// =============================================================================
// Test d'intégration du module routing.
// Le cas nominal appelle réellement OpenRouteService (pas de mock, cohérent
// avec le reste du projet — nécessite une clé ORS_API_KEY valide dans
// backend/.env). Les chemins d'erreur (panne réseau, réponse ORS anormale)
// sont testés en mockant `fetch` : les provoquer contre le vrai service
// serait non déterministe (on ne contrôle pas une panne tierce en direct).
// =============================================================================
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { computeRoute } from '../src/modules/routing/routing.service.js';

describe('routing module — validation HTTP', () => {
  it('refuse une requête sans from/to (400)', async () => {
    const app = await buildApp();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/route' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('refuse un format de coordonnées invalide (400)', async () => {
    const app = await buildApp();
    await app.ready();
    const res = await app.inject({
      method: 'GET',
      url: '/api/route?from=pas-des-coords&to=5.34,-3.99',
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('refuse des coordonnées hors de la zone de service (400)', async () => {
    const app = await buildApp();
    await app.ready();
    // Paris, hors bounding box Côte d'Ivoire
    const res = await app.inject({
      method: 'GET',
      url: '/api/route?from=48.8566,2.3522&to=5.34,-3.99',
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('refuse un profil invalide (400)', async () => {
    const app = await buildApp();
    await app.ready();
    const res = await app.inject({
      method: 'GET',
      url: '/api/route?from=5.32,-4.02&to=5.34,-3.99&profile=avion',
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it(
    'calcule un itinéraire réel entre deux points d\'Abidjan (200)',
    async () => {
      const app = await buildApp();
      await app.ready();
      const res = await app.inject({
        method: 'GET',
        url: '/api/route?from=5.32,-4.02&to=5.34,-3.99',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data.routes)).toBe(true);
      expect(body.data.routes.length).toBeGreaterThanOrEqual(1);
      const route = body.data.routes[0];
      expect(route.distanceMeters).toBeGreaterThan(0);
      expect(route.durationSeconds).toBeGreaterThan(0);
      expect(route.geometry.type).toBe('LineString');
      await app.close();
    },
    15000
  );

  it(
    'les profils driving-car et foot-walking donnent des résultats réellement différents',
    async () => {
      // Preuve de non-régression sur la raison même du remplacement d'OSRM :
      // ORS doit distinguer les profils, contrairement au serveur démo OSRM
      // (vérifié empiriquement hors-suite : distance/durée identiques sur 2
      // trajets différents, quel que soit le profil demandé).
      const app = await buildApp();
      await app.ready();
      const car = await app.inject({
        method: 'GET',
        url: '/api/route?from=5.32,-4.02&to=5.34,-3.99&profile=driving-car',
      });
      const foot = await app.inject({
        method: 'GET',
        url: '/api/route?from=5.32,-4.02&to=5.34,-3.99&profile=foot-walking',
      });
      expect(car.statusCode).toBe(200);
      expect(foot.statusCode).toBe(200);
      const carRoute = car.json().data.routes[0];
      const footRoute = foot.json().data.routes[0];
      // La marche est presque toujours plus lente par mètre que la voiture ;
      // exiger une différence de durée est un signal robuste que les deux
      // profils ne sont pas juste le même graphe recyclé.
      expect(footRoute.durationSeconds).not.toBe(carRoute.durationSeconds);
      await app.close();
    },
    20000
  );
});

describe('routing module — gestion des pannes (fetch mocké, déterministe)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('service ORS injoignable → 503 ROUTING_SERVICE_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    await expect(
      computeRoute({ lat: 5.32, lon: -4.02 }, { lat: 5.34, lon: -3.99 }, 'driving-car', false)
    ).rejects.toMatchObject({ statusCode: 503, code: 'ROUTING_SERVICE_ERROR' });
  });

  it('ORS répond une erreur "pas d\'itinéraire" (code 2010) → 422 NO_ROUTE (pas 500)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: { code: 2010, message: 'Could not find routable point' } }),
      } as Response)
    );

    await expect(
      computeRoute({ lat: 5.32, lon: -4.02 }, { lat: 5.34, lon: -3.99 }, 'driving-car', false)
    ).rejects.toMatchObject({ statusCode: 422, code: 'NO_ROUTE' });
  });

  it('ORS répond une erreur inattendue → 503 (pas de 500 générique)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: { code: 9999, message: 'Internal error' } }),
      } as Response)
    );

    await expect(
      computeRoute({ lat: 5.32, lon: -4.02 }, { lat: 5.34, lon: -3.99 }, 'driving-car', false)
    ).rejects.toMatchObject({ statusCode: 503, code: 'ROUTING_SERVICE_ERROR' });
  });

  it('réponse ORS sans "features" → 422 NO_ROUTE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ type: 'FeatureCollection', features: [] }),
      } as Response)
    );

    await expect(
      computeRoute({ lat: 5.32, lon: -4.02 }, { lat: 5.34, lon: -3.99 }, 'driving-car', false)
    ).rejects.toMatchObject({ statusCode: 422, code: 'NO_ROUTE' });
  });
});

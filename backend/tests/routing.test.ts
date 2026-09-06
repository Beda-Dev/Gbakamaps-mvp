// =============================================================================
// Test d'intégration du module routing.
// Le cas nominal appelle réellement le serveur OSRM public (pas de mock,
// cohérent avec le reste du projet). Les chemins d'erreur (panne réseau,
// réponse OSRM anormale) sont testés en mockant `fetch` : les provoquer
// contre le vrai service serait non déterministe (on ne contrôle pas une
// panne tierce en direct), donc les simuler ici est le choix honnête —
// pas un raccourci pour éviter d'appeler le vrai service.
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
});

describe('routing module — gestion des pannes (fetch mocké, déterministe)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('service OSRM injoignable → 503 ROUTING_SERVICE_ERROR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down'))
    );

    await expect(
      computeRoute({ lat: 5.32, lon: -4.02 }, { lat: 5.34, lon: -3.99 }, false)
    ).rejects.toMatchObject({ statusCode: 503, code: 'ROUTING_SERVICE_ERROR' });
  });

  it('OSRM répond code "NoRoute" → 422 NO_ROUTE (pas 500)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ code: 'NoRoute', routes: [] }),
      } as Response)
    );

    await expect(
      computeRoute({ lat: 5.32, lon: -4.02 }, { lat: 5.34, lon: -3.99 }, false)
    ).rejects.toMatchObject({ statusCode: 422, code: 'NO_ROUTE' });
  });

  it('OSRM répond un code inattendu → 503 (pas de 500 générique)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ code: 'InvalidQuery', message: 'bad request' }),
      } as Response)
    );

    await expect(
      computeRoute({ lat: 5.32, lon: -4.02 }, { lat: 5.34, lon: -3.99 }, false)
    ).rejects.toMatchObject({ statusCode: 503, code: 'ROUTING_SERVICE_ERROR' });
  });

  it('HTTP non-ok depuis OSRM → 503', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 502 } as Response)
    );

    await expect(
      computeRoute({ lat: 5.32, lon: -4.02 }, { lat: 5.34, lon: -3.99 }, false)
    ).rejects.toMatchObject({ statusCode: 503, code: 'ROUTING_SERVICE_ERROR' });
  });
});

// =============================================================================
// Test d'intégration du module places.
// Le cas nominal appelle réellement Overpass (pas de mock, cohérent avec la
// philosophie du reste du projet — nécessite une connexion internet). Les
// chemins d'erreur sont testés en mockant `fetch` (provoquer une vraie panne
// Overpass en direct serait non déterministe).
// =============================================================================
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';

describe('places module — validation HTTP', () => {
  it('refuse une requête sans q (400)', async () => {
    const app = await buildApp();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/places/search' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('refuse une recherche trop courte (400)', async () => {
    const app = await buildApp();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/places/search?q=a' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it(
    'trouve des lieux réels autour d\'Adjamé (Overpass réel, pas de mock)',
    async () => {
      const app = await buildApp();
      await app.ready();
      const res = await app.inject({ method: 'GET', url: '/api/places/search?q=Adjamé&limit=10' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data.places)).toBe(true);
      expect(body.data.places.length).toBeGreaterThan(0);
      const place = body.data.places[0];
      expect(typeof place.name).toBe('string');
      expect(place.name.length).toBeGreaterThan(0);
      expect(typeof place.lat).toBe('number');
      expect(typeof place.lon).toBe('number');
      // Toutes les coordonnées doivent rester dans la zone de service.
      for (const p of body.data.places) {
        expect(p.lat).toBeGreaterThanOrEqual(4.36);
        expect(p.lat).toBeLessThanOrEqual(10.74);
        expect(p.lon).toBeGreaterThanOrEqual(-8.6);
        expect(p.lon).toBeLessThanOrEqual(-2.49);
      }
      await app.close();
    },
    25000
  );
});

describe('places module — correspondance avec nos propres arrêts (matching multi-sources)', () => {
  // Coordonnées réelles vérifiées le 2026-09-06 : le nœud OSM "Adjamé"
  // (place=suburb) se trouve à 5.3531211,-4.0222008 — Overpass réel, pas
  // une supposition (voir les commandes de vérification dans la session).
  const ADJAME_LAT = 5.3531211;
  const ADJAME_LON = -4.0222008;
  let matchingStopId = '';
  let farStopId = '';
  let differentNameStopId = '';

  beforeAll(async () => {
    // Arrêt "réellement le même lieu" : à quelques mètres du nœud Overpass,
    // nom correspondant après normalisation ("Adjamé-Gare" ~ "Adjamé" — non,
    // en fait on teste avec un nom qui CONTIENT "Adjamé" pour matcher la
    // règle "l'un contient l'autre").
    const matching = await prisma.stop.create({
      data: { name: 'Adjamé [TEST]', lat: ADJAME_LAT + 0.0002, lon: ADJAME_LON, stopType: 'BUS_STOP' },
    });
    matchingStopId = matching.id;

    // Arrêt au même endroit mais un nom SANS RAPPORT — ne doit jamais
    // matcher malgré la proximité géographique (règle explicite : jamais
    // un seul des deux signaux seul).
    const differentName = await prisma.stop.create({
      data: { name: 'Gare Sud Totalement Différente [TEST]', lat: ADJAME_LAT + 0.0001, lon: ADJAME_LON, stopType: 'BUS_STOP' },
    });
    differentNameStopId = differentName.id;

    // Arrêt avec le même nom mais très loin — ne doit jamais matcher malgré
    // le nom identique (règle explicite : jamais un seul des deux signaux).
    const far = await prisma.stop.create({
      data: { name: 'Adjamé [TEST]', lat: ADJAME_LAT + 0.5, lon: ADJAME_LON, stopType: 'BUS_STOP' },
    });
    farStopId = far.id;
  });

  afterAll(async () => {
    await prisma.stop.deleteMany({ where: { id: { in: [matchingStopId, differentNameStopId, farStopId] } } });
  });

  it(
    "identifie l'arrêt proche ET nommé de façon cohérente comme la même entité, jamais celui juste proche ou juste homonyme",
    async () => {
      const app = await buildApp();
      await app.ready();
      const res = await app.inject({ method: 'GET', url: '/api/places/search?q=Adjamé&limit=15' });
      expect(res.statusCode).toBe(200);
      const places = res.json().data.places as { name: string; lat: number; lon: number; matchedStopId: string | null }[];

      // Le lieu Overpass "Adjamé" lui-même doit être apparié à notre arrêt
      // proche ET nommé de façon cohérente.
      const adjamePlace = places.find((p) => p.name === 'Adjamé');
      expect(adjamePlace).toBeDefined();
      expect(adjamePlace!.matchedStopId).toBe(matchingStopId);

      // Jamais apparié à l'arrêt lointain (même nom, mauvaise position) ni
      // à l'arrêt proche mais mal nommé (bonne position, nom sans rapport).
      expect(adjamePlace!.matchedStopId).not.toBe(farStopId);
      expect(adjamePlace!.matchedStopId).not.toBe(differentNameStopId);

      await app.close();
    },
    25000
  );
});

describe('places module — points d\'intérêt à proximité (GET /places/nearby)', () => {
  it('refuse des coordonnées manquantes (400)', async () => {
    const app = await buildApp();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/places/nearby' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it(
    'trouve de vrais POI autour du Plateau (Overpass réel, pas de mock)',
    async () => {
      const app = await buildApp();
      await app.ready();
      // Plateau, Abidjan — zone dense en pharmacies/commerces, vérifié
      // empiriquement le 2026-09-06 (7 résultats amenity~pharmacy|...).
      const res = await app.inject({
        method: 'GET',
        url: '/api/places/nearby?lat=5.32&lon=-4.02&radius=500',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data.pois)).toBe(true);
      expect(body.data.pois.length).toBeGreaterThan(0);
      const poi = body.data.pois[0];
      expect(typeof poi.name).toBe('string');
      expect(typeof poi.category).toBe('string');
      await app.close();
    },
    25000
  );

  it('une catégorie inconnue (hors liste blanche) est ignorée, ne casse jamais la requête', async () => {
    const app = await buildApp();
    await app.ready();
    const res = await app.inject({
      method: 'GET',
      url: '/api/places/nearby?lat=5.32&lon=-4.02&radius=100&categories=n_importe_quoi',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.pois).toEqual([]);
    await app.close();
  });
});

describe('places module — quartiers du Grand Abidjan (GET /places/neighborhoods)', () => {
  it(
    'retourne de vrais quartiers connus (Overpass réel, pas de mock)',
    async () => {
      const app = await buildApp();
      await app.ready();
      const res = await app.inject({ method: 'GET', url: '/api/places/neighborhoods' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      const names = (body.data.neighborhoods as { name: string }[]).map((n) => n.name);
      // "Cocody" est un quartier réel d'Abidjan, déjà vu dans les tests
      // manuels du 2026-09-06 — vérifie qu'on récupère des données réelles,
      // pas juste un tableau vide qui passerait le test sans rien prouver.
      expect(names).toContain('Cocody');
      await app.close();
    },
    25000
  );
});

describe('places module — gestion des pannes (fetch mocké, déterministe)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Overpass injoignable → 503 PLACES_SERVICE_ERROR (pas 500)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const app = await buildApp();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/places/search?q=Adjamé' });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('PLACES_SERVICE_ERROR');
    await app.close();
  });

  it('Overpass répond une erreur HTTP → 503 (pas de 500 générique)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 406, json: async () => null } as Response)
    );
    const app = await buildApp();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/places/search?q=Adjamé' });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it('éléments sans tag "name" sont ignorés, pas une erreur', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          elements: [
            { lat: 5.3, lon: -4.0, tags: {} },
            { lat: 5.32, lon: -4.02, tags: { name: 'Test Place [TEST]', amenity: 'pharmacy' } },
          ],
        }),
      } as Response)
    );
    const app = await buildApp();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/places/search?q=Test' });
    expect(res.statusCode).toBe(200);
    const places = res.json().data.places;
    expect(places).toHaveLength(1);
    expect(places[0].name).toBe('Test Place [TEST]');
    expect(places[0].category).toBe('pharmacy');
    await app.close();
  });
});

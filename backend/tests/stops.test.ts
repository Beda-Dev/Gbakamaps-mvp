// =============================================================================
// Test d'intégration du module stops — vérifie réellement la recherche
// spatiale PostGIS (ST_DWithin), pas seulement la forme des réponses.
// Trois arrêts sont semés à des distances connues (calculées par Haversine) :
//   A (Gare Sud Adjamé, STATION)   — point de référence de la recherche
//   B (Arrêt Adjamé Marché, BUS_STOP) — ~157m de A
//   C (Yopougon Gesco, GBAKA_STOP) — ~12,5km de A
// =============================================================================
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';

describe('stops module', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  const pointA = { lat: 5.32, lon: -4.02 }; // référence
  const pointB = { lat: 5.321, lon: -4.021 }; // ~157m de A
  const pointC = { lat: 5.4, lon: -4.1 }; // ~12.5km de A

  let stopAId = '';
  let stopBId = '';
  let stopCId = '';
  let stopDId = '';
  let testLineId = '';

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const stopA = await prisma.stop.create({
      data: { name: 'Gare Sud Adjamé [TEST]', lat: pointA.lat, lon: pointA.lon, stopType: 'STATION' },
    });
    const stopB = await prisma.stop.create({
      data: { name: 'Arrêt Adjamé Marché [TEST]', lat: pointB.lat, lon: pointB.lon, stopType: 'BUS_STOP' },
    });
    const stopC = await prisma.stop.create({
      data: { name: 'Yopougon Gesco [TEST]', lat: pointC.lat, lon: pointC.lon, stopType: 'GBAKA_STOP' },
    });
    // Même position que A : sert aux tests de filtre par mode/ligne (booléen
    // gbaka=true, distinct du `stopType` qui ne retient qu'un mode dominant).
    const stopD = await prisma.stop.create({
      data: {
        name: 'Arrêt Gbaka Adjamé [TEST]',
        lat: pointA.lat,
        lon: pointA.lon,
        stopType: 'BUS_STOP',
        gbaka: true,
      },
    });

    const testLine = await prisma.transportLine.create({
      data: { name: 'Ligne Test [TEST]', transportType: 'GBAKA', externalRef: 'test-line-filters' },
    });
    await prisma.stopLine.create({ data: { stopId: stopD.id, lineId: testLine.id } });

    stopAId = stopA.id;
    stopBId = stopB.id;
    stopCId = stopC.id;
    stopDId = stopD.id;
    testLineId = testLine.id;
  });

  afterAll(async () => {
    await prisma.stop.deleteMany({ where: { id: { in: [stopAId, stopBId, stopCId, stopDId] } } });
    await prisma.transportLine.delete({ where: { id: testLineId } });
    await app.close();
    await prisma.$disconnect();
  });

  it('le trigger PostGIS a bien renseigné la colonne geog à la création', async () => {
    const rows = await prisma.$queryRaw<{ geog_is_null: boolean }[]>`
      SELECT "geog" IS NULL AS geog_is_null FROM "stops" WHERE "id" = ${stopAId}
    `;
    expect(rows[0].geog_is_null).toBe(false);
  });

  it('radius=300 depuis A retourne A et B, triés par distance, pas C', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/stops/nearby?lat=${pointA.lat}&lon=${pointA.lon}&radius=300`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ids = body.data.stops.map((s: { id: string }) => s.id);

    expect(ids.indexOf(stopAId)).toBe(0); // A est à distance 0, doit être premier
    expect(ids).toContain(stopBId);
    expect(ids).not.toContain(stopCId);
  });

  it('radius=100 depuis A exclut B (~157m) — la borne de distance est respectée', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/stops/nearby?lat=${pointA.lat}&lon=${pointA.lon}&radius=100`,
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().data.stops.map((s: { id: string }) => s.id);
    expect(ids).toContain(stopAId);
    expect(ids).not.toContain(stopBId);
  });

  it('le filtre type=BUS_STOP inclut B et exclut A (STATION)', async () => {
    // Note : n'affirme pas une égalité stricte de la liste, la zone de test
    // chevauche désormais de vraies données GTFS (arrêts BUS_STOP réels du
    // Plateau) — seul le comportement du filtre est vérifié ici.
    const res = await app.inject({
      method: 'GET',
      url: `/api/stops/nearby?lat=${pointA.lat}&lon=${pointA.lon}&radius=300&type=BUS_STOP`,
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().data.stops.map((s: { id: string }) => s.id);
    expect(ids).toContain(stopBId);
    expect(ids).not.toContain(stopAId);
  });

  it('la distance retournée par PostGIS est cohérente avec le calcul attendu (~157m)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/stops/nearby?lat=${pointA.lat}&lon=${pointA.lon}&radius=300`,
    });
    const stopB = res.json().data.stops.find((s: { id: string }) => s.id === stopBId);
    expect(stopB.distanceMeters).toBeGreaterThan(140);
    expect(stopB.distanceMeters).toBeLessThan(170);
  });

  it('refuse des coordonnées hors de la zone de service (400)', async () => {
    // Paris, hors bounding box Côte d'Ivoire
    const res = await app.inject({
      method: 'GET',
      url: '/api/stops/nearby?lat=48.8566&lon=2.3522&radius=1000',
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuse un rayon supérieur au maximum autorisé (400)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/stops/nearby?lat=${pointA.lat}&lon=${pointA.lon}&radius=999999`,
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuse une requête sans lat/lon (400)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stops/nearby' });
    expect(res.statusCode).toBe(400);
  });

  it('GET /stops/:id retourne le détail avec compteurs', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/stops/${stopAId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.name).toBe('Gare Sud Adjamé [TEST]');
    expect(body.data._count).toEqual({ favorites: 0, reports: 0 });
  });

  it('GET /stops/:id inexistant retourne 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/stops/00000000-0000-4000-8000-000000000000',
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /stops/:id avec un id mal formé retourne 400 (pas 500)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stops/pas-un-uuid' });
    expect(res.statusCode).toBe(400);
  });

  describe('recherche textuelle (GET /stops/search)', () => {
    it("trouve un arrêt par une partie de son nom, insensible à la casse", async () => {
      const res = await app.inject({ method: 'GET', url: '/api/stops/search?q=adjamé marché' });
      expect(res.statusCode).toBe(200);
      const ids = res.json().data.stops.map((s: { id: string }) => s.id);
      expect(ids).toContain(stopBId);
      expect(ids).not.toContain(stopCId);
    });

    it('avec near=lat,lon, trie les résultats par distance à ce point', async () => {
      // A et B correspondent tous deux à "adjamé" ; en partant de B, B doit
      // être plus proche que A dans le tri (0m vs ~157m).
      const res = await app.inject({
        method: 'GET',
        url: `/api/stops/search?q=adjamé&near=${pointB.lat},${pointB.lon}`,
      });
      expect(res.statusCode).toBe(200);
      const stops = res.json().data.stops as { id: string; distanceMeters: number | null }[];
      const indexB = stops.findIndex((s) => s.id === stopBId);
      const indexA = stops.findIndex((s) => s.id === stopAId);
      expect(indexB).toBeGreaterThanOrEqual(0);
      expect(indexA).toBeGreaterThanOrEqual(0);
      expect(indexB).toBeLessThan(indexA);
      expect(stops[indexB].distanceMeters).toBeLessThan(5);
    });

    it('sans near, distanceMeters est null (pas de position de référence)', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/stops/search?q=adjamé' });
      const stops = res.json().data.stops as { distanceMeters: number | null }[];
      expect(stops.every((s) => s.distanceMeters === null)).toBe(true);
    });

    it('aucune correspondance renvoie une liste vide (pas une erreur)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/stops/search?q=xyzInexistantAbidjan123',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.stops).toEqual([]);
    });

    it("refuse une recherche trop courte (1 caractère) — 400", async () => {
      const res = await app.inject({ method: 'GET', url: '/api/stops/search?q=a' });
      expect(res.statusCode).toBe(400);
    });

    it('refuse un format near invalide (400)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/stops/search?q=adjamé&near=pas-des-coordonnées',
      });
      expect(res.statusCode).toBe(400);
    });

    it('/stops/search ne collisionne pas avec la route paramétrée /stops/:id', async () => {
      // "search" n'est pas un UUID valide : si le routeur matchait /stops/:id
      // en premier, ce serait un 400 (id mal formé) plutôt qu'un vrai résultat.
      const res = await app.inject({ method: 'GET', url: '/api/stops/search?q=adjamé' });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('filtres (GET /stops/nearby)', () => {
    it('modes=gbaka inclut D (gbaka=true) et exclut A (gbaka=false)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/stops/nearby?lat=${pointA.lat}&lon=${pointA.lon}&radius=100&modes=gbaka`,
      });
      expect(res.statusCode).toBe(200);
      const ids = res.json().data.stops.map((s: { id: string }) => s.id);
      expect(ids).toContain(stopDId);
      expect(ids).not.toContain(stopAId);
    });

    it('modes=woroworo,taxi (sémantique OU) — D exclu car ni woroworo ni taxi', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/stops/nearby?lat=${pointA.lat}&lon=${pointA.lon}&radius=100&modes=woroworo,taxi`,
      });
      expect(res.statusCode).toBe(200);
      const ids = res.json().data.stops.map((s: { id: string }) => s.id);
      expect(ids).not.toContain(stopDId);
    });

    it('modes invalide (mode inexistant) → 400', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/stops/nearby?lat=${pointA.lat}&lon=${pointA.lon}&radius=100&modes=avion`,
      });
      expect(res.statusCode).toBe(400);
    });

    it('lineId ne retient que les arrêts desservis par cette ligne', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/stops/nearby?lat=${pointA.lat}&lon=${pointA.lon}&radius=100&lineId=${testLineId}`,
      });
      expect(res.statusCode).toBe(200);
      const ids = res.json().data.stops.map((s: { id: string }) => s.id);
      expect(ids).toContain(stopDId);
      expect(ids).not.toContain(stopAId);
    });

    it('lineId mal formé (pas un UUID) → 400', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/stops/nearby?lat=${pointA.lat}&lon=${pointA.lon}&radius=100&lineId=pas-un-uuid`,
      });
      expect(res.statusCode).toBe(400);
    });

    it('combine type ET modes (ET logique entre les deux filtres différents)', async () => {
      // D est BUS_STOP + gbaka=true : type=BUS_STOP AND modes=gbaka doit le
      // retrouver ; type=STATION AND modes=gbaka ne doit rien retrouver (A
      // est STATION mais gbaka=false, D est gbaka=true mais BUS_STOP).
      const resMatch = await app.inject({
        method: 'GET',
        url: `/api/stops/nearby?lat=${pointA.lat}&lon=${pointA.lon}&radius=100&type=BUS_STOP&modes=gbaka`,
      });
      expect(resMatch.json().data.stops.map((s: { id: string }) => s.id)).toContain(stopDId);

      const resNoMatch = await app.inject({
        method: 'GET',
        url: `/api/stops/nearby?lat=${pointA.lat}&lon=${pointA.lon}&radius=100&type=STATION&modes=gbaka`,
      });
      expect(resNoMatch.json().data.stops.map((s: { id: string }) => s.id)).not.toContain(stopDId);
    });
  });
});

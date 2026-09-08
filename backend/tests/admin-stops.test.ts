// =============================================================================
// Test d'intégration du CRUD admin des arrêts (PROJECT_MEMORY.md §12.8).
//
// Tests réels contre la vraie base PostgreSQL/PostGIS — aucun mock de la DB,
// conformément à la convention du projet.
//
// Piège de test déjà rencontré sur ce projet (§12.7) : la base contient les
// 3820 arrêts GTFS réels d'Abidjan. Toutes les coordonnées utilisées ici sont
// donc volontairement placées à l'extrême nord-ouest de la Côte d'Ivoire
// (~9.9 / -8.4), loin de toute donnée réelle, pour que les assertions de
// proximité ne soient jamais polluées par des arrêts importés.
// =============================================================================
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';

// Zone de test isolée, dans les bornes de la Côte d'Ivoire mais très loin
// d'Abidjan (aucun arrêt GTFS réel alentour).
const TEST_LAT = 9.9;
const TEST_LON = -8.4;

describe('CRUD admin des arrêts', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  const suffix = Date.now();
  let userId = '';
  let adminId = '';
  let userSessionId = '';
  let adminSessionId = '';
  const createdStopIds: string[] = [];

  const asAdmin = { gbakamap_session: '' as string };

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const user = await prisma.user.create({
      data: {
        email: `admin-stops-user-${suffix}@example.com`,
        passwordHash: 'dummy-hash-not-used',
        displayName: 'Stops User',
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: `admin-stops-admin-${suffix}@example.com`,
        passwordHash: 'dummy-hash-not-used',
        displayName: 'Stops Admin',
        role: 'ADMIN',
      },
    });
    userId = user.id;
    adminId = admin.id;

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    userSessionId = (await prisma.session.create({ data: { userId, expiresAt } })).id;
    adminSessionId = (await prisma.session.create({ data: { userId: adminId, expiresAt } })).id;
    asAdmin.gbakamap_session = adminSessionId;
  });

  afterAll(async () => {
    // Nettoyage : les arrêts créés par les tests ne doivent jamais rester en
    // base (ils pollueraient les recherches de proximité des autres suites).
    await prisma.stop.deleteMany({ where: { id: { in: createdStopIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: [userId, adminId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, adminId] } } });
    await app.close();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // Autorisation — la faille de l'ancien projet (écriture sans auth) ne doit
  // en aucun cas réapparaître sur ces nouveaux endpoints.
  // ---------------------------------------------------------------------------

  it('POST /admin/stops sans authentification retourne 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/stops',
      payload: { name: 'Pirate', lat: TEST_LAT, lon: TEST_LON },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /admin/stops par un utilisateur non-admin retourne 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/stops',
      cookies: { gbakamap_session: userSessionId },
      payload: { name: 'Pirate', lat: TEST_LAT, lon: TEST_LON },
    });
    expect(res.statusCode).toBe(403);
  });

  it('DELETE /admin/stops/:id par un non-admin retourne 403 et ne supprime rien', async () => {
    const stop = await prisma.stop.create({
      data: { name: 'Arret protege [TEST]', lat: TEST_LAT, lon: TEST_LON },
    });
    createdStopIds.push(stop.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/stops/${stop.id}`,
      cookies: { gbakamap_session: userSessionId },
    });
    expect(res.statusCode).toBe(403);

    // L'arrêt doit toujours exister : un refus doit être un vrai refus.
    expect(await prisma.stop.findUnique({ where: { id: stop.id } })).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Création
  // ---------------------------------------------------------------------------

  it('POST /admin/stops cree un arret COMMUNITY sans jamais fabriquer un osmId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/stops',
      cookies: asAdmin,
      payload: {
        name: 'Gare de test admin [TEST]',
        lat: TEST_LAT,
        lon: TEST_LON,
        stopType: 'GBAKA_STOP',
        gbaka: true,
      },
    });

    expect(res.statusCode).toBe(201);
    const created = res.json().data;
    createdStopIds.push(created.id);

    expect(created.name).toBe('Gare de test admin [TEST]');
    expect(created.stopType).toBe('GBAKA_STOP');
    expect(created.gbaka).toBe(true);

    // Garde-fou central : un arrêt saisi par un admin est COMMUNITY, et son
    // osmId reste null. Fabriquer un osmId était le bug réel de l'ancien
    // projet (osmId = BigInt(Date.now()), cf. PROJECT_MEMORY.md §7).
    const fromDb = await prisma.stop.findUnique({ where: { id: created.id } });
    expect(fromDb?.source).toBe('COMMUNITY');
    expect(fromDb?.osmId).toBeNull();
  });

  it('un nom vide est enregistre comme null, jamais comme un nom invente', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/stops',
      cookies: asAdmin,
      payload: { name: '   ', lat: TEST_LAT, lon: TEST_LON },
    });

    expect(res.statusCode).toBe(201);
    const created = res.json().data;
    createdStopIds.push(created.id);
    expect(created.name).toBeNull();
  });

  it('rejette des coordonnees hors de la zone de service (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/stops',
      cookies: asAdmin,
      payload: { name: 'Paris', lat: 48.85, lon: 2.35 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('un arret cree est immediatement trouvable par la recherche de proximite', async () => {
    // Vérifie que la colonne géographique `geog` est bien remplie par le
    // trigger SQL stops_sync_geog_trigger à l'INSERT : sans elle, un arrêt
    // créé par un admin existerait en base mais serait invisible sur la carte
    // (ST_DWithin ne le retournerait jamais). C'est le test qui a le plus de
    // valeur ici — il porte sur le comportement réel de la base, pas sur Prisma.
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/stops',
      cookies: asAdmin,
      payload: { name: 'Arret geolocalise [TEST]', lat: TEST_LAT, lon: TEST_LON },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json().data;
    createdStopIds.push(created.id);

    const nearby = await app.inject({
      method: 'GET',
      url: `/api/stops/nearby?lat=${TEST_LAT}&lon=${TEST_LON}&radius=500`,
    });
    expect(nearby.statusCode).toBe(200);
    const ids = nearby.json().data.stops.map((s: { id: string }) => s.id);
    expect(ids).toContain(created.id);
  });

  // ---------------------------------------------------------------------------
  // Modification
  // ---------------------------------------------------------------------------

  it('PATCH /admin/stops/:id modifie les champs fournis et avance lastUpdated', async () => {
    const stop = await prisma.stop.create({
      data: {
        name: 'Avant modification [TEST]',
        lat: TEST_LAT,
        lon: TEST_LON,
        // Date volontairement ancienne pour prouver que lastUpdated avance
        // réellement (le champ n'est pas @updatedAt côté Prisma, il doit être
        // avancé explicitement par le service).
        lastUpdated: new Date('2020-01-01T00:00:00Z'),
      },
    });
    createdStopIds.push(stop.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/stops/${stop.id}`,
      cookies: asAdmin,
      payload: { name: 'Apres modification [TEST]', woroworo: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.name).toBe('Apres modification [TEST]');

    const fromDb = await prisma.stop.findUnique({ where: { id: stop.id } });
    expect(fromDb?.name).toBe('Apres modification [TEST]');
    expect(fromDb?.woroworo).toBe(true);
    expect(fromDb?.lastUpdated.getTime()).toBeGreaterThan(
      new Date('2020-01-01T00:00:00Z').getTime()
    );
  });

  it('un PATCH qui ne mentionne pas un champ laisse ce champ intact', async () => {
    const stop = await prisma.stop.create({
      data: { name: 'Nom a preserver [TEST]', lat: TEST_LAT, lon: TEST_LON, gbaka: true },
    });
    createdStopIds.push(stop.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/stops/${stop.id}`,
      cookies: asAdmin,
      payload: { woroworo: true },
    });
    expect(res.statusCode).toBe(200);

    const fromDb = await prisma.stop.findUnique({ where: { id: stop.id } });
    expect(fromDb?.name).toBe('Nom a preserver [TEST]');
    expect(fromDb?.gbaka).toBe(true);
    expect(fromDb?.woroworo).toBe(true);
  });

  it('deplacer un arret met a jour sa position geographique reelle', async () => {
    const stop = await prisma.stop.create({
      data: { name: 'Arret a deplacer [TEST]', lat: TEST_LAT, lon: TEST_LON },
    });
    createdStopIds.push(stop.id);

    // ~0,05 degre plus au nord, soit largement hors d'un rayon de 500 m autour
    // du point d'origine — le trigger doit resynchroniser `geog` a l'UPDATE.
    const movedLat = TEST_LAT + 0.05;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/stops/${stop.id}`,
      cookies: asAdmin,
      payload: { lat: movedLat },
    });
    expect(res.statusCode).toBe(200);

    const atOrigin = await app.inject({
      method: 'GET',
      url: `/api/stops/nearby?lat=${TEST_LAT}&lon=${TEST_LON}&radius=500`,
    });
    const originIds = atOrigin.json().data.stops.map((s: { id: string }) => s.id);
    expect(originIds).not.toContain(stop.id);

    const atDestination = await app.inject({
      method: 'GET',
      url: `/api/stops/nearby?lat=${movedLat}&lon=${TEST_LON}&radius=500`,
    });
    const destinationIds = atDestination.json().data.stops.map((s: { id: string }) => s.id);
    expect(destinationIds).toContain(stop.id);
  });

  it('rejette un PATCH vide (400) plutot que de repondre 200 sans rien faire', async () => {
    const stop = await prisma.stop.create({
      data: { name: 'Patch vide [TEST]', lat: TEST_LAT, lon: TEST_LON },
    });
    createdStopIds.push(stop.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/stops/${stop.id}`,
      cookies: asAdmin,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH sur un arret inexistant retourne 404', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/stops/00000000-0000-4000-8000-000000000000',
      cookies: asAdmin,
      payload: { name: 'Fantome' },
    });
    expect(res.statusCode).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // Impact et suppression
  // ---------------------------------------------------------------------------

  it('GET /admin/stops/:id/impact annonce les consequences reelles avant suppression', async () => {
    const stop = await prisma.stop.create({
      data: { name: 'Arret avec impact [TEST]', lat: TEST_LAT, lon: TEST_LON },
    });
    createdStopIds.push(stop.id);

    await prisma.favorite.create({ data: { userId, stopId: stop.id } });
    await prisma.report.create({
      data: { userId, stopId: stop.id, reportType: 'DAMAGE', title: 'Abri casse [TEST]' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/stops/${stop.id}/impact`,
      cookies: asAdmin,
    });

    expect(res.statusCode).toBe(200);
    const impact = res.json().data;
    expect(impact.favoritesDeleted).toBe(1);
    expect(impact.reportsDetached).toBe(1);
    expect(impact.stopLinesDeleted).toBe(0);
  });

  it('DELETE supprime les favoris en cascade mais CONSERVE les signalements', async () => {
    const stop = await prisma.stop.create({
      data: { name: 'Arret a supprimer [TEST]', lat: TEST_LAT, lon: TEST_LON },
    });
    createdStopIds.push(stop.id);

    await prisma.favorite.create({ data: { userId, stopId: stop.id } });
    const report = await prisma.report.create({
      data: { userId, stopId: stop.id, reportType: 'OTHER', title: 'Signalement survivant [TEST]' },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/stops/${stop.id}`,
      cookies: asAdmin,
    });

    expect(res.statusCode).toBe(200);
    const deleted = res.json().data;
    expect(deleted.favoritesDeleted).toBe(1);
    expect(deleted.reportsDetached).toBe(1);

    expect(await prisma.stop.findUnique({ where: { id: stop.id } })).toBeNull();
    expect(await prisma.favorite.count({ where: { stopId: stop.id } })).toBe(0);

    // Le signalement survit à la suppression de l'arrêt (onDelete: SetNull au
    // schéma) — il perd seulement son rattachement. Vérifié explicitement
    // parce que l'UI annonce ce comportement précis à l'administrateur.
    const survivingReport = await prisma.report.findUnique({ where: { id: report.id } });
    expect(survivingReport).not.toBeNull();
    expect(survivingReport?.stopId).toBeNull();

    await prisma.report.delete({ where: { id: report.id } });
  });

  it('DELETE sur un arret inexistant retourne 404', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/stops/00000000-0000-4000-8000-000000000000',
      cookies: asAdmin,
    });
    expect(res.statusCode).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // Non-régression des endpoints publics (le CRUD admin s'ajoute, ne remplace rien)
  // ---------------------------------------------------------------------------

  it('les endpoints publics de consultation restent accessibles sans authentification', async () => {
    const stop = await prisma.stop.create({
      data: { name: 'Arret public [TEST]', lat: TEST_LAT, lon: TEST_LON },
    });
    createdStopIds.push(stop.id);

    const detail = await app.inject({ method: 'GET', url: `/api/stops/${stop.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.id).toBe(stop.id);

    const nearby = await app.inject({
      method: 'GET',
      url: `/api/stops/nearby?lat=${TEST_LAT}&lon=${TEST_LON}&radius=1000`,
    });
    expect(nearby.statusCode).toBe(200);

    const search = await app.inject({ method: 'GET', url: '/api/stops/search?q=Arret public' });
    expect(search.statusCode).toBe(200);
  });
});

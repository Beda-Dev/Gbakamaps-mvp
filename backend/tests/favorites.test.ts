// =============================================================================
// Test d'intégration du module favorites.
// Seed de données réelles en beforeAll, nettoyage en afterAll, contre la
// vraie base PostgreSQL dockerisée — aucun mock.
// =============================================================================
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';

describe('favorites module', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  const suffix = Date.now();
  const user1Email = `fav1-${suffix}@example.com`;
  const user2Email = `fav2-${suffix}@example.com`;

  let stopId = '';
  let user1Id = '';
  let user2Id = '';
  let user1SessionId = '';
  let user2SessionId = '';
  let user1FavoriteId = '';

  const NON_EXISTENT_STOP_ID = '00000000-0000-4000-8000-000000000000';

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const stop = await prisma.stop.create({
      data: {
        name: 'Arrêt Favoris [TEST]',
        lat: 5.345,
        lon: -4.024,
        stopType: 'BUS_STOP',
      },
    });
    stopId = stop.id;

    const user1 = await prisma.user.create({
      data: { email: user1Email, passwordHash: 'dummy-hash-not-used', displayName: 'Fav User 1' },
    });
    const user2 = await prisma.user.create({
      data: { email: user2Email, passwordHash: 'dummy-hash-not-used', displayName: 'Fav User 2' },
    });
    user1Id = user1.id;
    user2Id = user2.id;

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const session1 = await prisma.session.create({ data: { userId: user1Id, expiresAt } });
    const session2 = await prisma.session.create({ data: { userId: user2Id, expiresAt } });
    user1SessionId = session1.id;
    user2SessionId = session2.id;
  });

  afterAll(async () => {
    await prisma.favorite.deleteMany({
      where: { OR: [{ userId: user1Id }, { userId: user2Id }] },
    });
    await prisma.session.deleteMany({
      where: { userId: { in: [user1Id, user2Id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [user1Id, user2Id] } },
    });
    if (stopId) {
      await prisma.stop.delete({ where: { id: stopId } }).catch(() => {});
    }
    await app.close();
    await prisma.$disconnect();
  });

  it('POST /favorites sans cookie de session → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/favorites',
      payload: { stopId },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /favorites avec un stopId inexistant → 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/favorites',
      cookies: { gbakamap_session: user1SessionId },
      payload: { stopId: NON_EXISTENT_STOP_ID },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /favorites valide → 201, favori créé en base', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/favorites',
      cookies: { gbakamap_session: user1SessionId },
      payload: { stopId },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.stopId).toBe(stopId);
    expect(body.data.userId).toBe(user1Id);
    user1FavoriteId = body.data.id;

    const inDb = await prisma.favorite.findFirst({ where: { userId: user1Id, stopId } });
    expect(inDb).not.toBeNull();
    expect(inDb!.id).toBe(user1FavoriteId);
  });

  it('POST /favorites en double → 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/favorites',
      cookies: { gbakamap_session: user1SessionId },
      payload: { stopId },
    });
    expect(res.statusCode).toBe(409);
  });

  it("GET /favorites retourne le favori avec l'arrêt, sans ceux de l'autre utilisateur", async () => {
    // Favori du deuxième utilisateur sur le même arrêt (IDOR check).
    const user2Favorite = await prisma.favorite.create({
      data: { userId: user2Id, stopId },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/favorites',
      cookies: { gbakamap_session: user1SessionId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.count).toBe(1);
    expect(body.data.favorites).toHaveLength(1);

    const fav = body.data.favorites[0];
    expect(fav.id).toBe(user1FavoriteId);
    expect(fav.userId).toBe(user1Id);
    expect(fav.stopId).toBe(stopId);
    // Infos de l'arrêt incluses.
    expect(fav.stop).toBeDefined();
    expect(fav.stop.id).toBe(stopId);
    expect(fav.stop.name).toBe('Arrêt Favoris [TEST]');
    // Pas de BigInt brut (sérialisable en JSON).
    expect(typeof fav.stop.osmId === 'string' || fav.stop.osmId === null).toBe(true);

    // Le favori de l'autre utilisateur ne doit pas fuiter.
    const ids = body.data.favorites.map((f: { id: string }) => f.id);
    expect(ids).not.toContain(user2Favorite.id);
    expect(body.data.favorites.every((f: { userId: string }) => f.userId === user1Id)).toBe(
      true
    );
  });

  it('DELETE /favorites/:stopId par le propriétaire → 200, supprimé en base', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/favorites/${stopId}`,
      cookies: { gbakamap_session: user1SessionId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);

    const inDb = await prisma.favorite.findFirst({ where: { userId: user1Id, stopId } });
    expect(inDb).toBeNull();
  });

  it("DELETE /favorites/:stopId par l'autre utilisateur → 404 (pas 403)", async () => {
    // À ce stade user1 n'a plus de favori sur cet arrêt, mais user2 oui
    // (créé dans le test GET) : user1 ne doit pas pouvoir le voir/supprimer.
    const user2StillHas = await prisma.favorite.findFirst({
      where: { userId: user2Id, stopId },
    });
    expect(user2StillHas).not.toBeNull();

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/favorites/${stopId}`,
      cookies: { gbakamap_session: user1SessionId },
    });
    expect(res.statusCode).toBe(404);

    // Le favori de user2 est toujours intact.
    const stillThere = await prisma.favorite.findFirst({
      where: { userId: user2Id, stopId },
    });
    expect(stillThere).not.toBeNull();
  });

  it('DELETE /favorites/:stopId avec un stopId non-uuid → 400 (pas 500)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/favorites/pas-un-uuid',
      cookies: { gbakamap_session: user1SessionId },
    });
    expect(res.statusCode).toBe(400);
  });
});

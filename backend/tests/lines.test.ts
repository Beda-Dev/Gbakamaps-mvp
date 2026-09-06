// =============================================================================
// Test d'intégration du module lines — consultation publique + définition
// du tarif par un administrateur (jamais par un utilisateur normal).
// =============================================================================
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';

describe('lines module', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  const suffix = Date.now();
  const userEmail = `lines-user-${suffix}@example.com`;
  const adminEmail = `lines-admin-${suffix}@example.com`;

  let lineId = '';
  let userId = '';
  let adminId = '';
  let userSessionId = '';
  let adminSessionId = '';

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const line = await prisma.transportLine.create({
      data: {
        name: 'Ligne Tarif [TEST]',
        shortName: 'T1',
        transportType: 'GBAKA',
        externalRef: `test-lines-fare-${suffix}`,
        fare: 250,
        fareVerified: false,
      },
    });
    lineId = line.id;

    const user = await prisma.user.create({
      data: { email: userEmail, passwordHash: 'dummy-hash-not-used', displayName: 'Lines User' },
    });
    const admin = await prisma.user.create({
      data: { email: adminEmail, passwordHash: 'dummy-hash-not-used', displayName: 'Lines Admin', role: 'ADMIN' },
    });
    userId = user.id;
    adminId = admin.id;

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const userSession = await prisma.session.create({ data: { userId, expiresAt } });
    const adminSession = await prisma.session.create({ data: { userId: adminId, expiresAt } });
    userSessionId = userSession.id;
    adminSessionId = adminSession.id;
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: { in: [userId, adminId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, adminId] } } });
    await prisma.transportLine.delete({ where: { id: lineId } });
    await app.close();
    await prisma.$disconnect();
  });

  it('GET /lines est public et inclut le tarif + son statut de vérification', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/lines?q=Tarif' });
    expect(res.statusCode).toBe(200);
    const line = res.json().data.lines.find((l: { id: string }) => l.id === lineId);
    expect(line).toBeDefined();
    expect(line.fare).toBe(250);
    expect(line.fareVerified).toBe(false);
  });

  it('GET /lines/:id public retourne le détail', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/lines/${lineId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(lineId);
  });

  it('GET /lines/:id inexistant → 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/lines/00000000-0000-4000-8000-000000000000',
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /admin/lines/:id sans authentification → 401', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/lines/${lineId}`,
      payload: { fare: 300 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('PATCH /admin/lines/:id par un utilisateur non-admin → 403', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/lines/${lineId}`,
      cookies: { gbakamap_session: userSessionId },
      payload: { fare: 300 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('PATCH /admin/lines/:id par un admin définit le tarif et le marque vérifié', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/lines/${lineId}`,
      cookies: { gbakamap_session: adminSessionId },
      payload: { fare: 300 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.fare).toBe(300);
    expect(body.fareVerified).toBe(true);

    const fromDb = await prisma.transportLine.findUnique({ where: { id: lineId } });
    expect(fromDb?.fare).toBe(300);
    expect(fromDb?.fareVerified).toBe(true);
  });

  it('un admin peut explicitement marquer un tarif comme inconnu (fare: null)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/lines/${lineId}`,
      cookies: { gbakamap_session: adminSessionId },
      payload: { fare: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.fare).toBeNull();
    expect(res.json().data.fareVerified).toBe(true);
  });

  it('rejette un tarif négatif (400)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/lines/${lineId}`,
      cookies: { gbakamap_session: adminSessionId },
      payload: { fare: -50 },
    });
    expect(res.statusCode).toBe(400);
  });
});

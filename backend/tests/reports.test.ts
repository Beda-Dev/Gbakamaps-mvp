// =============================================================================
// Test d'intégration du module reports (signalements + modération admin).
// Seed de données réelles en beforeAll, nettoyage en afterAll, contre la
// vraie base PostgreSQL dockerisée — aucun mock.
// =============================================================================
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';

describe('reports module', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  const suffix = Date.now();
  const userEmail = `rep-user-${suffix}@example.com`;
  const adminEmail = `rep-admin-${suffix}@example.com`;

  let stopId = '';
  let userId = '';
  let adminId = '';
  let userSessionId = '';
  let adminSessionId = '';
  let userReportId = '';
  let adminReportId = '';

  const NON_EXISTENT_UUID = '00000000-0000-4000-8000-000000000000';

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const stop = await prisma.stop.create({
      data: {
        name: 'Arrêt Reports [TEST]',
        lat: 5.345,
        lon: -4.024,
        stopType: 'BUS_STOP',
      },
    });
    stopId = stop.id;

    const user = await prisma.user.create({
      data: { email: userEmail, passwordHash: 'dummy-hash-not-used', displayName: 'Report User' },
    });
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: 'dummy-hash-not-used',
        displayName: 'Report Admin',
        role: 'ADMIN',
      },
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
    await prisma.report.deleteMany({
      where: { OR: [{ userId }, { userId: adminId }] },
    });
    await prisma.session.deleteMany({
      where: { userId: { in: [userId, adminId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [userId, adminId] } },
    });
    if (stopId) {
      await prisma.stop.delete({ where: { id: stopId } }).catch(() => {});
    }
    await app.close();
    await prisma.$disconnect();
  });

  it('POST /reports sans cookie → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/reports',
      payload: { reportType: 'DAMAGE', title: 'Abribus cassé ici' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /reports avec reportType invalide → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/reports',
      cookies: { gbakamap_session: userSessionId },
      payload: { reportType: 'NOT_A_TYPE', title: 'Titre valide ici' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /reports avec stopId inexistant → 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/reports',
      cookies: { gbakamap_session: userSessionId },
      payload: {
        reportType: 'DAMAGE',
        title: 'Abribus cassé ici',
        stopId: NON_EXISTENT_UUID,
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /reports valide (avec et sans stopId) → 201, vérifié en base', async () => {
    const resWithStop = await app.inject({
      method: 'POST',
      url: '/api/reports',
      cookies: { gbakamap_session: userSessionId },
      payload: {
        reportType: 'DAMAGE',
        title: 'Abribus cassé à cet arrêt',
        description: 'La vitre est brisée.',
        stopId,
      },
    });
    expect(resWithStop.statusCode).toBe(201);
    const bodyWithStop = resWithStop.json();
    expect(bodyWithStop.success).toBe(true);
    expect(bodyWithStop.data.reportType).toBe('DAMAGE');
    expect(bodyWithStop.data.stopId).toBe(stopId);
    expect(bodyWithStop.data.userId).toBe(userId);
    expect(bodyWithStop.data.status).toBe('PENDING');
    userReportId = bodyWithStop.data.id;

    const inDbWithStop = await prisma.report.findUnique({ where: { id: userReportId } });
    expect(inDbWithStop).not.toBeNull();
    expect(inDbWithStop!.status).toBe('PENDING');
    expect(inDbWithStop!.userId).toBe(userId);

    const resWithoutStop = await app.inject({
      method: 'POST',
      url: '/api/reports',
      cookies: { gbakamap_session: adminSessionId },
      payload: {
        reportType: 'MISSING_STOP',
        title: 'Il manque un arrêt ici',
        lat: 5.35,
        lon: -4.02,
      },
    });
    expect(resWithoutStop.statusCode).toBe(201);
    const bodyWithoutStop = resWithoutStop.json();
    expect(bodyWithoutStop.success).toBe(true);
    adminReportId = bodyWithoutStop.data.id;

    const inDbWithoutStop = await prisma.report.findUnique({ where: { id: adminReportId } });
    expect(inDbWithoutStop).not.toBeNull();
    expect(inDbWithoutStop!.stopId).toBeNull();
  });

  it('GET /reports/mine ne retourne QUE les signalements de l’utilisateur courant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/reports/mine',
      cookies: { gbakamap_session: userSessionId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.count).toBe(1);
    expect(body.data.reports).toHaveLength(1);
    expect(body.data.reports[0].id).toBe(userReportId);
    expect(body.data.reports.every((r: { userId: string }) => r.userId === userId)).toBe(true);
    const ids = body.data.reports.map((r: { id: string }) => r.id);
    expect(ids).not.toContain(adminReportId);
  });

  it('GET /admin/reports par un utilisateur normal → 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/reports',
      cookies: { gbakamap_session: userSessionId },
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET /admin/reports sans authentification → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/reports' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /admin/reports par l’admin → 200, tous les signalements', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/reports',
      cookies: { gbakamap_session: adminSessionId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    const ids = body.data.reports.map((r: { id: string }) => r.id);
    expect(ids).toContain(userReportId);
    expect(ids).toContain(adminReportId);
    expect(body.data.total).toBeGreaterThanOrEqual(2);
    // Infos utilisateur incluses, sans passwordHash.
    const userReport = body.data.reports.find((r: { id: string }) => r.id === userReportId);
    expect(userReport.user).toBeDefined();
    expect(userReport.user.email).toBe(userEmail);
    expect(userReport.user.passwordHash).toBeUndefined();
  });

  it('GET /admin/reports?status=PENDING filtre correctement', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/reports?status=PENDING',
      cookies: { gbakamap_session: adminSessionId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.reports.length).toBeGreaterThanOrEqual(1);
    expect(body.data.reports.every((r: { status: string }) => r.status === 'PENDING')).toBe(true);
    const ids = body.data.reports.map((r: { id: string }) => r.id);
    expect(ids).toContain(userReportId);
  });

  it('PATCH /admin/reports/:id par un utilisateur normal → 403', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/reports/${userReportId}`,
      cookies: { gbakamap_session: userSessionId },
      payload: { status: 'APPROVED' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('PATCH /admin/reports/:id par l’admin → 200, vérifié en base', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/reports/${userReportId}`,
      cookies: { gbakamap_session: adminSessionId },
      payload: { status: 'APPROVED' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('APPROVED');

    const inDb = await prisma.report.findUnique({ where: { id: userReportId } });
    expect(inDb).not.toBeNull();
    expect(inDb!.status).toBe('APPROVED');
    expect(inDb!.moderatedBy).toBe(adminId);
    expect(inDb!.moderatedAt).not.toBeNull();
  });

  it('PATCH /admin/reports/:id avec un status invalide → 400', async () => {
    const resPending = await app.inject({
      method: 'PATCH',
      url: `/api/admin/reports/${userReportId}`,
      cookies: { gbakamap_session: adminSessionId },
      payload: { status: 'PENDING' },
    });
    expect(resPending.statusCode).toBe(400);

    const resArbitrary = await app.inject({
      method: 'PATCH',
      url: `/api/admin/reports/${userReportId}`,
      cookies: { gbakamap_session: adminSessionId },
      payload: { status: 'WHATEVER' },
    });
    expect(resArbitrary.statusCode).toBe(400);
  });

  it('PATCH /admin/reports/:id sur un id inexistant → 404', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/reports/${NON_EXISTENT_UUID}`,
      cookies: { gbakamap_session: adminSessionId },
      payload: { status: 'APPROVED' },
    });
    expect(res.statusCode).toBe(404);
  });
});

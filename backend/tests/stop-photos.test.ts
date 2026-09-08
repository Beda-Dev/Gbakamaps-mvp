// =============================================================================
// Test d'intégration des photos communautaires (§9/§12.8) : upload
// multipart réel, suppression réservée à l'auteur/un admin, et le fait que
// GET /stops/:id/photos renvoie bien les photos communautaires en plus des
// sources externes (Mapillary/Panoramax, non mockées ici — le format de
// leur fusion est déjà couvert par un test manuel documenté dans
// PROJECT_MEMORY.md ; ce fichier se concentre sur la partie communautaire,
// seule partie sous notre contrôle direct).
//
// Zone de test isolée (voir admin-stops.test.ts) : loin de tout arrêt GTFS
// réel pour ne polluer aucune autre suite.
// =============================================================================
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';

const TEST_LAT = 9.85;
const TEST_LON = -8.35;

// Construit un corps multipart/form-data minimal à la main (app.inject()
// n'a pas d'assistant multipart natif) — un seul champ fichier "photo",
// contenu binaire arbitraire (pas un vrai JPEG valide, mais le champ
// mimetype suffit à passer la liste blanche ; le contenu lui-même n'est
// jamais décodé côté serveur, juste écrit tel quel sur disque).
function buildMultipartBody(fieldName: string, filename: string, mimeType: string, content: Buffer) {
  const boundary = `----testboundary${Date.now()}`;
  const parts = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n`,
    `Content-Type: ${mimeType}\r\n\r\n`,
  ];
  const body = Buffer.concat([
    Buffer.from(parts.join('')),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

describe('Photos communautaires des arrêts', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const suffix = Date.now();
  let userId = '';
  let otherUserId = '';
  let adminId = '';
  let userSessionId = '';
  let otherUserSessionId = '';
  let adminSessionId = '';
  let stopId = '';
  const uploadsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'uploads', 'stop-photos');

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const user = await prisma.user.create({
      data: { email: `photo-user-${suffix}@example.com`, passwordHash: 'x', displayName: 'Photo User' },
    });
    const other = await prisma.user.create({
      data: { email: `photo-other-${suffix}@example.com`, passwordHash: 'x', displayName: 'Autre User' },
    });
    const admin = await prisma.user.create({
      data: { email: `photo-admin-${suffix}@example.com`, passwordHash: 'x', role: 'ADMIN' },
    });
    userId = user.id;
    otherUserId = other.id;
    adminId = admin.id;

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    userSessionId = (await prisma.session.create({ data: { userId, expiresAt } })).id;
    otherUserSessionId = (await prisma.session.create({ data: { userId: otherUserId, expiresAt } })).id;
    adminSessionId = (await prisma.session.create({ data: { userId: adminId, expiresAt } })).id;

    const stop = await prisma.stop.create({
      data: { name: 'Arret photo [TEST]', lat: TEST_LAT, lon: TEST_LON },
    });
    stopId = stop.id;
  });

  afterAll(async () => {
    await prisma.stopPhoto.deleteMany({ where: { stopId } });
    await prisma.stop.delete({ where: { id: stopId } }).catch(() => {});
    await prisma.session.deleteMany({ where: { userId: { in: [userId, otherUserId, adminId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId, adminId] } } });
    await app.close();
    await prisma.$disconnect();
    // Nettoyage des fichiers réellement écrits sur disque pendant ce test.
    rmSync(uploadsDir, { recursive: true, force: true });
  });

  it('POST /stops/:id/photos sans authentification retourne 401', async () => {
    const { body, contentType } = buildMultipartBody('photo', 'test.jpg', 'image/jpeg', Buffer.from('fake'));
    const res = await app.inject({
      method: 'POST',
      url: `/api/stops/${stopId}/photos`,
      headers: { 'content-type': contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it('un type de fichier non supporté (ex. text/plain) est refusé', async () => {
    const { body, contentType } = buildMultipartBody('photo', 'test.txt', 'text/plain', Buffer.from('hello'));
    const res = await app.inject({
      method: 'POST',
      url: `/api/stops/${stopId}/photos`,
      cookies: { gbakamap_session: userSessionId },
      headers: { 'content-type': contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(403);
  });

  let uploadedPhotoId = '';

  it('un utilisateur connecté peut ajouter une vraie photo (upload réellement écrit sur disque)', async () => {
    const fakeImageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]); // en-tête JPEG minimal
    const { body, contentType } = buildMultipartBody('photo', 'stop.jpg', 'image/jpeg', fakeImageBytes);
    const res = await app.inject({
      method: 'POST',
      url: `/api/stops/${stopId}/photos`,
      cookies: { gbakamap_session: userSessionId },
      headers: { 'content-type': contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(json.data.uploadedByUserId).toBe(userId);
    expect(json.data.url).toMatch(/^\/api\/uploads\/stop-photos\/.+\.jpg$/);
    uploadedPhotoId = json.data.id;

    // Le fichier existe réellement sur le disque (pas juste une ligne en base).
    const filename = json.data.url.split('/').pop()!;
    const onDisk = readFileSync(join(uploadsDir, filename));
    expect(onDisk.equals(fakeImageBytes)).toBe(true);
  });

  it('GET /stops/:id/photos inclut la photo communautaire ajoutée', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/stops/${stopId}/photos` });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.data.communityPhotos).toHaveLength(1);
    expect(json.data.communityPhotos[0].id).toBe(uploadedPhotoId);
    expect(json.data.communityPhotos[0].uploadedByName).toBe('Photo User');
  });

  it("un autre utilisateur ne peut pas supprimer la photo de quelqu'un d'autre (403)", async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/stops/${stopId}/photos/${uploadedPhotoId}`,
      cookies: { gbakamap_session: otherUserSessionId },
    });
    expect(res.statusCode).toBe(403);
  });

  it('un admin peut supprimer la photo de quelqu\'un d\'autre', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/stops/${stopId}/photos/${uploadedPhotoId}`,
      cookies: { gbakamap_session: adminSessionId },
    });
    expect(res.statusCode).toBe(200);

    const check = await app.inject({ method: 'GET', url: `/api/stops/${stopId}/photos` });
    expect(check.json().data.communityPhotos).toHaveLength(0);
  });

  it('un utilisateur peut supprimer sa propre photo', async () => {
    const fakeImageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const { body, contentType } = buildMultipartBody('photo', 'stop2.jpg', 'image/jpeg', fakeImageBytes);
    const uploadRes = await app.inject({
      method: 'POST',
      url: `/api/stops/${stopId}/photos`,
      cookies: { gbakamap_session: userSessionId },
      headers: { 'content-type': contentType },
      payload: body,
    });
    const photoId = uploadRes.json().data.id;

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/stops/${stopId}/photos/${photoId}`,
      cookies: { gbakamap_session: userSessionId },
    });
    expect(deleteRes.statusCode).toBe(200);
  });
});

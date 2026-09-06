// =============================================================================
// Test d'intégration du parcours d'authentification complet.
// Nécessite la base Docker démarrée (`docker compose up -d db`) et le
// backend/.env pointant dessus en localhost. Utilise app.inject() —
// aucun port réseau n'est ouvert.
// =============================================================================
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';

describe('auth flow', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const email = `test-${Date.now()}@example.com`;
  const password = 'SuperSecret123';
  let sessionCookieValue = '';

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
    await prisma.$disconnect();
  });

  it('signup crée un utilisateur et pose un cookie de session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email, password, displayName: 'Test User' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.email).toBe(email);
    expect(body.data).not.toHaveProperty('passwordHash');

    const cookie = res.cookies.find((c) => c.name === 'gbakamap_session');
    expect(cookie).toBeDefined();
    sessionCookieValue = cookie!.value;
  });

  it('refuse un second signup avec le même email (409)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email, password, displayName: 'Duplicate' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('refuse un email invalide (400, validation Zod)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'pas-un-email', password: 'whatever123' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuse le login avec un mauvais mot de passe (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('refuse le login pour un email inexistant avec le même statut (pas de fuite d\'info)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'inexistant@example.com', password: 'whatever123' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Email ou mot de passe incorrect');
  });

  it('accepte le login avec les bons identifiants', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password },
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuse /auth/me sans cookie de session (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('accepte /auth/me avec un cookie de session valide', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { gbakamap_session: sessionCookieValue },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.email).toBe(email);
  });

  it('refuse une mutation authentifiée avec une origine différente (CSRF)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { gbakamap_session: sessionCookieValue },
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('logout révoque la session : /auth/me redevient 401 ensuite', async () => {
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { gbakamap_session: sessionCookieValue },
    });
    expect(logoutRes.statusCode).toBe(200);

    const meRes = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { gbakamap_session: sessionCookieValue },
    });
    expect(meRes.statusCode).toBe(401);
  });
});

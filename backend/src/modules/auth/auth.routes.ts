// =============================================================================
// Routes d'authentification.
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { requireAuth } from '../../common/auth-middleware.js';
import { loginSchema, signupSchema } from './auth.schemas.js';
import { createSession, revokeSession, signup, verifyCredentials } from './auth.service.js';

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: env.SESSION_TTL_HOURS * 60 * 60,
  };
}

function toPublicUser(user: { id: string; email: string; displayName: string | null; role: string }) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/signup', async (request, reply) => {
    const input = signupSchema.parse(request.body);
    const user = await signup(input);
    const session = await createSession(user.id);

    reply.setCookie(env.SESSION_COOKIE_NAME, session.id, sessionCookieOptions());
    return reply.status(201).send({ success: true, data: toPublicUser(user) });
  });

  // Rate limit dédié et plus strict que le global (@fastify/rate-limit
  // supporte un override par route via `config.rateLimit`) : une route de
  // login est la cible naturelle du brute-force.
  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const input = loginSchema.parse(request.body);
      const user = await verifyCredentials(input);
      const session = await createSession(user.id);

      reply.setCookie(env.SESSION_COOKIE_NAME, session.id, sessionCookieOptions());
      return reply.send({ success: true, data: toPublicUser(user) });
    }
  );

  app.post('/auth/logout', { preHandler: requireAuth }, async (request, reply) => {
    const sessionId = request.cookies[env.SESSION_COOKIE_NAME];
    if (sessionId) {
      await revokeSession(sessionId);
    }
    reply.clearCookie(env.SESSION_COOKIE_NAME, { path: '/' });
    return reply.send({ success: true, data: null });
  });

  app.get('/auth/me', { preHandler: requireAuth }, async (request, reply) => {
    return reply.send({ success: true, data: toPublicUser(request.currentUser!) });
  });
}

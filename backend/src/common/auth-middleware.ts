// =============================================================================
// Middleware d'authentification/autorisation, à utiliser en preHandler.
// Corrige le défaut identifié dans l'ancien projet : le middleware Next.js
// ne vérifiait que la PRÉSENCE d'un header "Bearer ...", jamais sa validité.
// Ici, requireAuth va systématiquement chercher la session en base.
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { getSessionWithUser } from '../modules/auth/auth.service.js';
import { ForbiddenError, UnauthorizedError } from './errors.js';

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const sessionId = request.cookies[env.SESSION_COOKIE_NAME];

  if (!sessionId) {
    throw new UnauthorizedError();
  }

  const session = await getSessionWithUser(sessionId);

  if (!session) {
    reply.clearCookie(env.SESSION_COOKIE_NAME, { path: '/' });
    throw new UnauthorizedError('Session expirée ou invalide');
  }

  request.currentUser = session.user;
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await requireAuth(request, reply);

  if (request.currentUser?.role !== 'ADMIN') {
    throw new ForbiddenError('Droits administrateur requis');
  }
}

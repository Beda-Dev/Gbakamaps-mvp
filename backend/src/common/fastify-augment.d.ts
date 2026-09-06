// =============================================================================
// Augmentation de types Fastify — attache l'utilisateur courant à la requête
// une fois authentifiée par le middleware requireAuth.
// =============================================================================
import type { User } from '../generated/prisma/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: User;
  }
}

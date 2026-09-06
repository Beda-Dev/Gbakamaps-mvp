// =============================================================================
// Routes du module favorites — toutes protégées par requireAuth.
// Le filtrage se fait toujours par request.currentUser.id, jamais par un
// userId fourni dans le body/params/query.
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../common/auth-middleware.js';
import {
  createFavoriteBodySchema,
  favoriteStopIdParamsSchema,
} from './favorites.schemas.js';
import { addFavorite, listFavorites, removeFavorite } from './favorites.service.js';

export async function favoritesRoutes(app: FastifyInstance) {
  app.post('/favorites', { preHandler: requireAuth }, async (request, reply) => {
    const { stopId } = createFavoriteBodySchema.parse(request.body);
    const favorite = await addFavorite(request.currentUser!.id, stopId);
    return reply.status(201).send({ success: true, data: favorite });
  });

  app.get('/favorites', { preHandler: requireAuth }, async (request, reply) => {
    const favorites = await listFavorites(request.currentUser!.id);
    return reply.send({ success: true, data: { favorites, count: favorites.length } });
  });

  app.delete('/favorites/:stopId', { preHandler: requireAuth }, async (request, reply) => {
    const { stopId } = favoriteStopIdParamsSchema.parse(request.params);
    await removeFavorite(request.currentUser!.id, stopId);
    return reply.send({ success: true, data: null });
  });
}

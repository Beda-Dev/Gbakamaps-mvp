// =============================================================================
// Routes du module places — public, lecture seule.
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { searchPlacesQuerySchema } from './places.schemas.js';
import { searchPlaces } from './places.service.js';

export async function placesRoutes(app: FastifyInstance) {
  app.get('/places/search', async (request, reply) => {
    const query = searchPlacesQuerySchema.parse(request.query);
    const places = await searchPlaces(query.q, query.limit);
    return reply.send({ success: true, data: { places, count: places.length } });
  });
}

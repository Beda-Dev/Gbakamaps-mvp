// =============================================================================
// Routes du module stops — lecture seule au MVP.
// La création/modification d'arrêts passe par le module reports (modération
// communautaire) ou le script d'import batch, jamais par un endpoint public
// direct — corrige la faille de l'ancien projet où PATCH /api/stops/[id]
// n'exigeait aucune authentification.
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { nearbyStopsQuerySchema, stopIdParamsSchema } from './stops.schemas.js';
import { findById, findNearby } from './stops.service.js';

export async function stopsRoutes(app: FastifyInstance) {
  app.get('/stops/nearby', async (request, reply) => {
    const query = nearbyStopsQuerySchema.parse(request.query);

    const stops = await findNearby({
      lat: query.lat,
      lon: query.lon,
      radiusMeters: query.radius,
      limit: query.limit,
      type: query.type,
    });

    return reply.send({
      success: true,
      data: { stops, count: stops.length, radius: query.radius },
    });
  });

  app.get('/stops/:id', async (request, reply) => {
    const { id } = stopIdParamsSchema.parse(request.params);
    const stop = await findById(id);
    return reply.send({ success: true, data: stop });
  });
}

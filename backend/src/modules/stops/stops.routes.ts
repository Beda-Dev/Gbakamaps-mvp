// =============================================================================
// Routes du module stops — lecture seule au MVP.
// La création/modification d'arrêts passe par le module reports (modération
// communautaire) ou le script d'import batch, jamais par un endpoint public
// direct — corrige la faille de l'ancien projet où PATCH /api/stops/[id]
// n'exigeait aucune authentification.
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { nearbyStopsQuerySchema, searchStopsQuerySchema, stopIdParamsSchema } from './stops.schemas.js';
import { findById, findNearby, searchStops } from './stops.service.js';

export async function stopsRoutes(app: FastifyInstance) {
  // Recherche textuelle (nom d'arrêt ou de ligne) — écart UX comblé en
  // phase 2 (PROJECT_MEMORY.md §12) : jusqu'ici seule la proximité
  // géographique permettait de trouver un arrêt.
  app.get('/stops/search', async (request, reply) => {
    const query = searchStopsQuerySchema.parse(request.query);
    const stops = await searchStops({ query: query.q, limit: query.limit, near: query.near });
    return reply.send({ success: true, data: { stops, count: stops.length } });
  });

  app.get('/stops/nearby', async (request, reply) => {
    const query = nearbyStopsQuerySchema.parse(request.query);

    const stops = await findNearby({
      lat: query.lat,
      lon: query.lon,
      radiusMeters: query.radius,
      limit: query.limit,
      type: query.type,
      modes: query.modes,
      lineId: query.lineId,
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

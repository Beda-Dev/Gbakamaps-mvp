// =============================================================================
// Routes du module trip-planning — lecture seule, public (comme /stops et
// /route, aucune authentification requise pour planifier un trajet).
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { tripPlanQuerySchema } from './trip-planning.schemas.js';
import { planTrip } from './trip-planning.service.js';

export async function tripPlanningRoutes(app: FastifyInstance) {
  app.get('/trip-plan', async (request, reply) => {
    const query = tripPlanQuerySchema.parse(request.query);

    const result = await planTrip({
      from: query.from,
      to: query.to,
      walkRadius: query.walkRadius,
      maxTransfers: query.maxTransfers,
      optimize: query.optimize,
      limit: query.limit,
    });

    return reply.send({
      success: true,
      data: {
        plans: result.plans,
        criterion: query.optimize,
        walkRadius: query.walkRadius,
        note: result.note,
      },
    });
  });
}

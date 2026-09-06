// =============================================================================
// Routes du module routing — lecture seule, publique (comme la recherche
// d'arrêts : planifier un trajet ne requiert pas de compte).
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { routeQuerySchema } from './routing.schemas.js';
import { computeRoute } from './routing.service.js';

export async function routingRoutes(app: FastifyInstance) {
  app.get('/route', async (request, reply) => {
    const query = routeQuerySchema.parse(request.query);
    const result = await computeRoute(query.from, query.to, query.alternatives);
    return reply.send({ success: true, data: result });
  });
}

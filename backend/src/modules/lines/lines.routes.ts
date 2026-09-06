// =============================================================================
// Routes du module lines — consultation publique, tarif géré par un admin
// (jamais d'endpoint permettant à un utilisateur normal de fixer un tarif).
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../../common/auth-middleware.js';
import {
  lineIdParamsSchema,
  listLinesQuerySchema,
  setLineFareBodySchema,
} from './lines.schemas.js';
import { getLineById, listLines, setLineFare } from './lines.service.js';

export async function linesRoutes(app: FastifyInstance) {
  app.get('/lines', async (request, reply) => {
    const query = listLinesQuerySchema.parse(request.query);
    const lines = await listLines(query);
    return reply.send({ success: true, data: { lines, count: lines.length } });
  });

  app.get('/lines/:id', async (request, reply) => {
    const { id } = lineIdParamsSchema.parse(request.params);
    const line = await getLineById(id);
    return reply.send({ success: true, data: line });
  });

  app.patch('/admin/lines/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = lineIdParamsSchema.parse(request.params);
    const { fare } = setLineFareBodySchema.parse(request.body);
    const line = await setLineFare(id, fare);
    return reply.send({ success: true, data: line });
  });
}

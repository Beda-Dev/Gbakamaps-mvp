// =============================================================================
// Routes du module lines — consultation publique, CRUD réservé à un admin
// (jamais d'endpoint permettant à un utilisateur normal de créer/modifier
// une ligne ou son tarif). Voir lines.schemas.ts/lines.service.ts pour les
// principes structurants du CRUD admin (§12.16/§12.21).
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../../common/auth-middleware.js';
import {
  createLineBodySchema,
  lineIdParamsSchema,
  listLinesQuerySchema,
  updateLineBodySchema,
} from './lines.schemas.js';
import {
  createLine,
  deleteLine,
  getLineById,
  getLineDeletionImpact,
  listAllLinesForAdmin,
  listLines,
  updateLine,
} from './lines.service.js';

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

  // ---------------------------------------------------------------------------
  // Administration (rôle ADMIN requis) — au-delà du seul tarif, voir §12.16
  // ---------------------------------------------------------------------------

  // Liste ADMIN distincte de `GET /lines` (public) : inclut les lignes
  // désactivées, sinon impossible de les retrouver pour les réactiver.
  app.get('/admin/lines', { preHandler: requireAdmin }, async (request, reply) => {
    const query = listLinesQuerySchema.parse(request.query);
    const lines = await listAllLinesForAdmin(query);
    return reply.send({ success: true, data: { lines, count: lines.length } });
  });

  app.post('/admin/lines', { preHandler: requireAdmin }, async (request, reply) => {
    const body = createLineBodySchema.parse(request.body);
    const line = await createLine(body);
    return reply.status(201).send({ success: true, data: line });
  });

  app.patch('/admin/lines/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = lineIdParamsSchema.parse(request.params);
    const body = updateLineBodySchema.parse(request.body);
    const line = await updateLine(id, body);
    return reply.send({ success: true, data: line });
  });

  // Consulté par l'UI AVANT d'afficher la confirmation de suppression dure —
  // même logique que GET /admin/stops/:id/impact (stops.routes.ts) : annoncer
  // ce qui va réellement disparaître plutôt qu'un "êtes-vous sûr ?" aveugle.
  app.get('/admin/lines/:id/impact', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = lineIdParamsSchema.parse(request.params);
    const impact = await getLineDeletionImpact(id);
    return reply.send({ success: true, data: impact });
  });

  app.delete('/admin/lines/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = lineIdParamsSchema.parse(request.params);
    const deleted = await deleteLine(id);
    return reply.send({ success: true, data: deleted });
  });
}

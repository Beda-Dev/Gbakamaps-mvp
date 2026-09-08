// =============================================================================
// Routes du module stops.
//
// Lecture : publique (recherche, proximité, détail).
// Écriture : réservée au rôle ADMIN via `requireAdmin`, jamais publique —
// corrige la faille de l'ancien projet où PATCH /api/stops/[id] n'exigeait
// aucune authentification (cf. PROJECT_MEMORY.md §7). Un utilisateur normal
// qui veut signaler un problème sur un arrêt passe toujours par le module
// reports (modération communautaire), pas par ces endpoints.
//
// Les routes publiques ci-dessous sont inchangées : le CRUD admin s'ajoute,
// il ne remplace rien.
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../../common/auth-middleware.js';
import {
  createStopBodySchema,
  nearbyStopsQuerySchema,
  searchStopsQuerySchema,
  stopIdParamsSchema,
  updateStopBodySchema,
} from './stops.schemas.js';
import {
  createStop,
  deleteStop,
  findById,
  findNearby,
  getStopDeletionImpact,
  searchStops,
  updateStop,
} from './stops.service.js';

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

  // ---------------------------------------------------------------------------
  // Administration (rôle ADMIN requis)
  // ---------------------------------------------------------------------------

  app.post('/admin/stops', { preHandler: requireAdmin }, async (request, reply) => {
    const body = createStopBodySchema.parse(request.body);
    const stop = await createStop(body);
    return reply.status(201).send({ success: true, data: stop });
  });

  app.patch('/admin/stops/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = stopIdParamsSchema.parse(request.params);
    const body = updateStopBodySchema.parse(request.body);
    const stop = await updateStop(id, body);
    return reply.send({ success: true, data: stop });
  });

  // Consulté par l'UI AVANT d'afficher la confirmation de suppression, pour
  // annoncer ce qui va réellement se passer plutôt qu'un "êtes-vous sûr ?"
  // aveugle : favoris et dessertes sont détruits en cascade, tandis que les
  // signalements survivent mais sont détachés (SetNull). Voir le détail dans
  // stops.service.ts (StopDeletionImpact).
  app.get('/admin/stops/:id/impact', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = stopIdParamsSchema.parse(request.params);
    const impact = await getStopDeletionImpact(id);
    return reply.send({ success: true, data: impact });
  });

  app.delete('/admin/stops/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = stopIdParamsSchema.parse(request.params);
    const deleted = await deleteStop(id);
    return reply.send({ success: true, data: deleted });
  });
}

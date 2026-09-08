// =============================================================================
// Routes du module trip-planning — lecture seule, public (comme /stops et
// /route, aucune authentification requise pour planifier un trajet).
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { isGeminiConfigured } from '../../common/gemini.js';
import { narrateTripQuerySchema, tripPlanQuerySchema } from './trip-planning.schemas.js';
import { narratePlan, planTrip } from './trip-planning.service.js';

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

  // Narration IA (Gemini) d'un plan précis — recalcule le plan côté serveur
  // à partir des mêmes critères (jamais un plan arbitraire envoyé par le
  // client, voir narrateTripQuerySchema) puis le fait reformuler en prose
  // par Gemini SANS lui laisser ajouter d'information non fournie.
  // Fonctionnalité strictement additive : 503 explicite si Gemini n'est pas
  // configuré/indisponible, jamais un plantage du planificateur lui-même.
  app.get('/trip-plan/narrate', async (request, reply) => {
    if (!isGeminiConfigured()) {
      return reply.status(503).send({
        success: false,
        error: 'Narration IA non configurée',
        code: 'GEMINI_UNAVAILABLE',
      });
    }
    const query = narrateTripQuerySchema.parse(request.query);
    const result = await planTrip({
      from: query.from,
      to: query.to,
      walkRadius: query.walkRadius,
      maxTransfers: query.maxTransfers,
      optimize: query.optimize,
      limit: query.limit,
    });
    const plan = result.plans[query.planIndex];
    if (!plan) {
      return reply.status(404).send({ success: false, error: 'Plan introuvable à cet index' });
    }
    const narration = await narratePlan(plan);
    return reply.send({ success: true, data: { narration } });
  });
}

// =============================================================================
// Health check — dépend uniquement de la DB, jamais de services externes
// (l'ancien /api/health appelait Overpass+OSRM en synchrone, ce qui rend
// un health check lent et fragile face à des pannes tierces).
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../db/prisma.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return reply.send({
        success: true,
        data: {
          status: 'healthy',
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      app.log.error({ err }, 'Health check failed: database unreachable');
      return reply.status(503).send({
        success: false,
        error: 'Database unreachable',
      });
    }
  });
}

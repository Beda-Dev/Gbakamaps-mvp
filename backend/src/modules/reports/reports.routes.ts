// =============================================================================
// Routes du module reports — signalements communautaires + modération admin.
// Routes utilisateur protégées par requireAuth, routes /admin/* protégées par
// requireAdmin sans aucune exception (faille critique de l'ancien projet où
// les endpoints de modération n'avaient aucune authentification).
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { requireAdmin, requireAuth } from '../../common/auth-middleware.js';
import {
  createReportBodySchema,
  listAdminReportsQuerySchema,
  moderateReportBodySchema,
  reportIdParamsSchema,
} from './reports.schemas.js';
import {
  createReport,
  listAllReports,
  listMyReports,
  moderateReport,
} from './reports.service.js';

export async function reportsRoutes(app: FastifyInstance) {
  app.post('/reports', { preHandler: requireAuth }, async (request, reply) => {
    const body = createReportBodySchema.parse(request.body);
    const report = await createReport(request.currentUser!.id, body);
    return reply.status(201).send({ success: true, data: report });
  });

  app.get('/reports/mine', { preHandler: requireAuth }, async (request, reply) => {
    const reports = await listMyReports(request.currentUser!.id);
    return reply.send({ success: true, data: { reports, count: reports.length } });
  });

  app.get('/admin/reports', { preHandler: requireAdmin }, async (request, reply) => {
    const query = listAdminReportsQuerySchema.parse(request.query);
    const { reports, total } = await listAllReports(query);
    return reply.send({
      success: true,
      data: { reports, count: reports.length, total },
    });
  });

  app.patch('/admin/reports/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = reportIdParamsSchema.parse(request.params);
    const { status } = moderateReportBodySchema.parse(request.body);
    const report = await moderateReport(id, status, request.currentUser!.id);
    return reply.send({ success: true, data: report });
  });
}

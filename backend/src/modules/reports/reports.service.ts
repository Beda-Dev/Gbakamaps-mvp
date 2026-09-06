// =============================================================================
// Logique métier du module reports.
// Les lectures utilisateur sont scopées par userId (fourni par requireAuth via
// request.currentUser.id) — jamais par un userId venu du client. La modération
// est réservée aux admins (routes protégées par requireAdmin) et se contente
// de changer le statut : aucune création automatique d'arrêt à l'approbation
// (hors périmètre du MVP).
// =============================================================================
import { prisma } from '../../db/prisma.js';
import { NotFoundError } from '../../common/errors.js';
import { serializeStopBigInt } from '../../common/serialize.js';
import type { CreateReportInput, ListAdminReportsQuery } from './reports.schemas.js';

function serializeReportStop<T extends { stop: { osmId: bigint | null } | null } & Record<string, unknown>>(
  report: T
) {
  const { stop, ...rest } = report;
  return { ...rest, stop: stop ? serializeStopBigInt(stop) : null };
}

export async function createReport(userId: string, input: CreateReportInput) {
  if (input.stopId) {
    const stop = await prisma.stop.findUnique({ where: { id: input.stopId } });
    if (!stop) {
      throw new NotFoundError('Arrêt');
    }
  }

  const report = await prisma.report.create({
    data: {
      userId,
      reportType: input.reportType,
      title: input.title,
      description: input.description,
      stopId: input.stopId,
      imageUrl: input.imageUrl,
      lat: input.lat,
      lon: input.lon,
    },
    include: { stop: true },
  });

  return serializeReportStop(report);
}

export async function listMyReports(userId: string) {
  const reports = await prisma.report.findMany({
    where: { userId },
    include: { stop: true },
    orderBy: { createdAt: 'desc' },
  });

  return reports.map(serializeReportStop);
}

export async function listAllReports(query: ListAdminReportsQuery) {
  const where = query.status ? { status: query.status } : {};

  const [total, reports] = await Promise.all([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      include: {
        user: { select: { id: true, email: true, displayName: true } },
        stop: true,
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      skip: query.offset,
    }),
  ]);

  return { reports: reports.map(serializeReportStop), total };
}

export async function moderateReport(
  reportId: string,
  status: 'APPROVED' | 'REJECTED' | 'RESOLVED',
  moderatedBy: string
) {
  const existing = await prisma.report.findUnique({ where: { id: reportId } });
  if (!existing) {
    throw new NotFoundError('Signalement');
  }

  const report = await prisma.report.update({
    where: { id: reportId },
    data: { status, moderatedBy, moderatedAt: new Date() },
    include: { stop: true },
  });

  return serializeReportStop(report);
}

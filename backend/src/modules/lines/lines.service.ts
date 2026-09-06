// =============================================================================
// Logique métier du module lines.
// =============================================================================
import { prisma } from '../../db/prisma.js';
import { NotFoundError } from '../../common/errors.js';
import type { ListLinesQuery } from './lines.schemas.js';

export async function listLines(query: ListLinesQuery) {
  return prisma.transportLine.findMany({
    where: {
      active: true,
      ...(query.transportType ? { transportType: query.transportType } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { shortName: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      shortName: true,
      color: true,
      transportType: true,
      operator: true,
      fare: true,
      fareVerified: true,
      _count: { select: { stopLines: true } },
    },
    orderBy: { shortName: 'asc' },
    take: query.limit,
  });
}

export async function getLineById(id: string) {
  const line = await prisma.transportLine.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      shortName: true,
      color: true,
      transportType: true,
      operator: true,
      fare: true,
      fareVerified: true,
    },
  });
  if (!line) throw new NotFoundError('Ligne');
  return line;
}

// Seul un administrateur peut faire foi sur le tarif d'une ligne (décision
// produit du 2026-09-06) — jamais une estimation automatique après ce point.
export async function setLineFare(id: string, fare: number | null) {
  const existing = await prisma.transportLine.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Ligne');

  return prisma.transportLine.update({
    where: { id },
    data: { fare, fareVerified: true },
    select: {
      id: true,
      name: true,
      shortName: true,
      transportType: true,
      fare: true,
      fareVerified: true,
    },
  });
}

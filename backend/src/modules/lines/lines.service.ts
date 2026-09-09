// =============================================================================
// Logique métier du module lines.
// =============================================================================
import { prisma } from '../../db/prisma.js';
import { NotFoundError } from '../../common/errors.js';
import type { CreateLineBody, ListLinesQuery, UpdateLineBody } from './lines.schemas.js';

const ADMIN_LINE_SELECT = {
  id: true,
  name: true,
  shortName: true,
  color: true,
  transportType: true,
  operator: true,
  fare: true,
  fareVerified: true,
  active: true,
  externalRef: true,
  shapeSource: true,
  _count: { select: { stopLines: true } },
} as const;

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
      // Tracé réel (data.gouv.ci), absent pour les lignes sans
      // correspondance OSM exacte — voir import-line-shapes.ts. `shape:
      // null` distingue explicitement "pas encore de tracé connu" plutôt
      // que d'inventer un tracé approximatif ici.
      shapeGeoJson: true,
      shapeSource: true,
    },
  });
  if (!line) throw new NotFoundError('Ligne');
  return line;
}

// =============================================================================
// Administration des lignes (CRUD admin, PROJECT_MEMORY.md §12.16/§12.21 —
// demande explicite de l'utilisateur, sur le modèle direct du CRUD arrêts
// déjà livré §12.15). Voir lines.schemas.ts pour les principes structurants
// (jamais d'externalRef/shape inventés, règle fare→fareVerified préservée).
// =============================================================================

// Liste ADMIN : contrairement à `listLines` (public, `active: true` toujours
// forcé), un administrateur doit pouvoir retrouver une ligne déjà désactivée
// pour la réactiver — impossible si elle est invisible partout.
export async function listAllLinesForAdmin(query: ListLinesQuery) {
  return prisma.transportLine.findMany({
    where: {
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
    select: ADMIN_LINE_SELECT,
    orderBy: [{ active: 'desc' }, { shortName: 'asc' }],
    take: query.limit,
  });
}

// Une ligne créée depuis l'admin n'a NI `externalRef` (pas de correspondance
// GTFS réelle) NI tracé officiel (`shapeGeoJson`/`shapeSource` restent
// `null`, jamais un tracé deviné) — voir lines.schemas.ts pour le
// raisonnement complet.
export async function createLine(input: CreateLineBody) {
  const line = await prisma.transportLine.create({
    data: {
      name: input.name,
      shortName: input.shortName ?? null,
      color: input.color ?? undefined,
      transportType: input.transportType,
      operator: input.operator ?? null,
      fare: input.fare ?? null,
      fareVerified: input.fare !== undefined,
    },
    select: ADMIN_LINE_SELECT,
  });
  return line;
}

// Fusionne l'ancien `setLineFare` (règle métier déjà testée : poser un tarif
// marque `fareVerified: true`, sans exception) dans un PATCH général — voir
// lines.schemas.ts pour pourquoi ce n'est pas une route séparée.
export async function updateLine(id: string, input: UpdateLineBody) {
  const existing = await prisma.transportLine.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new NotFoundError('Ligne');

  const { fare, ...rest } = input;
  const data: Record<string, unknown> = { ...rest };
  if (fare !== undefined) {
    data.fare = fare;
    data.fareVerified = true;
  }

  return prisma.transportLine.update({
    where: { id },
    data,
    select: ADMIN_LINE_SELECT,
  });
}

// Conséquences réelles d'une suppression DURE — mêmes principes que
// `getStopDeletionImpact` (stops.service.ts) : compter avant de supprimer,
// jamais annoncer "supprimé avec succès" sans détail. Une ligne peut
// desservir des dizaines d'arrêts (`StopLine`, `onDelete: Cascade`) : cette
// perte est TOUJOURS plus significative que celle d'un simple arrêt, d'où
// la désactivation (`active: false`) recommandée en priorité (cf.
// lines.schemas.ts) et cette suppression dure gardée pour les erreurs de
// saisie (ligne créée par erreur, jamais utilisée dans un vrai plan).
export interface LineDeletionImpact {
  id: string;
  name: string;
  stopLinesDeleted: number;
}

export async function getLineDeletionImpact(id: string): Promise<LineDeletionImpact> {
  const line = await prisma.transportLine.findUnique({
    where: { id },
    select: { id: true, name: true, _count: { select: { stopLines: true } } },
  });
  if (!line) throw new NotFoundError('Ligne');

  return { id: line.id, name: line.name, stopLinesDeleted: line._count.stopLines };
}

export async function deleteLine(id: string): Promise<LineDeletionImpact> {
  const impact = await getLineDeletionImpact(id);
  await prisma.transportLine.delete({ where: { id } });
  return impact;
}

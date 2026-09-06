// =============================================================================
// Logique métier du module stops.
// La recherche de proximité utilise PostGIS (ST_DWithin sur un index GiST)
// via une requête paramétrée ($queryRaw + Prisma.sql, donc protégée contre
// l'injection SQL comme le reste du projet via Prisma). Corrige la limite
// identifiée à l'audit de l'ancien projet : bounding box + Haversine en JS,
// non indexée.
// =============================================================================
import { Prisma } from '../../generated/prisma/index.js';
import { prisma } from '../../db/prisma.js';
import { NotFoundError } from '../../common/errors.js';
import { serializeStopBigInt } from '../../common/serialize.js';

const STOP_LINE_INCLUDE = {
  stopLines: {
    include: {
      line: {
        select: {
          id: true,
          name: true,
          shortName: true,
          color: true,
          transportType: true,
          fare: true,
        },
      },
    },
  },
} as const;

type StopWithLines = { osmId: bigint | null; stopLines: { line: unknown }[] } & Record<string, unknown>;

// Aplatit la table de jonction "stopLines" en un simple tableau "lines".
function toApiStop<T extends StopWithLines>(stop: T) {
  const { stopLines } = stop;
  const { stopLines: _omit, ...rest } = serializeStopBigInt(stop);
  return { ...rest, lines: stopLines.map((sl) => sl.line) };
}

export interface FindNearbyParams {
  lat: number;
  lon: number;
  radiusMeters: number;
  limit: number;
  type?: string;
}

export async function findNearby(params: FindNearbyParams) {
  const { lat, lon, radiusMeters, limit, type } = params;

  const typeFilter = type ? Prisma.sql`AND "stopType" = ${type}::"StopType"` : Prisma.empty;

  // ST_DWithin exploite l'index GiST sur "geog" — pas de scan complet de la
  // table même avec des centaines de milliers d'arrêts.
  const rows = await prisma.$queryRaw<{ id: string; distance: number }[]>(Prisma.sql`
    SELECT "id", ST_Distance("geog", ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography) AS distance
    FROM "stops"
    WHERE ST_DWithin("geog", ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography, ${radiusMeters})
    ${typeFilter}
    ORDER BY distance ASC
    LIMIT ${limit}
  `);

  if (rows.length === 0) return [];

  const distanceById = new Map(rows.map((r) => [r.id, r.distance]));

  const stops = await prisma.stop.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    include: STOP_LINE_INCLUDE,
  });

  // prisma.findMany avec `id: { in }` ne garantit pas l'ordre d'entrée :
  // on retrie selon la distance calculée par PostGIS, qui est la source de
  // vérité pour le tri (contrairement à un recalcul JS redondant).
  return stops
    .map((stop) => ({ ...toApiStop(stop), distanceMeters: distanceById.get(stop.id) ?? null }))
    .sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));
}

export async function findById(id: string) {
  const stop = await prisma.stop.findUnique({
    where: { id },
    include: {
      ...STOP_LINE_INCLUDE,
      _count: { select: { favorites: true, reports: true } },
    },
  });

  if (!stop) {
    throw new NotFoundError('Arrêt');
  }

  return toApiStop(stop);
}

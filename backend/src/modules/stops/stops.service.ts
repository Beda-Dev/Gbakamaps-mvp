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

export interface SearchStopsParams {
  query: string;
  limit: number;
  near?: { lat: number; lon: number };
}

// Distance haversine simple (résultat déjà borné par `limit`, pas besoin de
// l'index GiST PostGIS ici — contrairement à findNearby qui filtre par rayon
// sur potentiellement toute la table).
function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Recherche textuelle sur le nom d'un arrêt OU le nom/n° court d'une de ses
// lignes (ex. taper "15" retrouve les arrêts desservis par la ligne 15).
// Insensible à la casse. Si `near` est fourni, les résultats sont triés par
// distance à ce point plutôt que par ordre de correspondance SQL brut — plus
// utile quand l'utilisateur a déjà une position de référence (la sienne).
export async function searchStops(params: SearchStopsParams) {
  const { query, limit, near } = params;

  const stops = await prisma.stop.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { stopLines: { some: { line: { name: { contains: query, mode: 'insensitive' } } } } },
        { stopLines: { some: { line: { shortName: { contains: query, mode: 'insensitive' } } } } },
      ],
    },
    include: STOP_LINE_INCLUDE,
    take: near ? undefined : limit,
  });

  const mapped = stops.map((stop) => ({
    ...toApiStop(stop),
    distanceMeters: near ? haversineMeters(near, { lat: stop.lat, lon: stop.lon }) : null,
  }));

  if (near) {
    mapped.sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));
    return mapped.slice(0, limit);
  }
  return mapped;
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

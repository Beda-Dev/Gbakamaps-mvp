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
import type { CreateStopBody, UpdateStopBody } from './stops.schemas.js';

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

// Colonnes booléennes réelles du modèle Stop pour chaque mode filtrable —
// whitelist stricte (jamais interpoler un nom de colonne venu de l'entrée
// utilisateur directement dans du SQL, même après validation Zod amont).
const STOP_MODE_COLUMNS: Record<string, string> = {
  gbaka: 'gbaka',
  woroworo: 'woroworo',
  taxi: 'taxi',
  mototaxi: 'mototaxi',
};

export interface FindNearbyParams {
  lat: number;
  lon: number;
  radiusMeters: number;
  limit: number;
  type?: string;
  modes?: string[];
  lineId?: string;
}

export async function findNearby(params: FindNearbyParams) {
  const { lat, lon, radiusMeters, limit, type, modes, lineId } = params;

  const typeFilter = type ? Prisma.sql`AND "stopType" = ${type}::"StopType"` : Prisma.empty;

  // Sémantique OU entre modes demandés : un arrêt correspond s'il porte AU
  // MOINS un des modes filtrés (ex. modes=gbaka,woroworo -> gbaka=true OR
  // woroworo=true), pas une intersection stricte.
  const modesFilter =
    modes && modes.length > 0
      ? Prisma.sql`AND (${Prisma.join(
          modes.map((m) => Prisma.raw(`"${STOP_MODE_COLUMNS[m]}" = true`)),
          ' OR '
        )})`
      : Prisma.empty;

  const lineFilter = lineId
    ? Prisma.sql`AND EXISTS (SELECT 1 FROM "stop_lines" sl WHERE sl."stopId" = "stops"."id" AND sl."lineId" = ${lineId})`
    : Prisma.empty;

  // ST_DWithin exploite l'index GiST sur "geog" — pas de scan complet de la
  // table même avec des centaines de milliers d'arrêts.
  const rows = await prisma.$queryRaw<{ id: string; distance: number }[]>(Prisma.sql`
    SELECT "id", ST_Distance("geog", ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography) AS distance
    FROM "stops"
    WHERE ST_DWithin("geog", ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography, ${radiusMeters})
    ${typeFilter}
    ${modesFilter}
    ${lineFilter}
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

// =============================================================================
// Administration des arrêts (CRUD réservé au rôle ADMIN — voir stops.routes.ts).
// =============================================================================

const ADMIN_STOP_INCLUDE = {
  ...STOP_LINE_INCLUDE,
  _count: { select: { favorites: true, reports: true } },
} as const;

// `source` est forcé à COMMUNITY et `osmId` n'est jamais renseigné : un arrêt
// saisi par un administrateur n'est pas un arrêt importé d'OpenStreetMap, et
// lui fabriquer un osmId créerait une fausse référence externe (bug réel de
// l'ancien projet, cf. PROJECT_MEMORY.md §7). La colonne PostGIS `geog` est
// remplie automatiquement par le trigger SQL stops_sync_geog_trigger à partir
// de lat/lon — rien à faire ici, mais c'est la raison pour laquelle lat/lon
// sont obligatoires à la création.
export async function createStop(input: CreateStopBody) {
  const stop = await prisma.stop.create({
    data: { ...input, source: 'COMMUNITY' },
    include: ADMIN_STOP_INCLUDE,
  });
  return toApiStop(stop);
}

export async function updateStop(id: string, input: UpdateStopBody) {
  const existing = await prisma.stop.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    throw new NotFoundError('Arrêt');
  }

  // `lastUpdated` n'est pas un champ @updatedAt côté Prisma (il porte
  // seulement @default(now())) : il faut donc l'avancer explicitement, sinon
  // une modification d'arrêt laisserait une date de dernière mise à jour
  // trompeuse (celle de l'import GTFS d'origine).
  const stop = await prisma.stop.update({
    where: { id },
    data: { ...input, lastUpdated: new Date() },
    include: ADMIN_STOP_INCLUDE,
  });
  return toApiStop(stop);
}

// Conséquences réelles d'une suppression, comptées AVANT de supprimer quoi
// que ce soit. Les trois relations de Stop ne se comportent PAS de la même
// façon — vérifié dans schema.prisma, pas supposé :
//   - Favorite : onDelete Cascade  -> DÉTRUIT (favoris d'autres utilisateurs)
//   - StopLine : onDelete Cascade  -> DÉTRUIT (dessertes de lignes)
//   - Report   : onDelete SetNull  -> CONSERVÉ, mais détaché (stopId = null)
// Cette distinction compte pour l'UI : annoncer "2 signalements seront
// supprimés" serait faux (ils survivent), mais ne rien dire le serait aussi
// (ils perdent définitivement le lien vers l'arrêt qu'ils décrivaient, donc
// une bonne part de leur sens pour un modérateur). Les deux cas sont donc
// comptés séparément et nommés pour ce qu'ils sont.
export interface StopDeletionImpact {
  id: string;
  name: string | null;
  // Supprimés définitivement avec l'arrêt (cascade).
  favoritesDeleted: number;
  stopLinesDeleted: number;
  // Conservé mais détaché de l'arrêt (SetNull) — pas une perte de donnée,
  // une perte de rattachement.
  reportsDetached: number;
}

export async function getStopDeletionImpact(id: string): Promise<StopDeletionImpact> {
  const stop = await prisma.stop.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      _count: { select: { favorites: true, reports: true, stopLines: true } },
    },
  });

  if (!stop) {
    throw new NotFoundError('Arrêt');
  }

  return {
    id: stop.id,
    name: stop.name,
    favoritesDeleted: stop._count.favorites,
    stopLinesDeleted: stop._count.stopLines,
    reportsDetached: stop._count.reports,
  };
}

// Suppression dure assumée (pas de désactivation) : `Stop` n'a pas de champ
// `active`, contrairement à `TransportLine`. En ajouter un obligerait à
// filtrer dessus dans findNearby/searchStops, le planificateur de trajet et
// le rapprochement places/stops — un risque de régression disproportionné
// hors du périmètre de ce chantier. La perte est donc rendue explicite via
// getStopDeletionImpact plutôt que masquée derrière un drapeau.
// L'impact est renvoyé pour que l'appelant puisse afficher ce qui a
// réellement été supprimé, et pas seulement "supprimé avec succès".
export async function deleteStop(id: string): Promise<StopDeletionImpact> {
  const impact = await getStopDeletionImpact(id);
  await prisma.stop.delete({ where: { id } });
  return impact;
}

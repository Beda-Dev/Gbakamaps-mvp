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
  // Réservé à l'admin (GET /admin/stops) : un arrêt désactivé ne doit
  // JAMAIS apparaître dans une recherche publique (§12.16/§12.22, cohérence
  // avec TransportLine.active), mais l'admin doit pouvoir le retrouver pour
  // le réactiver.
  includeInactive?: boolean;
}

export async function findNearby(params: FindNearbyParams) {
  const { lat, lon, radiusMeters, limit, type, modes, lineId, includeInactive } = params;

  const activeFilter = includeInactive ? Prisma.empty : Prisma.sql`AND "active" = true`;
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
    ${activeFilter}
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
      active: true,
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

// =============================================================================
// Photos réelles à proximité d'un arrêt — PROJECT_MEMORY.md §9, demande
// explicite de l'utilisateur. Deux sources combinées, vérifiées
// empiriquement AVANT implémentation (2026-09-08) sur un échantillon de 8
// arrêts réels (plusieurs communes du Grand Abidjan) :
//   - Mapillary (~25 % de couverture seule, rayon 50 m — plafond imposé par
//     l'API "Image Radius Search", pas un choix arbitraire) ;
//   - Panoramax (agrégateur libre porté par l'IGN/OSM France, licence
//     CC-BY-SA, AUCUNE clé requise) — couverture PARTIELLEMENT DIFFÉRENTE
//     de Mapillary (trouve des images là où Mapillary n'en a pas, et
//     inversement) : combinées, ~37 % de couverture sur le même échantillon.
// Deux sources interrogées en parallèle, jamais l'une bloquée par l'échec
// de l'autre. Le frontend DOIT toujours traiter "aucune photo" comme un
// état normal, jamais une erreur — la couverture reste partielle.
// =============================================================================
import { env } from '../../config/env.js';

const MAPILLARY_URL = 'https://graph.mapillary.com/images';
// Rayon maximal accepté par l'endpoint de recherche par proximité Mapillary
// (Image Radius Search) — vérifié dans la documentation officielle, pas une
// valeur choisie arbitrairement : 50 m est le PLAFOND, pas une option parmi
// d'autres.
const MAPILLARY_SEARCH_RADIUS_METERS = 50;
const PANORAMAX_URL = 'https://api.panoramax.xyz/api/search';
// Panoramax s'interroge par bbox (pas de recherche par rayon dédiée) — une
// bbox d'environ 60 m de côté autour du point, cohérente avec le rayon
// Mapillary ci-dessus.
const PANORAMAX_BBOX_DEG = 0.0006;
const PHOTO_FETCH_TIMEOUT_MS = 10_000;
const MAX_PHOTOS_PER_SOURCE = 6;

export type StopPhotoSource = 'mapillary' | 'panoramax';

export interface StopPhoto {
  id: string;
  source: StopPhotoSource;
  thumbnailUrl: string;
  capturedAt: number | null;
  compassAngle: number | null;
  // Mention de licence à afficher à côté de l'image (exigence réelle de la
  // licence CC-BY-SA de Panoramax — jamais une photo affichée sans son
  // attribution/licence).
  license: string | null;
}

export function isPhotosFeatureConfigured(): boolean {
  // Panoramax ne nécessite aucune clé — la fonctionnalité reste active
  // même sans jeton Mapillary configuré (dégradée à une seule source).
  return true;
}

interface MapillaryImage {
  id: string;
  thumb_1024_url?: string;
  captured_at?: number;
  compass_angle?: number;
}

async function findMapillaryPhotos(lat: number, lon: number): Promise<StopPhoto[]> {
  if (!env.MAPILLARY_ACCESS_TOKEN) return [];

  const params = new URLSearchParams({
    access_token: env.MAPILLARY_ACCESS_TOKEN,
    lat: String(lat),
    lng: String(lon),
    radius: String(MAPILLARY_SEARCH_RADIUS_METERS),
    fields: 'id,thumb_1024_url,captured_at,compass_angle',
    limit: String(MAX_PHOTOS_PER_SOURCE),
  });

  let response: Response;
  try {
    response = await fetch(`${MAPILLARY_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(PHOTO_FETCH_TIMEOUT_MS),
    });
  } catch {
    // Panne réseau : dégradation silencieuse, jamais une erreur qui
    // casserait l'affichage du reste de l'arrêt (l'autre source peut
    // encore fonctionner, et même sans aucune photo l'arrêt reste utile).
    return [];
  }
  if (!response.ok) return [];

  const data = (await response.json().catch(() => null)) as { data?: MapillaryImage[] } | null;
  if (!data?.data) return [];

  return data.data
    .filter((img) => !!img.thumb_1024_url)
    .map((img) => ({
      id: `mapillary-${img.id}`,
      source: 'mapillary' as const,
      thumbnailUrl: img.thumb_1024_url!,
      capturedAt: img.captured_at ?? null,
      compassAngle: img.compass_angle ?? null,
      license: null,
    }));
}

interface PanoramaxFeature {
  id: string;
  assets?: { sd?: { href?: string }; thumb?: { href?: string } };
  properties?: { datetime?: string; 'view:azimuth'?: number; license?: string };
}

async function findPanoramaxPhotos(lat: number, lon: number): Promise<StopPhoto[]> {
  const d = PANORAMAX_BBOX_DEG;
  const params = new URLSearchParams({
    limit: String(MAX_PHOTOS_PER_SOURCE),
    bbox: `${lon - d},${lat - d},${lon + d},${lat + d}`,
  });

  let response: Response;
  try {
    response = await fetch(`${PANORAMAX_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(PHOTO_FETCH_TIMEOUT_MS),
    });
  } catch {
    return [];
  }
  if (!response.ok) return [];

  const data = (await response.json().catch(() => null)) as { features?: PanoramaxFeature[] } | null;
  if (!data?.features) return [];

  return data.features
    .filter((f) => !!(f.assets?.sd?.href ?? f.assets?.thumb?.href))
    .map((f) => ({
      id: `panoramax-${f.id}`,
      source: 'panoramax' as const,
      thumbnailUrl: (f.assets!.sd?.href ?? f.assets!.thumb?.href)!,
      capturedAt: f.properties?.datetime ? new Date(f.properties.datetime).getTime() : null,
      compassAngle: f.properties?.['view:azimuth'] ?? null,
      license: f.properties?.license ?? 'CC-BY-SA-4.0',
    }));
}

export async function findStopPhotos(stopId: string): Promise<StopPhoto[]> {
  const stop = await prisma.stop.findUnique({ where: { id: stopId }, select: { lat: true, lon: true } });
  if (!stop) throw new NotFoundError('Arrêt');

  // Les deux sources sont interrogées en parallèle et fusionnées — jamais
  // l'échec de l'une ne prive l'utilisateur des résultats de l'autre.
  const [mapillary, panoramax] = await Promise.all([
    findMapillaryPhotos(stop.lat, stop.lon),
    findPanoramaxPhotos(stop.lat, stop.lon),
  ]);
  return [...mapillary, ...panoramax];
}

// =============================================================================
// Photos communautaires (utilisateurs connectés + admins) — complètent les
// sources externes ci-dessus (Mapillary/Panoramax), dont la couverture
// reste partielle. Le fichier est stocké sur disque (volume Docker
// persistant, voir docker-compose.yml), jamais en base — seules les
// métadonnées (chemin, auteur, date) sont en base.
// =============================================================================
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ForbiddenError } from '../../common/errors.js';

// Liste blanche stricte de types MIME acceptés — jamais un fichier arbitraire
// écrit sur disque avec l'extension que le client prétend lui donner.
const ALLOWED_MIME_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const UPLOADS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'uploads', 'stop-photos');

export class UnsupportedPhotoTypeError extends ForbiddenError {
  constructor() {
    super('Format de photo non supporté (jpeg, png ou webp uniquement)');
  }
}

export interface CommunityPhoto {
  id: string;
  filePath: string;
  createdAt: Date;
  uploadedByUserId: string;
  uploadedByName: string | null;
}

export async function addStopPhoto(
  stopId: string,
  userId: string,
  mimeType: string,
  buffer: Buffer
): Promise<CommunityPhoto> {
  const stop = await prisma.stop.findUnique({ where: { id: stopId }, select: { id: true } });
  if (!stop) throw new NotFoundError('Arrêt');

  const extension = ALLOWED_MIME_TYPES[mimeType];
  if (!extension) throw new UnsupportedPhotoTypeError();

  await mkdir(UPLOADS_DIR, { recursive: true });
  // Nom de fichier généré côté serveur (UUID) — jamais le nom fourni par le
  // client, qui pourrait contenir un chemin ("../../etc/passwd") ou entrer
  // en collision avec un fichier existant.
  const filename = `${randomUUID()}.${extension}`;
  await writeFile(join(UPLOADS_DIR, filename), buffer);

  const created = await prisma.stopPhoto.create({
    data: { stopId, uploadedByUserId: userId, filePath: filename },
    include: { uploadedByUser: { select: { displayName: true } } },
  });

  return {
    id: created.id,
    filePath: created.filePath,
    createdAt: created.createdAt,
    uploadedByUserId: created.uploadedByUserId,
    uploadedByName: created.uploadedByUser.displayName,
  };
}

export async function listCommunityPhotos(stopId: string): Promise<CommunityPhoto[]> {
  const rows = await prisma.stopPhoto.findMany({
    where: { stopId },
    include: { uploadedByUser: { select: { displayName: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    filePath: r.filePath,
    createdAt: r.createdAt,
    uploadedByUserId: r.uploadedByUserId,
    uploadedByName: r.uploadedByUser.displayName,
  }));
}

// Suppression réservée à l'auteur de la photo OU à un admin — jamais à un
// autre utilisateur, même connecté.
export async function deleteStopPhoto(
  photoId: string,
  requestingUserId: string,
  requestingUserRole: string
): Promise<void> {
  const photo = await prisma.stopPhoto.findUnique({ where: { id: photoId } });
  if (!photo) throw new NotFoundError('Photo');

  const isOwner = photo.uploadedByUserId === requestingUserId;
  const isAdmin = requestingUserRole === 'ADMIN';
  if (!isOwner && !isAdmin) {
    throw new ForbiddenError("Vous ne pouvez supprimer que vos propres photos");
  }

  await prisma.stopPhoto.delete({ where: { id: photoId } });
  // Suppression du fichier APRÈS la ligne en base : en cas d'échec disque,
  // la métadonnée est déjà cohérente (photo introuvable en base = plus
  // jamais référencée), un fichier orphelin sur disque est un problème
  // mineur de nettoyage, jamais une incohérence visible pour l'utilisateur.
  await unlink(join(UPLOADS_DIR, photo.filePath)).catch(() => {
    // Fichier déjà absent ou erreur disque : sans conséquence pour
    // l'utilisateur, la ligne en base (la seule chose qu'il voit) est supprimée.
  });
}

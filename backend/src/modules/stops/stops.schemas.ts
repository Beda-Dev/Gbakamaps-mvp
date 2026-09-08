// =============================================================================
// Schémas de validation du module stops.
// =============================================================================
import { z } from 'zod';

// Bounding box large de la Côte d'Ivoire (reprise de l'ancien projet — la
// seule partie de sa logique de bornage géographique qui était juste, elle
// n'était simplement jamais appliquée nulle part). Sert à rejeter les
// coordonnées aberrantes en entrée, pas à garantir une couverture exhaustive.
export const IVORY_COAST_BOUNDS = {
  north: 10.74,
  south: 4.36,
  east: -2.49,
  west: -8.6,
};

const latSchema = z.coerce
  .number()
  .min(IVORY_COAST_BOUNDS.south, 'Latitude hors de la zone de service')
  .max(IVORY_COAST_BOUNDS.north, 'Latitude hors de la zone de service');

const lonSchema = z.coerce
  .number()
  .min(IVORY_COAST_BOUNDS.west, 'Longitude hors de la zone de service')
  .max(IVORY_COAST_BOUNDS.east, 'Longitude hors de la zone de service');

export const stopTypeEnum = z.enum([
  'BUS_STOP',
  'GBAKA_STOP',
  'WORO_WORO_STOP',
  'TAXI_STAND',
  'MOTO_TAXI_STAND',
  'PLATFORM',
  'STATION',
]);

// Tags de mode de transport présents sur un arrêt (indépendants de
// `stopType`, qui ne retient qu'UN type dominant à l'affichage — voir
// import-gtfs.ts `stopTypeFromTransportTypes`). Un arrêt `BUS_STOP` peut
// très bien aussi accueillir des gbaka : filtrer sur ces booléens permet
// "montre-moi tout ce qui prend des gbaka ici", pas seulement les arrêts
// affichés en priorité comme tels.
export const stopModeEnum = z.enum(['gbaka', 'woroworo', 'taxi', 'mototaxi']);

// Liste séparée par des virgules (ex. "gbaka,woroworo") — sémantique OU : un
// arrêt correspond s'il porte AU MOINS un des modes demandés.
const stopModesListSchema = z
  .string()
  .transform((val) => val.split(',').map((s) => s.trim()).filter(Boolean))
  .pipe(z.array(stopModeEnum).min(1))
  .optional();

export const nearbyStopsQuerySchema = z.object({
  lat: latSchema,
  lon: lonSchema,
  radius: z.coerce.number().int().min(100).max(20000).default(2000),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  type: stopTypeEnum.optional(),
  modes: stopModesListSchema,
  // Ne retient que les arrêts desservis par cette ligne précise — filtre
  // "ligne/trajet" demandé (phase 2, PROJECT_MEMORY.md §12).
  lineId: z.string().uuid('Identifiant de ligne invalide').optional(),
});

export const stopIdParamsSchema = z.object({
  id: z.string().uuid('Identifiant invalide'),
});

export const stopPhotoParamsSchema = z.object({
  id: z.string().uuid('Identifiant invalide'),
  photoId: z.string().uuid('Identifiant invalide'),
});

// Recherche textuelle (nom d'arrêt ou nom/n° de ligne) — écart UX identifié
// en phase 2 (PROJECT_MEMORY.md §12) : jusqu'ici, aucun moyen de trouver un
// arrêt par son nom, seulement par proximité géographique. `near` est
// optionnel : s'il est fourni, les résultats sont triés par distance plutôt
// que par pertinence texte brute (utile quand l'utilisateur tape depuis un
// endroit connu).
export const searchStopsQuerySchema = z.object({
  q: z.string().trim().min(2, 'Recherche trop courte (2 caractères minimum)').max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  near: z
    .string()
    .optional()
    .transform((val, ctx) => {
      if (!val) return undefined;
      const [latStr, lonStr] = val.split(',');
      const lat = Number(latStr);
      const lon = Number(lonStr);
      if (!latStr || !lonStr || Number.isNaN(lat) || Number.isNaN(lon)) {
        ctx.addIssue({ code: 'custom', message: 'Format attendu : "lat,lon"' });
        return z.NEVER;
      }
      return { lat, lon };
    }),
});

export type NearbyStopsQuery = z.infer<typeof nearbyStopsQuerySchema>;
export type SearchStopsQuery = z.infer<typeof searchStopsQuerySchema>;

// =============================================================================
// Administration des arrêts (CRUD admin, PROJECT_MEMORY.md §12.8 — demande
// explicite de l'utilisateur, confirmée deux fois).
//
// Deux principes structurants, repris des garde-fous du projet :
//   1. NE JAMAIS INVENTER DE DONNÉE. Un champ non renseigné reste null/absent,
//      jamais une valeur devinée. `name` est nullable au schéma Prisma : une
//      chaîne vide envoyée par le formulaire devient null, pas "Arrêt sans nom".
//   2. `source` et `osmId` ne sont JAMAIS pilotables depuis l'API. Un arrêt
//      créé ici est par définition COMMUNITY, et son osmId reste null — c'est
//      exactement le bug de l'ancien projet (osmId = BigInt(Date.now()), qui
//      fabriquait une fausse référence OSM, cf. PROJECT_MEMORY.md §7).
// =============================================================================

// Nom d'arrêt : optionnel partout. `''` (champ de formulaire vidé) est
// interprété comme "pas de nom" (null), jamais comme un nom vide en base.
const stopNameSchema = z
  .string()
  .trim()
  .max(200, 'Nom trop long (200 caractères maximum)')
  .nullable()
  .transform((val) => (val === '' ? null : val))
  .optional();

// Tags booléens réels du modèle Stop. Tous optionnels : absent = inchangé
// (PATCH) ou valeur par défaut du schéma Prisma (POST) — jamais forcé à false
// arbitrairement, ce qui reviendrait à affirmer "cet arrêt ne prend pas de
// gbaka" alors que l'admin n'a simplement rien dit.
const stopFlagsSchema = {
  shelter: z.boolean().optional(),
  bench: z.boolean().optional(),
  wheelchair: z.boolean().optional(),
  gbaka: z.boolean().optional(),
  woroworo: z.boolean().optional(),
  taxi: z.boolean().optional(),
  mototaxi: z.boolean().optional(),
  verified: z.boolean().optional(),
};

export const createStopBodySchema = z.object({
  name: stopNameSchema,
  // Coordonnées obligatoires à la création : un arrêt sans position n'a aucun
  // sens dans une application cartographique (et la colonne PostGIS `geog`
  // est calculée depuis lat/lon par un trigger SQL).
  lat: latSchema,
  lon: lonSchema,
  stopType: stopTypeEnum.optional(),
  ...stopFlagsSchema,
});

export const updateStopBodySchema = z
  .object({
    name: stopNameSchema,
    lat: latSchema.optional(),
    lon: lonSchema.optional(),
    stopType: stopTypeEnum.optional(),
    ...stopFlagsSchema,
  })
  // Un PATCH vide est refusé explicitement plutôt que traité comme un no-op
  // silencieux : côté UI, cela signale un formulaire qui n'a rien envoyé
  // (bug) plutôt que de renvoyer 200 en n'ayant rien fait.
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Aucun champ à modifier',
  });

export type CreateStopBody = z.infer<typeof createStopBodySchema>;
export type UpdateStopBody = z.infer<typeof updateStopBodySchema>;

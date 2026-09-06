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

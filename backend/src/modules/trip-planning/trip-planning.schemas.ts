// =============================================================================
// Schémas de validation du module trip-planning (phase 2, PROJECT_MEMORY.md
// §12.3 — planificateur multi-modal s'appuyant sur le graphe GTFS réel des
// lignes gbaka/woro-woro/bus, pas seulement un point-à-point piéton/voiture).
// =============================================================================
import { z } from 'zod';
import { IVORY_COAST_BOUNDS } from '../stops/stops.schemas.js';

const coordinatePairSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, 'Format attendu : lat,lon')
  .transform((value) => {
    const [latStr, lonStr] = value.split(',');
    return { lat: Number(latStr), lon: Number(lonStr) };
  })
  .refine((c) => c.lat >= IVORY_COAST_BOUNDS.south && c.lat <= IVORY_COAST_BOUNDS.north, {
    message: 'Latitude hors de la zone de service',
  })
  .refine((c) => c.lon >= IVORY_COAST_BOUNDS.west && c.lon <= IVORY_COAST_BOUNDS.east, {
    message: 'Longitude hors de la zone de service',
  });

export const optimizeCriterionEnum = z.enum(['fastest', 'cheapest', 'least-walking']);

export const tripPlanQuerySchema = z.object({
  from: coordinatePairSchema,
  to: coordinatePairSchema,
  // Rayon de marche accepté pour rejoindre/quitter un arrêt — le "rayon de
  // recherche" demandé par l'utilisateur, appliqué ici au contexte
  // itinéraire (distinct du rayon de `/stops/nearby`, qui sert à explorer
  // la carte). Bornes cohérentes avec des trajets à pied réalistes.
  walkRadius: z.coerce.number().int().min(100).max(2000).default(800),
  // 0 = trajets directs uniquement, 1 = jusqu'à une correspondance. Un
  // graphe de correspondances à N>1 croît vite en combinatoire et en risque
  // d'erreur — 1 correspondance couvre déjà la grande majorité des trajets
  // urbains réels et reste vérifiable manuellement.
  maxTransfers: z.coerce.number().int().min(0).max(1).default(1),
  optimize: optimizeCriterionEnum.default('fastest'),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

// Narration IA d'un plan précis parmi ceux que /trip-plan aurait renvoyés
// pour les mêmes paramètres — mêmes critères que tripPlanQuerySchema, plus
// l'index du plan à narrer. Le plan est RECALCULÉ ici (jamais accepté tel
// quel depuis le client) : accepter un objet "plan" arbitraire envoyé par
// le client permettrait de faire dire à Gemini des faits fabriqués côté
// client comme s'ils étaient un vrai trajet calculé par notre moteur.
export const narrateTripQuerySchema = tripPlanQuerySchema.extend({
  planIndex: z.coerce.number().int().min(0).max(9).default(0),
});

export type NarrateTripQuery = z.infer<typeof narrateTripQuerySchema>;

// Approximation de "zone accessible en X minutes" (PROJECT_MEMORY.md §12.17) —
// PAS un vrai isochrone réseau-routier (ORS/GraphHopper le refusent sur le
// plan gratuit) : une énumération des arrêts atteignables via le graphe de
// lignes du projet dans un budget de temps donné.
export const isochroneQuerySchema = z.object({
  from: coordinatePairSchema,
  // Budget de temps. Bornes : en-dessous de 5 min l'approximation n'a guère de
  // sens (à peine le temps de marcher jusqu'à un arrêt), au-dessus de 90 min
  // la combinatoire explose sans gain pratique à l'échelle du Grand Abidjan.
  maxMinutes: z.coerce.number().int().min(5).max(90).default(30),
  // Rayon de marche accepté de l'origine vers un premier arrêt embarquable —
  // mêmes bornes que tripPlanQuerySchema.
  walkRadius: z.coerce.number().int().min(100).max(2000).default(800),
  // Nombre d'embarquements successifs explorés (0 = arrêts accessibles à pied
  // uniquement, 3 = jusqu'à 2 correspondances). Garde-fou de calcul autant que
  // choix produit — cf. commentaire de computeReachableStops.
  maxRides: z.coerce.number().int().min(0).max(4).default(3),
});

export type IsochroneQuery = z.infer<typeof isochroneQuerySchema>;

export type TripPlanQuery = z.infer<typeof tripPlanQuerySchema>;
export type OptimizeCriterion = z.infer<typeof optimizeCriterionEnum>;
export type Coordinates = { lat: number; lon: number };

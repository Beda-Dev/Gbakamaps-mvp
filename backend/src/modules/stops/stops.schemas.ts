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

export const nearbyStopsQuerySchema = z.object({
  lat: latSchema,
  lon: lonSchema,
  radius: z.coerce.number().int().min(100).max(20000).default(2000),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  type: stopTypeEnum.optional(),
});

export const stopIdParamsSchema = z.object({
  id: z.string().uuid('Identifiant invalide'),
});

export type NearbyStopsQuery = z.infer<typeof nearbyStopsQuerySchema>;

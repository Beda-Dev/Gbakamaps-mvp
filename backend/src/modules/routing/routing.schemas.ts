// =============================================================================
// Schémas de validation du module routing.
// =============================================================================
import { z } from 'zod';
import { IVORY_COAST_BOUNDS } from '../stops/stops.schemas.js';

// Format "lat,lon" (ex: "5.32,-4.02") — cohérent avec l'ancien projet,
// que le frontend reprendra tel quel.
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

export const routeQuerySchema = z.object({
  from: coordinatePairSchema,
  to: coordinatePairSchema,
  alternatives: z.coerce.boolean().default(false),
});

export type RouteQuery = z.infer<typeof routeQuerySchema>;
export type Coordinates = { lat: number; lon: number };

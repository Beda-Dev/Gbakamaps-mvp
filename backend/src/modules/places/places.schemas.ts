// =============================================================================
// Schémas de validation du module places.
// =============================================================================
import { z } from 'zod';

export const searchPlacesQuerySchema = z.object({
  q: z.string().trim().min(2, 'Recherche trop courte (2 caractères minimum)').max(100),
  limit: z.coerce.number().int().min(1).max(30).default(10),
});

export type SearchPlacesQuery = z.infer<typeof searchPlacesQuerySchema>;

// Catégories de POI réellement supportées (liste blanche de tags OSM
// `amenity`/`shop` courants et utiles à proximité d'un arrêt) — jamais une
// catégorie arbitraire passée telle quelle à Overpass.
export const POI_CATEGORIES = [
  'pharmacy',
  'marketplace',
  'school',
  'hospital',
  'clinic',
  'bank',
  'atm',
  'restaurant',
  'fast_food',
  'cafe',
  'fuel',
  'police',
  'place_of_worship',
  'university',
  'college',
  'post_office',
  'toilets',
  'bus_station',
] as const;

export const nearbyPoisQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().int().min(50).max(1000).default(300),
  categories: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.split(',').map((c) => c.trim()) : undefined)),
});

export type NearbyPoisQuery = z.infer<typeof nearbyPoisQuerySchema>;

export const listCommunesQuerySchema = z.object({
  // Optionnel : filtre par nom (recherche directe "par commune", demande
  // explicite de l'utilisateur) — absent = renvoie toutes les communes du
  // Grand Abidjan (pour les dessiner sur la carte).
  q: z.string().trim().min(2).max(100).optional(),
});

export type ListCommunesQuery = z.infer<typeof listCommunesQuerySchema>;

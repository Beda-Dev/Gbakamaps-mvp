// =============================================================================
// Schémas de validation du module places.
// =============================================================================
import { z } from 'zod';

export const searchPlacesQuerySchema = z.object({
  q: z.string().trim().min(2, 'Recherche trop courte (2 caractères minimum)').max(100),
  limit: z.coerce.number().int().min(1).max(30).default(10),
});

export type SearchPlacesQuery = z.infer<typeof searchPlacesQuerySchema>;

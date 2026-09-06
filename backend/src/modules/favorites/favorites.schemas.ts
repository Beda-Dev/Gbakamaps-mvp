// =============================================================================
// Schémas de validation du module favorites.
// =============================================================================
import { z } from 'zod';

export const createFavoriteBodySchema = z.object({
  stopId: z.string().uuid('Identifiant invalide'),
});

export const favoriteStopIdParamsSchema = z.object({
  stopId: z.string().uuid('Identifiant invalide'),
});

export type CreateFavoriteInput = z.infer<typeof createFavoriteBodySchema>;

// =============================================================================
// Schémas de validation du module lines — consultation publique des lignes
// + définition du tarif par un administrateur (phase 2, PROJECT_MEMORY.md
// §12 : le tarif n'est jamais inventé côté code, c'est l'admin qui fait foi).
// =============================================================================
import { z } from 'zod';

export const transportTypeEnum = z.enum(['BUS', 'GBAKA', 'WORO_WORO', 'TAXI', 'MOTO_TAXI']);

export const listLinesQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  transportType: transportTypeEnum.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const lineIdParamsSchema = z.object({
  id: z.string().uuid('Identifiant invalide'),
});

// `fare: null` est une valeur volontaire (ex: tarif réellement variable,
// pas de tarif fixe) — distincte de "pas encore renseigné" (fare undefined
// dans le body ne modifierait rien, mais ce schéma exige toujours une
// valeur explicite pour éviter toute ambiguïté sur ce qu'un admin a voulu dire).
export const setLineFareBodySchema = z.object({
  fare: z.number().min(0).max(100000).nullable(),
});

export type ListLinesQuery = z.infer<typeof listLinesQuerySchema>;
export type SetLineFareBody = z.infer<typeof setLineFareBodySchema>;

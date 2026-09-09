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

// =============================================================================
// CRUD admin des lignes (au-delà du seul tarif) — PROJECT_MEMORY.md §12.16,
// demande explicite de l'utilisateur, sur le modèle direct du CRUD arrêts
// déjà livré (§12.15, stops.schemas.ts) : mêmes principes structurants.
//   1. NE JAMAIS INVENTER DE DONNÉE. `externalRef` (route_id GTFS) et
//      `shapeGeoJson`/`shapeSource` (tracé officiel data.gouv.ci, §12.19)
//      ne sont JAMAIS pilotables depuis l'API — une ligne créée ici n'a NI
//      correspondance GTFS NI tracé officiel, et lui en fabriquer un serait
//      exactement l'erreur déjà commise ailleurs (osmId inventé, §7).
//   2. `fare`/`fareVerified` gardent leur règle métier déjà en place et déjà
//      testée (tests/lines.test.ts) : poser un tarif via ce PATCH le marque
//      immédiatement `fareVerified: true` — un admin fait foi, jamais une
//      estimation automatique après ce point.
// =============================================================================

export const createLineBodySchema = z.object({
  name: z.string().trim().min(1, 'Nom requis').max(200),
  shortName: z.string().trim().max(20).nullable().optional(),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Couleur hexadécimale attendue (#RRGGBB)')
    .nullable()
    .optional(),
  transportType: transportTypeEnum,
  operator: z.string().trim().max(200).nullable().optional(),
  fare: z.number().min(0).max(100000).nullable().optional(),
});

// PATCH général (nom/couleur/opérateur/type/statut actif) fusionné avec
// l'ancien endpoint tarif-seul (`fare`, déjà en production et testé) plutôt
// que dupliqué sur une autre route — un seul `PATCH /admin/lines/:id`,
// tous les champs optionnels, la règle `fare` → `fareVerified: true` gérée
// dans lines.service.ts exactement comme avant cette extension.
export const updateLineBodySchema = z
  .object({
    name: z.string().trim().min(1, 'Nom requis').max(200).optional(),
    shortName: z.string().trim().max(20).nullable().optional(),
    color: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Couleur hexadécimale attendue (#RRGGBB)')
      .nullable()
      .optional(),
    transportType: transportTypeEnum.optional(),
    operator: z.string().trim().max(200).nullable().optional(),
    // `false` = ligne désactivée (masquée de /lines, et désormais aussi du
    // planificateur/isochrone — `listLines` filtrait déjà sur `active:
    // true`, mais `trip-planning.service.ts` ne le faisait PAS avant cette
    // extension : corrigé au même moment, sinon désactiver une ligne
    // n'aurait été qu'un statut cosmétique sans effet sur les itinéraires
    // proposés) SANS détruire ses dessertes (`StopLine`) — l'action
    // recommandée pour une ligne qui n'existe plus, plutôt que la
    // suppression dure ci-dessous.
    active: z.boolean().optional(),
    fare: z.number().min(0).max(100000).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Aucun champ à modifier' });

export type ListLinesQuery = z.infer<typeof listLinesQuerySchema>;
export type CreateLineBody = z.infer<typeof createLineBodySchema>;
export type UpdateLineBody = z.infer<typeof updateLineBodySchema>;

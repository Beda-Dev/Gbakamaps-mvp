// =============================================================================
// Schémas de validation du module auth.
// Contrairement à l'ancien projet (validation.ts écrit puis jamais branché),
// ces schémas sont directement utilisés dans auth.routes.ts.
// =============================================================================
import { z } from 'zod';

export const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email invalide'),
  password: z
    .string()
    .min(8, 'Le mot de passe doit contenir au moins 8 caractères')
    .max(128, 'Le mot de passe est trop long'),
  displayName: z.string().trim().min(2).max(100).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email invalide'),
  password: z.string().min(1, 'Mot de passe requis'),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

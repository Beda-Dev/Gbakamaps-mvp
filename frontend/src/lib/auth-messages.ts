// =============================================================================
// Helpers partagés des écrans d'auth : validation client immédiate + traduction
// des erreurs API en messages clairs. Le backend reste la source de vérité
// (Zod côté serveur) ; ces messages ne font que reformuler ses statuts.
// =============================================================================
import { ApiError } from '@/lib/api/client';

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// 401 login : le backend répond volontairement le même message que l'email
// n'existe pas (anti-énumération) — on ne distingue jamais les deux cas.
export function loginErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Email ou mot de passe incorrect.';
    if (err.status === 400) return err.message;
    return `Une erreur est survenue (${err.status}). Réessayez.`;
  }
  return 'Serveur injoignable. Vérifiez votre connexion puis réessayez.';
}

export function signupErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return 'Cet email est déjà utilisé. Essayez de vous connecter.';
    if (err.status === 400) return err.message;
    return `Une erreur est survenue (${err.status}). Réessayez.`;
  }
  return 'Serveur injoignable. Vérifiez votre connexion puis réessayez.';
}

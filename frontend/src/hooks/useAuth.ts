// =============================================================================
// État d'authentification centralisé : un seul hook réutilisable partout.
// GET /api/auth/me renvoie 401 quand personne n'est connecté — c'est l'état
// normal "pas connecté", converti en `user = null` (pas une erreur).
// Les mutations login/signup/logout rafraîchissent la query `me` en posant
// directement la réponse en cache (retour immédiat, pas d'aller-retour).
// =============================================================================
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api/client';
import type { AuthUser, LoginInput, SignupInput } from '@/lib/api/types';

export const AUTH_ME_QUERY_KEY = ['auth', 'me'] as const;

export function useAuth() {
  const queryClient = useQueryClient();

  const me = useQuery({
    queryKey: AUTH_ME_QUERY_KEY,
    // Un 401 signifie simplement "non connecté" : on le convertit en null.
    // Toute autre erreur (réseau, 500…) se propage comme une vraie erreur.
    queryFn: async (): Promise<AuthUser | null> => {
      try {
        return await api.get<AuthUser>('/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  const loginMutation = useMutation({
    mutationFn: (input: LoginInput) => api.post<AuthUser>('/auth/login', input),
    onSuccess: (user) => {
      queryClient.setQueryData<AuthUser | null>(AUTH_ME_QUERY_KEY, user);
    },
  });

  const signupMutation = useMutation({
    mutationFn: (input: SignupInput) => api.post<AuthUser>('/auth/signup', input),
    onSuccess: (user) => {
      queryClient.setQueryData<AuthUser | null>(AUTH_ME_QUERY_KEY, user);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => api.post<null>('/auth/logout'),
    onSuccess: () => {
      queryClient.setQueryData<AuthUser | null>(AUTH_ME_QUERY_KEY, null);
    },
  });

  return {
    user: me.data ?? null,
    isLoading: me.isLoading,
    isError: me.isError,
    refetchUser: me.refetch,
    login: loginMutation.mutateAsync,
    signup: signupMutation.mutateAsync,
    logout: logoutMutation.mutateAsync,
    isLoginPending: loginMutation.isPending,
    isSignupPending: signupMutation.isPending,
    isLogoutPending: logoutMutation.isPending,
    loginError: loginMutation.error,
    signupError: signupMutation.error,
    logoutError: logoutMutation.error,
    resetLoginError: loginMutation.reset,
    resetSignupError: signupMutation.reset,
  };
}

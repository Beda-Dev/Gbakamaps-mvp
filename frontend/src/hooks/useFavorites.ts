// =============================================================================
// Favoris de l'utilisateur connecté : une query `['favorites']` sur
// GET /api/favorites + mutations POST/DELETE. Même convention que useAuth :
// un 401 signifie simplement "non connecté" (liste vide, pas une erreur).
// La query n'est active que si un utilisateur est connecté (`enabled`).
// =============================================================================
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api/client';
import type { Stop } from '@/lib/api/types';
import { useAuth } from '@/hooks/useAuth';

export const FAVORITES_QUERY_KEY = ['favorites'] as const;

// Favori tel que renvoyé par le backend (inclut l'arrêt sérialisé).
export interface Favorite {
  id: string;
  userId: string;
  stopId: string;
  createdAt: string;
  stop: Stop;
}

export interface FavoritesData {
  favorites: Favorite[];
  count: number;
}

const EMPTY: FavoritesData = { favorites: [], count: 0 };

export function useFavorites() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: FAVORITES_QUERY_KEY,
    queryFn: async (): Promise<FavoritesData> => {
      try {
        return await api.get<FavoritesData>('/favorites');
      } catch (err) {
        // 401 = non connecté : état normal, on expose une liste vide.
        // Toute autre erreur (réseau, 500…) se propage comme une vraie erreur.
        if (err instanceof ApiError && err.status === 401) return { ...EMPTY };
        throw err;
      }
    },
    // Pas d'appel inutile pour un visiteur anonyme.
    enabled: !!user,
    retry: false,
    staleTime: 30_000,
  });

  const addMutation = useMutation({
    mutationFn: (stopId: string) => api.post<Favorite>('/favorites', { stopId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FAVORITES_QUERY_KEY });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (stopId: string) => api.delete<null>(`/favorites/${stopId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FAVORITES_QUERY_KEY });
    },
  });

  function isFavorite(stopId: string): boolean {
    const list = query.data?.favorites ?? [];
    return list.some((fav) => fav.stopId === stopId || fav.stop?.id === stopId);
  }

  return {
    favorites: query.data?.favorites ?? [],
    count: query.data?.count ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    addFavorite: addMutation.mutateAsync,
    removeFavorite: removeMutation.mutateAsync,
    isFavorite,
    isMutating: addMutation.isPending || removeMutation.isPending,
    addError: addMutation.error,
    removeError: removeMutation.error,
  };
}

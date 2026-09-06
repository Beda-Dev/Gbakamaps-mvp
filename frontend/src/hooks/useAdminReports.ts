// =============================================================================
// Modération admin : query `['admin', 'reports', status]` sur
// GET /api/admin/reports?status=…&limit=…&offset=… + mutation
// PATCH /api/admin/reports/:id. Même convention que useReports/useFavorites
// (labels FR réutilisés depuis useReports, jamais redéfinis ici).
//
// Distinction 401/403 : un 401 signifie "session expirée" (vraie erreur, avec
// "Réessayer"), un 403 signifie "connecté mais pas admin" (exposé via
// `isForbidden` pour un message clair, pas une redirection vers /login qui
// serait trompeuse : l'utilisateur EST connecté).
// La query n'est active que si `user?.role === 'ADMIN'`.
// =============================================================================
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import type { Report, ReportStatus } from '@/hooks/useReports';
import type { Stop } from '@/lib/api/types';

export const ADMIN_REPORTS_QUERY_KEY = ['admin', 'reports'] as const;

// Statuts acceptés par PATCH /api/admin/reports/:id — jamais PENDING
// (le backend le refuse en 400, l'UI ne propose donc pas cette action).
export type ModerateStatus = 'APPROVED' | 'REJECTED' | 'RESOLVED';

export interface AdminReportUser {
  id: string;
  email: string;
  displayName: string | null;
}

// Signalement tel que renvoyé par GET /api/admin/reports : le Report de base
// + auteur inclus + arrêt inclus (null si stopId nul).
export interface AdminReport extends Report {
  userId: string;
  user: AdminReportUser;
  stop: Stop | null;
}

export interface AdminReportsData {
  reports: AdminReport[];
  count: number;
  total: number;
}

export interface ModerateInput {
  id: string;
  status: ModerateStatus;
}

export const ADMIN_REPORTS_PAGE_SIZE = 20;

export function useAdminReports(
  status?: ReportStatus,
  options?: { limit?: number; offset?: number }
) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const limit = options?.limit ?? ADMIN_REPORTS_PAGE_SIZE;
  const offset = options?.offset ?? 0;
  const isAdmin = user?.role === 'ADMIN';

  const query = useQuery({
    // La clé inclut le filtre (et la pagination) : changer d'onglet ou de
    // page relance la requête.
    queryKey: [...ADMIN_REPORTS_QUERY_KEY, status ?? 'ALL', limit, offset],
    queryFn: async (): Promise<AdminReportsData> => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      params.set('limit', String(limit));
      params.set('offset', String(offset));
      return await api.get<AdminReportsData>(`/admin/reports?${params.toString()}`);
    },
    // Pas d'appel inutile pour un visiteur anonyme ou non-admin.
    enabled: isAdmin,
    retry: false,
    staleTime: 30_000,
  });

  const moderateMutation = useMutation({
    mutationFn: ({ id, status: next }: ModerateInput) =>
      api.patch<AdminReport>(`/admin/reports/${id}`, { status: next }),
    onSuccess: () => {
      // Clé partielle : invalide toutes les variantes de filtre/pagination.
      void queryClient.invalidateQueries({ queryKey: ADMIN_REPORTS_QUERY_KEY });
    },
  });

  const error = query.error;
  // 403 = connecté mais pas admin (à distinguer d'un 401 "non connecté").
  // Le garde-fou sur le rôle couvre le cas où la query ne s'est même pas
  // lancée (`enabled: false` pour un non-admin) ; le test sur l'erreur couvre
  // le cas où le backend refuse (ex. rôle révoqué après le chargement de /me).
  const isForbidden =
    (!!user && !isAdmin) || (error instanceof ApiError && error.status === 403);

  return {
    reports: query.data?.reports ?? [],
    count: query.data?.count ?? 0,
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error,
    isForbidden,
    refetch: query.refetch,
    moderate: moderateMutation.mutateAsync,
    isModerating: moderateMutation.isPending,
    moderateError: moderateMutation.error,
    resetModerateError: moderateMutation.reset,
  };
}

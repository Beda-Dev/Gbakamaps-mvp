// =============================================================================
// Signalements de l'utilisateur connecté : une query `['reports', 'mine']` sur
// GET /api/reports/mine + mutation POST /api/reports. Même convention que
// useFavorites : un 401 signifie simplement "non connecté" (liste vide, pas
// une erreur). La query n'est active que si un utilisateur est connecté.
// =============================================================================
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';

export const REPORTS_MINE_QUERY_KEY = ['reports', 'mine'] as const;

export type ReportType =
  | 'MISSING_STOP'
  | 'INCORRECT_INFO'
  | 'DAMAGE'
  | 'SAFETY_ISSUE'
  | 'NEW_LINE'
  | 'SCHEDULE_CHANGE'
  | 'DUPLICATE_STOP'
  | 'OTHER';

export type ReportStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'RESOLVED';

export interface Report {
  id: string;
  reportType: ReportType;
  title: string;
  description: string | null;
  stopId: string | null;
  status: ReportStatus;
  createdAt: string;
}

export interface ReportsData {
  reports: Report[];
  count: number;
}

export interface CreateReportInput {
  reportType: ReportType;
  title: string;
  description?: string;
  stopId?: string;
  imageUrl?: string;
  lat?: number;
  lon?: number;
}

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  MISSING_STOP: 'Arrêt manquant',
  INCORRECT_INFO: 'Info incorrecte',
  DAMAGE: 'Dégradation',
  SAFETY_ISSUE: 'Problème de sécurité',
  NEW_LINE: 'Nouvelle ligne',
  SCHEDULE_CHANGE: "Changement d'horaire",
  DUPLICATE_STOP: 'Doublon',
  OTHER: 'Autre',
};

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  PENDING: 'En attente',
  APPROVED: 'Approuvé',
  REJECTED: 'Rejeté',
  RESOLVED: 'Résolu',
};

// Traduction des statuts d'erreur API en messages clairs (même esprit que
// lib/auth-messages.ts : le backend reste la source de vérité, on reformule).
export function reportErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Connectez-vous pour signaler un problème.';
    if (err.status === 404) return "Cet arrêt n'existe plus.";
    // 400 : validation — le message brut du backend est souvent exploitable
    // (Zod), on le relaie ; sinon un message générique actionnable.
    if (err.status === 400) return err.message || 'Signalement invalide. Vérifiez les champs.';
    return `Une erreur est survenue (${err.status}). Réessayez.`;
  }
  return 'Serveur injoignable. Vérifiez votre connexion puis réessayez.';
}

const EMPTY: ReportsData = { reports: [], count: 0 };

export function useReports() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: REPORTS_MINE_QUERY_KEY,
    queryFn: async (): Promise<ReportsData> => {
      try {
        return await api.get<ReportsData>('/reports/mine');
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

  const createMutation = useMutation({
    mutationFn: (input: CreateReportInput) => api.post<Report>('/reports', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: REPORTS_MINE_QUERY_KEY });
    },
  });

  return {
    reports: query.data?.reports ?? [],
    count: query.data?.count ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    createReport: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    // Message prêt à afficher (string | null) — pas l'erreur brute.
    createError: createMutation.error ? reportErrorMessage(createMutation.error) : null,
    createErrorRaw: createMutation.error,
    resetCreateError: createMutation.reset,
  };
}

// =============================================================================
// CRUD admin des arrêts — POST/PATCH/DELETE /api/admin/stops(/:id), réservés
// au rôle ADMIN côté backend (voir backend/src/modules/stops/stops.routes.ts).
// Même convention que useAdminReports.ts (isForbidden distinct de isError,
// invalidation des listes publiques après mutation pour que la carte
// principale reflète immédiatement le changement).
// =============================================================================
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { NearbyStopsData, Stop } from '@/lib/api/types';

export interface CreateStopInput {
  name: string | null;
  lat: number;
  lon: number;
  stopType?: string;
  gbaka?: boolean;
  woroworo?: boolean;
  taxi?: boolean;
  mototaxi?: boolean;
  shelter?: boolean;
  bench?: boolean;
  wheelchair?: boolean;
  verified?: boolean;
}

// `active` volontairement absent de CreateStopInput (comme côté backend,
// stops.schemas.ts) : un arrêt créé n'a aucune raison de naître désactivé.
export type UpdateStopInput = Partial<CreateStopInput> & { active?: boolean };

// Liste ADMIN distincte de useNearbyStops (public) : inclut les arrêts
// désactivés, sinon impossible de les retrouver pour les réactiver — même
// principe que useAdminLines.ts.
export function useAdminNearbyStops(lat: number, lon: number, radius: number) {
  return useQuery({
    queryKey: ['admin-stops', lat, lon, radius],
    queryFn: () =>
      api.get<NearbyStopsData>(`/admin/stops?lat=${lat}&lon=${lon}&radius=${radius}&limit=500`),
    staleTime: 30_000,
  });
}

// Conséquences réelles d'une suppression — voir stops.service.ts côté
// backend (StopDeletionImpact) pour le détail Cascade vs SetNull.
export interface StopDeletionImpact {
  id: string;
  name: string | null;
  favoritesDeleted: number;
  stopLinesDeleted: number;
  reportsDetached: number;
}

// Les mutations invalident aussi bien les listes publiques (`stops`, la
// carte principale) que toute cache admin future — un admin qui déplace un
// arrêt doit le voir bouger immédiatement, pas seulement après un F5.
function invalidateStopCaches(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['stops'] });
  void queryClient.invalidateQueries({ queryKey: ['admin-stops'] });
}

export function useCreateStop() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStopInput) => api.post<Stop>('/admin/stops', input),
    onSuccess: () => invalidateStopCaches(queryClient),
  });
}

export function useUpdateStop() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateStopInput }) =>
      api.patch<Stop>(`/admin/stops/${id}`, input),
    onSuccess: () => invalidateStopCaches(queryClient),
  });
}

// Récupère l'impact AVANT suppression — appelé explicitement (pas un hook de
// query automatique) car ce n'est utile qu'au moment où l'admin ouvre la
// confirmation de suppression, jamais en arrière-plan.
export function useStopDeletionImpact() {
  return useMutation({
    mutationFn: (id: string) => api.get<StopDeletionImpact>(`/admin/stops/${id}/impact`),
  });
}

export function useDeleteStop() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<StopDeletionImpact>(`/admin/stops/${id}`),
    onSuccess: () => invalidateStopCaches(queryClient),
  });
}

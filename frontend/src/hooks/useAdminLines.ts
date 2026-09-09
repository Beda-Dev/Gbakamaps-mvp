// =============================================================================
// CRUD admin des lignes — POST/PATCH/DELETE /api/admin/lines(/:id), réservés
// au rôle ADMIN côté backend (voir backend/src/modules/lines/lines.routes.ts,
// §12.16/§12.21). Même convention que useAdminStops.ts.
// =============================================================================
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { TransportType } from '@/lib/api/types';

export interface AdminLine {
  id: string;
  name: string;
  shortName: string | null;
  color: string | null;
  transportType: TransportType;
  operator: string | null;
  fare: number | null;
  fareVerified: boolean;
  active: boolean;
  externalRef: string | null;
  shapeSource: string | null;
  _count: { stopLines: number };
}

export interface CreateLineInput {
  name: string;
  shortName?: string | null;
  color?: string | null;
  transportType: TransportType;
  operator?: string | null;
  fare?: number | null;
}

export type UpdateLineInput = Partial<CreateLineInput> & { active?: boolean };

// Conséquences réelles d'une suppression dure — voir lines.service.ts côté
// backend (LineDeletionImpact). Une ligne n'a qu'un seul type de relation
// détruite en cascade (StopLine), contrairement à Stop (favoris/dessertes/
// signalements) — décompte donc plus simple.
export interface LineDeletionImpact {
  id: string;
  name: string;
  stopLinesDeleted: number;
}

interface AdminLinesData {
  lines: AdminLine[];
  count: number;
}

// Liste ADMIN distincte de useLines (public) : inclut les lignes désactivées,
// sinon impossible de les retrouver pour les réactiver depuis cette page.
export function useAdminLines(q: string) {
  return useQuery({
    queryKey: ['admin-lines', q],
    queryFn: () => api.get<AdminLinesData>(`/admin/lines${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    staleTime: 30_000,
  });
}

// Les mutations invalident aussi bien la liste admin que la liste publique
// (`/lines`, utilisée par le planificateur et les fiches arrêt) — un admin
// qui désactive une ligne doit la voir disparaître partout, immédiatement.
function invalidateLineCaches(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['admin-lines'] });
  void queryClient.invalidateQueries({ queryKey: ['lines'] });
}

export function useCreateLine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLineInput) => api.post<AdminLine>('/admin/lines', input),
    onSuccess: () => invalidateLineCaches(queryClient),
  });
}

export function useUpdateLine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateLineInput }) =>
      api.patch<AdminLine>(`/admin/lines/${id}`, input),
    onSuccess: () => invalidateLineCaches(queryClient),
  });
}

// Récupère l'impact AVANT suppression — appelé explicitement (pas un hook de
// query automatique), au moment où l'admin ouvre la confirmation.
export function useLineDeletionImpact() {
  return useMutation({
    mutationFn: (id: string) => api.get<LineDeletionImpact>(`/admin/lines/${id}/impact`),
  });
}

export function useDeleteLine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<LineDeletionImpact>(`/admin/lines/${id}`),
    onSuccess: () => invalidateLineCaches(queryClient),
  });
}

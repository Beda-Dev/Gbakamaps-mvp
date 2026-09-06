// =============================================================================
// Planificateur de trajet multi-modal (phase 2, PROJECT_MEMORY.md §12.3) —
// s'appuie sur GET /api/trip-plan, qui utilise enfin le graphe des lignes
// gbaka/woro-woro/bus plutôt qu'un simple point-à-point piéton/voiture
// (useRoute.ts, toujours utilisé pour "aller à cet arrêt précis").
// =============================================================================
import { useMutation } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api/client';
import type { Line } from '@/lib/api/types';

export type OptimizeCriterion = 'fastest' | 'cheapest' | 'least-walking';

export interface TripCoordinates {
  lat: number;
  lon: number;
}

export interface TripStopPoint {
  id: string;
  name: string | null;
  lat: number;
  lon: number;
}

export interface TripStep {
  type: 'walk' | 'ride';
  distanceMeters: number;
  durationSeconds: number;
  fromLabel?: string;
  toLabel?: string;
  line?: Line & { fareVerified: boolean };
  direction?: string | null;
  boardStop?: TripStopPoint;
  alightStop?: TripStopPoint;
  costFCFA?: number | null;
  costVerified?: boolean;
  durationEstimateBasis?: 'gtfs-schedule' | 'haversine-fallback';
}

export interface TripPlan {
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  walkingDurationSeconds: number;
  transfersCount: number;
  totalCostFCFA: number | null;
  costVerified: boolean;
  steps: TripStep[];
}

export interface PlanTripInput {
  from: TripCoordinates;
  to: TripCoordinates;
  walkRadius?: number;
  maxTransfers?: 0 | 1;
  optimize?: OptimizeCriterion;
}

interface TripPlanApiData {
  plans: TripPlan[];
  criterion: OptimizeCriterion;
  walkRadius: number;
  note: string;
}

export function tripPlanErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 400) return 'Coordonnées invalides ou hors de la zone de service (Côte d’Ivoire).';
    return `Une erreur est survenue (${err.status}). Réessayez.`;
  }
  return 'Serveur injoignable. Vérifiez votre connexion puis réessayez.';
}

function toLatLonParam(c: TripCoordinates): string {
  return `${c.lat},${c.lon}`;
}

function buildTripPlanPath(input: PlanTripInput): string {
  const params = new URLSearchParams({
    from: toLatLonParam(input.from),
    to: toLatLonParam(input.to),
    optimize: input.optimize ?? 'fastest',
    maxTransfers: String(input.maxTransfers ?? 1),
  });
  if (input.walkRadius) params.set('walkRadius', String(input.walkRadius));
  return `/trip-plan?${params.toString()}`;
}

export function useTripPlan() {
  const mutation = useMutation({
    mutationFn: async (input: PlanTripInput): Promise<TripPlanApiData> =>
      api.get<TripPlanApiData>(buildTripPlanPath(input)),
    retry: false,
  });

  return {
    plan: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error ? tripPlanErrorMessage(mutation.error) : null,
    data: mutation.data,
    reset: mutation.reset,
  };
}

// --- Formatage (mêmes conventions françaises que useRoute.ts). -------------

export function formatTripDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`;
  }
  return `${Math.round(meters)} m`;
}

export function formatTripDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}min`;
}

export function formatTripCost(plan: Pick<TripPlan, 'totalCostFCFA' | 'costVerified'>): string {
  if (plan.totalCostFCFA === null) return 'Coût inconnu';
  const amount = `${plan.totalCostFCFA.toLocaleString('fr-FR')} FCFA`;
  return plan.costVerified ? amount : `${amount} (estimé)`;
}

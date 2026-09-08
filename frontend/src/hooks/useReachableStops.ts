// =============================================================================
// Approximation "zone accessible en X minutes" (PROJECT_MEMORY.md §12.17/§12.18)
// — via GET /api/isochrone.
//
// Ce N'EST PAS un vrai isochrone réseau-routier (ni ORS ni GraphHopper ne
// l'exposent sur le plan gratuit du projet) : le backend énumère les arrêts
// réellement atteignables via le graphe de lignes GTFS dans un budget de
// temps donné. Le résultat est un ENSEMBLE D'ARRÊTS (pas un polygone lissé)
// et l'estimation est OPTIMISTE (le temps d'attente aux correspondances n'est
// pas modélisé, faute de données de fréquence). L'UI doit l'afficher comme
// telle — voir HomePage.tsx.
// =============================================================================
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export interface ReachableStop {
  stopId: string;
  name: string | null;
  lat: number;
  lon: number;
  etaSeconds: number;
  // Nombre d'embarquements pour l'atteindre (0 = accessible à pied depuis le
  // point choisi, sans prendre aucune ligne).
  rides: number;
  lastLine: {
    id: string;
    name: string;
    shortName: string | null;
    color: string | null;
    transportType: string;
  } | null;
}

export interface IsochroneData {
  origin: { lat: number; lon: number };
  maxMinutes: number;
  walkRadius: number;
  maxRides: number;
  approximation: boolean;
  reachableStops: ReachableStop[];
  stats: { stopsReachable: number; segmentsExplored: number; truncated: boolean };
  note: string;
}

// `point` null/undefined → hook désactivé (aucun appel réseau tant que
// l'utilisateur n'a pas choisi de point de départ).
export function useReachableStops(
  point: { lat: number; lon: number } | null | undefined,
  maxMinutes: number
) {
  const enabled = !!point;
  const query = useQuery({
    queryKey: ['isochrone', point?.lat, point?.lon, maxMinutes],
    queryFn: () => {
      const params = new URLSearchParams({
        from: `${point!.lat},${point!.lon}`,
        maxMinutes: String(maxMinutes),
      });
      return api.get<IsochroneData>(`/isochrone?${params.toString()}`);
    },
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });

  return {
    data: query.data ?? null,
    reachableStops: query.data?.reachableStops ?? [],
    isLoading: enabled && query.isLoading,
    isError: enabled && query.isError,
  };
}

// Minutes proposées à l'utilisateur — volontairement peu d'options (choix
// "minimal", cf. délégation). 30 min par défaut.
export const ISOCHRONE_MINUTES_OPTIONS = [15, 30, 45] as const;
export type IsochroneMinutes = (typeof ISOCHRONE_MINUTES_OPTIONS)[number];

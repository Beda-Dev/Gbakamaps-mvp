// =============================================================================
// Quartiers du Grand Abidjan (place=suburb|neighbourhood|quarter, OSM via
// Overpass) — via GET /api/places/neighborhoods (voir backend §12.13).
// Idée notée PROJECT_MEMORY.md §12.8, confirmée par l'utilisateur.
//
// Liste stable (les quartiers ne changent pas d'une session à l'autre) :
// staleTime long, un seul appel réseau par session de navigation typique.
// =============================================================================
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export interface Neighborhood {
  name: string;
  lat: number;
  lon: number;
}

interface NeighborhoodsData {
  neighborhoods: Neighborhood[];
  count: number;
}

export function useNeighborhoods(enabled: boolean) {
  const query = useQuery({
    queryKey: ['places', 'neighborhoods'],
    queryFn: () => api.get<NeighborhoodsData>('/places/neighborhoods'),
    enabled,
    staleTime: 30 * 60_000,
    retry: false,
  });

  return {
    neighborhoods: query.data?.neighborhoods ?? [],
    isLoading: enabled && query.isLoading,
    isError: enabled && query.isError,
  };
}

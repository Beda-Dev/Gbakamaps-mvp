import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { NearbyStopsData } from '@/lib/api/types';

export function useNearbyStops(lat: number, lon: number, radius = 2000) {
  return useQuery({
    queryKey: ['stops', 'nearby', lat, lon, radius],
    queryFn: () =>
      api.get<NearbyStopsData>(`/stops/nearby?lat=${lat}&lon=${lon}&radius=${radius}&limit=100`),
    staleTime: 60_000,
  });
}

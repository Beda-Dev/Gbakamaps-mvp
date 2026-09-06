import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { NearbyStopsData } from '@/lib/api/types';

export function useNearbyStops(lat: number, lon: number, radius = 2000) {
  return useQuery({
    queryKey: ['stops', 'nearby', lat, lon, radius],
    queryFn: () =>
      api.get<NearbyStopsData>(`/stops/nearby?lat=${lat}&lon=${lon}&radius=${radius}&limit=100`),
    staleTime: 60_000,
    // Bug réel trouvé le 2026-09-06 en testant le sélecteur de rayon : sans
    // ceci, `data` redevient `undefined` pendant le rechargement (nouvelle
    // queryKey à chaque changement de rayon), ce qui démonte complètement
    // <StopsMap> (rendue seulement si `stops.data` est défini) — la carte
    // MapLibre se recrée alors dans le même conteneur DOM, et n'affiche plus
    // aucun marqueur (probable conflit de contexte WebGL au ré-init rapide).
    // `keepPreviousData` garde les anciens arrêts affichés pendant le fetch,
    // la carte ne démonte jamais, les marqueurs se mettent juste à jour.
    placeholderData: keepPreviousData,
  });
}

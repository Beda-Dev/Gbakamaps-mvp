import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { NearbyStopsData } from '@/lib/api/types';

// Plafond réel envoyé à l'API (voir nearbyStopsQuerySchema, max=500 côté
// backend — remonté de 100 le 2026-09-08, la limite basse datait des
// Markers DOM individuels, obsolète depuis le clustering GeoJSON, §12.11).
// Exporté pour que l'UI sache reconnaître un résultat encore TRONQUÉ
// (count === ce plafond, cas extrême) et ne jamais l'afficher comme
// exhaustif — bug réel trouvé le 2026-09-08 : le compteur affichait
// "100 arrêts" en zone dense (Plateau) alors que le vrai total dépassait
// ce plafond, incohérent avec le cercle de rayon affiché à côté.
export const NEARBY_STOPS_LIMIT = 500;

export function useNearbyStops(lat: number, lon: number, radius = 2000) {
  return useQuery({
    queryKey: ['stops', 'nearby', lat, lon, radius],
    queryFn: () =>
      api.get<NearbyStopsData>(
        `/stops/nearby?lat=${lat}&lon=${lon}&radius=${radius}&limit=${NEARBY_STOPS_LIMIT}`
      ),
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

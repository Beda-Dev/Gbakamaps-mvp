// =============================================================================
// Points d'intérêt réels à proximité d'un arrêt (pharmacie, marché,
// école...) — via GET /api/places/nearby (proxy Overpass, voir backend).
// Idée notée PROJECT_MEMORY.md §12.8, confirmée par l'utilisateur
// ("ok ajoute ça dans tes plans"), backend livré §12.13, ce hook en fait
// enfin usage côté frontend.
//
// Jamais mélangé avec les arrêts/lignes réels : ce sont des lieux
// génériques sans aucune donnée de transport, affichés dans une section
// clairement à part du panneau détail (voir HomePage.tsx).
// =============================================================================
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export interface NearbyPoi {
  name: string;
  lat: number;
  lon: number;
  category: string;
}

interface NearbyPoisData {
  pois: NearbyPoi[];
  count: number;
}

// Libellés humains pour les catégories brutes (tags OSM `amenity`) — jamais
// un tag technique affiché tel quel à l'utilisateur.
export const POI_CATEGORY_LABELS: Record<string, string> = {
  pharmacy: 'Pharmacie',
  marketplace: 'Marché',
  school: 'École',
  hospital: 'Hôpital',
  clinic: 'Clinique',
  bank: 'Banque',
  atm: 'Distributeur (ATM)',
  restaurant: 'Restaurant',
  fast_food: 'Restauration rapide',
  cafe: 'Café',
  fuel: 'Station-service',
  police: 'Police',
  place_of_worship: 'Lieu de culte',
  university: 'Université',
  college: 'Établissement supérieur',
  post_office: 'Bureau de poste',
  toilets: 'Toilettes publiques',
  bus_station: 'Gare routière',
};

// Coordonnées null/undefined → hook désactivé (pas d'appel réseau sans
// point de référence, ex. avant qu'un arrêt soit sélectionné).
export function useNearbyPois(point: { lat: number; lon: number } | null | undefined, radiusMeters = 300) {
  const enabled = !!point;
  const query = useQuery({
    queryKey: ['places', 'nearby', point?.lat, point?.lon, radiusMeters],
    queryFn: () =>
      api.get<NearbyPoisData>(
        `/places/nearby?lat=${point!.lat}&lon=${point!.lon}&radius=${radiusMeters}`
      ),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });

  return {
    pois: query.data?.pois ?? [],
    isLoading: enabled && query.isLoading,
    isError: enabled && query.isError,
  };
}

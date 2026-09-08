// =============================================================================
// Communes du Grand Abidjan — vraies limites administratives (polygone réel
// + bbox) via GET /api/places/communes (Overpass, voir backend §12.14).
// Demande explicite de l'utilisateur ("on peut délimiter les quartiers, ou
// commune ? Overpass le fait ? et faire une recherche directe ?").
// =============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export interface Commune {
  name: string;
  adminLevel: string | null;
  bounds: { south: number; west: number; north: number; east: number };
  // Anneaux [lon, lat] fermés — reconstruits côté backend depuis les
  // segments OSM ; approximation honnête d'un contour réel, pas garanti
  // topologiquement parfait (voir commentaire backend).
  polygon: [number, number][][];
}

interface CommunesData {
  communes: Commune[];
  count: number;
}

// Liste complète des communes (pour les dessiner sur la carte) — activée
// seulement quand demandé (toggle "quartiers/communes"), cache long car la
// liste ne change jamais d'une session à l'autre.
export function useCommunes(enabled: boolean) {
  const query = useQuery({
    queryKey: ['places', 'communes', 'all'],
    queryFn: () => api.get<CommunesData>('/places/communes'),
    enabled,
    staleTime: 30 * 60_000,
    retry: false,
  });

  return {
    communes: query.data?.communes ?? [],
    isLoading: enabled && query.isLoading,
    isError: enabled && query.isError,
  };
}

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

// Recherche de communes par nom (saisie libre) — pour "chercher/zoomer
// directement sur une commune", même pattern debounce que usePlaceSearch.
export function useCommuneSearch() {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((value: string) => {
    setText(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebounced(value.trim()), DEBOUNCE_MS);
  }, []);

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setText('');
    setDebounced('');
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const enabled = debounced.length >= MIN_QUERY_LENGTH;
  const query = useQuery({
    queryKey: ['places', 'communes', 'search', debounced],
    queryFn: () => api.get<CommunesData>(`/places/communes?q=${encodeURIComponent(debounced)}`),
    enabled,
    staleTime: 60_000,
    retry: false,
  });

  return {
    text,
    search,
    clear,
    results: enabled ? query.data?.communes ?? [] : [],
    isPending: text.trim().length >= MIN_QUERY_LENGTH && (text.trim() !== debounced || query.isFetching),
    isError: enabled && query.isError,
  };
}

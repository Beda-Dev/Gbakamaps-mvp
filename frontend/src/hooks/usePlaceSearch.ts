// =============================================================================
// Recherche de lieux quelconques (pas seulement des arrêts connus) — via
// GET /api/places/search (proxy Overpass, voir backend). Complète
// useStopSearch : un champ de recherche combine les deux pour se comporter
// "comme Google Maps" (demande explicite de l'utilisateur) tout en gardant
// les deux sources honnêtement distinguées côté UI (jamais fusionnées à
// l'aveugle) — voir StopSearchBar.tsx / TripPlannerPage.tsx.
// =============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export const PLACE_MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

export interface PlaceResult {
  name: string;
  lat: number;
  lon: number;
  category: string | null;
  // Non-null si ce lieu a été identifié avec confiance comme un arrêt déjà
  // connu de notre base (voir backend/src/modules/places/places.service.ts)
  // — dans ce cas, l'UI ne doit PAS l'afficher comme un résultat séparé,
  // l'arrêt réel (avec toutes ses données de transport) apparaît déjà via
  // useStopSearch.
  matchedStopId: string | null;
}

interface SearchPlacesData {
  places: PlaceResult[];
  count: number;
}

export function usePlaceSearch() {
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

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const enabled = debounced.length >= PLACE_MIN_QUERY_LENGTH;

  const query = useQuery({
    queryKey: ['places', 'search', debounced],
    queryFn: () => api.get<SearchPlacesData>(`/places/search?q=${encodeURIComponent(debounced)}&limit=8`),
    enabled,
    staleTime: 60_000,
    retry: false,
  });

  // Un lieu déjà identifié comme un de nos arrêts (matchedStopId non nul)
  // n'est jamais affiché comme un résultat "lieu" séparé — voir le
  // commentaire sur PlaceResult.matchedStopId.
  const results = enabled ? (query.data?.places ?? []).filter((p) => !p.matchedStopId) : [];

  return {
    text,
    search,
    clear,
    isPending: text.trim().length >= PLACE_MIN_QUERY_LENGTH && (text.trim() !== debounced || query.isFetching),
    results,
    isError: enabled && query.isError,
  };
}

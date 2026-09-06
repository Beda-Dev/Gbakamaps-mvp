// =============================================================================
// Recherche textuelle des arrêts (nom d'arrêt ou de ligne) — écart UX comblé
// en phase 2 (PROJECT_MEMORY.md §12) : jusqu'ici, la carte était le SEUL
// moyen de trouver un arrêt (proximité géographique via useNearbyStops), pas
// de recherche par nom façon "destination-first" (Citymapper/Google Maps).
//
// Debounce interne (300ms) : `search(text)` met à jour l'état local
// immédiatement (l'input reste réactif), mais la requête réseau ne part
// qu'après une pause de frappe — évite un appel par frappe.
// =============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Stop } from '@/lib/api/types';

export const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

interface SearchStopsData {
  stops: Stop[];
  count: number;
}

export function useStopSearch(near?: { lat: number; lon: number } | null) {
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

  // Pas de requête en suspens après démontage (même discipline que
  // useLiveTracking pour clearWatch : ici un simple clearTimeout).
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const enabled = debounced.length >= MIN_QUERY_LENGTH;
  const nearParam = near ? `&near=${near.lat},${near.lon}` : '';

  const query = useQuery({
    queryKey: ['stops', 'search', debounced, near?.lat, near?.lon],
    queryFn: () =>
      api.get<SearchStopsData>(
        `/stops/search?q=${encodeURIComponent(debounced)}&limit=15${nearParam}`,
      ),
    enabled,
    staleTime: 30_000,
  });

  return {
    text,
    search,
    clear,
    isSearching: text.length > 0,
    // Le debounce fait que isLoading/isFetching de la query peuvent rester
    // "faux" pendant la pause de frappe : on expose un flag composite pour
    // que l'UI affiche un spinner dès la frappe, pas seulement pendant le
    // fetch réseau lui-même.
    isPending: text.trim().length >= MIN_QUERY_LENGTH && (text.trim() !== debounced || query.isFetching),
    results: enabled ? (query.data?.stops ?? []) : [],
    isError: enabled && query.isError,
  };
}

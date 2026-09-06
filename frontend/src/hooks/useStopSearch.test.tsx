// Tests du hook useStopSearch : debounce, longueur minimale, URL construite
// (avec/sans `near`), pas de requête en dessous du seuil. Fetch mocké, comme
// les autres hooks de ce projet — aucun appel réseau réel.
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStopSearch } from '@/hooks/useStopSearch';
import { fetchMock, findFetchCall, setFetchHandler } from '@/test/utils';

const RESULT_STOP = {
  id: 's1',
  name: 'Adjamé Gare',
  lat: 5.35,
  lon: -4.02,
  stopType: 'STATION',
  verified: true,
  gbaka: true,
  woroworo: false,
  taxi: false,
  mototaxi: false,
  lines: [],
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useStopSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("n'appelle pas l'API en dessous de 2 caractères", async () => {
    setFetchHandler(() => ({
      status: 200,
      body: { success: true, data: { stops: [RESULT_STOP], count: 1 } },
    }));
    const { result } = renderHook(() => useStopSearch(), { wrapper: createWrapper() });

    act(() => {
      result.current.search('a');
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(findFetchCall('/stops/search')).toBeUndefined();
    expect(result.current.results).toEqual([]);
  });

  it('attend la fin du debounce (300ms) avant d’appeler l’API', async () => {
    setFetchHandler(() => ({
      status: 200,
      body: { success: true, data: { stops: [RESULT_STOP], count: 1 } },
    }));
    const { result } = renderHook(() => useStopSearch(), { wrapper: createWrapper() });

    act(() => {
      result.current.search('adjame');
    });
    // Juste avant la fin du debounce : toujours aucun appel.
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(findFetchCall('/stops/search')).toBeUndefined();

    act(() => {
      vi.advanceTimersByTime(100);
    });
    vi.useRealTimers(); // waitFor a besoin des vrais timers pour ses propres retries.
    await waitFor(() => expect(result.current.results).toHaveLength(1));

    const call = findFetchCall('/stops/search');
    expect(call).toBeDefined();
    expect(call!.url).toContain('/api/stops/search?q=adjame');
    expect(call!.url).not.toContain('near=');
  });

  it('ajoute le paramètre near quand une position de référence est fournie', async () => {
    setFetchHandler(() => ({
      status: 200,
      body: { success: true, data: { stops: [], count: 0 } },
    }));
    const { result } = renderHook(() => useStopSearch({ lat: 5.32, lon: -4.02 }), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.search('gare');
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    vi.useRealTimers();
    await waitFor(() => expect(findFetchCall('/stops/search')).toBeDefined());

    const call = findFetchCall('/stops/search');
    expect(call!.url).toContain('near=5.32,-4.02');
  });

  it('clear() vide le texte et arrête toute requête en attente', async () => {
    setFetchHandler(() => ({
      status: 200,
      body: { success: true, data: { stops: [RESULT_STOP], count: 1 } },
    }));
    const { result } = renderHook(() => useStopSearch(), { wrapper: createWrapper() });

    act(() => {
      result.current.search('adjame');
    });
    act(() => {
      result.current.clear();
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.text).toBe('');
    expect(findFetchCall('/stops/search')).toBeUndefined();
  });

  it('isSearching reflète le texte saisi, indépendamment du debounce', () => {
    const { result } = renderHook(() => useStopSearch(), { wrapper: createWrapper() });
    expect(result.current.isSearching).toBe(false);
    act(() => {
      result.current.search('a');
    });
    expect(result.current.isSearching).toBe(true);
  });

  it('une erreur réseau expose isError sans faire planter le hook', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useStopSearch(), { wrapper: createWrapper() });

    act(() => {
      result.current.search('adjame');
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    vi.useRealTimers();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.results).toEqual([]);
  });
});

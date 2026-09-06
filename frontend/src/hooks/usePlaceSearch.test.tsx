// Tests du hook usePlaceSearch : debounce, filtrage des lieux déjà appariés
// à un arrêt connu (matchedStopId), longueur minimale. Fetch mocké, comme
// les autres hooks de ce projet — aucun appel réseau réel.
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaceSearch } from '@/hooks/usePlaceSearch';
import { findFetchCall, setFetchHandler } from '@/test/utils';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('usePlaceSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("n'appelle pas l'API en dessous de 2 caractères", () => {
    const { result } = renderHook(() => usePlaceSearch(), { wrapper: createWrapper() });
    act(() => {
      result.current.search('a');
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(findFetchCall('/places/search')).toBeUndefined();
  });

  it('filtre les lieux déjà appariés à un arrêt connu (matchedStopId non nul)', async () => {
    setFetchHandler(() => ({
      status: 200,
      body: {
        success: true,
        data: {
          places: [
            { name: 'Adjamé', lat: 5.35, lon: -4.02, category: 'suburb', matchedStopId: 'stop-1' },
            { name: 'Pharmacie Adjamé', lat: 5.34, lon: -4.021, category: 'pharmacy', matchedStopId: null },
          ],
          count: 2,
        },
      },
    }));
    const { result } = renderHook(() => usePlaceSearch(), { wrapper: createWrapper() });

    act(() => {
      result.current.search('Adjame');
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    vi.useRealTimers();
    await waitFor(() => expect(findFetchCall('/places/search')).toBeDefined());
    await waitFor(() => expect(result.current.results).toHaveLength(1));
    expect(result.current.results[0].name).toBe('Pharmacie Adjamé');
  });

  it('une erreur réseau expose isError sans planter', async () => {
    const { fetchMock } = await import('@/test/utils');
    fetchMock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => usePlaceSearch(), { wrapper: createWrapper() });

    act(() => {
      result.current.search('Adjame');
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    vi.useRealTimers();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.results).toEqual([]);
  });
});

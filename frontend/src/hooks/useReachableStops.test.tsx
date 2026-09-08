// Tests du hook useReachableStops : désactivé sans point de départ, appelle
// bien GET /api/isochrone avec `from=lat,lon` + `maxMinutes` sinon, expose
// isError proprement. Fetch mocké, comme les autres hooks de ce projet.
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { useReachableStops } from '@/hooks/useReachableStops';
import { findFetchCall, setFetchHandler } from '@/test/utils';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const sampleData = {
  origin: { lat: 5.32, lon: -4.02 },
  maxMinutes: 30,
  walkRadius: 800,
  maxRides: 3,
  approximation: true,
  reachableStops: [
    { stopId: 's1', name: 'Arrêt 1 [TEST]', lat: 5.33, lon: -4.03, etaSeconds: 600, rides: 1, lastLine: null },
  ],
  stats: { stopsReachable: 1, segmentsExplored: 4, truncated: false },
  note: 'Approximation…',
};

describe('useReachableStops', () => {
  it("n'appelle pas l'API sans point de départ (point null)", () => {
    const { result } = renderHook(() => useReachableStops(null, 30), { wrapper: createWrapper() });
    expect(result.current.reachableStops).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(findFetchCall('/isochrone')).toBeUndefined();
  });

  it('appelle /isochrone avec from=lat,lon et maxMinutes', async () => {
    setFetchHandler(() => ({ status: 200, body: { success: true, data: sampleData } }));
    const { result } = renderHook(() => useReachableStops({ lat: 5.32, lon: -4.02 }, 30), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.reachableStops).toHaveLength(1));
    const call = findFetchCall('/isochrone');
    expect(call).toBeDefined();
    // URLSearchParams encode la virgule (%2C) — le backend la décode avant Zod.
    expect(decodeURIComponent(call!.url)).toContain('from=5.32,-4.02');
    expect(call!.url).toContain('maxMinutes=30');
    expect(result.current.data?.approximation).toBe(true);
    expect(result.current.data?.stats.stopsReachable).toBe(1);
  });

  it('une erreur réseau expose isError sans planter', async () => {
    const { fetchMock } = await import('@/test/utils');
    fetchMock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useReachableStops({ lat: 5.32, lon: -4.02 }, 15), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.reachableStops).toEqual([]);
  });
});

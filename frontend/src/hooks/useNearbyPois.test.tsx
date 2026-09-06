// Tests du hook useNearbyPois : désactivé sans point de référence, appelle
// bien /places/nearby avec les bonnes coordonnées sinon. Fetch mocké, comme
// les autres hooks de ce projet — aucun appel réseau réel.
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { useNearbyPois } from '@/hooks/useNearbyPois';
import { findFetchCall, setFetchHandler } from '@/test/utils';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useNearbyPois', () => {
  it("n'appelle pas l'API sans point de référence (point null)", () => {
    const { result } = renderHook(() => useNearbyPois(null), { wrapper: createWrapper() });
    expect(result.current.pois).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(findFetchCall('/places/nearby')).toBeUndefined();
  });

  it('appelle /places/nearby avec les coordonnées et le rayon fournis', async () => {
    setFetchHandler(() => ({
      status: 200,
      body: {
        success: true,
        data: {
          pois: [{ name: 'Pharmacie du Plateau [TEST]', lat: 5.32, lon: -4.02, category: 'pharmacy' }],
          count: 1,
        },
      },
    }));
    const { result } = renderHook(() => useNearbyPois({ lat: 5.32, lon: -4.02 }, 500), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.pois).toHaveLength(1));
    const call = findFetchCall('/places/nearby');
    expect(call).toBeDefined();
    expect(call!.url).toContain('lat=5.32');
    expect(call!.url).toContain('lon=-4.02');
    expect(call!.url).toContain('radius=500');
    expect(result.current.pois[0].name).toBe('Pharmacie du Plateau [TEST]');
  });

  it('une erreur réseau expose isError sans planter', async () => {
    const { fetchMock } = await import('@/test/utils');
    fetchMock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useNearbyPois({ lat: 5.32, lon: -4.02 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.pois).toEqual([]);
  });
});

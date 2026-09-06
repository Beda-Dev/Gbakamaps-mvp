// Tests du hook useNeighborhoods : désactivé par défaut (enabled=false),
// appelle /places/neighborhoods une fois activé. Fetch mocké.
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { useNeighborhoods } from '@/hooks/useNeighborhoods';
import { findFetchCall, setFetchHandler } from '@/test/utils';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useNeighborhoods', () => {
  it("n'appelle pas l'API quand enabled=false", () => {
    const { result } = renderHook(() => useNeighborhoods(false), { wrapper: createWrapper() });
    expect(result.current.neighborhoods).toEqual([]);
    expect(findFetchCall('/places/neighborhoods')).toBeUndefined();
  });

  it('appelle /places/neighborhoods une fois activé', async () => {
    setFetchHandler(() => ({
      status: 200,
      body: {
        success: true,
        data: { neighborhoods: [{ name: 'Cocody [TEST]', lat: 5.35, lon: -3.98 }], count: 1 },
      },
    }));
    const { result } = renderHook(() => useNeighborhoods(true), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.neighborhoods).toHaveLength(1));
    expect(findFetchCall('/places/neighborhoods')).toBeDefined();
    expect(result.current.neighborhoods[0].name).toBe('Cocody [TEST]');
  });
});

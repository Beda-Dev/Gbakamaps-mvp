// Tests du filtre par mode de transport (gbaka/woro-woro/taxi/moto-taxi)
// ajouté le 2026-09-09 — écart identifié où l'API le supportait déjà
// (stopModeEnum, backend) mais aucun hook frontend ne l'exposait.
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { useNearbyStops } from '@/hooks/useNearbyStops';
import { findFetchCall, setFetchHandler } from '@/test/utils';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useNearbyStops', () => {
  it('sans mode : aucun paramètre modes envoyé (comportement inchangé)', async () => {
    setFetchHandler(() => ({
      status: 200,
      body: { success: true, data: { stops: [], count: 0, radius: 1000 } },
    }));
    const { result } = renderHook(() => useNearbyStops(5.3, -4.0, 1000), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const call = findFetchCall('/stops/nearby');
    expect(call).toBeDefined();
    expect(call!.url).not.toContain('modes=');
  });

  it('avec des modes : envoie modes=<liste triée, séparée par des virgules>', async () => {
    setFetchHandler(() => ({
      status: 200,
      body: { success: true, data: { stops: [], count: 0, radius: 1000 } },
    }));
    const { result } = renderHook(() => useNearbyStops(5.3, -4.0, 1000, ['taxi', 'gbaka']), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const call = findFetchCall('/stops/nearby');
    expect(call).toBeDefined();
    // Trié alphabétiquement (gbaka avant taxi) — la queryKey doit être stable
    // quel que soit l'ordre de sélection des chips par l'utilisateur.
    expect(call!.url).toContain('modes=gbaka,taxi');
  });
});

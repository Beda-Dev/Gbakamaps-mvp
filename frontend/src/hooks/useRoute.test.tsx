// Tests du hook useRoute : URL/paramètres envoyés, traduction des 3 statuts
// d'erreur (400/422/503) en messages distincts, reset, helpers de formatage.
// Fetch mocké via les utilitaires partagés — aucun appel réseau réel.
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  formatRouteDistance,
  formatRouteDuration,
  useRoute,
  type ComputeRouteInput,
} from '@/hooks/useRoute';
import { findFetchCall, setFetchHandler } from '@/test/utils';

const INPUT: ComputeRouteInput = {
  from: { lat: 5.32, lon: -4.02 },
  to: { lat: 5.35, lon: -4.0 },
  profile: 'driving-car',
};

const SUCCESS_BODY = {
  success: true,
  data: {
    routes: [
      {
        distanceMeters: 6100,
        durationSeconds: 600,
        geometry: {
          type: 'LineString',
          coordinates: [
            [-4.02, 5.32],
            [-4.0, 5.35],
          ],
        },
      },
    ],
  },
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useRoute', () => {
  it('envoie la bonne URL (from/to "lat,lon", profil) et résout le 1er itinéraire', async () => {
    setFetchHandler(() => ({ status: 200, body: SUCCESS_BODY }));
    const { result } = renderHook(() => useRoute(), { wrapper: createWrapper() });

    let data;
    await act(async () => {
      data = await result.current.compute(INPUT);
    });

    const call = findFetchCall('/route');
    expect(call).toBeDefined();
    expect(call!.url).toBe(
      'http://localhost:4000/api/route?from=5.32%2C-4.02&to=5.35%2C-4&profile=driving-car&alternatives=false'
    );
    expect(call!.init?.credentials).toBe('include');
    expect(data).toEqual(SUCCESS_BODY.data.routes[0]);
    // L'état observé se met à jour après la résolution de mutateAsync.
    await waitFor(() => expect(result.current.data).toEqual(SUCCESS_BODY.data.routes[0]));
    expect(result.current.error).toBeNull();
  });

  it('400 (validation) → message zone de service, pas le "Validation failed" brut', async () => {
    setFetchHandler(() => ({
      status: 400,
      body: { success: false, error: 'Validation failed', code: 'VALIDATION_ERROR' },
    }));
    const { result } = renderHook(() => useRoute(), { wrapper: createWrapper() });

    await act(async () => {
      await expect(result.current.compute(INPUT)).rejects.toThrow();
    });

    await waitFor(() =>
      expect(result.current.error).toBe(
        'Coordonnées invalides ou hors de la zone de service (Côte d’Ivoire).'
      )
    );
  });

  it('422 NO_ROUTE → message métier clair, pas technique', async () => {
    setFetchHandler(() => ({
      status: 422,
      body: {
        success: false,
        error: 'Aucun itinéraire trouvé entre ces points',
        code: 'NO_ROUTE',
      },
    }));
    const { result } = renderHook(() => useRoute(), { wrapper: createWrapper() });

    await act(async () => {
      await expect(result.current.compute(INPUT)).rejects.toThrow();
    });

    await waitFor(() =>
      expect(result.current.error).toBe('Aucun itinéraire trouvé entre ces points.')
    );
  });

  it('503 → message service indisponible', async () => {
    setFetchHandler(() => ({
      status: 503,
      body: {
        success: false,
        error: "Service de calcul d'itinéraire indisponible",
        code: 'ROUTING_SERVICE_ERROR',
      },
    }));
    const { result } = renderHook(() => useRoute(), { wrapper: createWrapper() });

    await act(async () => {
      await expect(result.current.compute(INPUT)).rejects.toThrow();
    });

    await waitFor(() =>
      expect(result.current.error).toBe(
        "Service de calcul d'itinéraire indisponible, réessayez plus tard."
      )
    );
  });

  it('reset() efface erreur et résultat', async () => {
    setFetchHandler(() => ({
      status: 422,
      body: { success: false, error: 'Aucun itinéraire trouvé', code: 'NO_ROUTE' },
    }));
    const { result } = renderHook(() => useRoute(), { wrapper: createWrapper() });

    await act(async () => {
      await expect(result.current.compute(INPUT)).rejects.toThrow();
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    act(() => {
      result.current.reset();
    });
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.data).toBeUndefined();
  });
});

describe('formatRouteDistance / formatRouteDuration', () => {
  it('formate les distances (m puis km à la française)', () => {
    expect(formatRouteDistance(850)).toBe('850 m');
    expect(formatRouteDistance(6100)).toBe('6,1 km');
  });

  it('formate les durées (min puis heures)', () => {
    expect(formatRouteDuration(600)).toBe('10 min');
    expect(formatRouteDuration(4320)).toBe('1h 12min');
    expect(formatRouteDuration(3600)).toBe('1h');
  });
});

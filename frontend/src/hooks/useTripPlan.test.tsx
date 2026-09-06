// Tests du hook useTripPlan : URL construite (from/to/optimize/maxTransfers/
// walkRadius), traduction des erreurs, formatage. Fetch mocké, comme les
// autres hooks de ce projet — aucun appel réseau réel.
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  formatTripCost,
  formatTripDistance,
  formatTripDuration,
  tripPlanErrorMessage,
  useTripPlan,
} from '@/hooks/useTripPlan';
import { ApiError } from '@/lib/api/client';
import { findFetchCall, setFetchHandler } from '@/test/utils';

const PLAN_BODY = {
  success: true,
  data: {
    plans: [
      {
        totalDistanceMeters: 1000,
        totalDurationSeconds: 600,
        walkingDurationSeconds: 200,
        transfersCount: 0,
        totalCostFCFA: 200,
        costVerified: false,
        steps: [],
      },
    ],
    criterion: 'fastest',
    walkRadius: 800,
    note: 'note de test',
  },
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useTripPlan', () => {
  it('construit l’URL avec from/to/optimize/maxTransfers/walkRadius', async () => {
    setFetchHandler(() => ({ status: 200, body: PLAN_BODY }));
    const { result } = renderHook(() => useTripPlan(), { wrapper: createWrapper() });

    let data;
    await act(async () => {
      data = await result.current.plan({
        from: { lat: 5.32, lon: -4.02 },
        to: { lat: 5.34, lon: -3.99 },
        walkRadius: 1000,
        optimize: 'cheapest',
        maxTransfers: 1,
      });
    });

    const call = findFetchCall('/trip-plan');
    expect(call).toBeDefined();
    expect(call!.url).toContain('from=5.32%2C-4.02');
    expect(call!.url).toContain('to=5.34%2C-3.99');
    expect(call!.url).toContain('optimize=cheapest');
    expect(call!.url).toContain('maxTransfers=1');
    expect(call!.url).toContain('walkRadius=1000');
    expect(data).toEqual(PLAN_BODY.data);
  });

  it('maxTransfers par défaut = 1, optimize par défaut = fastest', async () => {
    setFetchHandler(() => ({ status: 200, body: PLAN_BODY }));
    const { result } = renderHook(() => useTripPlan(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.plan({ from: { lat: 5.32, lon: -4.02 }, to: { lat: 5.34, lon: -3.99 } });
    });

    const call = findFetchCall('/trip-plan');
    expect(call!.url).toContain('optimize=fastest');
    expect(call!.url).toContain('maxTransfers=1');
    expect(call!.url).not.toContain('walkRadius');
  });

  it('traduction des erreurs : 400 -> message zone de service, autre -> message générique, réseau -> message injoignable', () => {
    expect(tripPlanErrorMessage(new ApiError('Validation failed', 400))).toBe(
      'Coordonnées invalides ou hors de la zone de service (Côte d’Ivoire).'
    );
    expect(tripPlanErrorMessage(new ApiError('boom', 503))).toBe('Une erreur est survenue (503). Réessayez.');
    expect(tripPlanErrorMessage(new Error('network down'))).toBe(
      'Serveur injoignable. Vérifiez votre connexion puis réessayez.'
    );
  });

  it('error est null tant qu’aucune erreur ne s’est produite, rempli après un échec', async () => {
    setFetchHandler(() => ({ status: 400, body: { success: false, error: 'Validation failed' } }));
    const { result } = renderHook(() => useTripPlan(), { wrapper: createWrapper() });
    expect(result.current.error).toBeNull();

    await act(async () => {
      await expect(
        result.current.plan({ from: { lat: 5.32, lon: -4.02 }, to: { lat: 5.34, lon: -3.99 } })
      ).rejects.toThrow();
    });
    expect(result.current.error).toBe('Coordonnées invalides ou hors de la zone de service (Côte d’Ivoire).');
  });

  it('formatTripDistance / formatTripDuration suivent les conventions françaises existantes', () => {
    expect(formatTripDistance(500)).toBe('500 m');
    expect(formatTripDistance(1500)).toBe('1,5 km');
    expect(formatTripDuration(45 * 60)).toBe('45 min');
    expect(formatTripDuration(90 * 60)).toBe('1h 30min');
    expect(formatTripDuration(120 * 60)).toBe('2h');
  });

  it('formatTripCost distingue coût inconnu, estimé et vérifié', () => {
    expect(formatTripCost({ totalCostFCFA: null, costVerified: false })).toBe('Coût inconnu');
    expect(formatTripCost({ totalCostFCFA: 500, costVerified: false })).toBe('500 FCFA (estimé)');
    expect(formatTripCost({ totalCostFCFA: 500, costVerified: true })).toBe('500 FCFA');
  });
});

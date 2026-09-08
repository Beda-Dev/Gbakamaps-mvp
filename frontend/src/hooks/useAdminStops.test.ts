// Tests des mutations CRUD admin des arrêts : bonnes méthode/URL/body pour
// create/update/delete/impact. Fetch mocké — aucun appel réseau réel (le
// rôle ADMIN lui-même est vérifié côté backend, ces hooks n'ont pas de
// garde de rôle propre — voir AdminStopsPage pour ce garde-fou).
import { createElement, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  useCreateStop,
  useDeleteStop,
  useStopDeletionImpact,
  useUpdateStop,
} from '@/hooks/useAdminStops';
import { fetchMock, findFetchCall, setFetchHandler } from '@/test/utils';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useCreateStop', () => {
  it('POST /admin/stops avec le body fourni', async () => {
    setFetchHandler(() => ({
      status: 201,
      body: { success: true, data: { id: 's1', name: 'Nouvel arrêt [TEST]', lat: 5.3, lon: -4.0 } },
    }));
    const { result } = renderHook(() => useCreateStop(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ name: 'Nouvel arrêt [TEST]', lat: 5.3, lon: -4.0 });
    });

    const call = findFetchCall('/admin/stops');
    expect(call).toBeDefined();
    expect(call!.init?.method).toBe('POST');
    expect(JSON.parse(call!.init!.body as string)).toEqual({
      name: 'Nouvel arrêt [TEST]',
      lat: 5.3,
      lon: -4.0,
    });
  });
});

describe('useUpdateStop', () => {
  it('PATCH /admin/stops/:id — utilisé aussi pour un déplacement (lat/lon seuls)', async () => {
    setFetchHandler(() => ({
      status: 200,
      body: { success: true, data: { id: 's1', lat: 5.35, lon: -4.05 } },
    }));
    const { result } = renderHook(() => useUpdateStop(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ id: 's1', input: { lat: 5.35, lon: -4.05 } });
    });

    const call = findFetchCall('/admin/stops/s1');
    expect(call).toBeDefined();
    expect(call!.init?.method).toBe('PATCH');
    expect(JSON.parse(call!.init!.body as string)).toEqual({ lat: 5.35, lon: -4.05 });
  });
});

describe('useStopDeletionImpact', () => {
  it("GET /admin/stops/:id/impact renvoie le décompte réel avant suppression", async () => {
    setFetchHandler(() => ({
      status: 200,
      body: {
        success: true,
        data: { id: 's1', name: 'Arrêt [TEST]', favoritesDeleted: 2, stopLinesDeleted: 1, reportsDetached: 3 },
      },
    }));
    const { result } = renderHook(() => useStopDeletionImpact(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync('s1');
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({
      id: 's1',
      name: 'Arrêt [TEST]',
      favoritesDeleted: 2,
      stopLinesDeleted: 1,
      reportsDetached: 3,
    });
  });
});

describe('useDeleteStop', () => {
  it('DELETE /admin/stops/:id', async () => {
    setFetchHandler(() => ({
      status: 200,
      body: { success: true, data: { id: 's1', name: null, favoritesDeleted: 0, stopLinesDeleted: 0, reportsDetached: 0 } },
    }));
    const { result } = renderHook(() => useDeleteStop(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync('s1');
    });

    const call = findFetchCall('/admin/stops/s1');
    expect(call).toBeDefined();
    expect(call!.init?.method).toBe('DELETE');
  });

  it('une erreur réseau rejette la promesse sans planter', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useDeleteStop(), { wrapper: createWrapper() });

    await expect(act(async () => result.current.mutateAsync('s1'))).rejects.toThrow();
  });
});

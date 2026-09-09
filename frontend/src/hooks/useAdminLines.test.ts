// Tests des mutations/requêtes CRUD admin des lignes : bonnes méthode/URL/
// body pour list/create/update/delete/impact. Fetch mocké — aucun appel
// réseau réel (le rôle ADMIN lui-même est vérifié côté backend, ces hooks
// n'ont pas de garde de rôle propre — voir AdminLinesPage pour ce garde-fou).
import { createElement, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  useAdminLines,
  useCreateLine,
  useDeleteLine,
  useLineDeletionImpact,
  useUpdateLine,
} from '@/hooks/useAdminLines';
import { fetchMock, findFetchCall, setFetchHandler } from '@/test/utils';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useAdminLines', () => {
  it('GET /admin/lines sans recherche', async () => {
    setFetchHandler(() => ({
      status: 200,
      body: { success: true, data: { lines: [], count: 0 } },
    }));
    const { result } = renderHook(() => useAdminLines(''), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const call = findFetchCall('/admin/lines');
    expect(call).toBeDefined();
  });

  it('GET /admin/lines?q=... inclut la recherche encodée', async () => {
    setFetchHandler(() => ({
      status: 200,
      body: { success: true, data: { lines: [], count: 0 } },
    }));
    const { result } = renderHook(() => useAdminLines('Gare Sud'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const call = findFetchCall('/admin/lines?q=Gare%20Sud');
    expect(call).toBeDefined();
  });
});

describe('useCreateLine', () => {
  it('POST /admin/lines avec le body fourni', async () => {
    setFetchHandler(() => ({
      status: 201,
      body: {
        success: true,
        data: { id: 'l1', name: 'Nouvelle ligne [TEST]', transportType: 'BUS', active: true },
      },
    }));
    const { result } = renderHook(() => useCreateLine(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ name: 'Nouvelle ligne [TEST]', transportType: 'BUS' });
    });

    const call = findFetchCall('/admin/lines');
    expect(call).toBeDefined();
    expect(call!.init?.method).toBe('POST');
    expect(JSON.parse(call!.init!.body as string)).toEqual({
      name: 'Nouvelle ligne [TEST]',
      transportType: 'BUS',
    });
  });
});

describe('useUpdateLine', () => {
  it("PATCH /admin/lines/:id — utilisé aussi pour désactiver (active: false seul)", async () => {
    setFetchHandler(() => ({
      status: 200,
      body: { success: true, data: { id: 'l1', active: false } },
    }));
    const { result } = renderHook(() => useUpdateLine(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ id: 'l1', input: { active: false } });
    });

    const call = findFetchCall('/admin/lines/l1');
    expect(call).toBeDefined();
    expect(call!.init?.method).toBe('PATCH');
    expect(JSON.parse(call!.init!.body as string)).toEqual({ active: false });
  });
});

describe('useLineDeletionImpact', () => {
  it('GET /admin/lines/:id/impact renvoie le décompte réel avant suppression', async () => {
    setFetchHandler(() => ({
      status: 200,
      body: { success: true, data: { id: 'l1', name: 'Ligne [TEST]', stopLinesDeleted: 12 } },
    }));
    const { result } = renderHook(() => useLineDeletionImpact(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync('l1');
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({ id: 'l1', name: 'Ligne [TEST]', stopLinesDeleted: 12 });
  });
});

describe('useDeleteLine', () => {
  it('DELETE /admin/lines/:id', async () => {
    setFetchHandler(() => ({
      status: 200,
      body: { success: true, data: { id: 'l1', name: 'Ligne [TEST]', stopLinesDeleted: 0 } },
    }));
    const { result } = renderHook(() => useDeleteLine(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync('l1');
    });

    const call = findFetchCall('/admin/lines/l1');
    expect(call).toBeDefined();
    expect(call!.init?.method).toBe('DELETE');
  });

  it('une erreur réseau rejette la promesse sans planter', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useDeleteLine(), { wrapper: createWrapper() });

    await expect(act(async () => result.current.mutateAsync('l1'))).rejects.toThrow();
  });
});

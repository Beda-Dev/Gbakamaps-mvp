// Tests du hook useReports : bonne URL/méthode/body pour createReport,
// 401 → liste vide sur la query, traduction des erreurs (400/401/404).
// Fetch mocké via les utilitaires partagés — aucun appel réseau réel.
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  reportErrorMessage,
  useReports,
  type CreateReportInput,
} from '@/hooks/useReports';
import { ApiError } from '@/lib/api/client';
import { fetchMock, findFetchCall, setFetchHandler } from '@/test/utils';

const INPUT: CreateReportInput = {
  reportType: 'INCORRECT_INFO',
  title: 'Nom arrêt incorrect',
  description: 'Le nom affiché ne correspond pas.',
  stopId: '11111111-1111-4111-8111-111111111111',
};

const CREATED_REPORT = {
  id: 'r1',
  reportType: 'INCORRECT_INFO',
  title: 'Nom arrêt incorrect',
  description: 'Le nom affiché ne correspond pas.',
  stopId: '11111111-1111-4111-8111-111111111111',
  status: 'PENDING',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const MINE_BODY = {
  success: true,
  data: { reports: [CREATED_REPORT], count: 1 },
};

function json(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const LOGGED_IN_USER = {
  id: 'u1',
  email: 'aicha@example.com',
  displayName: 'Aïcha',
  role: 'USER',
};

// Le mock par défaut de `@/test/utils` répond toujours 401 sur /auth/me
// ("pas connecté", sans passer par le handler) — pour les tests de query
// "connecté", on surcharge `fetchMock` directement (comme FavoritesPage).
function mockLoggedInFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/auth/me')) return json(200, { success: true, data: LOGGED_IN_USER });
    return handler(url, init);
  });
}

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

describe('useReports', () => {
  it('createReport envoie POST /api/reports avec le bon body', async () => {
    setFetchHandler(() => ({
      status: 201,
      body: { success: true, data: CREATED_REPORT },
    }));
    const { result } = renderHook(() => useReports(), { wrapper: createWrapper() });

    let data;
    await act(async () => {
      data = await result.current.createReport(INPUT);
    });

    const call = findFetchCall('/reports');
    expect(call).toBeDefined();
    expect(call!.url).toBe('http://localhost:4000/api/reports');
    expect(call!.init?.method).toBe('POST');
    expect(call!.init?.credentials).toBe('include');
    expect(JSON.parse(String(call!.init?.body))).toEqual(INPUT);
    expect(data).toEqual(CREATED_REPORT);
  });

  it('query "mine" : 401 → liste vide (pas une erreur)', async () => {
    mockLoggedInFetch((url) => {
      if (url.includes('/reports/mine')) {
        return json(401, { success: false, error: 'Non authentifié' });
      }
      return json(404, { success: false, error: 'Non mocké' });
    });
    const { result } = renderHook(() => useReports(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.reports).toEqual([]);
    expect(result.current.count).toBe(0);
    expect(result.current.isError).toBe(false);
  });

  it('query "mine" : 200 → rapports exposés', async () => {
    mockLoggedInFetch(() => json(200, MINE_BODY));
    const { result } = renderHook(() => useReports(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.reports).toHaveLength(1));
    expect(result.current.count).toBe(1);
    expect(result.current.reports[0].title).toBe('Nom arrêt incorrect');
  });

  it('traduction des erreurs : 400 → message backend, 401, 404, réseau', () => {
    expect(reportErrorMessage(new ApiError('title trop court', 400))).toBe(
      'title trop court'
    );
    expect(reportErrorMessage(new ApiError('Non authentifié', 401))).toBe(
      'Connectez-vous pour signaler un problème.'
    );
    expect(reportErrorMessage(new ApiError('Not found', 404))).toBe(
      "Cet arrêt n'existe plus."
    );
    expect(reportErrorMessage(new Error('boom'))).toBe(
      'Serveur injoignable. Vérifiez votre connexion puis réessayez.'
    );
  });

  it('createError expose le message traduit après un 404', async () => {
    setFetchHandler(() => ({
      status: 404,
      body: { success: false, error: 'Arrêt introuvable', code: 'NOT_FOUND' },
    }));
    const { result } = renderHook(() => useReports(), { wrapper: createWrapper() });

    await act(async () => {
      await expect(result.current.createReport(INPUT)).rejects.toThrow();
    });

    await waitFor(() =>
      expect(result.current.createError).toBe("Cet arrêt n'existe plus.")
    );
  });
});

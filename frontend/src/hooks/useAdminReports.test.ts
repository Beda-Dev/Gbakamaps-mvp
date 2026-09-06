// Tests du hook useAdminReports : bonne URL avec le filtre de statut,
// 403 → isForbidden: true (distinct d'un 401), mutation moderate avec
// bon body/méthode. Fetch mocké — aucun appel réseau réel.
// Note : fichier .ts (pas de JSX) — le wrapper QueryClient est construit
// avec React.createElement.
import { createElement, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { useAdminReports } from '@/hooks/useAdminReports';
import { fetchMock, findFetchCall, setFetchHandler } from '@/test/utils';

const ADMIN_USER = {
  id: 'admin-1',
  email: 'admin@example.com',
  displayName: 'Admin',
  role: 'ADMIN',
};

function json(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function adminReportFixture(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    reportType: 'INCORRECT_INFO',
    title: 'Nom arrêt incorrect',
    description: 'Détails',
    stopId: '11111111-1111-4111-8111-111111111111',
    status: 'PENDING',
    createdAt: '2026-03-01T10:00:00.000Z',
    userId: 'u1',
    user: { id: 'u1', email: 'aicha@example.com', displayName: 'Aïcha' },
    stop: { id: '11111111-1111-4111-8111-111111111111', name: 'Adjamé Gare' },
    ...overrides,
  };
}

// Session admin connectée + handler dédié pour /admin/reports.
function mockAdminFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/auth/me')) return json(200, { success: true, data: ADMIN_USER });
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
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useAdminReports', () => {
  it('query avec filtre : GET /api/admin/reports?status=PENDING&limit=20&offset=0', async () => {
    const reports = [adminReportFixture('r1')];
    mockAdminFetch((url) => {
      if (url.includes('/admin/reports')) {
        return json(200, { success: true, data: { reports, count: 1, total: 1 } });
      }
      return json(404, { success: false, error: 'Non mocké' });
    });
    const { result } = renderHook(() => useAdminReports('PENDING'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.reports).toHaveLength(1));
    expect(result.current.count).toBe(1);
    expect(result.current.total).toBe(1);
    expect(result.current.isForbidden).toBe(false);

    const call = findFetchCall('/admin/reports');
    expect(call).toBeDefined();
    expect(call!.url).toBe('http://localhost:4000/api/admin/reports?status=PENDING&limit=20&offset=0');
    expect(call!.init?.credentials).toBe('include');
  });

  it('query sans filtre : pas de param status dans l URL', async () => {
    mockAdminFetch((url) => {
      if (url.includes('/admin/reports')) {
        return json(200, { success: true, data: { reports: [], count: 0, total: 0 } });
      }
      return json(404, { success: false, error: 'Non mocké' });
    });
    const { result } = renderHook(() => useAdminReports(), { wrapper: createWrapper() });

    // Attend que l'appel soit réellement parti (isLoading est déjà false
    // tant que /auth/me n'a pas résolu et que la query reste désactivée).
    await waitFor(() => expect(findFetchCall('/admin/reports')).toBeDefined());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const call = findFetchCall('/admin/reports');
    expect(call).toBeDefined();
    expect(call!.url).toBe('http://localhost:4000/api/admin/reports?limit=20&offset=0');
  });

  it('403 → isForbidden: true (vraie erreur, pas un état vide)', async () => {
    mockAdminFetch((url) => {
      if (url.includes('/admin/reports')) {
        return json(403, { success: false, error: 'Accès réservé aux administrateurs' });
      }
      return json(404, { success: false, error: 'Non mocké' });
    });
    const { result } = renderHook(() => useAdminReports('PENDING'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isForbidden).toBe(true);
    expect(result.current.reports).toEqual([]);
  });

  it('401 → isForbidden: false (session expirée, pas un refus admin)', async () => {
    mockAdminFetch((url) => {
      if (url.includes('/admin/reports')) {
        return json(401, { success: false, error: 'Non authentifié' });
      }
      return json(404, { success: false, error: 'Non mocké' });
    });
    const { result } = renderHook(() => useAdminReports('PENDING'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isForbidden).toBe(false);
  });

  it('moderate envoie PATCH /api/admin/reports/:id avec le bon body', async () => {
    const updated = adminReportFixture('r1', { status: 'APPROVED' });
    // setFetchHandler ne touche pas à /auth/me : on surcharge fetchMock
    // directement pour simuler une session admin (comme useReports.test).
    setFetchHandler(() => ({ status: 200, body: { success: true, data: updated } }));
    fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/me')) return json(200, { success: true, data: ADMIN_USER });
      if (url.includes('/admin/reports') && init?.method === 'PATCH') {
        return json(200, { success: true, data: updated });
      }
      if (url.includes('/admin/reports')) {
        return json(200, { success: true, data: { reports: [], count: 0, total: 0 } });
      }
      return json(404, { success: false, error: 'Non mocké' });
    });
    const { result } = renderHook(() => useAdminReports('PENDING'), {
      wrapper: createWrapper(),
    });

    let data;
    await act(async () => {
      data = await result.current.moderate({ id: 'r1', status: 'APPROVED' });
    });

    const call = findFetchCall('/admin/reports/r1');
    expect(call).toBeDefined();
    expect(call!.url).toBe('http://localhost:4000/api/admin/reports/r1');
    expect(call!.init?.method).toBe('PATCH');
    expect(call!.init?.credentials).toBe('include');
    expect(JSON.parse(String(call!.init?.body))).toEqual({ status: 'APPROVED' });
    expect(data).toEqual(updated);
  });
});

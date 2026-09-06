// Helpers partagés des tests de pages : rendu avec les providers requis
// (QueryClient isolé par test + MemoryRouter) et mock de fetch routé par URL.
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, vi } from 'vitest';

export type FetchHandler = (url: string, init?: RequestInit) => {
  status: number;
  body: unknown;
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

export const fetchMock = vi.fn();

// Par défaut : /auth/me répond 401 (état normal "pas connecté"), le reste
// est routé vers le handler du test via `setFetchHandler`.
let handler: FetchHandler = () => ({
  status: 404,
  body: { success: false, error: 'Non mocké' },
});

export function setFetchHandler(h: FetchHandler) {
  handler = h;
}

export const ME_401 = { success: false, error: 'Non authentifié' };

beforeEach(() => {
  handler = () => ({ status: 404, body: { success: false, error: 'Non mocké' } });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    // 401 = pas connecté : réponse par défaut de /auth/me au montage.
    if (url.includes('/auth/me')) return jsonResponse(401, ME_401);
    const { status, body } = handler(url, init);
    return jsonResponse(status, body);
  });
  vi.stubGlobal('fetch', fetchMock);
});

export function renderPage(ui: ReactElement, initialPath = '/') {
  // QueryClient isolé par test : pas de fuite de cache entre les tests.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

// Retrouve l'appel fetch vers un endpoint donné (ignore /auth/me du montage).
export function findFetchCall(path: string): { url: string; init?: RequestInit } | undefined {
  for (const call of fetchMock.mock.calls) {
    const url = String(call[0] as unknown);
    if (url.includes(path)) return { url, init: call[1] as RequestInit | undefined };
  }
  return undefined;
}

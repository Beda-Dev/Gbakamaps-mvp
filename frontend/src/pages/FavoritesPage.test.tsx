// Tests de la page favoris : rendu avec providers isolés (QueryClient neuf +
// MemoryRouter avec routes) et fetch mocké. Note : le mock par défaut de
// `@/test/utils` répond toujours 401 sur /auth/me ("pas connecté") — les
// tests "connecté" redéfinissent donc l'implémentation de `fetchMock` pour
// simuler une session active.
import type { ReactElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { FavoritesPage } from '@/pages/FavoritesPage';
import { fetchMock, findFetchCall } from '@/test/utils';

const USER = {
  id: 'u1',
  email: 'aicha@example.com',
  displayName: 'Aïcha',
  role: 'USER',
};

function json(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function stopFixture(id: string, name: string, stopType = 'Gare') {
  return {
    id,
    name,
    lat: 5.32,
    lon: -4.02,
    stopType,
    verified: true,
    gbaka: true,
    woroworo: false,
    taxi: false,
    mototaxi: false,
    lines: [
      {
        id: 'line-1',
        name: 'Adjamé – Plateau',
        shortName: '12',
        color: '#0A9396',
        transportType: 'GBAKA',
        fare: 300,
      },
    ],
  };
}

function favoriteFixture(id: string, stop: ReturnType<typeof stopFixture>) {
  return {
    id,
    userId: USER.id,
    stopId: stop.id,
    createdAt: '2026-01-01T00:00:00.000Z',
    stop,
  };
}

// Simule une session connectée + une réponse donnée pour GET /api/favorites.
// DELETE /api/favorites/:stopId répond 200 par défaut.
function mockLoggedIn(favoritesBody: unknown) {
  fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/auth/me')) return json(200, { success: true, data: USER });
    if (url.includes('/favorites')) {
      if (init?.method === 'DELETE') return json(200, { success: true, data: null });
      return json(200, { success: true, data: favoritesBody });
    }
    return json(404, { success: false, error: 'Non mocké' });
  });
}

function renderFavorites(ui: ReactElement = <FavoritesPage />, initialPath = '/favorites') {
  // QueryClient isolé par test : pas de fuite de cache entre les tests.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/favorites" element={ui} />
          <Route path="/login" element={<div>Page de connexion</div>} />
          <Route path="/" element={<div>Carte</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('FavoritesPage', () => {
  it('utilisateur non connecté → redirection vers /login', async () => {
    // Mock par défaut : /auth/me répond 401 (pas connecté).
    renderFavorites();
    // Après redirection, c'est le contenu de /login qui s'affiche.
    expect(await screen.findByText('Page de connexion')).toBeInTheDocument();
  });

  it('liste de favoris affichée correctement (2 éléments)', async () => {
    // Le backend n'inclut pas `lines` dans le stop d'un favori : le 2e
    // élément reproduit fidèlement cette forme (pas de champ `lines`).
    const stop2 = stopFixture('22222222-2222-4222-8222-222222222222', 'Plateau Hôtel de Ville');
    const { lines: _omitted, ...stop2WithoutLines } = stop2;
    void _omitted;
    const favs = [
      favoriteFixture('fav-1', stopFixture('11111111-1111-4111-8111-111111111111', 'Adjamé Gare')),
      { ...favoriteFixture('fav-2', stop2), stop: stop2WithoutLines },
    ];
    mockLoggedIn({ favorites: favs, count: favs.length });
    renderFavorites();

    expect(await screen.findByText('Adjamé Gare')).toBeInTheDocument();
    expect(screen.getByText('Plateau Hôtel de Ville')).toBeInTheDocument();
    expect(screen.getByText(/2 arrêts en favori/)).toBeInTheDocument();
  });

  it('liste vide → message adapté + lien vers la carte', async () => {
    mockLoggedIn({ favorites: [], count: 0 });
    renderFavorites();

    expect(await screen.findByText(/Vous n'avez pas encore de favoris/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voir la carte' })).toHaveAttribute('href', '/');
  });

  it('clic sur "retirer" appelle DELETE /api/favorites/:stopId avec le bon stopId', async () => {
    const stopId = '33333333-3333-4333-8333-333333333333';
    const favs = [favoriteFixture('fav-3', stopFixture(stopId, 'Treichville Gare'))];
    mockLoggedIn({ favorites: favs, count: favs.length });
    renderFavorites();

    const removeBtn = await screen.findByRole('button', {
      name: 'Retirer Treichville Gare des favoris',
    });
    fireEvent.click(removeBtn);

    await waitFor(() => expect(findFetchCall(`/favorites/${stopId}`)).toBeDefined());
    const call = findFetchCall(`/favorites/${stopId}`)!;
    expect(call.url).toBe(`http://localhost:4000/api/favorites/${stopId}`);
    expect(call.init?.method).toBe('DELETE');
    expect(call.init?.credentials).toBe('include');
  });
});

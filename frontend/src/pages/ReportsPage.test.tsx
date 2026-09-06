// Tests de la page signalements : rendu avec providers isolés (QueryClient
// neuf + MemoryRouter avec routes) et fetch mocké. Le mock par défaut de
// `@/test/utils` répond toujours 401 sur /auth/me ("pas connecté") — les
// tests "connecté" redéfinissent l'implémentation de `fetchMock` pour
// simuler une session active.
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ReportsPage } from '@/pages/ReportsPage';
import { fetchMock } from '@/test/utils';

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

function reportFixture(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    reportType: 'INCORRECT_INFO',
    title: 'Nom arrêt incorrect',
    description: 'Détails',
    stopId: '11111111-1111-4111-8111-111111111111',
    status: 'PENDING',
    createdAt: '2026-03-01T10:00:00.000Z',
    ...overrides,
  };
}

// Simule une session connectée + une réponse donnée pour GET /api/reports/mine.
function mockLoggedIn(reportsBody: unknown) {
  fetchMock.mockImplementation(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/auth/me')) return json(200, { success: true, data: USER });
    if (url.includes('/reports/mine')) return json(200, { success: true, data: reportsBody });
    return json(404, { success: false, error: 'Non mocké' });
  });
}

function renderReports(ui: ReactElement = <ReportsPage />, initialPath = '/reports') {
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
          <Route path="/reports" element={ui} />
          <Route path="/login" element={<div>Page de connexion</div>} />
          <Route path="/" element={<div>Carte</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ReportsPage', () => {
  it('utilisateur non connecté → redirection vers /login', async () => {
    // Mock par défaut : /auth/me répond 401 (pas connecté).
    renderReports();
    // Après redirection, c'est le contenu de /login qui s'affiche.
    expect(await screen.findByText('Page de connexion')).toBeInTheDocument();
  });

  it('liste de signalements affichée (titre, type FR, statut, date)', async () => {
    const reports = [
      reportFixture('r1'),
      reportFixture('r2', {
        reportType: 'DAMAGE',
        title: 'Abribus cassé',
        status: 'APPROVED',
        createdAt: '2026-02-15T08:30:00.000Z',
      }),
    ];
    mockLoggedIn({ reports, count: reports.length });
    renderReports();

    expect(await screen.findByText('Nom arrêt incorrect')).toBeInTheDocument();
    expect(screen.getByText('Abribus cassé')).toBeInTheDocument();
    expect(screen.getByText(/2 signalements/)).toBeInTheDocument();
    // Libellés français du type + badge de statut.
    expect(screen.getByText(/Info incorrecte/)).toBeInTheDocument();
    expect(screen.getByText(/Dégradation/)).toBeInTheDocument();
    expect(screen.getByText('En attente')).toBeInTheDocument();
    expect(screen.getByText('Approuvé')).toBeInTheDocument();
  });

  it('liste vide → message adapté + lien vers la carte', async () => {
    mockLoggedIn({ reports: [], count: 0 });
    renderReports();

    expect(
      await screen.findByText(/Vous n'avez pas encore fait de signalement/)
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voir la carte' })).toHaveAttribute('href', '/');
  });
});

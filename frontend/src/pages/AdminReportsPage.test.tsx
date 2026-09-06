// Tests de la page de modération admin : redirection anonyme, message
// "accès réservé" pour un connecté non-admin, liste affichée pour un admin,
// boutons d'action absents sur un report déjà modéré.
// Rendu avec providers isolés (QueryClient neuf + MemoryRouter) et fetch mocké.
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AdminReportsPage } from '@/pages/AdminReportsPage';
import { fetchMock, findFetchCall } from '@/test/utils';

const USER = {
  id: 'u1',
  email: 'aicha@example.com',
  displayName: 'Aïcha',
  role: 'USER',
};

const ADMIN = {
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
    userId: USER.id,
    user: { id: USER.id, email: USER.email, displayName: USER.displayName },
    stop: { id: '11111111-1111-4111-8111-111111111111', name: 'Adjamé Gare' },
    ...overrides,
  };
}

// Simule une session (admin ou non) + une réponse pour GET /api/admin/reports.
function mockSession(me: typeof USER, reportsBody: unknown) {
  fetchMock.mockImplementation(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/auth/me')) return json(200, { success: true, data: me });
    if (url.includes('/admin/reports')) {
      return json(200, { success: true, data: reportsBody });
    }
    return json(404, { success: false, error: 'Non mocké' });
  });
}

function renderAdmin(ui: ReactElement = <AdminReportsPage />, initialPath = '/admin/reports') {
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
          <Route path="/admin/reports" element={ui} />
          <Route path="/login" element={<div>Page de connexion</div>} />
          <Route path="/" element={<div>Carte</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AdminReportsPage', () => {
  it('utilisateur non connecté → redirection vers /login', async () => {
    // Mock par défaut : /auth/me répond 401 (pas connecté).
    renderAdmin();
    expect(await screen.findByText('Page de connexion')).toBeInTheDocument();
  });

  it('connecté mais pas admin → message d accès réservé + lien carte, sans appel API', async () => {
    mockSession(USER, { reports: [], count: 0, total: 0 });
    renderAdmin();

    expect(await screen.findByText(/Accès réservé aux administrateurs/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Retour à la carte/ })).toHaveAttribute('href', '/');
    // La query admin ne doit pas partir pour un non-admin.
    expect(findFetchCall('/admin/reports')).toBeUndefined();
  });

  it('admin : liste affichée (titre, type FR, auteur, arrêt, badge) + filtre En attente par défaut', async () => {
    const reports = [adminReportFixture('r1')];
    mockSession(ADMIN, { reports, count: 1, total: 1 });
    renderAdmin();

    expect(await screen.findByText('Nom arrêt incorrect')).toBeInTheDocument();
    expect(screen.getByText(/Info incorrecte/)).toBeInTheDocument();
    expect(screen.getByText(/Aïcha/)).toBeInTheDocument();
    expect(screen.getByText(/Adjamé Gare/)).toBeInTheDocument();
    // Le libellé "En attente" apparaît deux fois : onglet filtre + badge.
    expect(screen.getAllByText('En attente')).toHaveLength(2);
    // Onglets de filtre, "En attente" sélectionné par défaut.
    expect(screen.getByRole('button', { name: 'Tous' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'En attente' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    // Actions de modération proposées pour un PENDING.
    expect(screen.getByRole('button', { name: 'Approuver' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rejeter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Résoudre' })).toBeInTheDocument();
  });

  it('admin : aucun bouton d action sur un report déjà modéré', async () => {
    const reports = [
      adminReportFixture('r1'),
      adminReportFixture('r2', { title: 'Abribus cassé', status: 'APPROVED' }),
    ];
    mockSession(ADMIN, { reports, count: 2, total: 2 });
    renderAdmin();

    expect(await screen.findByText('Abribus cassé')).toBeInTheDocument();
    expect(screen.getByText('Approuvé')).toBeInTheDocument();
    // Un seul PENDING → un seul jeu de boutons d'action.
    expect(screen.getAllByRole('button', { name: 'Approuver' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Rejeter' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Résoudre' })).toHaveLength(1);
  });

  it('admin : liste vide → message adapté', async () => {
    mockSession(ADMIN, { reports: [], count: 0, total: 0 });
    renderAdmin();

    expect(await screen.findByText('Aucun signalement pour ce filtre.')).toBeInTheDocument();
  });
});

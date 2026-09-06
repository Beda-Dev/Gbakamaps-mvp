import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ADMIN_REPORTS_PAGE_SIZE, useAdminReports } from '@/hooks/useAdminReports';
import {
  REPORT_STATUS_LABELS,
  REPORT_TYPE_LABELS,
  type ReportStatus,
} from '@/hooks/useReports';
import { LoaderIcon } from '@/components/icons';

// Filtre d'onglet : 'ALL' (pas de param `status` côté API) ou un statut.
type StatusFilter = ReportStatus | 'ALL';

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'Tous' },
  { value: 'PENDING', label: 'En attente' },
  { value: 'APPROVED', label: 'Approuvés' },
  { value: 'REJECTED', label: 'Rejetés' },
  { value: 'RESOLVED', label: 'Résolus' },
];

export function AdminReportsPage() {
  const { user, isLoading: authLoading } = useAuth();
  // "En attente" par défaut : c'est la file de travail réelle d'un modérateur.
  const [filter, setFilter] = useState<StatusFilter>('PENDING');
  const [offset, setOffset] = useState(0);
  const [moderatingId, setModeratingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    reports,
    count,
    total,
    isLoading,
    isError,
    isForbidden,
    refetch,
    moderate,
    isModerating,
  } = useAdminReports(filter === 'ALL' ? undefined : filter, {
    limit: ADMIN_REPORTS_PAGE_SIZE,
    offset,
  });

  // Non connecté : retour vers la connexion (miroir de FavoritesPage).
  if (!authLoading && !user) {
    return <Navigate to="/login" replace />;
  }

  // Connecté mais pas admin : message explicite, PAS de redirection
  // silencieuse (l'utilisateur est connecté, /login serait trompeur).
  if (!authLoading && user && isForbidden) {
    return (
      <main className="reports">
        <div className="reports__card">
          <h1 className="reports__title">Modération</h1>
          <p className="reports__status reports__status--error" role="alert">
            Accès réservé aux administrateurs.
          </p>
          <Link className="reports__back" to="/">
            ← Retour à la carte
          </Link>
        </div>
      </main>
    );
  }

  function handleFilterChange(next: StatusFilter) {
    setFilter(next);
    setOffset(0);
    setActionError(null);
  }

  async function handleModerate(id: string, status: 'APPROVED' | 'REJECTED' | 'RESOLVED') {
    setModeratingId(id);
    setActionError(null);
    try {
      await moderate({ id, status });
    } catch {
      setActionError('Action impossible. Réessayez.');
    } finally {
      setModeratingId(null);
    }
  }

  const loading = authLoading || isLoading;
  // `count` = taille de la page, `total` = total pour ce filtre.
  const shown = offset + reports.length;

  return (
    <main className="reports">
      <div className="reports__card">
        <h1 className="reports__title">Modération des signalements</h1>
        <p className="reports__subtitle">
          {total === 0
            ? 'Aucun signalement pour ce filtre.'
            : `${shown} sur ${total} signalement${total > 1 ? 's' : ''}.`}
        </p>

        <div className="reports__filters" role="group" aria-label="Filtrer par statut">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`reports__filter${filter === f.value ? ' is-active' : ''}`}
              aria-pressed={filter === f.value}
              onClick={() => handleFilterChange(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading && (
          <p className="reports__status" role="status">
            <LoaderIcon className="icon-spin" width={16} height={16} aria-hidden="true" />
            Chargement des signalements…
          </p>
        )}

        {!loading && isError && (
          <p className="reports__status reports__status--error" role="alert">
            Erreur de chargement
            <button type="button" className="reports__retry" onClick={() => refetch()}>
              Réessayer
            </button>
          </p>
        )}

        {!loading && !isError && reports.length === 0 && (
          <p className="reports__empty">Aucun signalement pour ce filtre.</p>
        )}

        {!loading && !isError && reports.length > 0 && (
          <ul className="reports__list">
            {reports.map((report) => {
              const pending = isModerating && moderatingId === report.id;
              return (
                <li key={report.id} className="reports__item reports__item--admin">
                  <div className="reports__info">
                    <p className="reports__name">{report.title}</p>
                    <p className="reports__meta">
                      {REPORT_TYPE_LABELS[report.reportType]} •{' '}
                      {report.user.displayName ?? report.user.email}
                      {report.stop?.name ? ` • ${report.stop.name}` : ''} •{' '}
                      {new Date(report.createdAt).toLocaleDateString('fr-FR')}
                    </p>
                    <span
                      className={`reports__badge reports__badge--${report.status.toLowerCase()}`}
                    >
                      {REPORT_STATUS_LABELS[report.status]}
                    </span>
                    {report.status === 'PENDING' && (
                      <div className="reports__actions">
                        <button
                          type="button"
                          className="reports__action reports__action--approve"
                          onClick={() => handleModerate(report.id, 'APPROVED')}
                          disabled={pending}
                        >
                          {pending ? (
                            <LoaderIcon
                              className="icon-spin"
                              width={14}
                              height={14}
                              aria-hidden="true"
                            />
                          ) : (
                            'Approuver'
                          )}
                        </button>
                        <button
                          type="button"
                          className="reports__action reports__action--reject"
                          onClick={() => handleModerate(report.id, 'REJECTED')}
                          disabled={pending}
                        >
                          {pending ? (
                            <LoaderIcon
                              className="icon-spin"
                              width={14}
                              height={14}
                              aria-hidden="true"
                            />
                          ) : (
                            'Rejeter'
                          )}
                        </button>
                        <button
                          type="button"
                          className="reports__action reports__action--resolve"
                          onClick={() => handleModerate(report.id, 'RESOLVED')}
                          disabled={pending}
                        >
                          {pending ? (
                            <LoaderIcon
                              className="icon-spin"
                              width={14}
                              height={14}
                              aria-hidden="true"
                            />
                          ) : (
                            'Résoudre'
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {actionError && (
          <p className="reports__status reports__status--error" role="alert">
            {actionError}
          </p>
        )}

        {!loading && !isError && total > count && reports.length > 0 && (
          <div className="reports__pagination">
            <button
              type="button"
              className="reports__retry"
              onClick={() => setOffset((o) => Math.max(0, o - ADMIN_REPORTS_PAGE_SIZE))}
              disabled={offset === 0}
            >
              ← Précédent
            </button>
            <button
              type="button"
              className="reports__retry"
              onClick={() => setOffset((o) => o + ADMIN_REPORTS_PAGE_SIZE)}
              disabled={shown >= total}
            >
              Suivant →
            </button>
          </div>
        )}

        <Link className="reports__back" to="/">
          ← Retour à la carte
        </Link>
      </div>
    </main>
  );
}

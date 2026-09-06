import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { REPORT_STATUS_LABELS, REPORT_TYPE_LABELS, useReports } from '@/hooks/useReports';
import { LoaderIcon } from '@/components/icons';

export function ReportsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { reports, count, isLoading, isError, refetch } = useReports();

  // Non connecté : retour vers la connexion (miroir de FavoritesPage).
  if (!authLoading && !user) {
    return <Navigate to="/login" replace />;
  }

  const loading = authLoading || isLoading;

  return (
    <main className="reports">
      <div className="reports__card">
        <h1 className="reports__title">Mes signalements</h1>
        <p className="reports__subtitle">
          {count === 0
            ? 'Aucun signalement pour le moment.'
            : `${count} signalement${count > 1 ? 's' : ''}.`}
        </p>

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
          <p className="reports__empty">
            Vous n&apos;avez pas encore fait de signalement. <Link to="/">Voir la carte</Link>
          </p>
        )}

        {!loading && !isError && reports.length > 0 && (
          <ul className="reports__list">
            {reports.map((report) => (
              <li key={report.id} className="reports__item">
                <div className="reports__info">
                  <p className="reports__name">{report.title}</p>
                  <p className="reports__meta">
                    {REPORT_TYPE_LABELS[report.reportType]} •{' '}
                    {new Date(report.createdAt).toLocaleDateString('fr-FR')}
                  </p>
                </div>
                <span className={`reports__badge reports__badge--${report.status.toLowerCase()}`}>
                  {REPORT_STATUS_LABELS[report.status]}
                </span>
              </li>
            ))}
          </ul>
        )}

        <Link className="reports__back" to="/">
          ← Retour à la carte
        </Link>
      </div>
    </main>
  );
}

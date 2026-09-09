import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useFavorites } from '@/hooks/useFavorites';
import { LoaderIcon, StarIcon } from '@/components/icons';
import { STOP_TYPE_LABELS } from '@/components/StopsMap';

export function FavoritesPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { favorites, count, isLoading, isError, refetch, removeFavorite, isMutating } =
    useFavorites();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // Non connecté : retour vers la connexion (miroir de LoginPage/SignupPage
  // qui redirigent vers / quand déjà connecté).
  if (!authLoading && !user) {
    return <Navigate to="/login" replace />;
  }

  async function handleRemove(stopId: string) {
    setRemovingId(stopId);
    setRemoveError(null);
    try {
      await removeFavorite(stopId);
    } catch {
      setRemoveError('Impossible de retirer ce favori. Réessayez.');
    } finally {
      setRemovingId(null);
    }
  }

  const loading = authLoading || isLoading;

  return (
    <main className="favorites">
      <div className="favorites__card">
        <h1 className="favorites__title">Mes favoris</h1>
        <p className="favorites__subtitle">
          {count === 0 ? 'Aucun arrêt en favori pour le moment.' : `${count} arrêt${count > 1 ? 's' : ''} en favori.`}
        </p>

        {loading && (
          <p className="favorites__status" role="status">
            <LoaderIcon className="icon-spin" width={16} height={16} aria-hidden="true" />
            Chargement des favoris…
          </p>
        )}

        {!loading && isError && (
          <p className="favorites__status favorites__status--error" role="alert">
            Erreur de chargement
            <button
              type="button"
              className="favorites__retry"
              onClick={() => refetch()}
            >
              Réessayer
            </button>
          </p>
        )}

        {!loading && !isError && favorites.length === 0 && (
          <p className="favorites__empty">
            Vous n&apos;avez pas encore de favoris. <Link to="/">Voir la carte</Link>
          </p>
        )}

        {!loading && !isError && favorites.length > 0 && (
          <ul className="favorites__list">
            {favorites.map((fav) => {
              const stop = fav.stop;
              // Le backend n'inclut pas `lines` dans le stop d'un favori
              // (include: { stop: true } sans les lignes) : garde-fou.
              const lines = stop?.lines ?? [];
              const pending = isMutating && removingId === (stop?.id ?? fav.stopId);
              return (
                <li key={fav.id} className="favorites__item">
                  <div className="favorites__info">
                    <p className="favorites__name">{stop?.name ?? 'Arrêt sans nom'}</p>
                    {stop && (
                      <p className="favorites__meta">
                        {STOP_TYPE_LABELS[stop.stopType] ?? stop.stopType}
                      </p>
                    )}
                    {lines.length > 0 && (
                      <ul className="favorites__lines">
                        {lines.map((line) => (
                          <li key={line.id} style={{ borderColor: line.color ?? '#0A9396' }}>
                            {line.shortName ?? ''} {line.name}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <button
                    type="button"
                    className="favorites__remove"
                    onClick={() => handleRemove(stop?.id ?? fav.stopId)}
                    disabled={pending}
                    aria-label={`Retirer ${stop?.name ?? 'cet arrêt'} des favoris`}
                    title="Retirer des favoris"
                  >
                    {pending ? (
                      <LoaderIcon
                        className="icon-spin"
                        width={18}
                        height={18}
                        aria-hidden="true"
                      />
                    ) : (
                      <StarIcon width={18} height={18} aria-hidden="true" fill="currentColor" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {removeError && (
          <p className="favorites__status favorites__status--error" role="alert">
            {removeError}
          </p>
        )}

        <Link className="favorites__back" to="/">
          ← Retour à la carte
        </Link>
      </div>
    </main>
  );
}

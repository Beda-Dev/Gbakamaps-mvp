// Petit bandeau d'état de connexion, intégré en haut de HomePage sans
// toucher à sa mise en page (un coin discret, pas de redirection forcée :
// la carte reste utilisable sans compte).
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { LoaderIcon } from '@/components/icons';

export function AuthStatus() {
  const { user, isLoading, logout, isLogoutPending } = useAuth();

  if (isLoading) {
    return (
      <div className="auth-status" role="status">
        <LoaderIcon className="icon-spin" width={14} height={14} aria-hidden="true" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="auth-status">
        <Link className="auth-status__link" to="/login">
          Se connecter
        </Link>
      </div>
    );
  }

  return (
    <div className="auth-status">
      <Link className="auth-status__link" to="/favorites">
        Favoris
      </Link>
      <Link className="auth-status__link" to="/reports">
        Signalements
      </Link>
      {user.role === 'ADMIN' && (
        <Link className="auth-status__link" to="/admin/reports">
          Modération
        </Link>
      )}
      <span className="auth-status__name" title={user.email}>
        {user.displayName ?? user.email}
      </span>
      <button
        type="button"
        className="auth-status__logout"
        onClick={() => logout()}
        disabled={isLogoutPending}
      >
        {isLogoutPending ? (
          <LoaderIcon className="icon-spin" width={14} height={14} aria-hidden="true" />
        ) : (
          'Déconnexion'
        )}
      </button>
    </div>
  );
}

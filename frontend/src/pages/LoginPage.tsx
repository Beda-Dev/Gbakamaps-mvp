import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { isValidEmail, loginErrorMessage } from '@/lib/auth-messages';
import { EyeIcon, EyeOffIcon, LoaderIcon } from '@/components/icons';

export function LoginPage() {
  const { user, isLoading, login, isLoginPending, loginError } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  // Déjà connecté : pas besoin du formulaire, retour à la carte.
  if (!isLoading && user) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // Validation immédiate côté client ; le backend (Zod) tranche en dernier.
    if (!isValidEmail(email)) {
      setClientError('Entrez une adresse email valide.');
      return;
    }
    if (password.length === 0) {
      setClientError('Entrez votre mot de passe.');
      return;
    }
    setClientError(null);
    try {
      await login({ email: email.trim(), password });
      navigate('/');
    } catch {
      // L'erreur est exposée via `loginError` et affichée ci-dessous.
    }
  }

  const pending = isLoginPending;

  return (
    <main className="auth">
      <form className="auth__card" onSubmit={handleSubmit} noValidate>
        <h1 className="auth__title">Se connecter</h1>
        <p className="auth__subtitle">Retrouvez votre compte GbakaMap.</p>

        <label className="auth__label" htmlFor="login-email">
          Email
        </label>
        <input
          id="login-email"
          className="auth__input"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={clientError !== null}
          disabled={pending}
        />

        <label className="auth__label" htmlFor="login-password">
          Mot de passe
        </label>
        <div className="auth__password-wrap">
          <input
            id="login-password"
            className="auth__input auth__input--with-toggle"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending}
          />
          <button
            type="button"
            className="auth__toggle"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
            aria-pressed={showPassword}
          >
            {showPassword ? (
              <EyeOffIcon width={18} height={18} aria-hidden="true" />
            ) : (
              <EyeIcon width={18} height={18} aria-hidden="true" />
            )}
          </button>
        </div>

        {clientError && (
          <p className="auth__error" role="alert">
            {clientError}
          </p>
        )}
        {loginError && (
          <p className="auth__error" role="alert">
            {loginErrorMessage(loginError)}
          </p>
        )}

        <button type="submit" className="auth__submit" disabled={pending}>
          {pending && (
            <LoaderIcon className="icon-spin" width={16} height={16} aria-hidden="true" />
          )}
          {pending ? 'Connexion…' : 'Se connecter'}
        </button>

        <p className="auth__switch">
          Pas de compte ? <Link to="/signup">Créer un compte</Link>
        </p>
        <p className="auth__switch">
          <Link to="/">← Retour à la carte</Link>
        </p>
      </form>
    </main>
  );
}

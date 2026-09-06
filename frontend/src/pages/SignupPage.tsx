import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { isValidEmail, signupErrorMessage } from '@/lib/auth-messages';
import { EyeIcon, EyeOffIcon, LoaderIcon } from '@/components/icons';

export function SignupPage() {
  const { user, isLoading, signup, isSignupPending, signupError } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
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
    if (password.length < 8) {
      setClientError('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    const trimmedName = displayName.trim();
    if (trimmedName.length > 0 && trimmedName.length < 2) {
      setClientError('Le nom affiché doit contenir au moins 2 caractères.');
      return;
    }
    setClientError(null);
    try {
      await signup({
        email: email.trim(),
        password,
        ...(trimmedName.length > 0 ? { displayName: trimmedName } : {}),
      });
      navigate('/');
    } catch {
      // L'erreur est exposée via `signupError` et affichée ci-dessous.
    }
  }

  const pending = isSignupPending;

  return (
    <main className="auth">
      <form className="auth__card" onSubmit={handleSubmit} noValidate>
        <h1 className="auth__title">Créer un compte</h1>
        <p className="auth__subtitle">Rejoignez GbakaMap en quelques secondes.</p>

        <label className="auth__label" htmlFor="signup-email">
          Email
        </label>
        <input
          id="signup-email"
          className="auth__input"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={clientError !== null}
          disabled={pending}
        />

        <label className="auth__label" htmlFor="signup-displayName">
          Nom affiché <span className="auth__optional">(optionnel)</span>
        </label>
        <input
          id="signup-displayName"
          className="auth__input"
          type="text"
          autoComplete="nickname"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          disabled={pending}
        />

        <label className="auth__label" htmlFor="signup-password">
          Mot de passe <span className="auth__optional">(8 caractères minimum)</span>
        </label>
        <div className="auth__password-wrap">
          <input
            id="signup-password"
            className="auth__input auth__input--with-toggle"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
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
        {signupError && (
          <p className="auth__error" role="alert">
            {signupErrorMessage(signupError)}
          </p>
        )}

        <button type="submit" className="auth__submit" disabled={pending}>
          {pending && (
            <LoaderIcon className="icon-spin" width={16} height={16} aria-hidden="true" />
          )}
          {pending ? 'Création…' : 'Créer mon compte'}
        </button>

        <p className="auth__switch">
          Déjà un compte ? <Link to="/login">Se connecter</Link>
        </p>
        <p className="auth__switch">
          <Link to="/">← Retour à la carte</Link>
        </p>
      </form>
    </main>
  );
}

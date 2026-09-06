import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LoginPage } from '@/pages/LoginPage';
import { findFetchCall, renderPage, setFetchHandler } from '@/test/utils';

const USER = {
  id: 'u1',
  email: 'aicha@example.com',
  displayName: 'Aïcha',
  role: 'USER',
};

function fillLoginForm(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: password } });
}

describe('LoginPage', () => {
  it('affiche une erreur de validation sur email invalide, sans appeler l’API', async () => {
    renderPage(<LoginPage />, '/login');
    // Laisse /auth/me (401 → non connecté) se résoudre avant de soumettre.
    await screen.findByRole('button', { name: 'Se connecter' });

    fillLoginForm('pas-un-email', 'motdepasse123');
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Entrez une adresse email valide.'
    );
    expect(findFetchCall('/auth/login')).toBeUndefined();
  });

  it('un succès déclenche POST /api/auth/login avec credentials include', async () => {
    setFetchHandler(() => ({ status: 200, body: { success: true, data: USER } }));
    renderPage(<LoginPage />, '/login');
    await screen.findByRole('button', { name: 'Se connecter' });

    fillLoginForm('aicha@example.com', 'motdepasse123');
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));

    await waitFor(() => expect(findFetchCall('/auth/login')).toBeDefined());
    const call = findFetchCall('/auth/login')!;
    expect(call.url).toBe('http://localhost:4000/api/auth/login');
    expect(call.init?.method).toBe('POST');
    expect(call.init?.credentials).toBe('include');
    expect(JSON.parse(String(call.init?.body))).toEqual({
      email: 'aicha@example.com',
      password: 'motdepasse123',
    });
  });

  it('un 401 simulé affiche le message identifiants incorrects', async () => {
    setFetchHandler(() => ({
      status: 401,
      body: { success: false, error: 'Identifiants incorrects', code: 'INVALID_CREDENTIALS' },
    }));
    renderPage(<LoginPage />, '/login');
    await screen.findByRole('button', { name: 'Se connecter' });

    fillLoginForm('aicha@example.com', 'mauvais-mot-de-passe');
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Email ou mot de passe incorrect.'
    );
  });
});

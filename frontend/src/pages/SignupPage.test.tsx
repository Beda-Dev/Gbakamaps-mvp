import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SignupPage } from '@/pages/SignupPage';
import { findFetchCall, renderPage, setFetchHandler } from '@/test/utils';

const USER = {
  id: 'u2',
  email: 'yao@example.com',
  displayName: 'Yao',
  role: 'USER',
};

function fillSignupForm(email: string, password: string, displayName = '') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/Nom affiché/), { target: { value: displayName } });
  fireEvent.change(screen.getByLabelText(/Mot de passe/), { target: { value: password } });
}

describe('SignupPage', () => {
  it('affiche une erreur de validation sur email invalide, sans appeler l’API', async () => {
    renderPage(<SignupPage />, '/signup');
    // Laisse /auth/me (401 → non connecté) se résoudre avant de soumettre.
    await screen.findByRole('button', { name: 'Créer mon compte' });

    fillSignupForm('pas-un-email', 'motdepasse123');
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Entrez une adresse email valide.'
    );
    expect(findFetchCall('/auth/signup')).toBeUndefined();
  });

  it('un succès déclenche POST /api/auth/signup avec credentials include', async () => {
    setFetchHandler(() => ({ status: 201, body: { success: true, data: USER } }));
    renderPage(<SignupPage />, '/signup');
    await screen.findByRole('button', { name: 'Créer mon compte' });

    fillSignupForm('yao@example.com', 'motdepasse123', 'Yao');
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }));

    await waitFor(() => expect(findFetchCall('/auth/signup')).toBeDefined());
    const call = findFetchCall('/auth/signup')!;
    expect(call.url).toBe('http://localhost:4000/api/auth/signup');
    expect(call.init?.method).toBe('POST');
    expect(call.init?.credentials).toBe('include');
    expect(JSON.parse(String(call.init?.body))).toEqual({
      email: 'yao@example.com',
      password: 'motdepasse123',
      displayName: 'Yao',
    });
  });

  it('un 409 simulé affiche le message email déjà utilisé', async () => {
    setFetchHandler(() => ({
      status: 409,
      body: { success: false, error: 'Email déjà utilisé', code: 'EMAIL_TAKEN' },
    }));
    renderPage(<SignupPage />, '/signup');
    await screen.findByRole('button', { name: 'Créer mon compte' });

    fillSignupForm('yao@example.com', 'motdepasse123');
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cet email est déjà utilisé. Essayez de vous connecter.'
    );
  });
});

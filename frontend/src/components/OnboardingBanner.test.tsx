// Tests de la bannière d'onboarding minimal : visible à la première visite,
// fermeture mémorisée en localStorage (ne réapparaît plus), invisible si déjà
// vue. Le localStorage est forcément purgé entre chaque test (source d'état
// partagé), même si le composant lui-même s'y comporte correctement.
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ONBOARDING_STORAGE_KEY, OnboardingBanner } from '@/components/OnboardingBanner';

const KEY = ONBOARDING_STORAGE_KEY;

beforeEach(() => {
  window.localStorage.clear();
});

describe('OnboardingBanner', () => {
  it('visible à la première visite (rien en localStorage) et présente les 3 fonctions', () => {
    render(<OnboardingBanner />);

    expect(screen.getByText('Bienvenue sur GbakaMap')).toBeInTheDocument();
    // Les trois fonctionnalités principales sont présentées explicitement.
    expect(screen.getByText(/étoilez un arrêt/)).toBeInTheDocument();
    expect(screen.getByText(/calculez un trajet/)).toBeInTheDocument();
    expect(screen.getByText(/signalez un problème sur un arrêt/)).toBeInTheDocument();
    // Fermable (bouton de fermeture présent).
    expect(screen.getByRole('button', { name: 'Fermer la présentation' })).toBeInTheDocument();
  });

  it('la fermeture mémorise l’état "vu" en localStorage et masque la bannière', () => {
    render(<OnboardingBanner />);
    expect(screen.getByText('Bienvenue sur GbakaMap')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Fermer la présentation' }));

    expect(window.localStorage.getItem(KEY)).toBe('1');
    expect(screen.queryByText('Bienvenue sur GbakaMap')).not.toBeInTheDocument();
  });

  it('ne s’affiche pas si l’état "vu" est déjà en localStorage', () => {
    window.localStorage.setItem(KEY, '1');
    render(<OnboardingBanner />);

    expect(screen.queryByText('Bienvenue sur GbakaMap')).not.toBeInTheDocument();
  });
});
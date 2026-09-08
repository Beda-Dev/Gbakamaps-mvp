// Bannière d'onboarding minimal, affichée une seule fois (première visite),
// pour présenter en un coup d'œil les trois fonctionnalités principales du
// visiteur. Volontairement PAS un tutoriel à onglets multiples : un simple
// encart dismissible. L'état "déjà vu" est mémorisé en localStorage : une fois
// fermée, la bannière ne réapparaît plus jamais sur ce navigateur.
//
// Les trois fonctions présentées existent réellement dans l'app (aucune
// invention, cf. è§2 de PROJECT_MEMORY.md) : favori (étoile du panneau détail,
// page /favorites), itinéraire (tracé dessiné sur la carte / planificateur),
// signalement d'un problème sur un arrêt (drapeau du panneau détail).
import { useState } from 'react';
import { FlagIcon, RouteIcon, StarIcon, XIcon } from '@/components/icons';

// Clé localStorage namespaced (préfixe projet) — exportée pour les tests et
// pour garder une référence unique si l'UI s'enrichit plus tard.
export const ONBOARDING_STORAGE_KEY = 'gbakamap.onboarding.dismissed';

const FEATURES = [
  {
    icon: StarIcon,
    title: 'Favoris',
    text: "étoilez un arrêt pour le retrouver facilement plus tard.",
  },
  {
    icon: RouteIcon,
    title: 'Itinéraire',
    text: 'calculez un trajet, le tracé s’affiche sur la carte.',
  },
  {
    icon: FlagIcon,
    title: 'Suggestion',
    text: 'signalez un problème sur un arrêt pour améliorer la carte.',
  },
];

// Lecture initiale du localStorage, sans jamais casser le rendu : si le
// stockage est indisponible (navigation privée restrictive…), on considère la
// bannière comme déjà vue plutôt que de la réafficher à chaque visite.
function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1';
  } catch {
    return true;
  }
}

export function OnboardingBanner() {
  const [dismissed, setDismissed] = useState(readDismissed);

  if (dismissed) {
    return null;
  }

  function handleDismiss() {
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
    } catch {
      // Stockage indisponible : on masque quand même la bannière pour cette
      // visite (elle réapparaîtra au prochain chargement, comportement sûr).
    }
    setDismissed(true);
  }

  return (
    <section className="onboarding" role="region" aria-label="Découverte de GbakaMap">
      <div className="onboarding__intro">
        <p className="onboarding__title">Bienvenue sur GbakaMap</p>
        <p className="onboarding__text">
          Trouvez les bus, gbaka et woro-woro d’Abidjan autour de vous. L’essentiel en un coup d’œil :
        </p>
      </div>
      <ul className="onboarding__list">
        {FEATURES.map((feature) => {
          const Icon = feature.icon;
          return (
            <li key={feature.title} className="onboarding__item">
              <Icon width={18} height={18} aria-hidden="true" />
              <span>
                <strong>{feature.title}</strong> — {feature.text}
              </span>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className="onboarding__dismiss"
        onClick={handleDismiss}
        aria-label="Fermer la présentation"
        title="Fermer la présentation"
      >
        <XIcon width={16} height={16} aria-hidden="true" />
      </button>
    </section>
  );
}
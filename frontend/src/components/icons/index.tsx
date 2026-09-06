// =============================================================================
// Icônes SVG inlinées depuis Lucide (https://lucide.dev), licence ISC.
// Copyright (c) Lucide Contributors. Icônes dérivées de Feather Icons,
// Copyright (c) Cole Bemis, licence MIT. Voir LICENSES-ICONS.md.
//
// Choix : copier les 9 icônes nécessaires plutôt qu'ajouter la dépendance
// lucide-react (bundle déjà lourd avec MapLibre ~1,2 Mo — pas de librairie
// d'icônes complète pour 9 usages).
// =============================================================================
import type { SVGProps } from 'react';

const defaultProps: SVGProps<SVGSVGElement> = {
  xmlns: 'http://www.w3.org/2000/svg',
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function LocateFixedIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaultProps} {...props}>
      <line x1="2" x2="5" y1="12" y2="12" />
      <line x1="19" x2="22" y1="12" y2="12" />
      <line x1="12" x2="12" y1="2" y2="5" />
      <line x1="12" x2="12" y1="19" y2="22" />
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function XIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaultProps} {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function LoaderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaultProps} {...props}>
      <path d="M12 2v4" />
      <path d="m16.2 7.8 2.9-2.9" />
      <path d="M18 12h4" />
      <path d="m16.2 16.2 2.9 2.9" />
      <path d="M12 18v4" />
      <path d="m4.9 19.1 2.9-2.9" />
      <path d="M2 12h4" />
      <path d="m4.9 4.9 2.9 2.9" />
    </svg>
  );
}

// Icônes œil (afficher/masquer le mot de passe), copiées depuis
// https://lucide.dev/icons/eye et https://lucide.dev/icons/eye-off,
// même licence ISC que ci-dessus (voir LICENSES-ICONS.md).
export function EyeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaultProps} {...props}>
      <path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaultProps} {...props}>
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

// Icône étoile (favoris), copiée depuis https://lucide.dev/icons/star,
// même licence ISC (voir LICENSES-ICONS.md). Le remplissage "favori actif"
// se fait via la prop `fill` (ex. fill="currentColor"), pas une icône séparée.
export function StarIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaultProps} {...props}>
      <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
    </svg>
  );
}

// Icônes itinéraire (bouton "Itinéraire" + sélecteur de profil Voiture /
// Vélo / Marche), copiées depuis https://lucide.dev/icons/route,
// https://lucide.dev/icons/car, https://lucide.dev/icons/bike et
// https://lucide.dev/icons/footprints, même licence ISC (voir LICENSES-ICONS.md).
export function RouteIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaultProps} {...props}>
      <circle cx="6" cy="19" r="3" />
      <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
      <circle cx="18" cy="5" r="3" />
    </svg>
  );
}

export function CarIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaultProps} {...props}>
      <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
      <circle cx="7" cy="17" r="2" />
      <path d="M9 17h6" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  );
}

export function BikeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaultProps} {...props}>
      <circle cx="18.5" cy="17.5" r="3.5" />
      <circle cx="5.5" cy="17.5" r="3.5" />
      <circle cx="15" cy="5" r="1" />
      <path d="M12 17.5V14l-3-3 4-3 2 3h2" />
    </svg>
  );
}

export function FootprintsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaultProps} {...props}>
      <path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z" />
      <path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z" />
      <path d="M16 17h4" />
      <path d="M4 13h4" />
    </svg>
  );
}

// Icône signalement (bouton "Signaler"), copiée depuis
// https://lucide.dev/icons/flag, même licence ISC (voir LICENSES-ICONS.md).
export function FlagIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaultProps} {...props}>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" x2="4" y1="22" y2="15" />
    </svg>
  );
}

// Icône navigation (bouton "Suivre mon trajet" — repère du passager pendant
// son propre déplacement), copiée depuis https://lucide.dev/icons/navigation,
// même licence ISC (voir LICENSES-ICONS.md).
export function NavigationIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaultProps} {...props}>
      <polygon points="3 11 22 2 13 21 11 13 3 11" />
    </svg>
  );
}

// Icône recherche (barre de recherche d'arrêts, phase 2), copiée depuis
// https://lucide.dev/icons/search, même licence ISC (voir LICENSES-ICONS.md).
export function SearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaultProps} {...props}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

// Icône bus (étapes "en ligne" du planificateur de trajet, phase 2 — modes
// BUS et GBAKA, un gbaka étant physiquement un minibus), copiée depuis
// https://lucide.dev/icons/bus, même licence ISC (voir LICENSES-ICONS.md).
export function BusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaultProps} {...props}>
      <path d="M8 6v6" />
      <path d="M15 6v6" />
      <path d="M2 12h19.6" />
      <path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3" />
      <circle cx="7" cy="18" r="2" />
      <path d="M9 18h5" />
      <circle cx="16" cy="18" r="2" />
    </svg>
  );
}

// Icône taxi partagé (étape "en ligne" du planificateur — mode WORO_WORO),
// copiée depuis https://lucide.dev/icons/car-taxi-front, même licence ISC
// (voir LICENSES-ICONS.md).
export function CarTaxiFrontIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaultProps} {...props}>
      <path d="M10 2h4" />
      <path d="m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8" />
      <path d="M7 14h.01" />
      <path d="M17 14h.01" />
      <rect width="18" height="8" x="3" y="10" rx="2" />
      <path d="M5 18v2" />
      <path d="M19 18v2" />
    </svg>
  );
}

// Icône lieu générique (résultat de recherche "lieu", pas un arrêt connu —
// distinction visuelle demandée explicitement pour ne jamais présenter les
// deux comme la même chose), copiée depuis https://lucide.dev/icons/map-pin,
// même licence ISC (voir LICENSES-ICONS.md).
export function MapPinIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaultProps} {...props}>
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

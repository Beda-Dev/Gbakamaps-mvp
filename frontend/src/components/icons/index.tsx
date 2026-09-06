// =============================================================================
// Icônes SVG inlinées depuis Lucide (https://lucide.dev), licence ISC.
// Copyright (c) Lucide Contributors. Icônes dérivées de Feather Icons,
// Copyright (c) Cole Bemis, licence MIT. Voir LICENSES-ICONS.md.
//
// Choix : copier les 3 icônes nécessaires plutôt qu'ajouter la dépendance
// lucide-react (bundle déjà lourd avec MapLibre ~1,2 Mo — pas de librairie
// d'icônes complète pour 3 usages).
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

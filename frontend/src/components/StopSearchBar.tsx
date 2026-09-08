// =============================================================================
// Barre de recherche d'arrêts ("destination-first", façon Citymapper/Google
// Maps) — phase 2 (PROJECT_MEMORY.md §12) : jusqu'ici, la carte était le seul
// moyen de trouver un arrêt. Overlay flottant au-dessus de la carte (même
// pattern que le sélecteur de style / bouton recentrer déjà en position
// absolue dans StopsMap — ce sont des contrôles de carte indépendants, pas
// une zone qui chevauche le panneau détail : la leçon flex-wrap du panneau
// détail ne s'applique pas ici).
// =============================================================================
import { useEffect, useId, useRef, useState } from 'react';
import { useStopSearch } from '@/hooks/useStopSearch';
import { useCommuneSearch, type Commune } from '@/hooks/useCommunes';
import { LoaderIcon, MapPinIcon, SearchIcon, XIcon } from '@/components/icons';
import type { Stop } from '@/lib/api/types';

interface StopSearchBarProps {
  near?: { lat: number; lon: number } | null;
  onSelectStop: (stop: Stop) => void;
  // Recherche directe par commune (demande explicite) — optionnel : sans
  // ce callback, la barre garde son comportement d'origine (arrêts seuls).
  onSelectCommune?: (commune: Commune) => void;
}

export function StopSearchBar({ near, onSelectStop, onSelectCommune }: StopSearchBarProps) {
  const { text, search, clear, isPending, results, isError } = useStopSearch(near);
  const communeSearch = useCommuneSearch();
  const [isFocused, setIsFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  // Ferme le dropdown au clic en dehors (pattern standard, pas de librairie
  // supplémentaire nécessaire pour ça).
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsFocused(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleSelect(stop: Stop) {
    onSelectStop(stop);
    clear();
    communeSearch.clear();
    setIsFocused(false);
  }

  function handleSelectCommune(commune: Commune) {
    onSelectCommune?.(commune);
    clear();
    communeSearch.clear();
    setIsFocused(false);
  }

  function handleTextChange(value: string) {
    search(value);
    if (onSelectCommune) communeSearch.search(value);
  }

  const showDropdown = isFocused && text.trim().length >= 2;
  const communeResults = onSelectCommune ? communeSearch.results : [];

  return (
    <div className="stop-search" ref={containerRef}>
      <div className="stop-search__box">
        <SearchIcon width={18} height={18} aria-hidden="true" className="stop-search__icon" />
        <input
          type="search"
          // role="combobox" (pas "searchbox") : c'est le seul rôle ARIA qui
          // autorise aria-expanded/aria-controls sur un champ de saisie —
          // bug réel trouvé par un audit axe-core (aria-allowed-attr,
          // "searchbox" ne supporte pas aria-expanded), 2026-09-06.
          role="combobox"
          aria-haspopup="listbox"
          className="stop-search__input"
          placeholder="Chercher un arrêt, une ligne…"
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-autocomplete="list"
        />
        {isPending && (
          <LoaderIcon
            className="icon-spin stop-search__spinner"
            width={16}
            height={16}
            aria-hidden="true"
          />
        )}
        {text.length > 0 && !isPending && (
          <button
            type="button"
            className="stop-search__clear"
            onClick={() => { clear(); communeSearch.clear(); }}
            aria-label="Effacer la recherche"
          >
            <XIcon width={16} height={16} aria-hidden="true" />
          </button>
        )}
      </div>
      {showDropdown && (
        <ul className="stop-search__results" id={listboxId} role="listbox">
          {isError && (
            <li className="stop-search__message" role="alert">
              Recherche indisponible. Réessayez.
            </li>
          )}
          {!isError && isPending && results.length === 0 && communeResults.length === 0 && (
            <li className="stop-search__message" role="status">
              Recherche…
            </li>
          )}
          {!isError && !isPending && results.length === 0 && communeResults.length === 0 && (
            <li className="stop-search__message" role="status">
              Aucun résultat pour « {text.trim()} ».
            </li>
          )}
          {results.map((stop) => (
            <li key={stop.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="stop-search__result"
                onClick={() => handleSelect(stop)}
              >
                <span className="stop-search__result-name">{stop.name ?? 'Arrêt sans nom'}</span>
                {stop.lines.length > 0 && (
                  <span className="stop-search__result-lines">
                    {stop.lines
                      .slice(0, 3)
                      .map((l) => l.shortName ?? l.name)
                      .join(' · ')}
                  </span>
                )}
              </button>
            </li>
          ))}
          {/* Communes — visuellement distinctes des arrêts (icône lieu, pas
              de données de ligne) : sélectionner une commune cadre la carte
              sur son étendue réelle, ce n'est jamais un arrêt de transport. */}
          {communeResults.map((commune) => (
            <li key={commune.name} role="option" aria-selected={false}>
              <button
                type="button"
                className="stop-search__result stop-search__result--commune"
                onClick={() => handleSelectCommune(commune)}
              >
                <MapPinIcon width={14} height={14} aria-hidden="true" />
                <span className="stop-search__result-name">{commune.name}</span>
                <span className="stop-search__result-tag">commune</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

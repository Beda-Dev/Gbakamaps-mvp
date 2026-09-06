// =============================================================================
// Planifier un trajet — planificateur multi-modal (phase 2, §12.3) :
// origine → destination → comparaison de plusieurs itinéraires réels
// s'appuyant sur les lignes gbaka/woro-woro/bus, pas seulement un
// point-à-point piéton/voiture (déjà couvert par le panneau détail d'un
// arrêt, useRoute.ts).
//
// Chaque estimation affichée est explicitement étiquetée (temps basé sur
// les horaires GTFS 2021 ou une approximation, coût vérifié par un admin ou
// indicatif) — jamais présentée comme une donnée exacte garantie.
// =============================================================================
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStopSearch } from '@/hooks/useStopSearch';
import {
  formatTripCost,
  formatTripDistance,
  formatTripDuration,
  useTripPlan,
  type OptimizeCriterion,
  type TripCoordinates,
  type TripPlan,
} from '@/hooks/useTripPlan';
import {
  BusIcon,
  CarTaxiFrontIcon,
  FootprintsIcon,
  LoaderIcon,
  LocateFixedIcon,
  SearchIcon,
  XIcon,
} from '@/components/icons';
import type { Stop, TransportType } from '@/lib/api/types';

// Icône par mode réel de la ligne empruntée — TAXI/MOTO_TAXI n'apparaissent
// jamais comme type de ligne dans les données importées (ce sont des
// stations, pas des trajets fixes, cf. import-gtfs.ts), donc jamais dans un
// step "ride" ici ; BusIcon en repli reste cohérent visuellement si le cas
// se présentait quand même.
const MODE_ICONS: Record<TransportType, typeof BusIcon> = {
  BUS: BusIcon,
  GBAKA: BusIcon,
  WORO_WORO: CarTaxiFrontIcon,
  TAXI: CarTaxiFrontIcon,
  MOTO_TAXI: CarTaxiFrontIcon,
};

interface Place {
  label: string;
  coords: TripCoordinates;
}

const RADIUS_OPTIONS = [
  { value: 500, label: '500 m' },
  { value: 1000, label: '1 km' },
  { value: 2000, label: '2 km' },
  { value: 5000, label: '5 km' },
] as const;

const CRITERIA: { value: OptimizeCriterion; label: string }[] = [
  { value: 'fastest', label: 'Le plus rapide' },
  { value: 'cheapest', label: 'Le moins cher' },
  { value: 'least-walking', label: 'Moins de marche' },
];

// Champ de recherche d'un lieu (arrêt connu) — même moteur que la barre de
// recherche de la carte (useStopSearch), présenté en champ de formulaire
// plutôt qu'en overlay flottant (contexte différent : ce n'est pas la carte).
function PlaceField({
  id,
  label,
  value,
  onChange,
  near,
}: {
  id: string;
  label: string;
  value: Place | null;
  onChange: (place: Place | null) => void;
  near?: TripCoordinates | null;
}) {
  const { text, search, clear, isPending, results, isError } = useStopSearch(near);
  const [isFocused, setIsFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

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
    onChange({ label: stop.name ?? 'Arrêt sans nom', coords: { lat: stop.lat, lon: stop.lon } });
    clear();
    setIsFocused(false);
  }

  function handleClear() {
    onChange(null);
    clear();
  }

  const showDropdown = isFocused && !value && text.trim().length >= 2;

  return (
    <div className="trip-field" ref={containerRef}>
      <label className="trip-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="trip-field__box">
        <SearchIcon width={16} height={16} aria-hidden="true" className="trip-field__icon" />
        {value ? (
          <span className="trip-field__value">{value.label}</span>
        ) : (
          <input
            id={id}
            type="search"
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={showDropdown}
            aria-controls={listboxId}
            aria-autocomplete="list"
            className="trip-field__input"
            placeholder="Chercher un arrêt…"
            value={text}
            onChange={(e) => search(e.target.value)}
            onFocus={() => setIsFocused(true)}
          />
        )}
        {isPending && (
          <LoaderIcon className="icon-spin" width={14} height={14} aria-hidden="true" />
        )}
        {value && (
          <button type="button" className="trip-field__clear" onClick={handleClear} aria-label="Effacer">
            <XIcon width={14} height={14} aria-hidden="true" />
          </button>
        )}
      </div>
      {showDropdown && (
        <ul className="trip-field__results" id={listboxId} role="listbox">
          {isError && (
            <li className="trip-field__message" role="alert">
              Recherche indisponible. Réessayez.
            </li>
          )}
          {!isError && !isPending && results.length === 0 && (
            <li className="trip-field__message" role="status">
              Aucun arrêt ne correspond à « {text.trim()} ».
            </li>
          )}
          {results.map((stop) => (
            <li key={stop.id} role="option" aria-selected={false}>
              <button type="button" className="trip-field__result" onClick={() => handleSelect(stop)}>
                {stop.name ?? 'Arrêt sans nom'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TripPlanCard({ plan, rank }: { plan: TripPlan; rank: number }) {
  const [expanded, setExpanded] = useState(rank === 0);

  return (
    <li className={`trip-plan-card${rank === 0 ? ' is-recommended' : ''}`}>
      <button
        type="button"
        className="trip-plan-card__summary"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="trip-plan-card__headline">
          {rank === 0 && <span className="trip-plan-card__badge">Recommandé</span>}
          <span className="trip-plan-card__duration">{formatTripDuration(plan.totalDurationSeconds)}</span>
          <span className="trip-plan-card__distance">{formatTripDistance(plan.totalDistanceMeters)}</span>
        </div>
        <div className="trip-plan-card__meta">
          <span>{formatTripCost(plan)}</span>
          <span>
            {plan.transfersCount === 0
              ? 'Trajet direct'
              : `${plan.transfersCount} correspondance${plan.transfersCount > 1 ? 's' : ''}`}
          </span>
        </div>
      </button>
      {expanded && (
        <ol className="trip-plan-card__steps">
          {plan.steps.map((step, i) => {
            const ModeIcon = step.type === 'ride' && step.line ? MODE_ICONS[step.line.transportType] : null;
            return (
              <li key={i} className={`trip-step trip-step--${step.type}`} style={{ animationDelay: `${i * 60}ms` }}>
                {step.type === 'walk' ? (
                  <>
                    <span className="trip-step__icon trip-step__icon--walk" aria-hidden="true">
                      <FootprintsIcon width={16} height={16} />
                    </span>
                    <span>
                      Marcher {formatTripDistance(step.distanceMeters)} (
                      {formatTripDuration(step.durationSeconds)})
                      {step.toLabel ? ` jusqu'à ${step.toLabel}` : ''}
                      {step.fromLabel ? ` depuis ${step.fromLabel}` : ''}
                    </span>
                  </>
                ) : (
                  <>
                    <span
                      className="trip-step__line-badge"
                      style={{ backgroundColor: step.line?.color ?? '#0A9396' }}
                    >
                      {ModeIcon && <ModeIcon width={14} height={14} aria-hidden="true" />}
                      {step.line?.shortName ?? step.line?.name}
                    </span>
                    <span>
                      De <strong>{step.boardStop?.name ?? 'arrêt'}</strong> à{' '}
                      <strong>{step.alightStop?.name ?? 'arrêt'}</strong> —{' '}
                      {formatTripDuration(step.durationSeconds)}
                      {step.durationEstimateBasis === 'haversine-fallback' ? ' (estimé)' : ''}
                      {step.costFCFA !== null && step.costFCFA !== undefined && (
                        <> · {step.costFCFA.toLocaleString('fr-FR')} FCFA{!step.costVerified ? ' (estimé)' : ''}</>
                      )}
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </li>
  );
}

export function TripPlannerPage() {
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [walkRadius, setWalkRadius] = useState<number>(1000);
  const [optimize, setOptimize] = useState<OptimizeCriterion>('fastest');
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const trip = useTripPlan();

  function useMyLocation() {
    if (!('geolocation' in navigator)) {
      setLocationError("La géolocalisation n'est pas disponible sur cet appareil.");
      return;
    }
    setIsLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin({
          label: 'Ma position',
          coords: { lat: pos.coords.latitude, lon: pos.coords.longitude },
        });
        setIsLocating(false);
      },
      () => {
        setLocationError('Position indisponible. Autorisez la géolocalisation ou choisissez un arrêt de départ.');
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  }

  async function handleCompare(event: React.FormEvent) {
    event.preventDefault();
    if (!origin || !destination) return;
    try {
      await trip.plan({
        from: origin.coords,
        to: destination.coords,
        walkRadius,
        optimize,
        maxTransfers: 1,
      });
    } catch {
      // L'erreur traduite est exposée via trip.error, affichée ci-dessous.
    }
  }

  const canCompare = !!origin && !!destination && !trip.isPending;

  return (
    <main className="trip-planner">
      <div className="trip-planner__card">
        <div className="trip-planner__header">
          <h1>Planifier un trajet</h1>
          <Link className="trip-planner__back" to="/">
            ← Retour à la carte
          </Link>
        </div>

        <form className="trip-planner__form" onSubmit={(e) => void handleCompare(e)}>
          <div className="trip-field-row">
            <PlaceField id="trip-origin" label="Départ" value={origin} onChange={setOrigin} near={destination?.coords} />
            <button
              type="button"
              className="trip-planner__locate-btn"
              onClick={useMyLocation}
              disabled={isLocating}
              title="Utiliser ma position"
              aria-label="Utiliser ma position comme point de départ"
            >
              {isLocating ? (
                <LoaderIcon className="icon-spin" width={16} height={16} aria-hidden="true" />
              ) : (
                <LocateFixedIcon width={16} height={16} aria-hidden="true" />
              )}
            </button>
          </div>
          {locationError && (
            <p className="trip-planner__error" role="alert">
              {locationError}
            </p>
          )}

          <PlaceField id="trip-destination" label="Destination" value={destination} onChange={setDestination} near={origin?.coords} />

          <div className="trip-planner__filters">
            <label className="trip-planner__filter-label" htmlFor="trip-radius">
              Rayon de marche accepté
              <select
                id="trip-radius"
                value={walkRadius}
                onChange={(e) => setWalkRadius(Number(e.target.value))}
              >
                {RADIUS_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="trip-planner__filter-label" htmlFor="trip-optimize">
              Optimiser
              <select
                id="trip-optimize"
                value={optimize}
                onChange={(e) => setOptimize(e.target.value as OptimizeCriterion)}
              >
                {CRITERIA.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button type="submit" className="trip-planner__submit" disabled={!canCompare}>
            {trip.isPending ? (
              <>
                <LoaderIcon className="icon-spin" width={16} height={16} aria-hidden="true" />
                Recherche des itinéraires…
              </>
            ) : (
              'Comparer les itinéraires'
            )}
          </button>
        </form>

        {trip.error && (
          <p className="trip-planner__error" role="alert">
            {trip.error}
          </p>
        )}

        {trip.data && (
          <div className="trip-planner__results">
            <p className="trip-planner__note" role="note">
              {trip.data.note}
            </p>
            {trip.data.plans.length === 0 ? (
              <p className="trip-planner__empty">
                Aucun itinéraire trouvé avec ce rayon de marche. Essayez un rayon plus large.
              </p>
            ) : (
              <ul className="trip-plan-list">
                {trip.data.plans.map((plan, i) => (
                  <TripPlanCard key={i} plan={plan} rank={i} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

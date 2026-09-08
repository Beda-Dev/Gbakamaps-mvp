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
import { usePlaceSearch } from '@/hooks/usePlaceSearch';
import { useTripSegments } from '@/hooks/useTripSegments';
import { StopsMap } from '@/components/StopsMap';
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
  CrosshairIcon,
  FootprintsIcon,
  LoaderIcon,
  LocateFixedIcon,
  MapPinIcon,
  SearchIcon,
  XIcon,
} from '@/components/icons';
import type { Stop, TransportType } from '@/lib/api/types';

// Centre par défaut de la carte du planificateur — même valeur que la carte
// principale (HomePage.tsx), avant toute sélection d'origine/destination.
const DEFAULT_MAP_CENTER = { lat: 5.32, lon: -4.02 };

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

// Bornes ALIGNÉES sur tripPlanQuerySchema (backend, walkRadius max 2000) —
// bug réel trouvé le 2026-09-08 : l'option "5 km" existait ici mais était
// systématiquement rejetée en 400 par le backend (jamais testée bout en
// bout à l'ajout). 2 km reste d'ailleurs déjà généreux pour une marche
// "acceptée" avant d'embarquer.
const RADIUS_OPTIONS = [
  { value: 500, label: '500 m' },
  { value: 1000, label: '1 km' },
  { value: 1500, label: '1,5 km' },
  { value: 2000, label: '2 km' },
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
  onPickOnMap,
  isPicking,
}: {
  id: string;
  label: string;
  value: Place | null;
  onChange: (place: Place | null) => void;
  near?: TripCoordinates | null;
  onPickOnMap?: () => void;
  isPicking?: boolean;
}) {
  const stopSearch = useStopSearch(near);
  const placeSearch = usePlaceSearch();
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

  // Un seul champ pilote les deux recherches (arrêts connus + lieux
  // quelconques) — jamais deux champs séparés qui laisseraient croire à
  // l'utilisateur que ce sont deux systèmes différents (demande explicite :
  // "comme Google Maps", un seul système cohérent).
  function handleTextChange(value: string) {
    stopSearch.search(value);
    placeSearch.search(value);
  }

  function handleSelectStop(stop: Stop) {
    onChange({ label: stop.name ?? 'Arrêt sans nom', coords: { lat: stop.lat, lon: stop.lon } });
    stopSearch.clear();
    placeSearch.clear();
    setIsFocused(false);
  }

  function handleSelectPlace(place: { name: string; lat: number; lon: number }) {
    onChange({ label: place.name, coords: { lat: place.lat, lon: place.lon } });
    stopSearch.clear();
    placeSearch.clear();
    setIsFocused(false);
  }

  function handleClear() {
    onChange(null);
    stopSearch.clear();
    placeSearch.clear();
  }

  const text = stopSearch.text;
  const isPending = stopSearch.isPending || placeSearch.isPending;
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
            placeholder="Chercher un arrêt ou un lieu…"
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
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
        {!value && onPickOnMap && (
          <button
            type="button"
            className={`trip-field__pick-btn${isPicking ? ' is-active' : ''}`}
            onClick={onPickOnMap}
            title="Choisir ce point sur la carte"
            aria-pressed={isPicking}
          >
            <CrosshairIcon width={16} height={16} aria-hidden="true" />
          </button>
        )}
      </div>
      {isPicking && (
        <p className="trip-field__hint" role="status">
          Cliquez sur la carte pour placer ce point.
        </p>
      )}
      {showDropdown && (
        <ul className="trip-field__results" id={listboxId} role="listbox">
          {stopSearch.isError && placeSearch.isError && (
            <li className="trip-field__message" role="alert">
              Recherche indisponible. Réessayez.
            </li>
          )}
          {!isPending &&
            stopSearch.results.length === 0 &&
            placeSearch.results.length === 0 &&
            !(stopSearch.isError && placeSearch.isError) && (
              <li className="trip-field__message" role="status">
                Aucun résultat pour « {text.trim()} ».
              </li>
            )}
          {/* Arrêts connus en premier — toujours prioritaires, ce sont ceux
              pour lesquels nous avons de vraies données de transport. */}
          {stopSearch.results.map((stop) => (
            <li key={`stop-${stop.id}`} role="option" aria-selected={false}>
              <button
                type="button"
                className="trip-field__result trip-field__result--stop"
                onClick={() => handleSelectStop(stop)}
              >
                <BusIcon width={14} height={14} aria-hidden="true" />
                {stop.name ?? 'Arrêt sans nom'}
              </button>
            </li>
          ))}
          {/* Lieux quelconques (Overpass) — visuellement distincts, jamais
              présentés comme des arrêts de transport (pas de données de
              ligne associées, juste un point géographique). */}
          {placeSearch.results.map((place, i) => (
            <li key={`place-${i}`} role="option" aria-selected={false}>
              <button
                type="button"
                className="trip-field__result trip-field__result--place"
                onClick={() => handleSelectPlace(place)}
              >
                <MapPinIcon width={14} height={14} aria-hidden="true" />
                {place.name}
                <span className="trip-field__result-tag">lieu</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TripPlanCard({
  plan,
  rank,
  expanded,
  onToggle,
}: {
  plan: TripPlan;
  rank: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <li className={`trip-plan-card${rank === 0 ? ' is-recommended' : ''}`}>
      <button
        type="button"
        className="trip-plan-card__summary"
        onClick={onToggle}
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
  // Champ qui attend une sélection par clic sur la carte — null = aucun
  // (comportement normal de la carte, on ne capte pas les clics sans raison).
  const [pickingField, setPickingField] = useState<'origin' | 'destination' | null>(null);
  // Index du plan actuellement déplié — c'est celui-là qui est dessiné sur la
  // carte (un seul à la fois : superposer tous les plans rendrait la carte
  // illisible et laisserait croire que ce sont tous des trajets équivalents).
  const [expandedIndex, setExpandedIndex] = useState(0);
  const trip = useTripPlan();

  function handleMapClick(point: TripCoordinates) {
    if (!pickingField) return;
    const place: Place = { label: 'Point choisi sur la carte', coords: point };
    if (pickingField === 'origin') setOrigin(place);
    else setDestination(place);
    setPickingField(null);
  }

  const mapCenter = origin?.coords ?? destination?.coords ?? DEFAULT_MAP_CENTER;

  const selectedPlan = trip.data?.plans[expandedIndex] ?? null;
  // Segments RÉELS (suivant les routes existantes) du plan actuellement
  // déplié — voir useTripSegments.ts : corrige un vrai bug produit (lignes
  // droites traversant visuellement la lagune) en réutilisant le même
  // service de routage que "Itinéraire vers cet arrêt", jamais une simple
  // ligne à vol d'oiseau sauf en repli si le routage échoue pour un segment.
  const { segments: tripSegments, isLoading: tripSegmentsLoading } = useTripSegments(
    selectedPlan,
    origin?.coords ?? null,
    destination?.coords ?? null
  );

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
    setExpandedIndex(0);
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
      <div className="trip-planner__layout">
      <div className="trip-planner__card">
        <div className="trip-planner__header">
          <h1>Planifier un trajet</h1>
          <Link className="trip-planner__back" to="/">
            ← Retour à la carte
          </Link>
        </div>

        <form className="trip-planner__form" onSubmit={(e) => void handleCompare(e)}>
          <div className="trip-field-row">
            <PlaceField
              id="trip-origin"
              label="Départ"
              value={origin}
              onChange={setOrigin}
              near={destination?.coords}
              onPickOnMap={() => setPickingField((f) => (f === 'origin' ? null : 'origin'))}
              isPicking={pickingField === 'origin'}
            />
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

          <PlaceField
            id="trip-destination"
            label="Destination"
            value={destination}
            onChange={setDestination}
            near={origin?.coords}
            onPickOnMap={() => setPickingField((f) => (f === 'destination' ? null : 'destination'))}
            isPicking={pickingField === 'destination'}
          />

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
                  <TripPlanCard
                    key={i}
                    plan={plan}
                    rank={i}
                    expanded={expandedIndex === i}
                    onToggle={() => setExpandedIndex((cur) => (cur === i ? -1 : i))}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="trip-planner__map-panel">
        <div className="trip-planner__map">
          <StopsMap
            center={mapCenter}
            stops={[]}
            onMapClick={handleMapClick}
            pickerActive={pickingField !== null}
            originMarker={origin ? { ...origin.coords, label: origin.label } : null}
            destinationMarker={destination ? { ...destination.coords, label: destination.label } : null}
            tripSegments={tripSegments}
          />
        </div>
        {tripSegmentsLoading && (
          <p className="trip-planner__map-hint">Calcul du tracé sur la carte…</p>
        )}
        {!tripSegmentsLoading && tripSegments && (
          <p className="trip-planner__map-hint">
            Quand elle est connue (source : data.gouv.ci), le trajet en bus/gbaka suit le tracé réel de
            la ligne ; sinon, il suit les routes existantes (calculé via le même service que
            l'itinéraire vers un arrêt) — approximatif : un itinéraire routier plausible entre les mêmes
            points, pas nécessairement le trajet exact du véhicule.
          </p>
        )}
      </div>
      </div>
    </main>
  );
}

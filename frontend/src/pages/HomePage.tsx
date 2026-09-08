import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHealth } from '@/hooks/useHealth';
import { useNearbyStops } from '@/hooks/useNearbyStops';
import { useAuth } from '@/hooks/useAuth';
import { useFavorites } from '@/hooks/useFavorites';
import {
  REPORT_TYPE_LABELS,
  reportErrorMessage,
  useReports,
  type ReportType,
} from '@/hooks/useReports';
import {
  formatRouteDistance,
  formatRouteDuration,
  useRoute,
  type RouteGeometry,
  type RouteProfile,
} from '@/hooks/useRoute';
import { haversineDistanceMeters, useLiveTracking } from '@/hooks/useLiveTracking';
import { bearingBetween, cardinalLabel, useDeviceOrientation } from '@/hooks/useDeviceOrientation';
import { POI_CATEGORY_LABELS, useNearbyPois } from '@/hooks/useNearbyPois';
import { useNeighborhoods } from '@/hooks/useNeighborhoods';
import { useCommunes, type Commune } from '@/hooks/useCommunes';
import { AuthStatus } from '@/components/AuthStatus';
import { STOP_TYPE_LABELS, StopsMap } from '@/components/StopsMap';
import { StopSearchBar } from '@/components/StopSearchBar';
import {
  BikeIcon,
  CarIcon,
  FlagIcon,
  FootprintsIcon,
  LoaderIcon,
  MapPinIcon,
  NavigationIcon,
  RouteIcon,
  StarIcon,
  TargetIcon,
  XIcon,
} from '@/components/icons';
import type { Stop } from '@/lib/api/types';

// Plateau, Abidjan — point de départ par défaut avant géolocalisation.
const DEFAULT_CENTER = { lat: 5.32, lon: -4.02 };

// Rayons de recherche proposés (demande explicite, §12.3 "Rayons et
// proximité") — bornes cohérentes avec celles acceptées par
// GET /api/stops/nearby (100-20000m).
const SEARCH_RADIUS_OPTIONS = [500, 1000, 1500, 2000, 5000] as const;

interface GeoCenter {
  lat: number;
  lon: number;
}

// Étoile favori dans le panneau détail : visiteur anonyme → /login (aucun
// appel API qui échouerait en 401), connecté → ajout/retrait du favori.
function DetailFavoriteButton({ stop }: { stop: Stop }) {
  const { user, isLoading: authLoading } = useAuth();
  const { isFavorite, addFavorite, removeFavorite, isMutating } = useFavorites();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const favorite = isFavorite(stop.id);
  const pending = authLoading || isMutating;

  async function handleClick() {
    if (!user) {
      navigate('/login');
      return;
    }
    setError(null);
    try {
      if (favorite) {
        await removeFavorite(stop.id);
      } else {
        await addFavorite(stop.id);
      }
    } catch {
      setError("Impossible de mettre à jour ce favori. Réessayez.");
    }
  }

  return (
    <span className="home__favorite-wrap">
      <button
        type="button"
        className={`home__favorite-btn${favorite ? ' is-active' : ''}`}
        onClick={handleClick}
        disabled={pending}
        aria-label={favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
        aria-pressed={favorite}
        title={favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      >
        {pending ? (
          <LoaderIcon className="icon-spin" width={18} height={18} aria-hidden="true" />
        ) : (
          <StarIcon
            width={18}
            height={18}
            aria-hidden="true"
            fill={favorite ? 'currentColor' : 'none'}
          />
        )}
      </button>
      {error && (
        <span className="home__favorite-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

const ROUTE_PROFILES = [
  { id: 'driving-car', label: 'Voiture', Icon: CarIcon },
  { id: 'cycling-regular', label: 'Vélo', Icon: BikeIcon },
  { id: 'foot-walking', label: 'Marche', Icon: FootprintsIcon },
] as const;

// Bouton "Itinéraire" du panneau détail, à côté du bouton favori. Le panneau
// repliable (sélecteur de profil + résultat) s'affiche SOUS la ligne de titre
// (flex-wrap sur .home__detail-title, panel en flex-basis 100%) : aucun
// chevauchement avec le bouton fermer positionné en absolu en haut à droite.
//
// Une fois l'itinéraire calculé, le panneau propose aussi "Suivre mon trajet" :
// repère du PASSAGER pendant son propre déplacement (sa position GPS réelle
// progresse sur la carte via la prop userLocation déjà branchée sur StopsMap
// — PAS du suivi de véhicule, aucun marqueur supplémentaire).
function RouteToStopButton({
  stop,
  userLocation,
  isLocating,
  onRequestLocation,
  onGeometryChange,
  onLivePositionChange,
  onHeadingChange,
}: {
  stop: Stop;
  userLocation: { lat: number; lon: number } | null;
  isLocating: boolean;
  onRequestLocation: () => void;
  onGeometryChange: (geometry: RouteGeometry | null) => void;
  onLivePositionChange: (position: { lat: number; lon: number }) => void;
  onHeadingChange: (heading: number | null) => void;
}) {
  const route = useRoute();
  const {
    position: livePosition,
    isTracking,
    error: trackingError,
    start: startTracking,
    stop: stopTracking,
  } = useLiveTracking();
  // Boussole — voir useDeviceOrientation.ts pour la logique iOS/Android/
  // desktop. `heading` reste null tant qu'aucune donnée capteur réelle n'a
  // été reçue (pas de capteur, permission refusée, ou desktop) : le repli
  // "direction à suivre" (calculée, toujours dispo) prend le relais ci-dessous.
  const {
    heading,
    hasReceivedData: hasHeadingData,
    needsExplicitPermission,
    permission: headingPermission,
    requestPermission: requestHeadingPermission,
    stop: stopOrientation,
  } = useDeviceOrientation();
  const [expanded, setExpanded] = useState(false);
  const [lastProfile, setLastProfile] = useState<RouteProfile | null>(null);
  // Arrivée constatée (< 30 m) : le suivi est arrêté automatiquement, le
  // message reste affiché jusqu'au prochain démarrage ou à l'effacement.
  const [hasArrived, setHasArrived] = useState(false);

  // Distance restante jusqu'à l'arrêt de destination, recalculée à chaque
  // position live (haversine directe — le tracé useRoute ne se recalcule pas
  // en continu, c'est un simple repère de proximité).
  const remainingMeters =
    livePosition === null
      ? null
      : haversineDistanceMeters(livePosition, { lat: stop.lat, lon: stop.lon });

  // Chaque position live remonte à HomePage qui l'injecte dans la prop
  // userLocation de StopsMap : le point bleu existant suit le déplacement
  // réel (aucun deuxième marqueur créé).
  useEffect(() => {
    if (livePosition !== null) {
      onLivePositionChange({ lat: livePosition.lat, lon: livePosition.lon });
    }
  }, [livePosition, onLivePositionChange]);

  // Cap réel du capteur remonté à HomePage (fait pivoter la flèche sur le
  // point bleu) — jamais transmis tant qu'aucune donnée capteur réelle n'a
  // été reçue (hasHeadingData), même si `heading` a une valeur résiduelle.
  useEffect(() => {
    onHeadingChange(hasHeadingData ? heading : null);
  }, [heading, hasHeadingData, onHeadingChange]);

  // Direction à suivre vers la destination — calcul purement géométrique
  // (bearingBetween), toujours disponible dès qu'on a une position live,
  // indépendant du capteur d'orientation. Repère utile même sans boussole
  // (desktop, permission refusée, appareil sans capteur) : dit "de quel
  // côté marcher", pas "dans quel sens le téléphone est tenu" (ce que fait
  // `heading` — les deux informations sont complémentaires, pas des replis
  // l'une de l'autre).
  const bearingToDestination =
    livePosition === null ? null : bearingBetween(livePosition, { lat: stop.lat, lon: stop.lon });

  // Arrivée automatique : sous 30 m on affiche "Vous êtes arrivé(e) !" et on
  // arrête le watch (pas de watch orphelin qui tournerait pour rien).
  useEffect(() => {
    if (isTracking && remainingMeters !== null && remainingMeters < 30) {
      setHasArrived(true);
      stopTracking();
    }
  }, [isTracking, remainingMeters, stopTracking]);

  function handleToggle() {
    if (expanded) {
      // Replier le panneau itinéraire coupe aussi le suivi : sinon le watch
      // tournerait sans aucun bouton visible pour l'arrêter.
      stopTracking();
      stopOrientation();
      setExpanded(false);
      return;
    }
    setExpanded(true);
    // Sans position connue, on retente la géolocalisation au lieu de bloquer
    // silencieusement — le panneau affichera l'attente ou un message clair.
    if (!userLocation) onRequestLocation();
  }

  async function handleProfile(profile: RouteProfile) {
    if (!userLocation) {
      onRequestLocation();
      return;
    }
    setLastProfile(profile);
    try {
      const result = await route.compute({
        from: userLocation,
        to: { lat: stop.lat, lon: stop.lon },
        profile,
      });
      // Nouvel itinéraire = nouveau trajet : l'alerte d'arrivée précédente ne
      // s'applique plus.
      setHasArrived(false);
      onGeometryChange(result.geometry);
    } catch {
      // L'erreur traduite est exposée via route.error, affichée ci-dessous.
      onGeometryChange(null);
    }
  }

  function handleClear() {
    // Effacer l'itinéraire coupe aussi le suivi : pas de suivi orphelin sans
    // tracé ni destination associée.
    stopTracking();
    stopOrientation();
    setHasArrived(false);
    onGeometryChange(null);
    route.reset();
  }

  function handleStartTracking() {
    setHasArrived(false);
    startTracking();
    // Le clic sur "Suivre mon trajet" EST le geste utilisateur requis par
    // iOS pour la permission d'orientation (voir useDeviceOrientation.ts) —
    // sur Android/desktop, requestPermission() attache directement les
    // écouteurs sans rien demander (pas de second appel nécessaire).
    void requestHeadingPermission();
  }

  return (
    <>
      <span className="home__route-wrap">
        <button
          type="button"
          className={`home__route-btn${route.data ? ' is-active' : ''}`}
          onClick={handleToggle}
          disabled={route.isPending}
          aria-label="Itinéraire vers cet arrêt"
          aria-expanded={expanded}
          title="Itinéraire vers cet arrêt"
        >
          {route.isPending ? (
            <LoaderIcon className="icon-spin" width={18} height={18} aria-hidden="true" />
          ) : (
            <RouteIcon width={18} height={18} aria-hidden="true" />
          )}
        </button>
      </span>
      {expanded && (
        <div className="home__route-panel">
          {!userLocation ? (
            isLocating ? (
              <p className="home__route-hint" role="status">
                <span className="spinner spinner--small" aria-hidden="true" />
                Localisation en cours…
              </p>
            ) : (
              <p className="home__route-hint" role="alert">
                Activez la géolocalisation pour calculer un itinéraire.
                <button type="button" className="home__retry-btn" onClick={onRequestLocation}>
                  Relancer
                </button>
              </p>
            )
          ) : (
            <div className="home__route-profiles" role="group" aria-label="Mode de transport">
              {ROUTE_PROFILES.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={`home__route-profile${lastProfile === id ? ' is-active' : ''}`}
                  onClick={() => void handleProfile(id)}
                  disabled={route.isPending}
                  aria-pressed={lastProfile === id}
                >
                  <Icon width={18} height={18} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
          )}
          {route.isPending && (
            <p className="home__route-hint" role="status">
              <span className="spinner spinner--small" aria-hidden="true" />
              Calcul de l’itinéraire…
            </p>
          )}
          {route.data && !route.isPending && (
            <>
              <p className="home__route-result" role="status">
                {formatRouteDistance(route.data.distanceMeters)} •{' '}
                {formatRouteDuration(route.data.durationSeconds)}
                <button type="button" className="home__route-clear" onClick={handleClear}>
                  Effacer l’itinéraire
                </button>
              </p>
              {/* Suivi du passager (pas du véhicule) : visible uniquement quand
                  un itinéraire est calculé — pas de suivi sans destination. */}
              <div className="home__tracking">
                {!isTracking && !trackingError && (
                  <button
                    type="button"
                    className={`home__tracking-btn${hasArrived ? ' is-done' : ''}`}
                    onClick={handleStartTracking}
                    aria-pressed={false}
                  >
                    <NavigationIcon width={18} height={18} aria-hidden="true" />
                    Suivre mon trajet
                  </button>
                )}
                {isTracking && (
                  <button
                    type="button"
                    className="home__tracking-btn is-active"
                    onClick={stopTracking}
                    aria-pressed={true}
                  >
                    <NavigationIcon width={18} height={18} aria-hidden="true" />
                    Arrêter le suivi
                  </button>
                )}
                {isTracking && remainingMeters === null && (
                  <p className="home__tracking-info" role="status">
                    <span className="spinner spinner--small" aria-hidden="true" />
                    Localisation en cours…
                  </p>
                )}
                {isTracking && remainingMeters !== null && (
                  <p className="home__tracking-info" role="status">
                    Distance restante : {formatRouteDistance(remainingMeters)}
                  </p>
                )}
                {/* Cap boussole (capteur réel) si reçu, sinon direction
                    calculée vers la destination (toujours disponible dès
                    qu'on a une position live) — jamais les deux confondus,
                    labellés différemment (§9/§12.8, boussole). */}
                {isTracking && bearingToDestination !== null && (
                  <p className="home__tracking-info home__tracking-heading" role="status">
                    {hasHeadingData
                      ? `Cap : ${cardinalLabel(heading!)}`
                      : `Direction à suivre : ${cardinalLabel(bearingToDestination)}`}
                  </p>
                )}
                {isTracking &&
                  needsExplicitPermission &&
                  headingPermission === 'unknown' && (
                    <button
                      type="button"
                      className="home__retry-btn"
                      onClick={() => void requestHeadingPermission()}
                    >
                      Activer la boussole
                    </button>
                  )}
                {isTracking && headingPermission === 'denied' && (
                  <p className="home__tracking-info home__tracking-heading">
                    Boussole indisponible (permission refusée) — direction calculée affichée à la place.
                  </p>
                )}
                {isTracking &&
                  remainingMeters !== null &&
                  remainingMeters < 150 &&
                  remainingMeters >= 30 && (
                    <p className="home__tracking-approaching" role="status">
                      Vous approchez de votre destination !
                    </p>
                  )}
                {hasArrived && (
                  <p className="home__tracking-arrived" role="status">
                    Vous êtes arrivé(e) !
                  </p>
                )}
                {trackingError && (
                  <p className="home__tracking-error" role="alert">
                    {trackingError}
                    <button
                      type="button"
                      className="home__retry-btn"
                      onClick={handleStartTracking}
                    >
                      Réessayer
                    </button>
                  </p>
                )}
              </div>
            </>
          )}
          {route.error && (
            <p className="home__route-error" role="alert">
              {route.error}
            </p>
          )}
        </div>
      )}
    </>
  );
}

// Bouton "Signaler" du panneau détail, à côté des boutons favori et
// itinéraire. Même pattern que RouteToStopButton : le formulaire repliable
// s'affiche SOUS la ligne de titre (flex-wrap sur .home__detail-title, panel
// en flex-basis 100%) : aucun chevauchement avec le bouton fermer positionné
// en absolu en haut à droite.
function ReportToStopButton({ stop }: { stop: Stop }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { createReport } = useReports();
  const [expanded, setExpanded] = useState(false);
  const [reportType, setReportType] = useState<ReportType>('INCORRECT_INFO');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function handleToggle() {
    // Visiteur anonyme → /login (aucun appel API qui échouerait en 401),
    // comme le bouton favori.
    if (!user) {
      navigate('/login');
      return;
    }
    setExpanded((prev) => !prev);
  }

  function handleCancel() {
    setExpanded(false);
    setError(null);
    setSuccess(false);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    // Validation client avant envoi (miroir du contrat backend 5-200).
    if (trimmedTitle.length < 5 || trimmedTitle.length > 200) {
      setError('Le titre doit contenir entre 5 et 200 caractères.');
      return;
    }
    setIsSending(true);
    setError(null);
    try {
      await createReport({
        reportType,
        title: trimmedTitle,
        // Champ optionnel : on n'envoie rien quand il est vide.
        ...(description.trim() ? { description: description.trim() } : {}),
        stopId: stop.id,
      });
      setSuccess(true);
      // Repli automatique après ~2s, formulaire réinitialisé.
      setTimeout(() => {
        setExpanded(false);
        setSuccess(false);
        setTitle('');
        setDescription('');
      }, 2000);
    } catch (err) {
      setError(reportErrorMessage(err));
    } finally {
      setIsSending(false);
    }
  }

  return (
    <>
      <span className="home__report-wrap">
        <button
          type="button"
          className="home__report-btn"
          onClick={handleToggle}
          aria-label="Signaler un problème sur cet arrêt"
          aria-expanded={expanded}
          title="Signaler un problème sur cet arrêt"
        >
          <FlagIcon width={18} height={18} aria-hidden="true" />
        </button>
      </span>
      {expanded && (
        <div className="home__report-panel">
          {success ? (
            <p className="home__report-success" role="status">
              Signalement envoyé, merci !
            </p>
          ) : (
            <form className="home__report-form" onSubmit={(e) => void handleSubmit(e)}>
              <label className="home__report-label" htmlFor="report-type">
                Type de signalement
                <select
                  id="report-type"
                  className="home__report-input"
                  value={reportType}
                  onChange={(e) => setReportType(e.target.value as ReportType)}
                  disabled={isSending}
                >
                  {(Object.keys(REPORT_TYPE_LABELS) as ReportType[]).map((type) => (
                    <option key={type} value={type}>
                      {REPORT_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="home__report-label" htmlFor="report-title">
                Titre (5-200 caractères)
                <input
                  id="report-title"
                  className="home__report-input"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  minLength={5}
                  maxLength={200}
                  required
                  disabled={isSending}
                  placeholder="Ex. Nom d'arrêt incorrect"
                />
              </label>
              <label className="home__report-label" htmlFor="report-description">
                Description (optionnel)
                <textarea
                  id="report-description"
                  className="home__report-input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  disabled={isSending}
                  placeholder="Détails utiles pour la modération…"
                />
              </label>
              {error && (
                <p className="home__report-error" role="alert">
                  {error}
                </p>
              )}
              <div className="home__report-actions">
                <button
                  type="submit"
                  className="home__report-submit"
                  disabled={isSending}
                >
                  {isSending ? (
                    <>
                      <LoaderIcon
                        className="icon-spin"
                        width={16}
                        height={16}
                        aria-hidden="true"
                      />
                      Envoi…
                    </>
                  ) : (
                    'Envoyer'
                  )}
                </button>
                <button
                  type="button"
                  className="home__report-cancel"
                  onClick={handleCancel}
                  disabled={isSending}
                >
                  Annuler
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </>
  );
}

export function HomePage() {
  const health = useHealth();
  const [center, setCenter] = useState<GeoCenter>(DEFAULT_CENTER);
  const [userLocation, setUserLocation] = useState<GeoCenter | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [showOkBanner, setShowOkBanner] = useState(true);
  // Rayon de recherche réglable par l'utilisateur (demande explicite,
  // PROJECT_MEMORY.md §12.3 "Rayons et proximité") — 1500m repris comme
  // valeur de départ (comportement historique de cette page, inchangé par
  // défaut).
  const [searchRadius, setSearchRadius] = useState(1500);
  // Affichage du cercle matérialisant ce rayon sur la carte — masqué par
  // défaut (demande explicite : bouton dédié pour l'activer, pas un cercle
  // permanent qui encombrerait la carte).
  const [showRadiusCircle, setShowRadiusCircle] = useState(false);
  // Étiquettes de quartiers — masquées par défaut (appel Overpass évitable
  // tant que l'utilisateur ne les demande pas explicitement), chargées à la
  // première activation puis mises en cache (staleTime long côté hook).
  const [showNeighborhoods, setShowNeighborhoods] = useState(false);
  const { neighborhoods } = useNeighborhoods(showNeighborhoods);
  // Contours de commune dessinés avec le même toggle que les étiquettes de
  // quartier — les deux relèvent conceptuellement du même "contexte de
  // zone" pour l'utilisateur, pas deux fonctionnalités distinctes à activer
  // séparément.
  const { communes } = useCommunes(showNeighborhoods);
  // Zone à cadrer sur la carte (sélection d'une commune via la recherche) —
  // un nouvel objet à chaque sélection, jamais réutilisé tel quel.
  const [focusBounds, setFocusBounds] = useState<Commune['bounds'] | null>(null);

  function handleSelectCommune(commune: Commune) {
    setShowNeighborhoods(true); // révèle le contour choisi, pas une zone invisible
    setFocusBounds({ ...commune.bounds });
  }
  const stops = useNearbyStops(center.lat, center.lon, searchRadius);
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
  // Points d'intérêt réels autour de l'arrêt actuellement sélectionné
  // (pharmacie, marché, école...) — désactivé tant qu'aucun arrêt n'est
  // choisi (voir useNearbyPois : hook désactivé sur point null).
  const nearbyPois = useNearbyPois(
    selectedStop ? { lat: selectedStop.lat, lon: selectedStop.lon } : null
  );
  // Géométrie du tracé d'itinéraire affichée sur la carte (null = aucun).
  const [routeGeometry, setRouteGeometry] = useState<RouteGeometry | null>(null);

  // Géolocalisation réelle avec repli silencieux sur le centre par défaut
  // en cas de refus / erreur / navigateur incompatible.
  const requestLocation = useCallback(() => {
    if (!('geolocation' in navigator)) return;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setCenter(next);
        setUserLocation(next);
        setIsLocating(false);
      },
      () => {
        // Refus ou erreur : on reste sur le centre par défaut, sans alarmer.
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }, []);

  // Demande la position au chargement ; la query useNearbyStops se relance
  // automatiquement via `center` (clé de query incluant lat/lon).
  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

  // Un nouvel arrêt sélectionné (ou la fermeture du panneau) invalide le
  // tracé précédent — pas de tracé fantôme vers l'ancien arrêt.
  // (RouteToStopButton est remonté via key={selectedStop.id} : le suivi GPS
  // live est lui aussi démonté, et son cleanup appelle clearWatch — aucun
  // watch orphelin au changement d'arrêt ou à la fermeture du panneau.)
  useEffect(() => {
    setRouteGeometry(null);
  }, [selectedStop?.id]);

  // Position live remontée par RouteToStopButton pendant "Suivre mon trajet" :
  // injectée dans la MÊME prop userLocation que la géolocalisation ponctuelle,
  // donc le point bleu existant de StopsMap suit le déplacement réel (aucun
  // deuxième marqueur). Le dernier point connu reste affiché à l'arrêt.
  const handleLivePosition = useCallback((pos: GeoCenter) => {
    setUserLocation(pos);
  }, []);

  // Cap de l'appareil remonté par RouteToStopButton pendant le suivi — fait
  // pivoter la flèche sur le point bleu (StopsMap), jamais la carte entière.
  const [headingDeg, setHeadingDeg] = useState<number | null>(null);
  const handleHeadingChange = useCallback((heading: number | null) => {
    setHeadingDeg(heading);
  }, []);

  // Sélection depuis la barre de recherche (phase 2, §12) : contrairement à
  // un clic sur un marqueur déjà visible, l'arrêt trouvé peut être hors de
  // la zone actuellement chargée — on recentre la carte dessus (ce qui
  // relance useNearbyStops via la clé de query incluant `center`) EN PLUS
  // d'ouvrir le panneau détail, pour que le marqueur soit réellement visible.
  const handleSelectFromSearch = useCallback((stop: Stop) => {
    setCenter({ lat: stop.lat, lon: stop.lon });
    setSelectedStop(stop);
  }, []);

  // Bannière de succès brève : auto-disparition ~2s après connexion OK.
  useEffect(() => {
    if (!health.data || health.isError) return;
    setShowOkBanner(true);
    const timer = setTimeout(() => setShowOkBanner(false), 2000);
    return () => clearTimeout(timer);
  }, [health.data, health.isError]);

  return (
    <div className={`home${selectedStop ? ' has-detail' : ''}`}>
      {/* Bandeau discret d'état de connexion : la carte reste publique.
          <nav> plutôt qu'un <div> nu : contient les liens de navigation de
          l'utilisateur (planifier/favoris/signalements/connexion) — trouvé
          par un audit d'accessibilité réel (axe-core, règle "region", ce
          contenu n'était contenu par aucun repère de page), 2026-09-06. */}
      <nav className="home__topbar" aria-label="Navigation utilisateur">
        <AuthStatus />
      </nav>
      <header className="home__banner">
        {health.isLoading && <span>Connexion au serveur…</span>}
        {health.isError && (
          <span className="home__banner-row">
            <span className="home__banner--error">⚠️ Serveur indisponible</span>
            <button type="button" className="home__retry-btn" onClick={() => health.refetch()}>
              Réessayer
            </button>
          </span>
        )}
        {health.data && !health.isError && showOkBanner && (
          <span className="home__banner--ok">✅ Connecté</span>
        )}
      </header>

      {/* <main> englobe la carte, le panneau détail et le compteur d'arrêts
          — sans lui, le contenu injecté par MapLibre (attribution, contrôles)
          et certains textes n'étaient contenus par aucun repère de page
          (même audit que la <nav> ci-dessus). */}
      <main className="home__main">
      <div className="home__map">
        <StopSearchBar
          near={userLocation ?? center}
          onSelectStop={handleSelectFromSearch}
          onSelectCommune={handleSelectCommune}
        />
        {stops.isLoading && (
          <p className="home__status" role="status">
            <span className="spinner" aria-hidden="true" />
            Chargement des arrêts…
          </p>
        )}
        {stops.isError && (
          <p className="home__status home__status--error" role="alert">
            Erreur de chargement
            <button type="button" className="home__retry-btn" onClick={() => stops.refetch()}>
              Réessayer
            </button>
          </p>
        )}
        {stops.data && stops.data.count === 0 && !stops.isLoading && !stops.isError && (
          <p className="home__status" role="status">
            Aucun arrêt trouvé dans cette zone
          </p>
        )}
        {stops.data && (
          <StopsMap
            center={center}
            stops={stops.data.stops}
            onSelectStop={setSelectedStop}
            userLocation={userLocation}
            isLocating={isLocating}
            onRecenter={requestLocation}
            routeGeometry={routeGeometry}
            radiusCircleMeters={showRadiusCircle ? searchRadius : null}
            neighborhoods={showNeighborhoods ? neighborhoods : null}
            communes={showNeighborhoods ? communes : null}
            focusBounds={focusBounds}
            headingDeg={headingDeg}
          />
        )}
      </div>

      {/* Toujours rendu pour permettre la transition slide + fade via .is-open. */}
      <div
        className={`home__detail${selectedStop ? ' is-open' : ''}`}
        aria-hidden={selectedStop ? undefined : true}
      >
        {selectedStop && (
          <>
            <button
              className="home__detail-close"
              onClick={() => setSelectedStop(null)}
              aria-label="Fermer le détail de l'arrêt"
            >
              <XIcon width={18} height={18} aria-hidden="true" />
            </button>
            <div className="home__detail-title">
              <h2>{selectedStop.name ?? 'Arrêt sans nom'}</h2>
              <DetailFavoriteButton stop={selectedStop} />
              <RouteToStopButton
                key={selectedStop.id}
                stop={selectedStop}
                userLocation={userLocation}
                isLocating={isLocating}
                onRequestLocation={requestLocation}
                onGeometryChange={setRouteGeometry}
                onLivePositionChange={handleLivePosition}
                onHeadingChange={handleHeadingChange}
              />
              <ReportToStopButton key={`report-${selectedStop.id}`} stop={selectedStop} />
            </div>
            <p className="home__detail-meta">
              {STOP_TYPE_LABELS[selectedStop.stopType] ?? selectedStop.stopType}
              {userLocation && (
                <> · à {formatRouteDistance(haversineDistanceMeters(userLocation, selectedStop))} de vous</>
              )}
            </p>
            {selectedStop.lines.length > 0 ? (
              <>
                <p className="home__detail-meta">
                  {selectedStop.lines.length > 1
                    ? `Correspondance possible entre ${selectedStop.lines.length} lignes :`
                    : 'Ligne desservant cet arrêt :'}
                </p>
                <ul className="home__lines">
                  {selectedStop.lines.map((line) => (
                    <li key={line.id} style={{ borderColor: line.color ?? '#0A9396' }}>
                      {line.shortName ?? ''} {line.name}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="home__detail-meta">Aucune ligne connue desservant cet arrêt pour l'instant.</p>
            )}
            {/* Points d'intérêt à proximité (Overpass) — section clairement
                distincte des lignes de transport ci-dessus : ce ne sont pas
                des arrêts, jamais présentés comme tels. */}
            <p className="home__detail-meta home__detail-meta--pois">Aux alentours</p>
            {nearbyPois.isLoading && <p className="home__detail-meta">Recherche des lieux à proximité…</p>}
            {!nearbyPois.isLoading && nearbyPois.pois.length === 0 && (
              <p className="home__detail-meta">Rien de répertorié à proximité.</p>
            )}
            {nearbyPois.pois.length > 0 && (
              <ul className="home__pois">
                {nearbyPois.pois.slice(0, 6).map((poi, i) => (
                  <li key={i}>
                    <MapPinIcon width={12} height={12} aria-hidden="true" />
                    {poi.name}
                    <span className="home__pois-category">
                      {POI_CATEGORY_LABELS[poi.category] ?? poi.category}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {stops.data && (
        <p className="home__count">
          {stops.data.count} arrêt{stops.data.count > 1 ? 's' : ''} dans un rayon de{' '}
          <label className="home__radius-label">
            <span className="sr-only">Rayon de recherche</span>
            <select
              className="home__radius-select"
              value={searchRadius}
              onChange={(e) => setSearchRadius(Number(e.target.value))}
            >
              {SEARCH_RADIUS_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r >= 1000 ? `${r / 1000} km` : `${r} m`}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={`home__radius-toggle${showRadiusCircle ? ' is-active' : ''}`}
            onClick={() => setShowRadiusCircle((v) => !v)}
            aria-pressed={showRadiusCircle}
            title="Afficher le rayon de recherche sur la carte"
          >
            <TargetIcon width={16} height={16} aria-hidden="true" />
            <span className="sr-only">Afficher le rayon sur la carte</span>
          </button>
          <button
            type="button"
            className={`home__radius-toggle${showNeighborhoods ? ' is-active' : ''}`}
            onClick={() => setShowNeighborhoods((v) => !v)}
            aria-pressed={showNeighborhoods}
            title="Afficher les noms de quartiers sur la carte"
          >
            <MapPinIcon width={16} height={16} aria-hidden="true" />
            <span className="sr-only">Afficher les quartiers sur la carte</span>
          </button>
        </p>
      )}
      </main>
    </div>
  );
}

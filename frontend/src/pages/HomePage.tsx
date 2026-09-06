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
import { AuthStatus } from '@/components/AuthStatus';
import { StopsMap } from '@/components/StopsMap';
import {
  BikeIcon,
  CarIcon,
  FlagIcon,
  FootprintsIcon,
  LoaderIcon,
  RouteIcon,
  StarIcon,
  XIcon,
} from '@/components/icons';
import type { Stop } from '@/lib/api/types';

// Plateau, Abidjan — point de départ par défaut avant géolocalisation.
const DEFAULT_CENTER = { lat: 5.32, lon: -4.02 };

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
function RouteToStopButton({
  stop,
  userLocation,
  isLocating,
  onRequestLocation,
  onGeometryChange,
}: {
  stop: Stop;
  userLocation: { lat: number; lon: number } | null;
  isLocating: boolean;
  onRequestLocation: () => void;
  onGeometryChange: (geometry: RouteGeometry | null) => void;
}) {
  const route = useRoute();
  const [expanded, setExpanded] = useState(false);
  const [lastProfile, setLastProfile] = useState<RouteProfile | null>(null);

  function handleToggle() {
    if (expanded) {
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
      onGeometryChange(result.geometry);
    } catch {
      // L'erreur traduite est exposée via route.error, affichée ci-dessous.
      onGeometryChange(null);
    }
  }

  function handleClear() {
    onGeometryChange(null);
    route.reset();
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
            <p className="home__route-result" role="status">
              {formatRouteDistance(route.data.distanceMeters)} •{' '}
              {formatRouteDuration(route.data.durationSeconds)}
              <button type="button" className="home__route-clear" onClick={handleClear}>
                Effacer l’itinéraire
              </button>
            </p>
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
  const stops = useNearbyStops(center.lat, center.lon, 1500);
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
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
  useEffect(() => {
    setRouteGeometry(null);
  }, [selectedStop?.id]);

  // Bannière de succès brève : auto-disparition ~2s après connexion OK.
  useEffect(() => {
    if (!health.data || health.isError) return;
    setShowOkBanner(true);
    const timer = setTimeout(() => setShowOkBanner(false), 2000);
    return () => clearTimeout(timer);
  }, [health.data, health.isError]);

  return (
    <div className={`home${selectedStop ? ' has-detail' : ''}`}>
      {/* Bandeau discret d'état de connexion : la carte reste publique. */}
      <div className="home__topbar">
        <AuthStatus />
      </div>
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

      <div className="home__map">
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
              />
              <ReportToStopButton key={`report-${selectedStop.id}`} stop={selectedStop} />
            </div>
            <p>{selectedStop.stopType}</p>
            {selectedStop.lines.length > 0 && (
              <ul className="home__lines">
                {selectedStop.lines.map((line) => (
                  <li key={line.id} style={{ borderColor: line.color ?? '#0A9396' }}>
                    {line.shortName ?? ''} {line.name}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {stops.data && (
        <p className="home__count">
          {stops.data.count} arrêt{stops.data.count > 1 ? 's' : ''} dans un rayon de {stops.data.radius}m
        </p>
      )}
    </div>
  );
}

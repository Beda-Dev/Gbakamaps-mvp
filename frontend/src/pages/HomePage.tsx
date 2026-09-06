import { useCallback, useEffect, useState } from 'react';
import { useHealth } from '@/hooks/useHealth';
import { useNearbyStops } from '@/hooks/useNearbyStops';
import { StopsMap } from '@/components/StopsMap';
import { XIcon } from '@/components/icons';
import type { Stop } from '@/lib/api/types';

// Plateau, Abidjan — point de départ par défaut avant géolocalisation.
const DEFAULT_CENTER = { lat: 5.32, lon: -4.02 };

interface GeoCenter {
  lat: number;
  lon: number;
}

export function HomePage() {
  const health = useHealth();
  const [center, setCenter] = useState<GeoCenter>(DEFAULT_CENTER);
  const [userLocation, setUserLocation] = useState<GeoCenter | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [showOkBanner, setShowOkBanner] = useState(true);
  const stops = useNearbyStops(center.lat, center.lon, 1500);
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);

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

  // Bannière de succès brève : auto-disparition ~2s après connexion OK.
  useEffect(() => {
    if (!health.data || health.isError) return;
    setShowOkBanner(true);
    const timer = setTimeout(() => setShowOkBanner(false), 2000);
    return () => clearTimeout(timer);
  }, [health.data, health.isError]);

  return (
    <div className={`home${selectedStop ? ' has-detail' : ''}`}>
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
            <h2>{selectedStop.name ?? 'Arrêt sans nom'}</h2>
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

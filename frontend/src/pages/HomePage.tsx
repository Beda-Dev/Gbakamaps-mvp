import { useState } from 'react';
import { useHealth } from '@/hooks/useHealth';
import { useNearbyStops } from '@/hooks/useNearbyStops';
import { StopsMap } from '@/components/StopsMap';
import type { Stop } from '@/lib/api/types';

// Plateau, Abidjan — point de départ par défaut avant géolocalisation.
const DEFAULT_CENTER = { lat: 5.32, lon: -4.02 };

export function HomePage() {
  const health = useHealth();
  const stops = useNearbyStops(DEFAULT_CENTER.lat, DEFAULT_CENTER.lon, 1500);
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);

  return (
    <div className="home">
      <header className="home__banner">
        {health.isLoading && <span>Connexion au serveur…</span>}
        {health.isError && <span className="home__banner--error">⚠️ Serveur indisponible</span>}
        {health.data && <span className="home__banner--ok">✅ Connecté</span>}
      </header>

      <div className="home__map">
        {stops.isLoading && <p className="home__status">Chargement des arrêts…</p>}
        {stops.isError && <p className="home__status home__status--error">Erreur de chargement</p>}
        {stops.data && (
          <StopsMap center={DEFAULT_CENTER} stops={stops.data.stops} onSelectStop={setSelectedStop} />
        )}
      </div>

      {selectedStop && (
        <div className="home__detail">
          <button className="home__detail-close" onClick={() => setSelectedStop(null)}>
            ✕
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
        </div>
      )}

      {stops.data && (
        <p className="home__count">
          {stops.data.count} arrêt{stops.data.count > 1 ? 's' : ''} dans un rayon de {stops.data.radius}m
        </p>
      )}
    </div>
  );
}

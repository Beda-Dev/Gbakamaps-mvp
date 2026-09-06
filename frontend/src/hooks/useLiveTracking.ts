// =============================================================================
// Suivi GPS continu du PASSAGER pendant son propre déplacement (repère
// honnête le long du tracé calculé par useRoute — PAS du suivi de véhicule :
// aucune donnée GPS n'existe pour les gbaka/woro-woro, un seul marqueur, le
// point bleu de l'utilisateur déjà affiché par StopsMap).
//
// Distinct de la géolocalisation ponctuelle `getCurrentPosition` de HomePage
// (une seule mesure au chargement) : ici `watchPosition` en continu, avec
// arrêt propre (clearWatch) dans tous les chemins de sortie.
// =============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';

export interface LatLon {
  lat: number;
  lon: number;
}

export interface LivePosition extends LatLon {
  accuracy: number;
}

// Options imposées par la spec : haute précision, position réutilisable 5s,
// abandon après 15s sans fix.
export const LIVE_TRACKING_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 5000,
  timeout: 15000,
};

// Formule haversine standard (rayon terrestre 6 371 000 m) — sert à calculer
// la distance restante jusqu'à l'arrêt de destination.
export function haversineDistanceMeters(a: LatLon, b: LatLon): number {
  const R = 6371000;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function trackingErrorMessage(err: GeolocationPositionError): string {
  if (err.code === err.PERMISSION_DENIED)
    return "Permission de géolocalisation refusée. Autorisez l'accès à votre position pour suivre votre trajet.";
  if (err.code === err.TIMEOUT) return 'Délai de géolocalisation dépassé. Réessayez.';
  return 'Position indisponible. Réessayez.';
}

export function useLiveTracking() {
  const [position, setPosition] = useState<LivePosition | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Id du watch actif (null = aucun) — stocké en ref, jamais en état.
  const watchIdRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (watchIdRef.current !== null && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;
    setIsTracking(false);
  }, []);

  const start = useCallback(() => {
    if (!('geolocation' in navigator) || !navigator.geolocation) {
      setError("La géolocalisation n'est pas disponible sur cet appareil.");
      return;
    }
    // Redémarrage propre : jamais deux watch simultanés.
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setError(null);
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setIsTracking(true);
        setError(null);
      },
      (err) => {
        setError(trackingErrorMessage(err));
        setIsTracking(false);
      },
      LIVE_TRACKING_OPTIONS,
    );
    watchIdRef.current = id;
    setIsTracking(true);
  }, []);

  // Nettoyage automatique au démontage : jamais de watch orphelin qui
  // continuerait de tourner (et de consommer la batterie) après qu'on a
  // quitté l'écran.
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  return { position, isTracking, error, start, stop };
}

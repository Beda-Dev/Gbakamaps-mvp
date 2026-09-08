// =============================================================================
// Cap de l'appareil (boussole) pour "Suivre mon trajet" — PROJECT_MEMORY.md
// §9/§12.8, demande explicite de l'utilisateur.
//
// Deux APIs distinctes selon la plateforme, vérifiées dans la doc MDN/specs
// (pas testables en émulation matérielle réelle dans cet environnement —
// aucun gyroscope/magnétomètre physique disponible pour un vrai test sur
// device ; ce hook a été vérifié par lecture de code + détection de
// fonctionnalités réelles dans un vrai navigateur, jamais supposé) :
//
// - iOS Safari (13+) : `DeviceOrientationEvent.requestPermission()` DOIT être
//   appelée depuis un geste utilisateur explicite (clic), sinon la
//   permission est refusée silencieusement — pas d'appel automatique au
//   montage. L'événement `deviceorientation` expose alors
//   `event.webkitCompassHeading` (cap vrai, déjà relatif au nord, 0-360,
//   PAS besoin d'inverser comme `alpha`).
// - Android / autres navigateurs : pas de permission séparée nécessaire
//   pour l'orientation (contrairement à la géolocalisation). L'événement
//   `deviceorientationabsolute` (quand disponible) expose `alpha` déjà
//   calé sur le nord magnétique. À défaut, on retombe sur
//   `deviceorientation` + `alpha` (peut dériver sans calibration, mais
//   c'est la seule donnée disponible sur certains appareils/navigateurs).
// - Desktop / appareils sans capteur : aucun événement ne se déclenche
//   jamais — `heading` reste `null` indéfiniment, `isSupported` reste basé
//   sur la seule PRÉSENCE de l'API (`'DeviceOrientationEvent' in window`,
//   vraie même sur desktop Chrome) : la vraie disponibilité ne se confirme
//   qu'à la réception du premier événement (`hasReceivedData`).
//
// Le composant appelant DOIT toujours prévoir le cas `heading === null`
// (pas de capteur, permission refusée, ou événement jamais reçu) — voir
// `bearingBetween()` plus bas, un repli purement mathématique (cap calculé
// vers une destination connue, toujours disponible dès qu'on a deux points
// GPS, indépendant de tout capteur physique).
// =============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';

export type OrientationPermissionState = 'unknown' | 'granted' | 'denied' | 'unnecessary';

interface DeviceOrientationEventWithHeading extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
}

// Certains navigateurs (Safari iOS) exposent `requestPermission` comme
// méthode STATIQUE sur le constructeur — absente ailleurs. Vérifié réel :
// `typeof DeviceOrientationEvent.requestPermission === 'function'` est le
// seul test fiable, jamais un sniff de user-agent.
function needsExplicitPermission(): boolean {
  return (
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> })
      .requestPermission === 'function'
  );
}

export function useDeviceOrientation() {
  const [heading, setHeading] = useState<number | null>(null);
  const [hasReceivedData, setHasReceivedData] = useState(false);
  const [permission, setPermission] = useState<OrientationPermissionState>('unknown');
  const activeRef = useRef(false);

  // Présence de l'API dans le navigateur — ne garantit PAS un capteur
  // physique fonctionnel (desktop Chrome expose la classe sans jamais
  // émettre d'événement réel), seulement que ça vaut la peine d'essayer.
  const isSupported = typeof DeviceOrientationEvent !== 'undefined';

  const handleEvent = useCallback((event: Event) => {
    const e = event as DeviceOrientationEventWithHeading;
    // iOS : cap vrai déjà fourni, jamais recalculé depuis `alpha` (qui sur
    // iOS n'est pas calé sur le nord de la même façon).
    if (typeof e.webkitCompassHeading === 'number') {
      setHeading(e.webkitCompassHeading);
      setHasReceivedData(true);
      return;
    }
    // Android/`deviceorientationabsolute` (ou repli `deviceorientation`) :
    // `alpha` est l'angle depuis le nord dans le sens ANTI-horaire côté
    // spec DOM — converti en cap boussole (sens horaire depuis le nord).
    if (typeof e.alpha === 'number') {
      setHeading((360 - e.alpha) % 360);
      setHasReceivedData(true);
    }
  }, []);

  const attachListeners = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current = true;
    // `deviceorientationabsolute` : cap vraiment calé sur le nord quand le
    // navigateur le supporte (Chrome Android) — préféré à `deviceorientation`
    // seul, qui peut dériver sans jamais se recaler.
    window.addEventListener('deviceorientationabsolute', handleEvent as EventListener);
    window.addEventListener('deviceorientation', handleEvent as EventListener);
  }, [handleEvent]);

  const detachListeners = useCallback(() => {
    activeRef.current = false;
    window.removeEventListener('deviceorientationabsolute', handleEvent as EventListener);
    window.removeEventListener('deviceorientation', handleEvent as EventListener);
  }, [handleEvent]);

  // À appeler UNIQUEMENT depuis un gestionnaire de clic (geste utilisateur
  // explicite) — un appel automatique au montage échoue silencieusement sur
  // iOS 13+ (spec WebKit, pas une supposition).
  const requestPermission = useCallback(async () => {
    if (!needsExplicitPermission()) {
      // Android/desktop : rien à demander, on peut écouter directement.
      setPermission('unnecessary');
      attachListeners();
      return true;
    }
    try {
      const result = await (
        DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }
      ).requestPermission();
      if (result === 'granted') {
        setPermission('granted');
        attachListeners();
        return true;
      }
      setPermission('denied');
      return false;
    } catch {
      setPermission('denied');
      return false;
    }
  }, [attachListeners]);

  // Pas d'attache automatique au montage : même sur Android/desktop où
  // aucune permission n'est requise, on n'écoute que si l'appelant le
  // demande explicitement (via requestPermission(), appelée par exemple au
  // clic sur "Suivre mon trajet") — pas de capteur qui tourne en arrière-plan
  // tant que le suivi n'est pas réellement demandé.
  useEffect(() => {
    return () => detachListeners();
  }, [detachListeners]);

  return {
    heading,
    hasReceivedData,
    isSupported,
    permission,
    needsExplicitPermission: needsExplicitPermission(),
    requestPermission,
    stop: detachListeners,
  };
}

// Cap calculé (grand cercle) d'un point vers un autre — toujours disponible
// dès qu'on a deux coordonnées GPS, indépendant de tout capteur physique.
// Repli honnête quand `heading` du hook ci-dessus reste `null` (pas de
// capteur, permission refusée, ou appareil desktop) : on peut toujours dire
// "la destination est à Nord-Est de vous", jamais un cap deviné.
export function bearingBetween(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLon = toRad(to.lon - from.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Libellé cardinal FR pour un cap — repli textuel simple quand on ne veut
// pas afficher une flèche graphique (ex. lecteur d'écran).
const CARDINAL_LABELS = ['Nord', 'Nord-Est', 'Est', 'Sud-Est', 'Sud', 'Sud-Ouest', 'Ouest', 'Nord-Ouest'];
export function cardinalLabel(bearingDeg: number): string {
  const index = Math.round(((bearingDeg % 360) + 360) % 360 / 45) % 8;
  return CARDINAL_LABELS[index];
}

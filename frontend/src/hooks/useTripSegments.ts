// =============================================================================
// Segments RÉELS (suivant les routes) du plan de trajet actuellement déplié,
// pour l'affichage sur la carte (TripPlannerPage.tsx). Remplace les lignes
// droites précédentes (buildTripSegments, StopsMap.tsx TripSegment) par un
// vrai tracé routier — bug produit réel signalé par l'utilisateur le
// 2026-09-08 : une ligne droite entre deux arrêts réels du Plateau/Cocody
// traverse visuellement la lagune, alors que le bus emprunte évidemment les
// ponts/routes existants.
//
// Toujours honnête malgré l'amélioration : ce tracé suit les VRAIES routes
// (via le même service ORS/GraphHopper déjà utilisé pour "Itinéraire vers
// cet arrêt"), mais reste une approximation du trajet du véhicule — on n'a
// toujours pas le tracé GTFS réel de la ligne (shapes.txt absent des
// données JungleBus, §12.7bis). Si un segment échoue à être routé
// (service indisponible, aucun itinéraire trouvé), repli sur la ligne
// droite pour CE segment précis plutôt que de faire échouer tout
// l'affichage — jamais un trajet à moitié dessiné qui semblerait cassé.
// =============================================================================
import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import type { TripPlan, TripCoordinates } from '@/hooks/useTripPlan';
import type { TripSegment } from '@/components/StopsMap';

interface RouteApiData {
  routes: { geometry: { coordinates: [number, number][] } }[];
}

function toLatLonParam(c: TripCoordinates): string {
  return `${c.lat},${c.lon}`;
}

// Une ligne droite [ [lon,lat], [lon,lat] ] — repli identique à l'ancien
// comportement, utilisé uniquement quand le routage réel échoue.
function straightLine(from: TripCoordinates, to: TripCoordinates): [number, number][] {
  return [[from.lon, from.lat], [to.lon, to.lat]];
}

async function fetchRoadGeometry(
  from: TripCoordinates,
  to: TripCoordinates,
  profile: 'driving-car' | 'foot-walking'
): Promise<[number, number][]> {
  try {
    const params = new URLSearchParams({
      from: toLatLonParam(from),
      to: toLatLonParam(to),
      profile,
      alternatives: 'false',
    });
    const data = await api.get<RouteApiData>(`/route?${params.toString()}`);
    const coords = data.routes[0]?.geometry?.coordinates;
    return coords && coords.length > 1 ? coords : straightLine(from, to);
  } catch {
    // Service de routage indisponible ou aucun itinéraire trouvé pour ce
    // segment précis — repli honnête sur la ligne droite, jamais un segment
    // manquant qui casserait visuellement le reste du tracé.
    return straightLine(from, to);
  }
}

interface TripSegmentsResult {
  segments: TripSegment[] | null;
  isLoading: boolean;
}

export function useTripSegments(
  plan: TripPlan | null,
  origin: TripCoordinates | null,
  destination: TripCoordinates | null
): TripSegmentsResult {
  const [segments, setSegments] = useState<TripSegment[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!plan || !origin || !destination) {
      setSegments(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    (async () => {
      let cursor: TripCoordinates = origin;
      const built: TripSegment[] = [];

      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        if (step.type === 'ride' && step.boardStop && step.alightStop) {
          const coords = await fetchRoadGeometry(step.boardStop, step.alightStop, 'driving-car');
          built.push({ kind: 'ride', coordinates: coords, color: step.line?.color ?? '#0A9396' });
          cursor = step.alightStop;
          continue;
        }
        // Marche : point d'arrivée = arrêt de montée de la prochaine étape
        // "ride", sinon la destination finale (dernière étape du plan) —
        // même logique que l'ancien buildTripSegments synchronisée.
        const nextRide = plan.steps.slice(i + 1).find((s) => s.type === 'ride');
        const next: TripCoordinates = nextRide?.boardStop ?? destination;
        const coords = await fetchRoadGeometry(cursor, next, 'foot-walking');
        built.push({ kind: 'walk', coordinates: coords });
        cursor = next;
      }

      if (!cancelled) {
        setSegments(built);
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [plan, origin, destination]);

  return { segments, isLoading };
}

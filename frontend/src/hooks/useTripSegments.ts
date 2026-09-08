// =============================================================================
// Segments du plan de trajet actuellement déplié, pour l'affichage sur la
// carte (TripPlannerPage.tsx).
//
// Deux sources de tracé pour une étape "ride", par ordre de préférence :
//   1. Le tracé RÉEL de la ligne (TransportLine.shapeGeoJson), importé depuis
//      le jeu de données officiel data.gouv.ci "Lignes de transport à
//      Abidjan" (backend/src/scripts/import-line-shapes.ts, 2026-09-08 —
//      suite à la remarque de l'utilisateur "OI MAIS overpass motre le
//      tracer des trajet de bus" : la source existe bel et bien, on
//      l'exploite). On en extrait la portion entre l'arrêt de montée et
//      l'arrêt de descente en cherchant leurs points les plus proches sur le
//      tracé — jamais un tracé de ligne DIFFÉRENTE ni un bout inventé : si
//      l'un des deux arrêts est trop loin du tracé connu (RIDE_SNAP_MAX_M),
//      on ne fait pas confiance à cette extraction et on tombe au point 2.
//   2. Un tracé routier calculé à la volée via /api/route (ORS/GraphHopper,
//      même service que "Itinéraire vers cet arrêt") — approximation
//      plausible mais pas le vrai trajet du véhicule. C'était jusqu'ici la
//      SEULE source (bug produit réel du 2026-09-08 : une ligne droite,
//      remplacée ce jour-là par ce même appel routier, traversait
//      visuellement la lagune).
//
// Les segments de marche utilisent toujours le routage piéton (aucune
// donnée de "tracé de trottoir réel" équivalente n'existe pour la marche).
// =============================================================================
import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import type { TripPlan, TripCoordinates, TripStep } from '@/hooks/useTripPlan';
import type { TripSegment } from '@/components/StopsMap';

interface RouteApiData {
  routes: { geometry: { coordinates: [number, number][] } }[];
}

interface LineShapeData {
  shapeGeoJson: { type: string; coordinates: unknown } | null;
  shapeSource: string | null;
}

// Distance max (mètres) entre un arrêt et le point le plus proche du tracé
// officiel de la ligne pour qu'on lui fasse confiance. Au-delà, le tracé
// connu ne dessert vraisemblablement pas cet arrêt précis (variante de
// direction différente, portion manquante) — mieux vaut un repli routier
// honnête qu'une extraction qui semblerait fausse sur la carte.
const RIDE_SNAP_MAX_M = 350;

function toLatLonParam(c: TripCoordinates): string {
  return `${c.lat},${c.lon}`;
}

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

// Distance approximative en mètres entre deux points [lon,lat] — équirectangulaire,
// largement suffisante à l'échelle d'un arrêt de bus (pas de calcul de route).
function approxDistanceMeters(a: [number, number], b: [number, number]): number {
  const R = 6_371_000;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Aplatit un MultiLineString en une seule polyligne "la plus longue et la
// plus proche des deux arrêts" — les tracés source contiennent parfois
// plusieurs sous-lignes (branches, aller/retour physiquement séparés) ;
// pour chaque sous-ligne, on vérifie si LES DEUX arrêts s'y projettent à
// une distance acceptable et on choisit la meilleure. Ne recombine jamais
// deux sous-lignes différentes entre elles (ce serait inventer une jonction).
export function extractRideSegment(
  shape: { type: string; coordinates: unknown },
  from: TripCoordinates,
  to: TripCoordinates
): [number, number][] | null {
  if (shape.type !== 'MultiLineString' && shape.type !== 'LineString') return null;
  const lines: [number, number][][] =
    shape.type === 'LineString'
      ? [shape.coordinates as [number, number][]]
      : (shape.coordinates as [number, number][][]);

  const fromPt: [number, number] = [from.lon, from.lat];
  const toPt: [number, number] = [to.lon, to.lat];

  let best: { coords: [number, number][]; score: number } | null = null;

  for (const line of lines) {
    if (line.length < 2) continue;
    let fromIdx = -1;
    let fromDist = Infinity;
    let toIdx = -1;
    let toDist = Infinity;
    line.forEach((pt, idx) => {
      const df = approxDistanceMeters(pt, fromPt);
      if (df < fromDist) {
        fromDist = df;
        fromIdx = idx;
      }
      const dt = approxDistanceMeters(pt, toPt);
      if (dt < toDist) {
        toDist = dt;
        toIdx = idx;
      }
    });

    if (fromDist > RIDE_SNAP_MAX_M || toDist > RIDE_SNAP_MAX_M) continue;
    if (fromIdx === toIdx) continue;

    const segment =
      fromIdx < toIdx
        ? line.slice(fromIdx, toIdx + 1)
        : line.slice(toIdx, fromIdx + 1).reverse();

    const score = fromDist + toDist;
    if (!best || score < best.score) {
      best = { coords: segment, score };
    }
  }

  return best?.coords ?? null;
}

const lineShapeCache = new Map<string, Promise<LineShapeData | null>>();

function fetchLineShape(lineId: string): Promise<LineShapeData | null> {
  let cached = lineShapeCache.get(lineId);
  if (!cached) {
    cached = api
      .get<LineShapeData>(`/lines/${lineId}`)
      .catch(() => null);
    lineShapeCache.set(lineId, cached);
  }
  return cached;
}

async function buildRideSegment(step: TripStep): Promise<[number, number][]> {
  const { boardStop, alightStop, line } = step;
  if (!boardStop || !alightStop) return [];

  if (line?.id) {
    const shapeData = await fetchLineShape(line.id);
    if (shapeData?.shapeGeoJson) {
      const extracted = extractRideSegment(shapeData.shapeGeoJson, boardStop, alightStop);
      if (extracted) return extracted;
    }
  }

  return fetchRoadGeometry(boardStop, alightStop, 'driving-car');
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
          const coords = await buildRideSegment(step);
          built.push({
            kind: 'ride',
            coordinates: coords.length > 1 ? coords : straightLine(step.boardStop, step.alightStop),
            color: step.line?.color ?? '#0A9396',
          });
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

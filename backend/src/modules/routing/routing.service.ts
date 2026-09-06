// =============================================================================
// Logique métier du module routing — proxy vers OpenRouteService.
//
// Remplace OSRM (serveur démo public router.project-osrm.org) : vérifié
// empiriquement, sur deux trajets différents à Abidjan, que ce serveur
// renvoie EXACTEMENT la même distance/durée quel que soit le profil demandé
// (driving/foot/bike) — malgré sa documentation affirmant le contraire, il
// ne route en réalité que sur un seul graphe. OpenRouteService (HeiGIT,
// université de Heidelberg) calcule des itinéraires réellement distincts
// par profil, avec un quota clair (~2000-2500 requêtes/jour gratuites,
// compte requis sans carte bancaire — même friction que MapTiler).
// Référence API vérifiée : https://api.openrouteservice.org/v2/directions/
// =============================================================================
import { env } from '../../config/env.js';
import { AppError } from '../../common/errors.js';
import type { Coordinates, RouteProfile } from './routing.schemas.js';

const REQUEST_TIMEOUT_MS = 10_000;

export class RouteNotFoundError extends AppError {
  constructor() {
    super('Aucun itinéraire trouvé entre ces points', 422, 'NO_ROUTE');
  }
}

export class RoutingServiceError extends AppError {
  constructor(detail?: string) {
    super('Service de calcul d\'itinéraire indisponible', 503, 'ROUTING_SERVICE_ERROR', detail);
  }
}

// Réponse GeoJSON d'ORS (POST /v2/directions/{profile}/geojson) : une
// FeatureCollection, chaque feature étant un itinéraire (LineString) avec
// ses métriques dans properties.summary.
interface OrsGeoJsonResponse {
  type: string;
  features: Array<{
    type: string;
    geometry: { type: string; coordinates: [number, number][] };
    properties: {
      summary: { distance: number; duration: number };
    };
  }>;
  error?: { code: number; message: string };
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  geometry: { type: string; coordinates: [number, number][] };
}

export async function computeRoute(
  from: Coordinates,
  to: Coordinates,
  profile: RouteProfile,
  alternatives: boolean
): Promise<{ routes: RouteResult[] }> {
  const url = `${env.ORS_BASE_URL}/v2/directions/${profile}/geojson`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: env.ORS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        coordinates: [
          [from.lon, from.lat],
          [to.lon, to.lat],
        ],
        ...(alternatives
          ? { alternative_routes: { target_count: 2, weight_factor: 1.4 } }
          : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new RoutingServiceError(err instanceof Error ? err.message : 'fetch failed');
  }

  const data = (await response.json().catch(() => null)) as OrsGeoJsonResponse | null;

  if (!response.ok || !data) {
    // ORS renvoie un code d'erreur explicite (ex: 2010 = pas d'itinéraire
    // trouvable) — on le distingue d'une vraie panne de service.
    if (data?.error?.code === 2010 || data?.error?.code === 2004) {
      throw new RouteNotFoundError();
    }
    throw new RoutingServiceError(data?.error?.message ?? `ORS HTTP ${response.status}`);
  }

  if (!data.features || data.features.length === 0) {
    throw new RouteNotFoundError();
  }

  return {
    routes: data.features.map((feature) => ({
      distanceMeters: feature.properties.summary.distance,
      durationSeconds: feature.properties.summary.duration,
      geometry: feature.geometry,
    })),
  };
}

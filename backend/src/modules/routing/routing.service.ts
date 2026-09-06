// =============================================================================
// Logique métier du module routing — proxy vers OSRM (routage réel).
//
// Décision volontaire : un seul profil exposé ("driving"), pas de choix
// walking/cycling. Vérifié empiriquement contre le serveur démo public
// (router.project-osrm.org) : les trois profils renvoient EXACTEMENT la
// même distance/durée sur un même trajet, preuve que ce serveur ne route
// en réalité que sur le graphe voiture. Exposer un choix de mode à
// l'utilisateur serait donc trompeur (temps de marche affiché = temps en
// voiture). Corrigible en V2 en pointant vers une instance OSRM
// auto-hébergée avec les profils walking/cycling réellement configurés.
// =============================================================================
import { env } from '../../config/env.js';
import { AppError } from '../../common/errors.js';
import type { Coordinates } from './routing.schemas.js';

const OSRM_PROFILE = 'driving';
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

interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: { type: string; coordinates: [number, number][] };
}

interface OsrmResponse {
  code: string;
  message?: string;
  routes: OsrmRoute[];
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  geometry: { type: string; coordinates: [number, number][] };
}

export async function computeRoute(
  from: Coordinates,
  to: Coordinates,
  alternatives: boolean
): Promise<{ routes: RouteResult[] }> {
  const coordinates = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const params = new URLSearchParams({
    overview: 'full',
    geometries: 'geojson',
    alternatives: alternatives ? 'true' : 'false',
  });
  const url = `${env.OSRM_URL}/route/v1/${OSRM_PROFILE}/${coordinates}?${params}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': 'GbakaMap-MVP/1.0' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new RoutingServiceError(err instanceof Error ? err.message : 'fetch failed');
  }

  if (!response.ok) {
    throw new RoutingServiceError(`OSRM HTTP ${response.status}`);
  }

  const data = (await response.json()) as OsrmResponse;

  if (data.code === 'NoRoute') {
    throw new RouteNotFoundError();
  }

  if (data.code !== 'Ok' || data.routes.length === 0) {
    throw new RoutingServiceError(data.message ?? data.code);
  }

  return {
    routes: data.routes.map((route) => ({
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      geometry: route.geometry,
    })),
  };
}

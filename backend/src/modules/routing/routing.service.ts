// =============================================================================
// Logique métier du module routing — chaîne de fournisseurs avec repli
// automatique : OpenRouteService (clé 1) → OpenRouteService (clé 2, si
// configurée) → GraphHopper (si configuré). Jamais de blocage silencieux :
// si un fournisseur échoue pour une raison transitoire (réseau, quota,
// limite de débit, 5xx), le suivant est tenté avant d'abandonner.
//
// Historique : remplace OSRM (serveur démo public router.project-osrm.org) —
// vérifié empiriquement, sur deux trajets différents à Abidjan, que ce
// serveur renvoie EXACTEMENT la même distance/durée quel que soit le profil
// demandé (driving/foot/bike) — malgré sa documentation affirmant le
// contraire, il ne route en réalité que sur un seul graphe. C'est pourquoi
// OSRM n'est PAS utilisé comme fournisseur de repli ici, malgré sa
// disponibilité sans clé : un résultat rapide mais trompeur est pire qu'un
// échec clair.
//
// Fallback multi-clés ajouté le 2026-09-06 : une seule clé ORS a montré des
// 503 ("fetch failed") pendant des tests automatisés répétés en quelques
// minutes, alors que des appels curl isolés juste après réussissaient —
// signe d'une limite de débit PAR MINUTE (pas d'incident, pas un quota
// journalier épuisé) que deux clés absorbent sans jamais bloquer
// l'utilisateur.
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

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  geometry: { type: string; coordinates: [number, number][] };
}

// Erreur interne (jamais renvoyée telle quelle au client) : signale à
// `computeRoute` qu'un fournisseur a échoué pour une raison qui justifie
// d'essayer le suivant, plutôt que d'abandonner immédiatement.
class ProviderFailure extends Error {}

// -----------------------------------------------------------------------------
// Fournisseur 1 : OpenRouteService (une tentative par clé fournie).
// -----------------------------------------------------------------------------
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

async function callOrs(
  apiKey: string,
  from: Coordinates,
  to: Coordinates,
  profile: RouteProfile,
  alternatives: boolean
): Promise<RouteResult[]> {
  const url = `${env.ORS_BASE_URL}/v2/directions/${profile}/geojson`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: apiKey,
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
    throw new ProviderFailure(err instanceof Error ? err.message : 'fetch failed');
  }

  const data = (await response.json().catch(() => null)) as OrsGeoJsonResponse | null;

  if (!response.ok || !data) {
    // Codes ORS explicites de "pas d'itinéraire trouvable" : une VRAIE
    // réponse métier, pas une panne — ne pas retenter un autre fournisseur,
    // le résultat serait le même (les points sont hors réseau routable).
    if (data?.error?.code === 2010 || data?.error?.code === 2004) {
      throw new RouteNotFoundError();
    }
    // 401/403 (clé invalide/quota épuisé), 429 (limite de débit), 5xx
    // (panne) : toutes des raisons de tenter le fournisseur suivant.
    throw new ProviderFailure(data?.error?.message ?? `ORS HTTP ${response.status}`);
  }

  if (!data.features || data.features.length === 0) {
    throw new RouteNotFoundError();
  }

  return data.features.map((feature) => ({
    distanceMeters: feature.properties.summary.distance,
    durationSeconds: feature.properties.summary.duration,
    geometry: feature.geometry,
  }));
}

// -----------------------------------------------------------------------------
// Fournisseur 2 (repli final) : GraphHopper — distingue réellement les
// profils voiture/vélo/marche (contrairement à OSRM démo, jamais utilisé ici
// pour cette raison). Optionnel : n'est tenté que si GRAPHHOPPER_API_KEY est
// configurée.
// -----------------------------------------------------------------------------
// Noms de profils vérifiés contre la vraie spec OpenAPI GraphHopper
// (openapi.json fourni par l'utilisateur le 2026-09-06, section "Map Data
// and Routing Profiles") — le paramètre de requête s'appelle `profile`,
// PAS `vehicle` (nom d'une version antérieure de leur API, erreur trouvée
// et corrigée grâce à cette vérification contre la doc officielle réelle).
const GRAPHHOPPER_PROFILE: Record<RouteProfile, string> = {
  'driving-car': 'car',
  'cycling-regular': 'bike',
  'foot-walking': 'foot',
};

interface GraphHopperResponse {
  paths?: Array<{
    distance: number;
    time: number; // millisecondes
    points: { type: string; coordinates: [number, number][] };
  }>;
  message?: string;
}

async function callGraphHopper(
  apiKey: string,
  from: Coordinates,
  to: Coordinates,
  profile: RouteProfile
): Promise<RouteResult[]> {
  const params = new URLSearchParams({
    profile: GRAPHHOPPER_PROFILE[profile],
    points_encoded: 'false',
    locale: 'fr',
    key: apiKey,
  });
  params.append('point', `${from.lat},${from.lon}`);
  params.append('point', `${to.lat},${to.lon}`);

  let response: Response;
  try {
    response = await fetch(`${env.GRAPHHOPPER_BASE_URL}/route?${params.toString()}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ProviderFailure(err instanceof Error ? err.message : 'fetch failed');
  }

  const data = (await response.json().catch(() => null)) as GraphHopperResponse | null;

  if (!response.ok || !data) {
    throw new ProviderFailure(data?.message ?? `GraphHopper HTTP ${response.status}`);
  }

  if (!data.paths || data.paths.length === 0) {
    throw new RouteNotFoundError();
  }

  return data.paths.map((path) => ({
    distanceMeters: path.distance,
    durationSeconds: path.time / 1000,
    geometry: path.points,
  }));
}

// -----------------------------------------------------------------------------
// Orchestration : tente chaque fournisseur configuré dans l'ordre, s'arrête
// au premier succès OU au premier échec définitif (pas de route trouvable —
// inutile d'interroger un autre fournisseur pour le même résultat). N'abandonne
// avec une erreur que si TOUS les fournisseurs configurés ont échoué pour une
// raison transitoire.
// -----------------------------------------------------------------------------
export async function computeRoute(
  from: Coordinates,
  to: Coordinates,
  profile: RouteProfile,
  alternatives: boolean
): Promise<{ routes: RouteResult[] }> {
  const orsKeys = [env.ORS_API_KEY, env.ORS_API_KEY_2].filter(
    (key): key is string => !!key
  );

  const failures: string[] = [];

  for (const [index, key] of orsKeys.entries()) {
    try {
      const routes = await callOrs(key, from, to, profile, alternatives);
      return { routes };
    } catch (err) {
      if (err instanceof RouteNotFoundError) throw err;
      failures.push(`ORS(${index + 1}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (env.GRAPHHOPPER_API_KEY) {
    try {
      const routes = await callGraphHopper(env.GRAPHHOPPER_API_KEY, from, to, profile);
      return { routes };
    } catch (err) {
      if (err instanceof RouteNotFoundError) throw err;
      failures.push(`GraphHopper: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new RoutingServiceError(failures.join(' | '));
}

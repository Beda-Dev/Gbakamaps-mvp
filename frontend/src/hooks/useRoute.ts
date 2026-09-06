// =============================================================================
// Calcul d'itinéraire : une MUTATION (pas une query automatique) — le calcul
// est déclenché explicitement par l'utilisateur (clic sur un profil
// Voiture/Vélo/Marche), jamais à chaque mouvement de carte ou frappe.
// Backend : GET /api/route?from=lat,lon&to=lat,lon&profile=…&alternatives=…
// =============================================================================
import { useMutation } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api/client';

// Profils OpenRouteService exposés par le backend (cf. routeProfileEnum).
export type RouteProfile = 'driving-car' | 'foot-walking' | 'cycling-regular';

export interface RouteCoordinates {
  lat: number;
  lon: number;
}

export interface RouteGeometry {
  type: string;
  coordinates: [number, number][];
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  geometry: RouteGeometry;
}

export interface ComputeRouteInput {
  from: RouteCoordinates;
  to: RouteCoordinates;
  profile: RouteProfile;
}

interface RouteApiData {
  routes: RouteResult[];
}

// Traduction des statuts d'erreur API en messages clairs (même esprit que
// lib/auth-messages.ts : le backend reste la source de vérité, on reformule).
export function routeErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    // 422 NO_ROUTE : aucun itinéraire trouvable — message métier, pas technique.
    if (err.status === 422) return 'Aucun itinéraire trouvé entre ces points.';
    // 503 : le service externe (OpenRouteService) est indisponible.
    if (err.status === 503)
      return "Service de calcul d'itinéraire indisponible, réessayez plus tard.";
    // 400 : validation (ex. coordonnées hors zone de service Côte d'Ivoire).
    // Le message brut du backend est générique ("Validation failed", détail
    // dans `details`) — on affiche un message actionnable à la place.
    if (err.status === 400)
      return 'Coordonnées invalides ou hors de la zone de service (Côte d’Ivoire).';
    return `Une erreur est survenue (${err.status}). Réessayez.`;
  }
  return 'Serveur injoignable. Vérifiez votre connexion puis réessayez.';
}

// L'API attend des strings "lat,lon" — construites ici depuis les objets
// { lat, lon } manipulés partout ailleurs dans le frontend.
export function toLatLonParam(coords: RouteCoordinates): string {
  return `${coords.lat},${coords.lon}`;
}

function buildRoutePath({ from, to, profile }: ComputeRouteInput): string {
  const params = new URLSearchParams({
    from: toLatLonParam(from),
    to: toLatLonParam(to),
    profile,
    alternatives: 'false',
  });
  return `/route?${params.toString()}`;
}

export function useRoute() {
  const mutation = useMutation({
    mutationFn: async (input: ComputeRouteInput): Promise<RouteResult> => {
      const data = await api.get<RouteApiData>(buildRoutePath(input));
      const first = data.routes[0];
      if (!first) {
        // Garde-fou : un 200 sans itinéraire équivaut à un NO_ROUTE.
        throw new ApiError('Aucun itinéraire trouvé entre ces points.', 422, 'NO_ROUTE');
      }
      return first;
    },
    retry: false,
  });

  return {
    compute: mutation.mutateAsync,
    isPending: mutation.isPending,
    // Message prêt à afficher (string | null) — pas l'erreur brute.
    error: mutation.error ? routeErrorMessage(mutation.error) : null,
    errorRaw: mutation.error,
    data: mutation.data,
    reset: mutation.reset,
  };
}

// --- Formatage affiché dans le panneau détail (conventions françaises). -----

export function formatRouteDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`;
  }
  return `${Math.round(meters)} m`;
}

export function formatRouteDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}min`;
}

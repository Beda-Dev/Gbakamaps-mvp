// =============================================================================
// Types partagés avec les réponses backend.
// Note : dupliqués manuellement pour l'instant (pas de package
// packages/shared-types branché) — à factoriser si la duplication
// devient un problème réel, pas avant.
// =============================================================================
export interface HealthData {
  status: string;
  timestamp: string;
}

export type TransportType = 'BUS' | 'GBAKA' | 'WORO_WORO' | 'TAXI' | 'MOTO_TAXI';

export interface Line {
  id: string;
  name: string;
  shortName: string | null;
  color: string | null;
  transportType: TransportType;
  fare: number | null;
}

export interface Stop {
  id: string;
  name: string | null;
  lat: number;
  lon: number;
  stopType: string;
  verified: boolean;
  gbaka: boolean;
  woroworo: boolean;
  taxi: boolean;
  mototaxi: boolean;
  lines: Line[];
  distanceMeters?: number;
}

export interface NearbyStopsData {
  stops: Stop[];
  count: number;
  radius: number;
}

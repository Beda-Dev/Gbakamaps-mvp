// =============================================================================
// Planificateur de trajet multi-modal — s'appuie enfin sur le graphe GTFS
// réel des lignes (arrêts ordonnés par sens, temps relatif entre arrêts,
// cf. import-gtfs.ts réécrit le 2026-09-06) plutôt que sur un simple
// point-à-point piéton/voiture (routing.service.ts, qui reste utilisé pour
// le calcul "aller à CET arrêt précis" existant, inchangé).
//
// Portée assumée de cette première version (documentée, pas cachée) :
//   - Trajets directs (0 correspondance) et à 1 correspondance MAXIMUM.
//   - Une correspondance suppose un changement de ligne au MÊME arrêt
//     physique (pas de marche entre deux arrêts proches de lignes
//     différentes) — cas réel le plus fréquent pour les gares/terminus,
//     mais pas exhaustif. Amélioration documentée pour une version future.
//   - Le temps de marche est estimé (vitesse standard 5 km/h + facteur de
//     détour 1,3 — valeurs usuelles de planification piétonne, PAS des
//     mesures spécifiques à Abidjan) plutôt que d'appeler OpenRouteService
//     par candidat (éviterait de multiplier les appels externes pour un
//     simple filtrage de candidats — cf. incident de limite de débit ORS,
//     PROJECT_MEMORY.md §12.5). Le calcul ORS existant reste disponible
//     séparément pour un itinéraire piéton précis vers UN arrêt choisi.
//   - Le temps de trajet en ligne utilise le temps relatif réel tiré des
//     horaires GTFS 2021 (secondsFromRouteStart) quand disponible — feuille
//     de route obsolète en absolu mais l'écart RELATIF entre deux arrêts
//     reste une estimation raisonnable. Repli sur une estimation par
//     distance à vol d'oiseau si l'un des deux arrêts n'a pas de temps
//     renseigné (variante de trajet secondaire, ~1,7% des dessertes).
//   - Le coût vient de `TransportLine.fare` — jamais inventé ici. À
//     l'import, ce champ est pré-rempli avec une valeur indicative réelle
//     (recherche 2026, PROJECT_MEMORY.md §12.2) tant qu'aucun administrateur
//     ne l'a définie (`fareVerified=false`) ; `fareVerified=true` une fois
//     confirmée via PATCH /api/admin/lines/:id, et l'import ne la touche
//     plus jamais ensuite. Un plan expose `costVerified: true` seulement si
//     TOUS ses segments en transport ont un tarif confirmé par un admin —
//     sinon le coût affiché reste une estimation à traiter comme telle.
// =============================================================================
import { Prisma } from '../../generated/prisma/index.js';
import { prisma } from '../../db/prisma.js';
import type { Coordinates, OptimizeCriterion } from './trip-planning.schemas.js';

// --- Constantes de planification (documentées, jamais présentées comme des
// mesures exactes propres à Abidjan). ---
const WALK_SPEED_MPS = 5000 / 3600; // 5 km/h
const WALK_DETOUR_FACTOR = 1.3; // trajet réel piéton vs vol d'oiseau
// Repli quand aucun temps GTFS n'est disponible pour un segment de ligne :
// vitesse commerciale moyenne raisonnable pour un gbaka/bus en circulation
// urbaine dense (documentée comme estimation, pas une mesure).
const FALLBACK_RIDE_SPEED_MPS = 15000 / 3600; // 15 km/h

const LINE_SELECT = {
  id: true,
  name: true,
  shortName: true,
  color: true,
  transportType: true,
  fare: true,
  fareVerified: true,
} as const;

function haversineMeters(a: Coordinates, b: Coordinates): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function estimateWalk(distanceMeters: number) {
  const realDistance = distanceMeters * WALK_DETOUR_FACTOR;
  return {
    distanceMeters: Math.round(realDistance),
    durationSeconds: Math.round(realDistance / WALK_SPEED_MPS),
  };
}

interface StopPoint {
  id: string;
  name: string | null;
  lat: number;
  lon: number;
}

interface CandidateStop extends StopPoint {
  walkDistanceMeters: number;
}

// Arrêts servis par au moins une ligne, dans un rayon donné — condition
// supplémentaire par rapport à /stops/nearby : un arrêt sans desserte connue
// ne peut jamais être un point d'embarquement/débarquement valide.
async function findBoardableStopsNear(point: Coordinates, radiusMeters: number): Promise<CandidateStop[]> {
  const rows = await prisma.$queryRaw<
    { id: string; name: string | null; lat: number; lon: number; distance: number }[]
  >(Prisma.sql`
    SELECT DISTINCT s."id", s."name", s."lat", s."lon",
      ST_Distance(s."geog", ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326)::geography) AS distance
    FROM "stops" s
    INNER JOIN "stop_lines" sl ON sl."stopId" = s."id"
    WHERE ST_DWithin(s."geog", ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326)::geography, ${radiusMeters})
    ORDER BY distance ASC
    LIMIT 20
  `);
  return rows.map((r) => ({ id: r.id, name: r.name, lat: r.lat, lon: r.lon, walkDistanceMeters: r.distance }));
}

interface LineRef {
  id: string;
  name: string;
  shortName: string | null;
  color: string | null;
  transportType: string;
  fare: number | null;
  fareVerified: boolean;
}

interface StopLineEntry {
  stopId: string;
  stop: StopPoint;
  lineId: string;
  line: LineRef;
  direction: string | null;
  sequence: number | null;
  secondsFromRouteStart: number | null;
}

async function fetchStopLines(stopIds: string[]): Promise<StopLineEntry[]> {
  if (stopIds.length === 0) return [];
  const rows = await prisma.stopLine.findMany({
    where: { stopId: { in: stopIds } },
    include: {
      stop: { select: { id: true, name: true, lat: true, lon: true } },
      line: { select: LINE_SELECT },
    },
  });
  return rows.map((r) => ({
    stopId: r.stopId,
    stop: r.stop,
    lineId: r.lineId,
    line: r.line,
    direction: r.direction,
    sequence: r.sequence,
    secondsFromRouteStart: r.secondsFromRouteStart,
  }));
}

interface ReachablePair {
  // La desserte D'ORIGINE (arrêt+LIGNE+sens précis) — jamais juste un
  // stopId : un arrêt peut être un hub desservi par des dizaines de lignes
  // différentes (ex. "Cash Center Plateau" dessert 29 lignes réelles dans
  // ce jeu de données). Grouper uniquement par stopId mélangerait les
  // dessertes atteignables de lignes n'ayant RIEN à voir entre elles — bug
  // réel constaté le 2026-09-06 (un plan affichait une "ligne 25" reliant
  // deux arrêts qui n'appartiennent pourtant pas à la même ligne, avec une
  // vitesse résultante de 522 km/h).
  origin: StopLineEntry;
  reachable: StopLineEntry[];
}

// Segments de ligne "en avant" depuis chaque desserte d'un arrêt candidat :
// pour une desserte (ligne, sens, séquence), toutes les dessertes de la
// MÊME ligne+sens avec une séquence strictement supérieure (accessibles en
// une seule montée, sans changer de ligne).
async function findReachableForward(entries: StopLineEntry[]): Promise<ReachablePair[]> {
  const pairs: ReachablePair[] = [];
  for (const entry of entries) {
    if (entry.sequence === null || entry.direction === null) continue;
    const rows = await prisma.stopLine.findMany({
      where: { lineId: entry.lineId, direction: entry.direction, sequence: { gt: entry.sequence } },
      include: {
        stop: { select: { id: true, name: true, lat: true, lon: true } },
        line: { select: LINE_SELECT },
      },
    });
    pairs.push({
      origin: entry,
      reachable: rows.map((r) => ({
        stopId: r.stopId,
        stop: r.stop,
        lineId: r.lineId,
        line: r.line,
        direction: r.direction,
        sequence: r.sequence,
        secondsFromRouteStart: r.secondsFromRouteStart,
      })),
    });
  }
  return pairs;
}

// Dessertes "en arrière" depuis chaque arrêt candidat de destination : pour
// une desserte (ligne, sens, séquence), toutes les dessertes de la MÊME
// ligne+sens avec une séquence strictement inférieure (peuvent l'atteindre
// en une seule descente).
async function findReachableBackward(entries: StopLineEntry[]): Promise<ReachablePair[]> {
  const pairs: ReachablePair[] = [];
  for (const entry of entries) {
    if (entry.sequence === null || entry.direction === null) continue;
    const rows = await prisma.stopLine.findMany({
      where: { lineId: entry.lineId, direction: entry.direction, sequence: { lt: entry.sequence } },
      include: {
        stop: { select: { id: true, name: true, lat: true, lon: true } },
        line: { select: LINE_SELECT },
      },
    });
    pairs.push({
      origin: entry,
      reachable: rows.map((r) => ({
        stopId: r.stopId,
        stop: r.stop,
        lineId: r.lineId,
        line: r.line,
        direction: r.direction,
        sequence: r.sequence,
        secondsFromRouteStart: r.secondsFromRouteStart,
      })),
    });
  }
  return pairs;
}

function estimateRideSeconds(board: StopLineEntry, alight: StopLineEntry): { seconds: number; basis: 'gtfs-schedule' | 'haversine-fallback' } {
  if (board.secondsFromRouteStart !== null && alight.secondsFromRouteStart !== null) {
    const delta = alight.secondsFromRouteStart - board.secondsFromRouteStart;
    if (delta > 0) return { seconds: delta, basis: 'gtfs-schedule' };
  }
  const distance = haversineMeters(board.stop, alight.stop);
  return { seconds: Math.max(60, Math.round(distance / FALLBACK_RIDE_SPEED_MPS)), basis: 'haversine-fallback' };
}

export interface TripStep {
  type: 'walk' | 'ride';
  distanceMeters: number;
  durationSeconds: number;
  fromLabel?: string;
  toLabel?: string;
  line?: LineRef;
  direction?: string | null;
  boardStop?: StopPoint;
  alightStop?: StopPoint;
  // null = coût inconnu (aucune valeur définie ni indicative — ne devrait
  // plus arriver depuis que l'import pré-remplit un placeholder, mais reste
  // possible pour une ligne créée autrement que par l'import GTFS).
  costFCFA?: number | null;
  costVerified?: boolean;
  durationEstimateBasis?: 'gtfs-schedule' | 'haversine-fallback';
}

export interface TripPlan {
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  walkingDurationSeconds: number;
  transfersCount: number;
  // null si au moins un segment en transport n'a aucun tarif renseigné
  // (jamais une estimation inventée pour compenser).
  totalCostFCFA: number | null;
  // true seulement si TOUS les segments en transport ont un tarif confirmé
  // par un administrateur (PATCH /api/admin/lines/:id) — sinon le coût
  // affiché reste indicatif, à signaler comme tel côté frontend.
  costVerified: boolean;
  steps: TripStep[];
}

function buildRideStep(board: StopLineEntry, alight: StopLineEntry): TripStep {
  const { seconds, basis } = estimateRideSeconds(board, alight);
  const distance = Math.round(haversineMeters(board.stop, alight.stop));
  return {
    type: 'ride',
    distanceMeters: distance,
    durationSeconds: seconds,
    line: board.line,
    direction: board.direction,
    boardStop: board.stop,
    alightStop: alight.stop,
    costFCFA: board.line.fare,
    costVerified: board.line.fareVerified,
    durationEstimateBasis: basis,
  };
}

function assemblePlan(steps: TripStep[]): TripPlan {
  const totalDistanceMeters = steps.reduce((sum, s) => sum + s.distanceMeters, 0);
  const totalDurationSeconds = steps.reduce((sum, s) => sum + s.durationSeconds, 0);
  const walkingDurationSeconds = steps
    .filter((s) => s.type === 'walk')
    .reduce((sum, s) => sum + s.durationSeconds, 0);
  const rideSteps = steps.filter((s) => s.type === 'ride');
  const transfersCount = rideSteps.length - 1;
  const hasUnknownCost = rideSteps.some((s) => s.costFCFA === null || s.costFCFA === undefined);
  const totalCostFCFA = hasUnknownCost
    ? null
    : rideSteps.reduce((sum, s) => sum + (s.costFCFA ?? 0), 0);
  const costVerified = rideSteps.length > 0 && rideSteps.every((s) => s.costVerified === true);
  return {
    totalDistanceMeters: Math.round(totalDistanceMeters),
    totalDurationSeconds: Math.round(totalDurationSeconds),
    walkingDurationSeconds: Math.round(walkingDurationSeconds),
    transfersCount: Math.max(0, transfersCount),
    totalCostFCFA: totalCostFCFA !== null ? Math.round(totalCostFCFA) : null,
    costVerified,
    steps,
  };
}

// "cheapest" traite un coût inconnu comme le plus défavorable possible (fin
// de liste) — jamais comme 0, qui laisserait croire à un trajet gratuit.
function sortPlans(plans: TripPlan[], criterion: OptimizeCriterion): TripPlan[] {
  const key: Record<OptimizeCriterion, (p: TripPlan) => number> = {
    fastest: (p) => p.totalDurationSeconds,
    cheapest: (p) => p.totalCostFCFA ?? Number.POSITIVE_INFINITY,
    'least-walking': (p) => p.walkingDurationSeconds,
  };
  return [...plans].sort((a, b) => key[criterion](a) - key[criterion](b));
}

// Dédoublonne les plans identiques en substance (même arrêts d'embarquement/
// débarquement pour chaque étape en transport) — plusieurs combinaisons de
// candidats proches peuvent produire le même trajet logique.
function dedupePlans(plans: TripPlan[]): TripPlan[] {
  const seen = new Set<string>();
  const result: TripPlan[] = [];
  for (const plan of plans) {
    const key = plan.steps
      .filter((s) => s.type === 'ride')
      .map((s) => `${s.line?.id}:${s.boardStop?.id}:${s.alightStop?.id}`)
      .join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(plan);
  }
  return result;
}

export interface PlanTripParams {
  from: Coordinates;
  to: Coordinates;
  walkRadius: number;
  maxTransfers: number;
  optimize: OptimizeCriterion;
  limit: number;
}

export async function planTrip(params: PlanTripParams): Promise<{ plans: TripPlan[]; note: string }> {
  const { from, to, walkRadius, maxTransfers, optimize, limit } = params;

  const [boardCandidates, alightCandidates] = await Promise.all([
    findBoardableStopsNear(from, walkRadius),
    findBoardableStopsNear(to, walkRadius),
  ]);

  const boardStopIds = boardCandidates.map((s) => s.id);
  const alightStopIds = alightCandidates.map((s) => s.id);

  const [boardEntries, alightEntries] = await Promise.all([
    fetchStopLines(boardStopIds),
    fetchStopLines(alightStopIds),
  ]);

  const walkToBoard = new Map(boardCandidates.map((s) => [s.id, s.walkDistanceMeters]));
  const walkFromAlight = new Map(alightCandidates.map((s) => [s.id, s.walkDistanceMeters]));

  const plans: TripPlan[] = [];

  // --- Trajets directs : même (ligne, sens), embarquement avant débarquement. ---
  const alightByLineDirection = new Map<string, StopLineEntry[]>();
  for (const entry of alightEntries) {
    if (entry.direction === null || entry.sequence === null) continue;
    const key = `${entry.lineId}::${entry.direction}`;
    if (!alightByLineDirection.has(key)) alightByLineDirection.set(key, []);
    alightByLineDirection.get(key)!.push(entry);
  }

  for (const board of boardEntries) {
    if (board.direction === null || board.sequence === null) continue;
    const key = `${board.lineId}::${board.direction}`;
    const candidates = alightByLineDirection.get(key) ?? [];
    for (const alight of candidates) {
      if (alight.sequence === null || board.sequence >= alight.sequence) continue;
      const rideStep = buildRideStep(board, alight);
      const walkStart = estimateWalk(walkToBoard.get(board.stopId) ?? 0);
      const walkEnd = estimateWalk(walkFromAlight.get(alight.stopId) ?? 0);
      plans.push(
        assemblePlan([
          { type: 'walk', ...walkStart, toLabel: board.stop.name ?? 'arrêt' },
          rideStep,
          { type: 'walk', ...walkEnd, fromLabel: alight.stop.name ?? 'arrêt' },
        ])
      );
    }
  }

  // --- Trajets à 1 correspondance (même arrêt physique de transfert). ---
  if (maxTransfers >= 1) {
    const [reachableForward, reachableBackward] = await Promise.all([
      findReachableForward(boardEntries),
      findReachableBackward(alightEntries),
    ]);

    // reachableBackward donne, pour CHAQUE desserte précise (arrêt+ligne+
    // sens) d'un candidat de destination, les dessertes en amont qui
    // peuvent l'atteindre en une descente. On aplatit en une liste indexée
    // par arrêt physique de transfert pour la croiser avec reachableForward
    // — en conservant à chaque fois la desserte d'ORIGINE (destination
    // précise), jamais juste un id d'arrêt.
    const secondLegByTransferStop = new Map<
      string,
      { alightOrigin: StopLineEntry; secondLegEntry: StopLineEntry }[]
    >();
    for (const alightPair of reachableBackward) {
      for (const secondLegEntry of alightPair.reachable) {
        if (!secondLegByTransferStop.has(secondLegEntry.stopId)) {
          secondLegByTransferStop.set(secondLegEntry.stopId, []);
        }
        secondLegByTransferStop
          .get(secondLegEntry.stopId)!
          .push({ alightOrigin: alightPair.origin, secondLegEntry });
      }
    }

    for (const boardPair of reachableForward) {
      const board = boardPair.origin;
      for (const transferEntry of boardPair.reachable) {
        const options = secondLegByTransferStop.get(transferEntry.stopId) ?? [];
        for (const { alightOrigin, secondLegEntry } of options) {
          // Pas une vraie correspondance si les deux jambes utilisent la
          // même ligne+sens (ce serait un trajet direct, déjà couvert).
          if (transferEntry.lineId === secondLegEntry.lineId && transferEntry.direction === secondLegEntry.direction) {
            continue;
          }

          const ride1 = buildRideStep(board, transferEntry);
          const ride2 = buildRideStep(secondLegEntry, alightOrigin);
          const walkStart = estimateWalk(walkToBoard.get(board.stopId) ?? 0);
          const walkEnd = estimateWalk(walkFromAlight.get(alightOrigin.stopId) ?? 0);
          plans.push(
            assemblePlan([
              { type: 'walk', ...walkStart, toLabel: board.stop.name ?? 'arrêt' },
              ride1,
              ride2,
              { type: 'walk', ...walkEnd, fromLabel: alightOrigin.stop.name ?? 'arrêt' },
            ])
          );
        }
      }
    }
  }

  const deduped = dedupePlans(plans);
  const sorted = sortPlans(deduped, optimize).slice(0, limit);

  return {
    plans: sorted,
    note:
      "Estimations : temps de marche basé sur une vitesse standard (pas mesuré à Abidjan), " +
      'temps de trajet basé sur les horaires GTFS 2021 quand disponibles (sinon estimation par distance). ' +
      "Coût : tarif par ligne — indicatif (costVerified=false) tant qu'aucun administrateur ne l'a confirmé, " +
      'fiable une fois vérifié (costVerified=true). Correspondances limitées à un changement au même arrêt physique.',
  };
}

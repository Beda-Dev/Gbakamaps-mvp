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
import { generateText } from '../../common/gemini.js';
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
async function findBoardableStopsNear(
  point: Coordinates,
  radiusMeters: number,
  limit = 20
): Promise<CandidateStop[]> {
  const rows = await prisma.$queryRaw<
    { id: string; name: string | null; lat: number; lon: number; distance: number }[]
  >(Prisma.sql`
    SELECT DISTINCT s."id", s."name", s."lat", s."lon",
      ST_Distance(s."geog", ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326)::geography) AS distance
    FROM "stops" s
    INNER JOIN "stop_lines" sl ON sl."stopId" = s."id"
    WHERE ST_DWithin(s."geog", ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326)::geography, ${radiusMeters})
    ORDER BY distance ASC
    LIMIT ${limit}
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

// =============================================================================
// Narration en langage naturel d'un plan déjà calculé (Gemini) — première
// fonctionnalité IA du projet (PROJECT_MEMORY.md §12.8, "description en
// langage naturel d'un itinéraire"), demande explicite de l'utilisateur.
//
// Principe non négociable : Gemini ne reçoit QUE des faits déjà calculés et
// vérifiés par notre propre moteur (planTrip ci-dessus) — noms d'arrêts
// réels, lignes réelles, durées/coûts déjà estimés avec leur statut
// vérifié/non vérifié. Le prompt lui interdit explicitement d'ajouter une
// information non fournie (aucune donnée temps réel, aucun prix inventé).
// Gemini ne fait QUE reformuler en prose fluide des faits qu'on lui donne —
// jamais une source de vérité sur le trajet lui-même.
// =============================================================================
function describeStepForPrompt(step: TripStep, index: number): string {
  if (step.type === 'walk') {
    const dest = step.toLabel ? ` jusqu'à ${step.toLabel}` : step.fromLabel ? ` depuis ${step.fromLabel}` : '';
    return `${index + 1}. Marcher ${step.distanceMeters} m (environ ${Math.round(step.durationSeconds / 60)} min)${dest}.`;
  }
  const lineName = step.line ? `${step.line.shortName ?? ''} ${step.line.name}`.trim() : 'une ligne';
  const cost =
    step.costFCFA === null || step.costFCFA === undefined
      ? 'coût inconnu'
      : `${step.costFCFA} FCFA${step.costVerified ? ' (tarif confirmé)' : ' (tarif indicatif, non confirmé par un administrateur)'}`;
  return (
    `${index + 1}. Prendre la ligne ${lineName} de l'arrêt "${step.boardStop?.name ?? 'arrêt'}" ` +
    `à l'arrêt "${step.alightStop?.name ?? 'arrêt'}" (environ ${Math.round(step.durationSeconds / 60)} min, ${cost}).`
  );
}

export async function narratePlan(plan: TripPlan): Promise<string> {
  const stepsDescription = plan.steps.map(describeStepForPrompt).join('\n');
  const totalCost =
    plan.totalCostFCFA === null
      ? 'coût total inconnu'
      : `coût total ${plan.totalCostFCFA} FCFA${plan.costVerified ? ' (tarifs confirmés)' : ' (estimation, tarifs non tous confirmés)'}`;

  const prompt = `Tu es un assistant qui explique un trajet de transport en commun à Abidjan (Côte d'Ivoire) à un utilisateur, en français, de façon claire, chaleureuse et concise (4-6 phrases maximum).

RÈGLE ABSOLUE : n'utilise QUE les informations ci-dessous. N'invente JAMAIS un nom d'arrêt, une ligne, une durée, un prix, un horaire ou une information qui n'est pas explicitement fournie. Si une information manque (ex. coût inconnu), dis-le simplement, ne la remplace par aucune estimation de ton cru.

Trajet calculé (durée totale ${Math.round(plan.totalDurationSeconds / 60)} min, distance totale ${plan.totalDistanceMeters} m, ${plan.transfersCount} correspondance(s), ${totalCost}) :
${stepsDescription}

Rédige une explication naturelle de ce trajet, étape par étape, comme si tu parlais à quelqu'un qui ne connaît pas Abidjan. Mentionne si un tarif est indicatif (pas confirmé).`;

  return generateText(prompt);
}

// =============================================================================
// Approximation de "zone accessible en X minutes" — PROJECT_MEMORY.md §12.17.
//
// CE N'EST PAS un vrai calcul isochrone réseau-routier : ni OpenRouteService
// ni GraphHopper n'exposent leur API isochrone sur le plan gratuit du projet
// (testé le 2026-09-08, §12.17). À la place, on parcourt NOTRE PROPRE graphe
// de lignes GTFS (le même que planTrip) pour lister les arrêts réellement
// atteignables dans un budget de temps donné, avec le temps réel pour y
// arriver.
//
// Garde-fou (rappelé toute la session par le propriétaire du projet) : un
// arrêt n'est inclus QUE s'il est atteignable par une chaîne de lignes
// réelles — desserte StopLine avec lineId + direction + sequence cohérents,
// embarquement toujours AVANT débarquement dans le sens de la ligne. Jamais
// par simple proximité géographique. La SEULE proximité utilisée est
// légitime : la marche de l'origine vers un premier arrêt embarquable
// (exactement comme planTrip). Une correspondance = un changement de véhicule
// AU MÊME arrêt physique (la marche courte entre deux arrêts proches de
// lignes différentes est une autre amélioration, suivie séparément, §12.16).
//
// Limites assumées, à afficher comme telles côté client :
//   - Le temps d'attente aux correspondances n'est PAS modélisé (aucune
//     donnée de fréquence de passage des gbaka/woro-woro n'existe, §4). Les
//     temps réels seront donc en pratique plus longs — l'approximation est
//     OPTIMISTE. Cohérent avec planTrip, qui ne modélise pas non plus
//     l'attente.
//   - `maxRides` borne le nombre d'embarquements successifs explorés (défaut
//     3 = jusqu'à 2 correspondances) : garde-fou de calcul ET choix cohérent
//     avec planTrip ("1 correspondance couvre déjà la grande majorité des
//     trajets urbains réels").
//   - Le résultat est un ENSEMBLE D'ARRÊTS atteignables, pas un polygone
//     lissé — volontairement, pour ne pas suggérer une précision de tracé de
//     rue qu'on n'a pas.
// =============================================================================

// Aucune donnée de fréquence de passage → l'attente aux correspondances n'est
// pas inventée. Documentée comme limite (l'approximation en devient optimiste).
const TRANSFER_WAIT_SECONDS = 0;

// Garde-fou de calcul : nombre max de couples (ligne, sens) dont on charge la
// séquence complète d'arrêts. Un budget réaliste (≤ 90 min) à Abidjan en
// touche largement moins en pratique ; au-delà on marque le résultat tronqué
// plutôt que de laisser la requête s'emballer.
const MAX_SEGMENT_FETCHES = 400;

export interface ReachableStop {
  stopId: string;
  name: string | null;
  lat: number;
  lon: number;
  etaSeconds: number;
  // Nombre d'embarquements pour l'atteindre (0 = accessible à pied depuis
  // l'origine, sans prendre aucune ligne).
  rides: number;
  // Dernière ligne empruntée pour l'atteindre (null si accessible à pied).
  lastLine: LineRef | null;
}

export interface ReachableResult {
  origin: Coordinates;
  maxSeconds: number;
  walkRadius: number;
  maxRides: number;
  reachable: ReachableStop[];
  segmentsExplored: number;
  truncated: boolean;
  note: string;
}

export interface ComputeReachableParams {
  from: Coordinates;
  maxSeconds: number;
  walkRadius: number;
  maxRides: number;
}

// Parcours en largeur, niveau par niveau (un embarquement de plus par niveau),
// avec relâchement du meilleur temps connu par arrêt. Les poids d'arête (temps
// de trajet) varient, donc on itère jusqu'à `maxRides` niveaux plutôt qu'un
// simple BFS par nombre de sauts — chaque arrêt garde le plus petit temps
// d'arrivée trouvé, quel que soit le niveau qui l'a produit.
export async function computeReachableStops(
  params: ComputeReachableParams
): Promise<ReachableResult> {
  const { from, maxSeconds, walkRadius, maxRides } = params;

  interface Arrival {
    etaSeconds: number;
    rides: number;
    lastLine: LineRef | null;
  }
  const best = new Map<string, Arrival>();
  const stopMeta = new Map<string, StopPoint>();

  // Enregistre une arrivée à `stop` si elle améliore le meilleur temps connu
  // et tient dans le budget. Renvoie true si c'est une amélioration (→ à
  // ré-explorer au niveau suivant).
  const consider = (
    stop: StopPoint,
    etaSeconds: number,
    rides: number,
    lastLine: LineRef | null
  ): boolean => {
    if (etaSeconds > maxSeconds) return false;
    const prev = best.get(stop.id);
    if (prev && prev.etaSeconds <= etaSeconds) return false;
    best.set(stop.id, { etaSeconds, rides, lastLine });
    stopMeta.set(stop.id, stop);
    return true;
  };

  interface Frontier {
    stopId: string;
    etaSeconds: number;
    lineKey: string | null; // (ligne, sens) par lequel on est arrivé, ou null (à pied)
  }

  // --- Niveau 0 : marche de l'origine vers les premiers arrêts embarquables. ---
  const originStops = await findBoardableStopsNear(from, walkRadius, 40);
  let frontier: Frontier[] = [];
  for (const s of originStops) {
    const walk = estimateWalk(s.walkDistanceMeters);
    const point: StopPoint = { id: s.id, name: s.name, lat: s.lat, lon: s.lon };
    if (consider(point, walk.durationSeconds, 0, null)) {
      frontier.push({ stopId: s.id, etaSeconds: walk.durationSeconds, lineKey: null });
    }
  }

  // --- Caches DB (bornés par le budget de temps + MAX_SEGMENT_FETCHES). ---
  const dessertesByStop = new Map<string, StopLineEntry[]>();
  const segmentByLineDir = new Map<string, StopLineEntry[]>();
  let segmentFetches = 0;
  let truncated = false;

  const loadDessertes = async (stopIds: string[]) => {
    const missing = stopIds.filter((id) => !dessertesByStop.has(id));
    if (missing.length === 0) return;
    for (const id of missing) dessertesByStop.set(id, []);
    const entries = await fetchStopLines(missing);
    for (const e of entries) dessertesByStop.get(e.stopId)!.push(e);
  };

  const loadSegment = async (lineId: string, direction: string): Promise<StopLineEntry[]> => {
    const key = `${lineId}::${direction}`;
    const cached = segmentByLineDir.get(key);
    if (cached) return cached;
    if (segmentFetches >= MAX_SEGMENT_FETCHES) {
      truncated = true;
      return [];
    }
    segmentFetches += 1;
    const rows = await prisma.stopLine.findMany({
      where: { lineId, direction },
      include: {
        stop: { select: { id: true, name: true, lat: true, lon: true } },
        line: { select: LINE_SELECT },
      },
      orderBy: { sequence: 'asc' },
    });
    const seg: StopLineEntry[] = rows.map((r) => ({
      stopId: r.stopId,
      stop: r.stop,
      lineId: r.lineId,
      line: r.line,
      direction: r.direction,
      sequence: r.sequence,
      secondsFromRouteStart: r.secondsFromRouteStart,
    }));
    segmentByLineDir.set(key, seg);
    return seg;
  };

  // --- Niveaux 1..maxRides : un embarquement de plus à chaque niveau. ---
  for (let ride = 1; ride <= maxRides && frontier.length > 0; ride += 1) {
    await loadDessertes([...new Set(frontier.map((f) => f.stopId))]);
    const nextFrontier: Frontier[] = [];

    for (const state of frontier) {
      if (state.etaSeconds > maxSeconds) continue;
      const dessertes = dessertesByStop.get(state.stopId) ?? [];
      for (const boardEntry of dessertes) {
        if (boardEntry.sequence === null || boardEntry.direction === null) continue;
        const lineKey = `${boardEntry.lineId}::${boardEntry.direction}`;
        // Pénalité de correspondance seulement si on change réellement de
        // véhicule (ligne+sens différents de celui déjà emprunté).
        const wait =
          state.lineKey !== null && lineKey !== state.lineKey ? TRANSFER_WAIT_SECONDS : 0;
        const boardTime = state.etaSeconds + wait;
        if (boardTime > maxSeconds) continue;

        const segment = await loadSegment(boardEntry.lineId, boardEntry.direction);
        for (const downstream of segment) {
          if (downstream.sequence === null || downstream.sequence <= boardEntry.sequence) continue;
          const { seconds: rideSeconds } = estimateRideSeconds(boardEntry, downstream);
          const eta = boardTime + rideSeconds;
          if (consider(downstream.stop, eta, ride, boardEntry.line)) {
            nextFrontier.push({ stopId: downstream.stopId, etaSeconds: eta, lineKey });
          }
        }
      }
    }
    frontier = nextFrontier;
  }

  const reachable: ReachableStop[] = [...best.entries()]
    .map(([stopId, a]) => {
      const meta = stopMeta.get(stopId)!;
      return {
        stopId,
        name: meta.name,
        lat: meta.lat,
        lon: meta.lon,
        etaSeconds: a.etaSeconds,
        rides: a.rides,
        lastLine: a.lastLine,
      };
    })
    .sort((x, y) => x.etaSeconds - y.etaSeconds);

  return {
    origin: from,
    maxSeconds,
    walkRadius,
    maxRides,
    reachable,
    segmentsExplored: segmentFetches,
    truncated,
    note:
      'Approximation : arrêts atteignables via les lignes connues (graphe GTFS du projet), ' +
      "PAS un vrai calcul isochrone de rue. Le temps d'attente aux correspondances n'est pas " +
      'modélisé (aucune donnée de fréquence) — les temps réels sont donc plutôt plus longs. ' +
      `Exploration limitée à ${maxRides} embarquement(s) successif(s).` +
      (truncated
        ? ' Résultat tronqué : trop de segments de lignes à explorer pour ce budget.'
        : ''),
  };
}

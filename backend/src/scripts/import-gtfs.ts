// =============================================================================
// Script d'import batch des données GTFS JungleBus (Grand Abidjan).
// Voir backend/data/gtfs-abidjan/README.md pour la provenance et les limites
// connues de cette source.
//
// Design volontaire (cf. audit de l'ancien projet) :
//   - JAMAIS exécuté sur le chemin d'une requête HTTP — script indépendant,
//     lancé manuellement (`npm run import:gtfs`)
//   - Idempotent : ré-exécutable sans dupliquer les lignes (upsert par
//     "externalRef" = route_id GTFS) ni les arrêts (upsert par "osmId",
//     les stop_id GTFS de ce flux étant directement des IDs de nœuds OSM)
//   - Transport lagunaire (ferry) explicitement hors périmètre MVP : ignoré
//
// Ordonnancement des arrêts par ligne (ajouté phase 2, PROJECT_MEMORY.md
// §12) : la première version de cet import ne capturait QUE l'ensemble des
// arrêts desservis par une ligne, sans ordre — `StopLine.sequence`/
// `direction` existaient dans le schéma mais restaient toujours NULL (bug
// réel constaté le 2026-09-06, 0% de remplissage sur 10 357 lignes). Or
// stop_times.txt/trips.txt contiennent bien stop_sequence/direction_id/
// trip_headsign — cette version les exploite enfin, ce qui rend possible un
// vrai calcul d'itinéraire multi-modal s'appuyant sur les lignes (§12.3).
//
// Vérifié empiriquement (pas une supposition) sur la ligne r5985016 : les
// deux sens d'une même ligne desservent des arrêts ENTIÈREMENT DIFFÉRENTS
// (0 arrêt commun sur 31+31) — pas une simple inversion de la même liste.
// Chaque (route_id, direction_id) est donc traité comme une séquence
// indépendante, à partir d'un "voyage représentatif" (le plus complet parmi
// les voyages de ce couple route/sens) pour en tirer l'ordre des arrêts et
// un temps relatif entre arrêts (secondes depuis le premier arrêt de ce
// voyage — jamais l'horaire absolu, obsolète depuis 2021, cf. README).
// =============================================================================
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { prisma } from '../db/prisma.js';
import { Prisma, type TransportType } from '../generated/prisma/index.js';

// Tarifs indicatifs 2026 (FCFA) — recherche réelle, pas une invention (voir
// PROJECT_MEMORY.md §12.2, sources budgetabidjan.com) : bus SOTRA facturé
// 200 ou 500 F selon la ligne (200 = tarif de base le plus courant, retenu
// comme valeur de départ), gbaka ~250 F, wôrô-wôrô ~500 F. Un administrateur
// peut et doit corriger cette valeur par ligne réelle via
// PATCH /api/admin/lines/:id — ce tableau n'est qu'un point de départ,
// jamais une vérité affichée comme telle (fareVerified=false tant qu'un
// admin ne l'a pas confirmée).
const PLACEHOLDER_FARE_FCFA: Partial<Record<TransportType, number>> = {
  BUS: 200,
  GBAKA: 250,
  WORO_WORO: 500,
};

const DATA_DIR = path.resolve(process.cwd(), 'data/gtfs-abidjan');

interface AgencyRow {
  agency_id: string;
  agency_name: string;
}

interface RouteRow {
  route_id: string;
  agency_id: string;
  route_short_name: string;
  route_long_name: string;
  route_type: string;
  route_color: string;
}

interface TripRow {
  route_id: string;
  trip_id: string;
  trip_headsign: string;
  direction_id: string;
}

interface StopTimeRow {
  trip_id: string;
  stop_id: string;
  stop_sequence: string;
  arrival_time: string;
}

interface StopRow {
  stop_id: string;
  stop_name: string;
  stop_lat: string;
  stop_lon: string;
  location_type: string;
}

async function readCsv<T>(fileName: string): Promise<T[]> {
  const content = await readFile(path.join(DATA_DIR, fileName), 'utf-8');
  return parse(content, { columns: true, skip_empty_lines: true }) as T[];
}

// GTFS route_type=4 est le transport lagunaire (ferry) — hors périmètre MVP
// (cf. README). On le détecte aussi par nom d'opérateur pour rester robuste
// si une future version du flux change ce codage.
const FERRY_ROUTE_TYPE = '4';

function transportTypeFromAgency(agencyId: string): TransportType | null {
  if (agencyId.startsWith('Gbaka')) return 'GBAKA';
  if (agencyId.startsWith('Woro-woro')) return 'WORO_WORO';
  if (['Aqualines', 'STL', 'monbato'].includes(agencyId)) return null; // ferry
  // monbus, monbus / Navette, Wibus, Express : réseaux de bus classiques
  return 'BUS';
}

function stopTypeFromTransportTypes(types: Set<TransportType>): string {
  // Priorité : le mode le moins "standard" l'emporte pour la classification
  // affichée — un arrêt desservi à la fois par un bus et un woro-woro est
  // avant tout identifié comme point woro-woro pour l'usager.
  if (types.has('WORO_WORO')) return 'WORO_WORO_STOP';
  if (types.has('GBAKA')) return 'GBAKA_STOP';
  return 'BUS_STOP';
}

// "HH:MM:SS" GTFS (les heures peuvent dépasser 24 pour un service qui
// continue après minuit — arithmétique simple, pas une heure d'horloge).
function gtfsTimeToSeconds(time: string): number | null {
  const parts = time.split(':').map(Number);
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) return null;
  const [h, m, s] = parts;
  return h * 3600 + m * 60 + s;
}

interface OrderedStop {
  stopId: string;
  sequence: number;
  secondsFromStart: number | null;
}

async function main() {
  console.log('📥 Lecture des fichiers GTFS...');

  const [agencies, routes, trips, stopTimes, stops] = await Promise.all([
    readCsv<AgencyRow>('agency.txt'),
    readCsv<RouteRow>('routes.txt'),
    readCsv<TripRow>('trips.txt'),
    readCsv<StopTimeRow>('stop_times.txt'),
    readCsv<StopRow>('stops.txt'),
  ]);

  console.log(
    `   ${agencies.length} opérateurs, ${routes.length} lignes, ${trips.length} voyages, ` +
      `${stopTimes.length} passages, ${stops.length} arrêts`
  );

  // --- Étape 1 : déterminer le type de transport de chaque ligne ---
  const routeTransportType = new Map<string, TransportType | null>();
  let skippedFerryRoutes = 0;

  for (const route of routes) {
    const type = transportTypeFromAgency(route.agency_id);
    if (type === null || route.route_type === FERRY_ROUTE_TYPE) {
      skippedFerryRoutes++;
      routeTransportType.set(route.route_id, null);
    } else {
      routeTransportType.set(route.route_id, type);
    }
  }
  console.log(`   ${skippedFerryRoutes} lignes de transport lagunaire ignorées (hors périmètre MVP)`);

  // --- Étape 2 : trip_id -> { route_id, direction_id, headsign } ---
  const tripInfo = new Map<string, { routeId: string; direction: string; headsign: string }>();
  for (const trip of trips) {
    tripInfo.set(trip.trip_id, {
      routeId: trip.route_id,
      direction: trip.direction_id ?? '0',
      headsign: trip.trip_headsign?.trim() || `Sens ${trip.direction_id ?? '0'}`,
    });
  }

  // --- Étape 3 : stop_times regroupés par trip_id (triés par séquence) ---
  const stopTimesByTrip = new Map<string, StopTimeRow[]>();
  for (const st of stopTimes) {
    if (!stopTimesByTrip.has(st.trip_id)) stopTimesByTrip.set(st.trip_id, []);
    stopTimesByTrip.get(st.trip_id)!.push(st);
  }
  for (const rows of stopTimesByTrip.values()) {
    rows.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
  }

  // --- Étape 4 : stop_id -> ensemble des route_id qui le desservent (TOUS
  // les voyages, pas seulement le représentatif — garantit qu'aucune
  // desserte connue avant cette réécriture ne disparaît). ---
  const stopToRoutes = new Map<string, Set<string>>();
  for (const [tripId, rows] of stopTimesByTrip) {
    const info = tripInfo.get(tripId);
    if (!info) continue;
    const type = routeTransportType.get(info.routeId);
    if (type === null) continue; // ligne ferry ignorée

    for (const row of rows) {
      if (!stopToRoutes.has(row.stop_id)) stopToRoutes.set(row.stop_id, new Set());
      stopToRoutes.get(row.stop_id)!.add(info.routeId);
    }
  }

  // --- Étape 5 : pour chaque (route_id, direction_id), choisir le voyage
  // représentatif (le plus complet = le plus grand nombre d'arrêts) et en
  // extraire la séquence ordonnée + le temps relatif entre arrêts. ---
  interface RouteDirectionKey {
    routeId: string;
    direction: string;
    headsign: string;
  }
  const bestTripByRouteDirection = new Map<string, { tripId: string; stopCount: number; info: RouteDirectionKey }>();

  for (const [tripId, rows] of stopTimesByTrip) {
    const info = tripInfo.get(tripId);
    if (!info) continue;
    if (routeTransportType.get(info.routeId) === null) continue; // ferry

    const key = `${info.routeId}::${info.direction}`;
    const existing = bestTripByRouteDirection.get(key);
    if (!existing || rows.length > existing.stopCount) {
      bestTripByRouteDirection.set(key, {
        tripId,
        stopCount: rows.length,
        info: { routeId: info.routeId, direction: info.headsign, headsign: info.headsign },
      });
    }
  }

  // routeId -> direction -> arrêts ordonnés avec temps relatif
  const orderedStopsByRouteDirection = new Map<string, OrderedStop[]>();
  for (const [key, best] of bestTripByRouteDirection) {
    const rows = stopTimesByTrip.get(best.tripId) ?? [];
    const firstTime = rows.length > 0 ? gtfsTimeToSeconds(rows[0].arrival_time) : null;
    const ordered: OrderedStop[] = rows.map((row) => {
      const t = gtfsTimeToSeconds(row.arrival_time);
      return {
        stopId: row.stop_id,
        sequence: Number(row.stop_sequence),
        secondsFromStart: t !== null && firstTime !== null ? t - firstTime : null,
      };
    });
    orderedStopsByRouteDirection.set(key, ordered);
  }

  console.log(
    `   ${bestTripByRouteDirection.size} sens de ligne identifiés (voyages représentatifs choisis)`
  );

  // --- Étape 6 : upsert des lignes de transport (hors ferry) ---
  console.log('📤 Import des lignes de transport...');
  const routeIdToLineId = new Map<string, string>();
  let linesCreated = 0;
  let linesUpdated = 0;

  for (const route of routes) {
    const transportType = routeTransportType.get(route.route_id);
    if (!transportType) continue;

    const existing = await prisma.transportLine.findUnique({
      where: { externalRef: route.route_id },
    });

    const data: Prisma.TransportLineUncheckedCreateInput = {
      name: route.route_long_name || route.route_short_name || route.route_id,
      shortName: route.route_short_name || null,
      color: route.route_color ? `#${route.route_color}` : undefined,
      transportType,
      operator: route.agency_id,
      externalRef: route.route_id,
    };

    // Tarif : jamais écrasé une fois défini/confirmé par un administrateur
    // (PATCH /api/admin/lines/:id met fareVerified=true). Sinon, valeur
    // indicative de départ tirée d'une recherche réelle (pas inventée),
    // que l'import peut continuer de rafraîchir tant qu'aucun admin n'a
    // statué — voir PLACEHOLDER_FARE_FCFA plus haut.
    if (!existing?.fareVerified) {
      data.fare = PLACEHOLDER_FARE_FCFA[transportType] ?? null;
    }

    const line = existing
      ? await prisma.transportLine.update({ where: { id: existing.id }, data })
      : await prisma.transportLine.create({ data });

    if (existing) linesUpdated++;
    else linesCreated++;
    routeIdToLineId.set(route.route_id, line.id);
  }
  console.log(`   ${linesCreated} lignes créées, ${linesUpdated} mises à jour`);

  // --- Étape 7 : upsert des arrêts ---
  console.log('📤 Import des arrêts...');
  let stopsCreated = 0;
  let stopsUpdated = 0;
  let stopsSkippedInvalidCoords = 0;
  const gtfsStopIdToDbId = new Map<string, string>();

  for (const stopRow of stops) {
    const lat = Number(stopRow.stop_lat);
    const lon = Number(stopRow.stop_lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) {
      stopsSkippedInvalidCoords++;
      continue;
    }

    // Les stop_id de ce flux JungleBus sont des IDs de nœuds OSM préfixés
    // "n" (ex: "n768587345") — on récupère l'ID OSM réel pour éviter de
    // dupliquer un arrêt déjà connu d'OpenStreetMap.
    const osmIdMatch = /^n(\d+)$/.exec(stopRow.stop_id);
    const osmId = osmIdMatch ? BigInt(osmIdMatch[1]) : null;

    const servedRouteIds = stopToRoutes.get(stopRow.stop_id) ?? new Set<string>();
    const servedTypes = new Set(
      [...servedRouteIds].map((rid) => routeTransportType.get(rid)).filter((t): t is TransportType => !!t)
    );

    const stopData = {
      name: stopRow.stop_name || null,
      lat,
      lon,
      stopType: stopTypeFromTransportTypes(servedTypes) as never,
      source: 'OSM' as const,
      osmId,
      gbaka: servedTypes.has('GBAKA'),
      woroworo: servedTypes.has('WORO_WORO'),
      verified: false,
      lastUpdated: new Date(),
    };

    const existing = osmId ? await prisma.stop.findUnique({ where: { osmId } }) : null;

    const stop = existing
      ? await prisma.stop.update({ where: { id: existing.id }, data: stopData })
      : await prisma.stop.create({ data: stopData });

    if (existing) stopsUpdated++;
    else stopsCreated++;
    gtfsStopIdToDbId.set(stopRow.stop_id, stop.id);
  }
  console.log(
    `   ${stopsCreated} arrêts créés, ${stopsUpdated} mis à jour, ${stopsSkippedInvalidCoords} ignorés (coordonnées invalides)`
  );

  // --- Étape 8 : associations arrêt <-> ligne, avec ordre/temps quand
  // disponibles (voyage représentatif), sinon association simple (comme
  // avant cette réécriture — aucune desserte connue ne disparaît). ---
  console.log('📤 Import des dessertes (arrêt <-> ligne)...');
  let associationsWithOrder = 0;
  let associationsWithoutOrder = 0;

  // D'abord les dessertes ordonnées (voyages représentatifs).
  const orderedPairsHandled = new Set<string>(); // `${gtfsStopId}::${routeId}`
  for (const [key, ordered] of orderedStopsByRouteDirection) {
    const [routeId] = key.split('::');
    const dbLineId = routeIdToLineId.get(routeId);
    if (!dbLineId) continue;
    const best = bestTripByRouteDirection.get(key);
    // `best` existe toujours ici : `orderedStopsByRouteDirection` est
    // construit en itérant `bestTripByRouteDirection` (mêmes clés), voir
    // plus haut. `direction` n'est donc jamais null pour un arrêt ordonné —
    // seule la desserte "sans ordre" (plus bas) peut avoir direction=null.
    const direction = best!.info.headsign;

    for (const stop of ordered) {
      const dbStopId = gtfsStopIdToDbId.get(stop.stopId);
      if (!dbStopId) continue;

      await prisma.stopLine.upsert({
        where: { stopId_lineId_direction: { stopId: dbStopId, lineId: dbLineId, direction } },
        update: {
          sequence: stop.sequence,
          secondsFromRouteStart: stop.secondsFromStart,
        },
        create: {
          stopId: dbStopId,
          lineId: dbLineId,
          sequence: stop.sequence,
          direction,
          secondsFromRouteStart: stop.secondsFromStart,
        },
      });
      associationsWithOrder++;
      orderedPairsHandled.add(`${stop.stopId}::${routeId}`);
    }
  }

  // Puis les dessertes restantes (arrêts desservis seulement par une
  // variante de trajet non retenue comme représentative) sans ordre.
  for (const [gtfsStopId, routeIds] of stopToRoutes) {
    const dbStopId = gtfsStopIdToDbId.get(gtfsStopId);
    if (!dbStopId) continue;

    for (const routeId of routeIds) {
      if (orderedPairsHandled.has(`${gtfsStopId}::${routeId}`)) continue;
      const dbLineId = routeIdToLineId.get(routeId);
      if (!dbLineId) continue;

      // Upsert manuel plutôt que `prisma.stopLine.upsert` : le type généré
      // pour la clé composite `stopId_lineId_direction` n'accepte pas
      // `direction: null` proprement (limite connue de Prisma sur les
      // colonnes nullables dans un index composite) — cas rare (~1,7% des
      // dessertes), un aller-retour supplémentaire est sans conséquence ici.
      const existingUnordered = await prisma.stopLine.findFirst({
        where: { stopId: dbStopId, lineId: dbLineId, direction: null },
      });
      if (!existingUnordered) {
        await prisma.stopLine.create({ data: { stopId: dbStopId, lineId: dbLineId } });
      }
      associationsWithoutOrder++;
    }
  }
  console.log(
    `   ${associationsWithOrder} dessertes avec ordre/temps relatif, ${associationsWithoutOrder} sans ordre (variantes de trajet secondaires)`
  );

  console.log('✅ Import terminé.');
}

main()
  .catch((err) => {
    console.error('❌ Échec de l\'import :', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

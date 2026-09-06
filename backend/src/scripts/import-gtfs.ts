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
//   - N'importe QUE la topologie (arrêts, lignes, dessertes) — jamais les
//     horaires, obsolètes dans cette source (cf. README)
//   - Transport lagunaire (ferry) explicitement hors périmètre MVP : ignoré
// =============================================================================
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { prisma } from '../db/prisma.js';
import type { TransportType } from '../generated/prisma/index.js';

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
}

interface StopTimeRow {
  trip_id: string;
  stop_id: string;
  stop_sequence: string;
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

  // --- Étape 2 : trip_id -> route_id ---
  const tripToRoute = new Map<string, string>();
  for (const trip of trips) {
    tripToRoute.set(trip.trip_id, trip.route_id);
  }

  // --- Étape 3 : stop_id -> ensemble des route_id qui le desservent ---
  const stopToRoutes = new Map<string, Set<string>>();
  for (const st of stopTimes) {
    const routeId = tripToRoute.get(st.trip_id);
    if (!routeId) continue;
    const type = routeTransportType.get(routeId);
    if (type === null) continue; // ligne ferry ignorée

    if (!stopToRoutes.has(st.stop_id)) {
      stopToRoutes.set(st.stop_id, new Set());
    }
    stopToRoutes.get(st.stop_id)!.add(routeId);
  }

  // --- Étape 4 : upsert des lignes de transport (hors ferry) ---
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

    const data = {
      name: route.route_long_name || route.route_short_name || route.route_id,
      shortName: route.route_short_name || null,
      color: route.route_color ? `#${route.route_color}` : undefined,
      transportType,
      operator: route.agency_id,
      externalRef: route.route_id,
    };

    const line = existing
      ? await prisma.transportLine.update({ where: { id: existing.id }, data })
      : await prisma.transportLine.create({ data });

    if (existing) linesUpdated++;
    else linesCreated++;
    routeIdToLineId.set(route.route_id, line.id);
  }
  console.log(`   ${linesCreated} lignes créées, ${linesUpdated} mises à jour`);

  // --- Étape 5 : upsert des arrêts ---
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

  // --- Étape 6 : associations arrêt <-> ligne ---
  console.log('📤 Import des dessertes (arrêt <-> ligne)...');
  let associationsCreated = 0;

  for (const [stopId, routeIds] of stopToRoutes) {
    const dbStopId = gtfsStopIdToDbId.get(stopId);
    if (!dbStopId) continue;

    for (const routeId of routeIds) {
      const dbLineId = routeIdToLineId.get(routeId);
      if (!dbLineId) continue;

      await prisma.stopLine.upsert({
        where: { stopId_lineId: { stopId: dbStopId, lineId: dbLineId } },
        update: {},
        create: { stopId: dbStopId, lineId: dbLineId },
      });
      associationsCreated++;
    }
  }
  console.log(`   ${associationsCreated} dessertes synchronisées`);

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

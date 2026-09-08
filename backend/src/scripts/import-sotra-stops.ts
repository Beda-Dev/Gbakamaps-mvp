// =============================================================================
// Comblement des arrêts manquants à partir du jeu de données officiel
// "Gares, Arrêts de bus et Arrêts de bateaux de la SOTRA"
// (https://data.gouv.ci/datasets/gares-routieres-et-arrets-bus-et-bateaux-sotra),
// trouvé le 2026-09-08 en explorant data.gouv.ci suite à la demande de
// l'utilisateur d'exploiter au maximum les données du portail.
//
// Origine des données : DigitalTransport4Africa, relevé 2021, dérivé de
// nœuds OSM — le champ `id`/`@id` du jeu de données EST directement l'ID de
// nœud OSM (ex. "node/768587345"), exactement comme les `stop_id` du flux
// GTFS JungleBus déjà importé par import-gtfs.ts ("n768587345"). Vérifié
// empiriquement le 2026-09-08 : 2076 des 2160 arrêts "node/" de ce jeu ont
// déjà un `Stop.osmId` correspondant EXACT en base (même nœud OSM, pas une
// coïncidence de nom/position) — ce script n'importe QUE les 84 restants,
// qui sont donc de vrais arrêts SOTRA officiels absents de notre couverture
// actuelle (import GTFS de 2021 incomplet sur ce point précis).
//
// Design (mêmes principes que import-gtfs.ts et import-line-shapes.ts) :
//   - jamais exécuté sur le chemin d'une requête HTTP, lancé manuellement
//     (`npm run import:sotra-stops`)
//   - idempotent : ne CRÉE que les arrêts dont l'osmId n'existe pas encore
//     en base — ne touche JAMAIS un arrêt déjà connu (ce jeu n'a pas plus
//     de détail que ce qu'on a déjà pour ceux-là ; l'écraser ferait perdre
//     des tags enrichis par GTFS comme gbaka/woroworo)
//   - correspondance par ID de nœud OSM EXACT uniquement, jamais par nom ni
//     proximité — c'est le signal le plus fort possible (même entité OSM),
//     donc aucune ambiguïté à lever contrairement au rapprochement de lieux
//     (§12.7bis) qui exige un double signal en l'absence d'ID commun
//   - les 6 entrées "Gare SOTRA" du jeu (polygones `way/...`, bâtiments de
//     gare) sont volontairement IGNORÉES par ce script : nos `Stop.osmId`
//     ne référencent que des nœuds, jamais des ways, donc pas de
//     correspondance par ID possible pour elles. Vérifié manuellement le
//     2026-09-08 (voir PROJECT_MEMORY.md §12.20) que les 6 correspondent
//     déjà à des arrêts existants par proximité (6 à 27 m) et nom identique
//     — rien à créer. Un futur ajout à ce jeu de données (nouvelle gare)
//     resterait invisible à ce script tant qu'il n'est pas étendu pour les
//     ways ; ce cas est jugé assez rare (6 gares stables) pour ne pas
//     justifier la complexité d'un rapprochement par polygone maintenant.
//   - `Catégorie` du jeu ("Arrêt de bus" / "Arrêt de bateau") mappée vers
//     notre `StopType` de façon prudente : notre enum n'a pas de type
//     "arrêt de bateau" dédié, seul un cas Ferry existe (route_type=4 côté
//     GTFS, hors périmètre MVP, cf. import-gtfs.ts) — ces arrêts sont donc
//     créés en `STATION`, jamais en `BUS_STOP`, pour ne pas mentir sur leur
//     nature. Au moment de l'écriture, les 84 arrêts manquants sont TOUS
//     "Arrêt de bus" (vérifié) — ce mapping ne sert donc qu'à ne pas casser
//     silencieusement si le jeu de données est étendu plus tard.
// =============================================================================
import { prisma } from '../db/prisma.js';
import type { StopType } from '../generated/prisma/index.js';

const DATASET_API =
  'https://data.gouv.ci/data-fair/api/v1/datasets/gares-routieres-et-arrets-bus-et-bateaux-sotra/lines';
const PAGE_SIZE = 200;

interface SotraRecord {
  id: string; // "node/768587345" ou "way/295528558"
  Catégorie: 'Arrêt de bus' | 'Arrêt de bateau' | 'Gare SOTRA';
  Lieu?: string;
  _geopoint: string; // "lat,lon" (centroïde, cf. schéma du jeu de données)
}

interface DataFairPage {
  total: number;
  next?: string;
  results: SotraRecord[];
}

async function fetchAllRecords(): Promise<SotraRecord[]> {
  const all: SotraRecord[] = [];
  let url: string | undefined = `${DATASET_API}?size=${PAGE_SIZE}`;

  while (url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`data.gouv.ci a répondu ${res.status} pour ${url}`);
    }
    const page = (await res.json()) as DataFairPage;
    all.push(...page.results);
    url = page.next;
  }

  return all;
}

function stopTypeFromCategorie(categorie: SotraRecord['Catégorie']): StopType {
  if (categorie === 'Arrêt de bateau') return 'STATION' as StopType;
  return 'BUS_STOP' as StopType;
}

async function main() {
  console.log('Téléchargement du jeu de données "Gares/Arrêts SOTRA"…');
  const records = await fetchAllRecords();
  console.log(`${records.length} enregistrements reçus depuis data.gouv.ci.`);

  let created = 0;
  let alreadyExists = 0;
  let skippedWay = 0;
  let skippedInvalid = 0;

  for (const record of records) {
    const match = /^node\/(\d+)$/.exec(record.id);
    if (!match) {
      skippedWay += 1;
      continue;
    }
    const osmId = BigInt(match[1]);

    const existing = await prisma.stop.findUnique({ where: { osmId } });
    if (existing) {
      alreadyExists += 1;
      continue;
    }

    const [latStr, lonStr] = record._geopoint.split(',');
    const lat = Number(latStr);
    const lon = Number(lonStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      skippedInvalid += 1;
      continue;
    }

    await prisma.stop.create({
      data: {
        name: record.Lieu?.trim() || null,
        lat,
        lon,
        stopType: stopTypeFromCategorie(record['Catégorie']),
        source: 'OSM',
        osmId,
        verified: false,
        lastUpdated: new Date(),
      },
    });
    created += 1;
  }

  console.log('--- Bilan import arrêts SOTRA officiels ---');
  console.log(`Enregistrements reçus                : ${records.length}`);
  console.log(`Déjà présents en base (osmId connu)   : ${alreadyExists}`);
  console.log(`Nouveaux arrêts créés                 : ${created}`);
  console.log(`Ignorés (référence "way", cf. commentaire d'en-tête) : ${skippedWay}`);
  console.log(`Ignorés (coordonnées invalides)       : ${skippedInvalid}`);
}

main()
  .catch((err) => {
    console.error("Échec de l'import des arrêts SOTRA :", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

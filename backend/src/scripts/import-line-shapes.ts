// =============================================================================
// Import du tracé RÉEL des lignes de transport d'Abidjan, depuis le jeu de
// données officiel ivoirien "Lignes de transport à Abidjan"
// (https://data.gouv.ci/datasets/abidjantransport-lignes), lui-même dérivé de
// relations OSM route=bus (DigitalTransport4Africa, relevé 2021).
//
// Origine de cette intégration : l'utilisateur a fourni un export local
// (abidjantransport_lignes.geojson) puis pointé le jeu de données source sur
// data.gouv.ci le 2026-09-08. Vérifié empiriquement que les deux sont
// identiques (même API data-fair sous-jacente, 325 lignes, même schéma) —
// ce script interroge l'API en direct plutôt que de dépendre du fichier
// local, pour rester ré-exécutable indéfiniment sans dépendre d'un export
// ponctuel sur le disque de quelqu'un.
//
// Correspondance avec nos lignes existantes (importées depuis GTFS
// JungleBus, voir import-gtfs.ts) : NON DEVINÉE. `TransportLine.externalRef`
// est au format "r<id_relation_OSM>" (ex. "r5985016"), et `line_id` dans ce
// jeu de données est au format "Line:relation:<id_relation_OSM>" — même
// identifiant de relation OSM, vérifié concrètement le 2026-09-08 sur la
// ligne "06" (Aéroport ↔ Gare Sud, cohérent des deux côtés). Sur 391 lignes
// en base avec un externalRef, 318 ont une correspondance exacte dans ce
// jeu de 325 lignes — les 73 restantes (souvent des variantes de direction
// sans relation OSM "route" dédiée) restent SANS tracé plutôt que de se voir
// attribuer un tracé approximatif ou celui d'une autre ligne.
//
// Design (mêmes principes que import-gtfs.ts) :
//   - jamais exécuté sur le chemin d'une requête HTTP, lancé manuellement
//     (`npm run import:line-shapes`)
//   - idempotent : ne fait qu'UPDATE des lignes déjà présentes (upsert par
//     externalRef), ne crée jamais de nouvelle TransportLine — cette source
//     n'a pas le détail arrêts/séquence/tarif nécessaire pour créer une
//     ligne complète, seulement l'enrichir d'un tracé
//   - jamais de correspondance floue par nom : uniquement par ID de relation
//     OSM exact, sinon la ligne est laissée sans tracé (log explicite)
// =============================================================================
import { prisma } from '../db/prisma.js';

const DATASET_API =
  'https://data.gouv.ci/data-fair/api/v1/datasets/abidjantransport-lignes/lines';
const PAGE_SIZE = 100;

interface DataFairGeometry {
  type: string;
  coordinates: unknown;
}

interface DataFairLineRecord {
  line_id: string; // "Line:relation:5985016"
  name?: string;
  code?: number;
  geometry?: DataFairGeometry | string;
}

interface DataFairPage {
  total: number;
  next?: string;
  results: DataFairLineRecord[];
}

// Extrait l'ID de relation OSM commun aux deux sources, ex. "5985016" à
// partir de "Line:relation:5985016". Retourne null si le format ne
// correspond pas exactement à ce attendu — jamais une extraction "au mieux".
function relationIdFromLineId(lineId: string): string | null {
  const match = /^Line:relation:(\d+)$/.exec(lineId);
  return match ? match[1] : null;
}

async function fetchAllLines(): Promise<DataFairLineRecord[]> {
  const all: DataFairLineRecord[] = [];
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

async function main() {
  console.log('Téléchargement du jeu de données "Lignes de transport à Abidjan"…');
  const records = await fetchAllLines();
  console.log(`${records.length} lignes reçues depuis data.gouv.ci.`);

  let matched = 0;
  let noRelationId = 0;
  let noGeometry = 0;
  let noMatchingLine = 0;

  for (const record of records) {
    const relationId = relationIdFromLineId(record.line_id);
    if (!relationId) {
      noRelationId += 1;
      continue;
    }
    if (!record.geometry) {
      noGeometry += 1;
      continue;
    }

    const externalRef = `r${relationId}`;
    const geometry: DataFairGeometry =
      typeof record.geometry === 'string' ? JSON.parse(record.geometry) : record.geometry;

    const result = await prisma.transportLine.updateMany({
      where: { externalRef },
      data: {
        shapeGeoJson: geometry as never,
        shapeSource: 'data.gouv.ci/datasets/abidjantransport-lignes',
      },
    });

    if (result.count > 0) {
      matched += 1;
    } else {
      noMatchingLine += 1;
    }
  }

  console.log('--- Bilan import tracés de lignes ---');
  console.log(`Lignes reçues du jeu de données      : ${records.length}`);
  console.log(`Tracés appliqués (externalRef trouvé) : ${matched}`);
  console.log(`Sans correspondance en base            : ${noMatchingLine}`);
  console.log(`line_id au mauvais format (ignorées)   : ${noRelationId}`);
  console.log(`Sans géométrie (ignorées)              : ${noGeometry}`);
}

main()
  .catch((err) => {
    console.error("Échec de l'import des tracés de lignes :", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

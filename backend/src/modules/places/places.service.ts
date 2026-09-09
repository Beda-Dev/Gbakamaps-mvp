// =============================================================================
// Recherche de lieux nommés quelconques (pas seulement des arrêts/lignes
// connus de notre base) — via l'API Overpass publique, gratuite, sans clé.
//
// Vérifié empiriquement avant adoption (règle du projet, PROJECT_MEMORY.md
// §12.8) : Overpass avait déjà été écarté pour les tags de transport
// informel ivoirien (gbaka=yes, quasi aucun résultat, cf. §4/§7) — un usage
// DIFFÉRENT, la recherche de lieux nommés génériques (quartiers, commerces,
// écoles...), a été testé séparément le 2026-09-06 et fonctionne réellement
// bien pour Abidjan (ex. "Adjamé" retourne 10 résultats pertinents et
// réels : quartiers, pharmacies, missions...).
//
// Un `User-Agent` explicite est OBLIGATOIRE — sans lui, Overpass renvoie
// 406 Not Acceptable (politique d'usage de leur service, vérifié en
// pratique, pas supposé).
//
// Portée volontairement limitée à la Côte d'Ivoire (bounding box réutilisée
// de stops.schemas.ts) — jamais un géocodeur mondial, cohérent avec la
// zone de service de toute l'application.
//
// Bbox resserrée au Grand Abidjan (pas toute la Côte d'Ivoire) : testé
// empiriquement le 2026-09-06 — une requête `nwr` (nœuds+chemins+relations)
// sur la bbox pays entier renvoie 200 mais VIDE (dépassement silencieux du
// timeout Overpass côté serveur, pas d'erreur HTTP), alors qu'une requête
// `node` seule (les POI nommés, jamais les routes/polygones bruts, inutiles
// ici) sur le Grand Abidjan répond en ~5s avec de vrais résultats. Cohérent
// aussi avec la couverture réelle de nos données GTFS (Grand Abidjan
// uniquement) — chercher un lieu ailleurs dans le pays n'aurait de toute
// façon aucun arrêt/ligne à proposer autour.
// =============================================================================
import { Prisma } from '../../generated/prisma/index.js';
import { prisma } from '../../db/prisma.js';
import { AppError } from '../../common/errors.js';
import { namesLikelyMatch } from '../../common/normalize.js';
import { POI_CATEGORIES } from './places.schemas.js';

const GREATER_ABIDJAN_BOUNDS = { south: 5.2, west: -4.3, north: 5.55, east: -3.7 };

// Rayon de correspondance géographique avec un arrêt déjà connu — cohérence
// multi-sources (PROJECT_MEMORY.md, "Sources → ingestion → normalisation →
// matching → validation → modèle unifié") : un lieu Overpass et un arrêt
// GTFS ne sont considérés comme LA MÊME entité réelle QUE si les DEUX
// signaux concordent (proximité géographique ET nom correspondant après
// normalisation) — jamais un seul des deux critères seul, qui produirait
// des faux rapprochements (deux lieux homonymes à des kilomètres d'écart,
// ou deux lieux voisins mais réellement différents). En cas de doute, les
// deux entités restent distinctes plutôt que fusionnées à tort.
const STOP_MATCH_RADIUS_METERS = 60;

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const REQUEST_TIMEOUT_MS = 20_000;
const USER_AGENT = 'GbakaMap/1.0 (+recherche de lieux, usage non commercial)';

export class PlacesServiceError extends AppError {
  constructor(detail?: string) {
    super('Recherche de lieux indisponible', 503, 'PLACES_SERVICE_ERROR', detail);
  }
}

export interface PlaceResult {
  name: string;
  lat: number;
  lon: number;
  category: string | null;
  // Non-null uniquement si un arrêt réel de notre base a été identifié
  // avec confiance comme LA MÊME entité que ce lieu (voir
  // STOP_MATCH_RADIUS_METERS) — permet au frontend de traiter ce résultat
  // comme "cet arrêt connu" plutôt qu'un lieu générique sans données de
  // transport, au lieu de présenter deux entités qui se chevauchent sans
  // rapport apparent pour l'utilisateur.
  matchedStopId: string | null;
}

interface OverpassElement {
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

// Ordre de priorité pour deviner une catégorie humainement lisible à partir
// des tags OSM bruts — n'affiche jamais un tag inconnu tel quel, seulement
// une liste blanche de clés courantes.
const CATEGORY_TAGS = ['amenity', 'shop', 'tourism', 'office', 'leisure', 'place'] as const;

function guessCategory(tags: Record<string, string>): string | null {
  for (const key of CATEGORY_TAGS) {
    const value = tags[key];
    if (value && value !== 'yes') return value;
  }
  return null;
}

// Échappe les métacaractères regex Overpass — la requête utilisateur est
// injectée dans un motif ["name"~"..."] côté serveur Overpass, jamais
// interprétée comme du code de notre côté, mais un caractère spécial mal
// échappé casserait la syntaxe de la requête (pas une injection SQL/JS,
// une requête Overpass QL malformée renverrait juste une erreur 400).
function escapeOverpassRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&');
}

export async function searchPlaces(query: string, limit: number): Promise<PlaceResult[]> {
  const { south, west, north, east } = GREATER_ABIDJAN_BOUNDS;
  const escaped = escapeOverpassRegex(query);
  // `node` seul (pas `nwr`) : les points d'intérêt nommés sont des nœuds
  // dans l'immense majorité des cas — inclure ways/relations ralentit
  // fortement la requête pour un gain de pertinence quasi nul ici.
  const overpassQuery = `[out:json][timeout:${REQUEST_TIMEOUT_MS / 1000}];
node(${south},${west},${north},${east})["name"~"${escaped}",i];
out ${limit};`;

  let response: Response;
  try {
    response = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body: `data=${encodeURIComponent(overpassQuery)}`,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new PlacesServiceError(err instanceof Error ? err.message : 'fetch failed');
  }

  if (!response.ok) {
    throw new PlacesServiceError(`Overpass HTTP ${response.status}`);
  }

  const data = (await response.json().catch(() => null)) as OverpassResponse | null;
  if (!data) throw new PlacesServiceError('Réponse Overpass invalide');

  const results: PlaceResult[] = [];
  for (const el of data.elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    const name = el.tags?.name;
    if (lat === undefined || lon === undefined || !name) continue;
    const matchedStopId = await findMatchingStop(name, lat, lon);
    results.push({ name, lat, lon, category: guessCategory(el.tags ?? {}), matchedStopId });
  }
  return results;
}

// Points d'intérêt à proximité d'un point donné (typiquement un arrêt) —
// idée notée dans PROJECT_MEMORY.md §12.8, confirmée par l'utilisateur le
// 2026-09-06 ("ok ajoute ça dans tes plans"), maintenant implémentée.
// Vérifié empiriquement (pas supposé) : `node(around:...)` avec un filtre
// `amenity` restreint à un petit rayon (ex. 300-500m) répond en <1s avec des
// résultats réels (pharmacies, écoles...) — cf. test du 2026-09-06.
export interface NearbyPoiResult {
  name: string;
  lat: number;
  lon: number;
  category: string;
}

export async function searchNearbyPois(
  lat: number,
  lon: number,
  radiusMeters: number,
  categories?: string[]
): Promise<NearbyPoiResult[]> {
  // Liste blanche stricte : jamais une catégorie arbitraire injectée dans la
  // requête Overpass, même si le paramètre vient d'une requête utilisateur.
  const wanted = (categories?.length ? categories : [...POI_CATEGORIES]).filter(
    (c): c is (typeof POI_CATEGORIES)[number] => (POI_CATEGORIES as readonly string[]).includes(c)
  );
  if (wanted.length === 0) return [];
  const amenityPattern = wanted.join('|');

  const overpassQuery = `[out:json][timeout:${REQUEST_TIMEOUT_MS / 1000}];
node(around:${radiusMeters},${lat},${lon})["amenity"~"^(${amenityPattern})$"];
out 30;`;

  let response: Response;
  try {
    response = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
      body: `data=${encodeURIComponent(overpassQuery)}`,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new PlacesServiceError(err instanceof Error ? err.message : 'fetch failed');
  }
  if (!response.ok) throw new PlacesServiceError(`Overpass HTTP ${response.status}`);

  const data = (await response.json().catch(() => null)) as OverpassResponse | null;
  if (!data) throw new PlacesServiceError('Réponse Overpass invalide');

  const results: NearbyPoiResult[] = [];
  for (const el of data.elements) {
    const elLat = el.lat ?? el.center?.lat;
    const elLon = el.lon ?? el.center?.lon;
    const name = el.tags?.name;
    const category = el.tags?.amenity;
    if (elLat === undefined || elLon === undefined || !name || !category) continue;
    results.push({ name, lat: elLat, lon: elLon, category });
  }
  return results;
}

// Quartiers du Grand Abidjan (tags OSM `place=suburb|neighbourhood|quarter`)
// — idée notée §12.8, confirmée par l'utilisateur. `nwr` (pas seulement
// `node`) est nécessaire ici car un quartier est souvent cartographié comme
// une relation/way avec `out center` pour son point représentatif, pas
// comme un simple nœud — vérifié empiriquement que `nwr` reste rapide
// (~2s) sur la bbox déjà resserrée du Grand Abidjan (contrairement au test
// initial `nwr` sur tout le pays qui timeoutait silencieusement, cf.
// PROJECT_MEMORY.md §12.7bis).
export interface NeighborhoodResult {
  name: string;
  lat: number;
  lon: number;
}

export async function listNeighborhoods(): Promise<NeighborhoodResult[]> {
  const { south, west, north, east } = GREATER_ABIDJAN_BOUNDS;
  const overpassQuery = `[out:json][timeout:${REQUEST_TIMEOUT_MS / 1000}];
nwr(${south},${west},${north},${east})["place"~"^(suburb|neighbourhood|quarter)$"];
out center 200;`;

  let response: Response;
  try {
    response = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
      body: `data=${encodeURIComponent(overpassQuery)}`,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new PlacesServiceError(err instanceof Error ? err.message : 'fetch failed');
  }
  if (!response.ok) throw new PlacesServiceError(`Overpass HTTP ${response.status}`);

  const data = (await response.json().catch(() => null)) as OverpassResponse | null;
  if (!data) throw new PlacesServiceError('Réponse Overpass invalide');

  const results: NeighborhoodResult[] = [];
  for (const el of data.elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    const name = el.tags?.name;
    if (lat === undefined || lon === undefined || !name) continue;
    results.push({ name, lat, lon });
  }
  return results;
}

// Limites administratives réelles des communes du Grand Abidjan (relations
// OSM `boundary=administrative`, `admin_level=8`) — demande explicite de
// l'utilisateur ("on peut délimiter les quartiers/communes ? Overpass le
// fait ?"), vérifié empiriquement le 2026-09-06 : Cocody, Le Plateau,
// Treichville, Marcory, Koumassi, Attécoubé... existent bien comme telles,
// avec une géométrie réelle reconstructible (testé : 22 segments de voie
// membres de la relation "Cocody", correctement rassemblés en un unique
// anneau fermé de 192 points).
interface OverpassMember {
  type: string;
  role: string;
  ref: number;
  lat?: number;
  lon?: number;
  geometry?: { lat: number; lon: number }[];
}

interface OverpassRelation {
  type: 'relation';
  tags?: Record<string, string>;
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  members?: OverpassMember[];
}

export interface CommuneResult {
  name: string;
  adminLevel: string | null;
  bounds: { south: number; west: number; north: number; east: number };
  // Anneaux [lon, lat] fermés (premier point == dernier) — reconstruits à
  // partir des segments de voie membres de la relation OSM. Best-effort :
  // si l'assemblage ne referme pas parfaitement un anneau (topologie OSM
  // incomplète), l'anneau est quand même renvoyé fermé de force (dernier
  // point relié au premier) plutôt qu'omis — approximation honnête d'une
  // vraie limite plutôt qu'une absence totale de contour.
  polygon: [number, number][][];
}

// Assemble les segments de voie "outer" d'une relation multipolygone en
// anneaux fermés — les segments OSM ne sont ni ordonnés ni orientés de
// façon cohérente entre eux, seuls leurs points d'extrémité partagés
// permettent de les enchaîner (algorithme standard de reconstruction de
// multipolygone, appliqué ici en best-effort, pas une librairie GIS complète
// : suffisant pour un contour visuel, pas pour un usage topologique strict).
function assembleRingsFromOuterWays(members: OverpassMember[]): [number, number][][] {
  const outerWays = members.filter((m) => m.type === 'way' && m.role === 'outer' && m.geometry?.length);
  const segments: [number, number][][] = outerWays.map((w) => w.geometry!.map((p) => [p.lon, p.lat]));
  const used = new Array(segments.length).fill(false);
  const eq = (a: [number, number], b: [number, number]) =>
    Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

  const rings: [number, number][][] = [];
  while (used.some((u) => !u)) {
    const startIdx = used.findIndex((u) => !u);
    used[startIdx] = true;
    let ring = [...segments[startIdx]];
    let extended = true;
    while (extended) {
      extended = false;
      for (let i = 0; i < segments.length; i++) {
        if (used[i]) continue;
        const seg = segments[i];
        const ringEnd = ring[ring.length - 1];
        if (eq(ringEnd, seg[0])) {
          ring = ring.concat(seg.slice(1));
          used[i] = true;
          extended = true;
        } else if (eq(ringEnd, seg[seg.length - 1])) {
          ring = ring.concat([...seg].reverse().slice(1));
          used[i] = true;
          extended = true;
        }
      }
    }
    // Fermeture forcée si l'assemblage n'a pas naturellement rebouclé
    // (topologie source incomplète) — mieux qu'un contour ouvert invalide
    // pour un rendu de polygone.
    if (!eq(ring[0], ring[ring.length - 1])) ring.push(ring[0]);
    rings.push(ring);
  }
  return rings;
}

export async function listCommunes(query?: string): Promise<CommuneResult[]> {
  const { south, west, north, east } = GREATER_ABIDJAN_BOUNDS;
  const nameFilter = query ? `["name"~"${escapeOverpassRegex(query)}",i]` : '';
  const overpassQuery = `[out:json][timeout:${REQUEST_TIMEOUT_MS / 1000}];
relation(${south},${west},${north},${east})["boundary"="administrative"]["admin_level"="8"]${nameFilter};
out geom;`;

  let response: Response;
  try {
    response = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
      body: `data=${encodeURIComponent(overpassQuery)}`,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new PlacesServiceError(err instanceof Error ? err.message : 'fetch failed');
  }
  if (!response.ok) throw new PlacesServiceError(`Overpass HTTP ${response.status}`);

  const data = (await response.json().catch(() => null)) as { elements: OverpassRelation[] } | null;
  if (!data) throw new PlacesServiceError('Réponse Overpass invalide');

  const results: CommuneResult[] = [];
  for (const rel of data.elements) {
    const name = rel.tags?.name;
    if (!name || !rel.bounds || !rel.members) continue;
    results.push({
      name,
      adminLevel: rel.tags?.admin_level ?? null,
      bounds: {
        south: rel.bounds.minlat,
        west: rel.bounds.minlon,
        north: rel.bounds.maxlat,
        east: rel.bounds.maxlon,
      },
      polygon: assembleRingsFromOuterWays(rel.members),
    });
  }
  return results;
}

// Cherche, parmi les arrêts déjà connus dans un rayon serré autour d'un
// lieu Overpass, celui dont le nom correspond après normalisation — voir
// le commentaire sur STOP_MATCH_RADIUS_METERS pour le raisonnement complet
// (les deux signaux, géographique ET nominal, doivent concorder).
async function findMatchingStop(placeName: string, lat: number, lon: number): Promise<string | null> {
  const candidates = await prisma.$queryRaw<{ id: string; name: string | null }[]>(Prisma.sql`
    SELECT "id", "name"
    FROM "stops"
    WHERE "name" IS NOT NULL
      AND "active" = true
      AND ST_DWithin("geog", ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography, ${STOP_MATCH_RADIUS_METERS})
    LIMIT 5
  `);
  for (const candidate of candidates) {
    if (candidate.name && namesLikelyMatch(placeName, candidate.name)) {
      return candidate.id;
    }
  }
  return null;
}

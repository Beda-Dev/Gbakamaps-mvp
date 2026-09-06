// =============================================================================
// Carte MapLibre. Styles vectoriels MapTiler (rendu net à toute résolution,
// zoom fluide, bâtiments visibles) — nécessite une clé API gratuite
// (VITE_MAPTILER_KEY, voir .env.example et README). Ni Google Maps ni sa
// clé jamais configurée comme dans l'ancien projet.
//
// Chaîne de repli à 3 niveaux (phase 2, §12 PROJECT_MEMORY.md — cohérente
// avec le repli multi-fournisseurs ajouté côté routing) :
//   1. VITE_MAPTILER_KEY
//   2. VITE_MAPTILER_KEY_2 (clé de secours, optionnelle)
//   3. Tuiles OpenStreetMap brutes (moins nettes, mais garde l'app
//      utilisable — jamais un écran cassé, ni faute de clé ni si les DEUX
//      clés sont invalides/en quota dépassé).
// La bascule 1→2→3 est déclenchée par un vrai échec de chargement du style
// (événement 'error' de MapLibre avec un code HTTP côté MapTiler — clé
// invalide, quota dépassé, panne), pas une supposition.
// =============================================================================
import { useEffect, useRef, useState } from 'react';
import {
  AJAXError,
  LngLatBounds,
  Map,
  Marker,
  NavigationControl,
  Popup,
  type DataDrivenPropertyValueSpecification,
  type GeoJSONSource,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Stop } from '@/lib/api/types';
import type { RouteGeometry } from '@/hooks/useRoute';
import { LoaderIcon, LocateFixedIcon } from '@/components/icons';

const MAPTILER_KEYS = [
  import.meta.env.VITE_MAPTILER_KEY,
  import.meta.env.VITE_MAPTILER_KEY_2,
].filter((key): key is string => !!key);

// Styles MapTiler réels (vérifiés) — l'utilisateur peut basculer entre eux.
// Slugs confirmés : https://api.maptiler.com/maps/<slug>/style.json
const MAP_STYLES = [
  { id: 'streets-v2', label: 'Rues' },
  { id: 'basic-v2', label: 'Basique' },
  { id: 'outdoor-v2', label: 'Plein air' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'hybrid', label: 'Hybride' },
] as const;

type MapStyleId = (typeof MAP_STYLES)[number]['id'];
const DEFAULT_STYLE: MapStyleId = 'streets-v2';

const OSM_FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

// `keyIndex` : index dans MAPTILER_KEYS, ou -1 = repli OSM déjà atteint
// (dernier recours, plus de clé à tenter).
function resolveMapStyle(styleId: MapStyleId, keyIndex: number): string | StyleSpecification {
  const key = keyIndex >= 0 ? MAPTILER_KEYS[keyIndex] : undefined;
  if (!key) {
    return OSM_FALLBACK_STYLE;
  }
  return `https://api.maptiler.com/maps/${styleId}/style.json?key=${key}`;
}

// Un événement 'error' MapLibre correspond-il à un échec RÉEL de chargement
// depuis MapTiler (clé invalide/quota dépassé/panne), par opposition à une
// erreur sans rapport (image manquante, etc.) ? On ne bascule de clé que sur
// un signal concret, jamais sur une simple supposition.
function isMapTilerLoadFailure(error: unknown): boolean {
  if (error instanceof AJAXError) {
    return error.url.includes('api.maptiler.com');
  }
  // Échec réseau générique (pas de code HTTP) sur une requête vers MapTiler :
  // AJAXError n'est pas toujours l'instance levée selon le type de panne.
  return (
    error instanceof Error && /maptiler/i.test(error.message)
  );
}

export const STOP_TYPE_COLORS: Record<string, string> = {
  GBAKA_STOP: '#EE9B00',
  WORO_WORO_STOP: '#CA6702',
  TAXI_STAND: '#9B2226',
  MOTO_TAXI_STAND: '#AE2012',
  BUS_STOP: '#0A9396',
  PLATFORM: '#005F73',
  STATION: '#005F73',
};

export const STOP_TYPE_LABELS: Record<string, string> = {
  BUS_STOP: 'Bus',
  GBAKA_STOP: 'Gbaka',
  WORO_WORO_STOP: 'Woro-woro',
  TAXI_STAND: 'Taxi',
  MOTO_TAXI_STAND: 'Moto-taxi',
  STATION: 'Gare / Station',
  PLATFORM: 'Quai',
};

// Expression MapLibre "match" dérivée de STOP_TYPE_COLORS — un seul endroit
// à maintenir pour la légende, les marqueurs et le style des points groupés.
function stopTypeColorExpression(): DataDrivenPropertyValueSpecification<string> {
  const pairs = Object.entries(STOP_TYPE_COLORS).flat();
  return ['match', ['get', 'stopType'], ...pairs, '#0A9396'] as unknown as DataDrivenPropertyValueSpecification<string>;
}

// Un segment du plan de trajet multi-modal (marche ou trajet en ligne) tel
// qu'affiché sur la carte — cf. buildTripSegments dans TripPlannerPage.tsx.
// AUCUNE géométrie réelle de voirie n'existe pour ces segments (GTFS
// shapes.txt confirmé absent des données JungleBus importées) : ce sont des
// lignes droites entre points réels (arrêts GTFS ou coordonnées choisies par
// l'utilisateur) — jamais présentées comme un tracé de rue exact, d'où le
// style pointillé et le label honnête côté UI ("trajet approximatif").
export interface TripSegment {
  kind: 'walk' | 'ride';
  coordinates: [number, number][]; // [lon, lat]
  color?: string; // couleur de la ligne empruntée, pour un segment 'ride'
}

interface MapPoint {
  lat: number;
  lon: number;
  label: string;
}

interface StopsMapProps {
  center: { lat: number; lon: number };
  stops: Stop[];
  onSelectStop?: (stop: Stop) => void;
  userLocation?: { lat: number; lon: number } | null;
  isLocating?: boolean;
  onRecenter?: () => void;
  // Tracé d'itinéraire (GeoJSON LineString, coords [lon, lat]) — null = aucun.
  routeGeometry?: RouteGeometry | null;
  // Sélection d'un point par clic sur la carte (origine/destination du
  // planificateur) — actif seulement quand un champ attend une sélection.
  onMapClick?: (point: { lat: number; lon: number }) => void;
  pickerActive?: boolean;
  // Marqueurs distincts origine (vert) / destination (rouge) du planificateur.
  originMarker?: MapPoint | null;
  destinationMarker?: MapPoint | null;
  // Segments du plan de trajet sélectionné, à dessiner en superposition.
  tripSegments?: TripSegment[] | null;
  // Cercle matérialisant le rayon de recherche actuel autour du centre —
  // demande explicite ("un cercle sur la carte qui montre vraiment le
  // rayon"), null/undefined = masqué.
  radiusCircleMeters?: number | null;
}

// Polygone approximatif d'un cercle réel (grand cercle terrestre, pas une
// simple ellipse en degrés qui déformerait fortement aux latitudes élevées)
// autour d'un centre, pour matérialiser un rayon de recherche sur la carte.
// 64 points : lisse à l'œil sans peser sur le rendu.
const EARTH_RADIUS_METERS = 6_371_000;
function circlePolygon(center: { lat: number; lon: number }, radiusMeters: number, points = 64): [number, number][] {
  const centerLatRad = (center.lat * Math.PI) / 180;
  const coords: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dx = radiusMeters * Math.cos(angle);
    const dy = radiusMeters * Math.sin(angle);
    const lat = center.lat + (dy / EARTH_RADIUS_METERS) * (180 / Math.PI);
    const lon = center.lon + (dx / (EARTH_RADIUS_METERS * Math.cos(centerLatRad))) * (180 / Math.PI);
    coords.push([lon, lat]);
  }
  return coords;
}

// Source/couche du tracé d'itinéraire (ids réservés à cet usage).
const ROUTE_SOURCE_ID = 'route';
const ROUTE_LAYER_ID = 'route-line';
// Source/couche des segments du plan de trajet multi-modal (distincte du
// tracé point-à-point ci-dessus — les deux ne sont jamais actifs ensemble
// dans l'usage réel de l'app, mais gardés séparés pour rester explicites).
const TRIP_SEGMENTS_SOURCE_ID = 'trip-segments';
const TRIP_SEGMENTS_LAYER_ID = 'trip-segments-line';

function upsertTripSegmentsLayer(map: Map, segments: TripSegment[] | null): void {
  const existing = map.getSource(TRIP_SEGMENTS_SOURCE_ID);
  if (!segments || segments.length === 0) {
    if (map.getLayer(TRIP_SEGMENTS_LAYER_ID)) map.removeLayer(TRIP_SEGMENTS_LAYER_ID);
    if (existing) map.removeSource(TRIP_SEGMENTS_SOURCE_ID);
    return;
  }
  const data = {
    type: 'FeatureCollection' as const,
    features: segments.map((seg) => ({
      type: 'Feature' as const,
      properties: { kind: seg.kind, color: seg.color ?? '#0A9396' },
      geometry: { type: 'LineString' as const, coordinates: seg.coordinates },
    })),
  };
  if (existing && existing.type === 'geojson') {
    (existing as GeoJSONSource).setData(data);
    return;
  }
  if (map.getLayer(TRIP_SEGMENTS_LAYER_ID)) map.removeLayer(TRIP_SEGMENTS_LAYER_ID);
  if (existing) map.removeSource(TRIP_SEGMENTS_SOURCE_ID);
  map.addSource(TRIP_SEGMENTS_SOURCE_ID, { type: 'geojson', data });
  const firstSymbolLayer = map.getStyle().layers?.find((l) => l.type === 'symbol');
  map.addLayer(
    {
      id: TRIP_SEGMENTS_LAYER_ID,
      type: 'line',
      source: TRIP_SEGMENTS_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['match', ['get', 'kind'], 'walk', 3, 5],
        'line-dasharray': ['match', ['get', 'kind'], 'walk', ['literal', [2, 2]], ['literal', [1, 0]]],
      },
    },
    firstSymbolLayer?.id,
  );
}

// Arrêts affichés via une source GeoJSON groupée (clustering natif MapLibre/
// supercluster) plutôt que des Markers DOM un par un : à faible zoom, de
// nombreux arrêts proches (hub, gare) sont regroupés en un seul cercle
// numéroté — décongestionnement réel de la carte demandé explicitement
// ("clarté cartographique... décongestion intelligente selon le zoom"), pas
// un simple habillage. Un clic sur un groupe zoome pour le faire éclater ;
// un clic sur un point isolé sélectionne l'arrêt réel (jamais un groupe
// présenté comme s'il s'agissait d'un arrêt unique).
const STOPS_SOURCE_ID = 'stops';
const STOPS_CLUSTER_LAYER_ID = 'stops-clusters';
const STOPS_CLUSTER_COUNT_LAYER_ID = 'stops-cluster-count';
const STOPS_UNCLUSTERED_LAYER_ID = 'stops-unclustered';
const STOPS_CLICKABLE_LAYER_IDS = [STOPS_CLUSTER_LAYER_ID, STOPS_UNCLUSTERED_LAYER_ID];

function stopsToFeatureCollection(stops: Stop[]) {
  return {
    type: 'FeatureCollection' as const,
    features: stops.map((stop) => ({
      type: 'Feature' as const,
      properties: { id: stop.id, stopType: stop.stopType },
      geometry: { type: 'Point' as const, coordinates: [stop.lon, stop.lat] },
    })),
  };
}

function upsertStopsSource(map: Map, stops: Stop[]): void {
  const data = stopsToFeatureCollection(stops);
  const existing = map.getSource(STOPS_SOURCE_ID);
  if (existing && existing.type === 'geojson') {
    (existing as GeoJSONSource).setData(data);
    return;
  }
  map.addSource(STOPS_SOURCE_ID, {
    type: 'geojson',
    data,
    cluster: true,
    clusterMaxZoom: 16,
    clusterRadius: 45,
  });
  map.addLayer({
    id: STOPS_CLUSTER_LAYER_ID,
    type: 'circle',
    source: STOPS_SOURCE_ID,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#005F73',
      'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 30, 26],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  });
  map.addLayer({
    id: STOPS_CLUSTER_COUNT_LAYER_ID,
    type: 'symbol',
    source: STOPS_SOURCE_ID,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-size': 12,
      'text-font': ['Noto Sans Bold', 'Open Sans Bold', 'Arial Unicode MS Bold'],
    },
    paint: { 'text-color': '#ffffff' },
  });
  map.addLayer({
    id: STOPS_UNCLUSTERED_LAYER_ID,
    type: 'circle',
    source: STOPS_SOURCE_ID,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': stopTypeColorExpression(),
      'circle-radius': 8,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  });
}

// Crée ou met à jour le tracé ; le supprime nettement si geometry est null
// (pas de tracé fantôme). La couche est insérée SOUS la première couche de
// symboles du style quand il y en a une : le tracé ne masque ni les noms de
// rues ni les popups (les marqueurs, eux, sont des éléments DOM positionnés
// par-dessus le canvas de toute façon).
function upsertRouteLayer(map: Map, geometry: RouteGeometry | null): void {
  const existing = map.getSource(ROUTE_SOURCE_ID);
  if (!geometry) {
    if (map.getLayer(ROUTE_LAYER_ID)) map.removeLayer(ROUTE_LAYER_ID);
    if (existing) map.removeSource(ROUTE_SOURCE_ID);
    return;
  }
  const data = {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'LineString' as const, coordinates: geometry.coordinates },
  };
  // Mise à jour en place quand la source existe déjà (cas courant).
  if (existing && existing.type === 'geojson') {
    (existing as GeoJSONSource).setData(data);
    return;
  }
  // Recréation (premier tracé, ou après un changement de style MapTiler qui
  // purge les sources/couches personnalisées via setStyle()).
  if (map.getLayer(ROUTE_LAYER_ID)) map.removeLayer(ROUTE_LAYER_ID);
  if (existing) map.removeSource(ROUTE_SOURCE_ID);
  map.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data });
  const firstSymbolLayer = map.getStyle().layers?.find((l) => l.type === 'symbol');
  map.addLayer(
    {
      id: ROUTE_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#0A9396', 'line-width': 4 },
    },
    firstSymbolLayer?.id,
  );
}

// Cercle matérialisant le rayon de recherche actuel — même logique de
// création/mise à jour/suppression que le tracé point-à-point ci-dessus.
const RADIUS_CIRCLE_SOURCE_ID = 'radius-circle';
const RADIUS_CIRCLE_FILL_LAYER_ID = 'radius-circle-fill';
const RADIUS_CIRCLE_LINE_LAYER_ID = 'radius-circle-line';

function upsertRadiusCircleLayer(
  map: Map,
  center: { lat: number; lon: number },
  radiusMeters: number | null
): void {
  const existing = map.getSource(RADIUS_CIRCLE_SOURCE_ID);
  if (!radiusMeters) {
    if (map.getLayer(RADIUS_CIRCLE_FILL_LAYER_ID)) map.removeLayer(RADIUS_CIRCLE_FILL_LAYER_ID);
    if (map.getLayer(RADIUS_CIRCLE_LINE_LAYER_ID)) map.removeLayer(RADIUS_CIRCLE_LINE_LAYER_ID);
    if (existing) map.removeSource(RADIUS_CIRCLE_SOURCE_ID);
    return;
  }
  const data = {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'Polygon' as const, coordinates: [circlePolygon(center, radiusMeters)] },
  };
  if (existing && existing.type === 'geojson') {
    (existing as GeoJSONSource).setData(data);
    return;
  }
  map.addSource(RADIUS_CIRCLE_SOURCE_ID, { type: 'geojson', data });
  const firstSymbolLayer = map.getStyle().layers?.find((l) => l.type === 'symbol');
  map.addLayer(
    {
      id: RADIUS_CIRCLE_FILL_LAYER_ID,
      type: 'fill',
      source: RADIUS_CIRCLE_SOURCE_ID,
      paint: { 'fill-color': '#0A9396', 'fill-opacity': 0.08 },
    },
    firstSymbolLayer?.id,
  );
  map.addLayer(
    {
      id: RADIUS_CIRCLE_LINE_LAYER_ID,
      type: 'line',
      source: RADIUS_CIRCLE_SOURCE_ID,
      paint: { 'line-color': '#0A9396', 'line-width': 2, 'line-dasharray': [3, 2] },
    },
    firstSymbolLayer?.id,
  );
}

export function StopsMap({
  center,
  stops,
  onSelectStop,
  userLocation,
  isLocating,
  onRecenter,
  routeGeometry,
  onMapClick,
  pickerActive,
  originMarker,
  destinationMarker,
  tripSegments,
  radiusCircleMeters,
}: StopsMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const userMarkerRef = useRef<Marker | null>(null);
  const originMarkerRef = useRef<Marker | null>(null);
  const destinationMarkerRef = useRef<Marker | null>(null);
  const tripSegmentsRef = useRef<TripSegment[] | null>(null);
  const radiusCircleRef = useRef<number | null>(null);
  const stopsPopupRef = useRef<Popup | null>(null);
  // Table de correspondance id → arrêt complet, pour retrouver l'objet Stop
  // réel (nom, lignes…) au clic sur un point de la couche groupée (les
  // propriétés GeoJSON d'un feature ne portent que l'id, pas l'objet entier).
  // Un objet simple, pas `Map` : ce nom désigne ici la classe MapLibre.
  const stopsByIdRef = useRef<Record<string, Stop>>({});
  // Dernière liste d'arrêts connue, pour redessiner la couche groupée après
  // un changement de style (setStyle purge les sources/couches perso).
  const stopsRef = useRef<Stop[]>([]);
  useEffect(() => {
    stopsByIdRef.current = Object.fromEntries(stops.map((s) => [s.id, s]));
    stopsRef.current = stops;
  }, [stops]);
  // Callbacks toujours à jour sans réattacher les écouteurs MapLibre à chaque
  // re-render (la carte ne doit s'initialiser qu'une fois, cf. plus bas).
  const onMapClickRef = useRef(onMapClick);
  const onSelectStopRef = useRef(onSelectStop);
  const pickerActiveRef = useRef(pickerActive);
  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);
  useEffect(() => {
    onSelectStopRef.current = onSelectStop;
  }, [onSelectStop]);
  useEffect(() => {
    pickerActiveRef.current = pickerActive;
  }, [pickerActive]);
  // Dernière géométrie connue : permet de redessiner le tracé après un
  // changement de style (setStyle purge les sources/couches perso).
  const routeGeometryRef = useRef<RouteGeometry | null>(null);
  const [styleId, setStyleId] = useState<MapStyleId>(DEFAULT_STYLE);
  const [mapReady, setMapReady] = useState(false);
  // Index de la clé MapTiler actuellement utilisée (-1 = repli OSM final).
  // En ref (pas en state) : lu depuis le handler 'error' stable de MapLibre,
  // pas besoin de re-render à chaque bascule.
  const keyIndexRef = useRef<number>(MAPTILER_KEYS.length > 0 ? 0 : -1);
  const styleIdRef = useRef<MapStyleId>(DEFAULT_STYLE);
  const escalatingRef = useRef(false);
  // Reflète keyIndexRef pour l'UI (le sélecteur de style n'a de sens que sur
  // un vrai style vectoriel MapTiler, pas sur le repli OSM raster) — une ref
  // seule ne déclencherait pas de re-render au moment de la bascule.
  const [onFinalFallback, setOnFinalFallback] = useState(MAPTILER_KEYS.length === 0);

  useEffect(() => {
    styleIdRef.current = styleId;
  }, [styleId]);

  // Applique un style avec la clé/le niveau de repli actuel, puis redessine
  // le tracé d'itinéraire (purgé par tout setStyle()).
  function applyStyle(map: Map, id: MapStyleId) {
    map.setStyle(resolveMapStyle(id, keyIndexRef.current));
    map.once('style.load', () => {
      const geometry = routeGeometryRef.current;
      if (geometry) upsertRouteLayer(map, geometry);
      const segments = tripSegmentsRef.current;
      if (segments) upsertTripSegmentsLayer(map, segments);
      upsertStopsSource(map, stopsRef.current);
      if (radiusCircleRef.current) upsertRadiusCircleLayer(map, center, radiusCircleRef.current);
    });
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new Map({
      container: containerRef.current,
      style: resolveMapStyle(DEFAULT_STYLE, keyIndexRef.current),
      center: [center.lon, center.lat],
      zoom: 15,
    });
    map.addControl(new NavigationControl(), 'top-right');
    map.once('load', () => setMapReady(true));

    // Sélection d'un point par clic (origine/destination du planificateur) —
    // ignoré si aucun champ n'attend de sélection. N'est déclenché que si le
    // clic n'a pas déjà été intercepté par un groupe/point d'arrêt (voir
    // gestionnaires ci-dessous, qui utilisent le même événement 'click' natif
    // — MapLibre exécute les écouteurs de couche puis celui-ci dans l'ordre
    // d'ajout, donc after clic sur un point on choisit quand même de propager
    // ici : un point de destination possible reste sélectionnable au clic
    // même s'il coïncide avec un arrêt, cf. gestion plus bas qui court-circuite
    // via un drapeau).
    let stopClickHandled = false;
    map.on('click', (e) => {
      if (stopClickHandled) {
        stopClickHandled = false;
        return;
      }
      onMapClickRef.current?.({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    });

    // Clic sur un groupe d'arrêts : zoom pour le faire éclater (comportement
    // standard de décongestion MapLibre/supercluster) — jamais présenté comme
    // la sélection d'un arrêt unique.
    map.on('click', STOPS_CLUSTER_LAYER_ID, (e) => {
      stopClickHandled = true;
      const feature = e.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      const source = map.getSource(STOPS_SOURCE_ID) as GeoJSONSource | undefined;
      if (!source || clusterId === undefined || feature?.geometry.type !== 'Point') return;
      const center = feature.geometry.coordinates as [number, number];
      source.getClusterExpansionZoom(clusterId).then((zoom) => {
        map.easeTo({ center, zoom });
      }).catch(() => {
        // Échec ponctuel de calcul de zoom (source pas encore prête) : sans
        // conséquence grave, l'utilisateur peut zoomer manuellement.
      });
    });

    // Clic sur un point isolé : retrouve l'arrêt réel via son id (les
    // propriétés du feature ne portent que l'id, pas l'objet Stop complet) et
    // affiche son nom en popup + notifie le sélecteur (panneau détail).
    map.on('click', STOPS_UNCLUSTERED_LAYER_ID, (e) => {
      stopClickHandled = true;
      const feature = e.features?.[0];
      const id = feature?.properties?.id as string | undefined;
      const stop = id ? stopsByIdRef.current[id] : undefined;
      if (!stop || feature?.geometry.type !== 'Point') return;
      stopsPopupRef.current?.remove();
      stopsPopupRef.current = new Popup({ offset: 12 })
        .setLngLat(feature.geometry.coordinates as [number, number])
        .setText(stop.name ?? 'Arrêt sans nom')
        .addTo(map);
      onSelectStopRef.current?.(stop);
    });

    // Curseur "main" au survol d'un élément sélectionnable — sauf pendant une
    // sélection de point par clic (crosshair prioritaire, géré séparément).
    for (const layerId of STOPS_CLICKABLE_LAYER_IDS) {
      map.on('mouseenter', layerId, () => {
        if (!pickerActiveRef.current) map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = pickerActiveRef.current ? 'crosshair' : '';
      });
    }

    // Bascule automatique clé 1 → clé 2 → OSM sur un échec RÉEL de
    // chargement MapTiler (clé invalide, quota dépassé, panne) — jamais sur
    // une simple supposition (voir isMapTilerLoadFailure). `escalatingRef`
    // évite une cascade si plusieurs requêtes de la même tuile échouent en
    // rafale pour la même cause.
    map.on('error', (e) => {
      if (escalatingRef.current) return;
      if (keyIndexRef.current === -1) return; // déjà au repli OSM final
      if (!isMapTilerLoadFailure(e.error)) return;

      escalatingRef.current = true;
      const previousTier = keyIndexRef.current + 1;
      const hasNextKey = keyIndexRef.current + 1 < MAPTILER_KEYS.length;
      keyIndexRef.current = hasNextKey ? keyIndexRef.current + 1 : -1;
      console.warn(
        `[GbakaMap] Échec de chargement MapTiler (clé ${previousTier}/${MAPTILER_KEYS.length}) — ` +
          `bascule vers ${hasNextKey ? `la clé ${keyIndexRef.current + 1}` : 'le repli OpenStreetMap'}.`
      );
      if (!hasNextKey) setOnFinalFallback(true);
      applyStyle(map, styleIdRef.current);
      escalatingRef.current = false;
    });

    mapRef.current = map;

    return () => {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      routeGeometryRef.current = null;
      if (map.getLayer(ROUTE_LAYER_ID)) map.removeLayer(ROUTE_LAYER_ID);
      if (map.getSource(ROUTE_SOURCE_ID)) map.removeSource(ROUTE_SOURCE_ID);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la carte ne doit s'initialiser qu'une fois
  }, []);

  useEffect(() => {
    mapRef.current?.setCenter([center.lon, center.lat]);
  }, [center.lat, center.lon]);

  // Curseur "réticule" quand un champ du planificateur attend un clic sur la
  // carte — seul indice visuel nécessaire, pas de tooltip flottant qui
  // gênerait la lecture de la carte.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = pickerActive ? 'crosshair' : '';
  }, [pickerActive, mapReady]);

  // Marqueurs origine (vert) / destination (rouge) du planificateur — icône
  // distincte des arrêts (couleurs réservées, cf. STOP_TYPE_COLORS) pour ne
  // jamais laisser croire que ce sont des arrêts de transport réels.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    originMarkerRef.current?.remove();
    originMarkerRef.current = originMarker
      ? new Marker({ color: '#2a9d34' })
          .setLngLat([originMarker.lon, originMarker.lat])
          .setPopup(new Popup({ offset: 12 }).setText(`Départ : ${originMarker.label}`))
          .addTo(map)
      : null;
    return () => {
      originMarkerRef.current?.remove();
      originMarkerRef.current = null;
    };
  }, [originMarker, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    destinationMarkerRef.current?.remove();
    destinationMarkerRef.current = destinationMarker
      ? new Marker({ color: '#c1121f' })
          .setLngLat([destinationMarker.lon, destinationMarker.lat])
          .setPopup(new Popup({ offset: 12 }).setText(`Arrivée : ${destinationMarker.label}`))
          .addTo(map)
      : null;
    return () => {
      destinationMarkerRef.current?.remove();
      destinationMarkerRef.current = null;
    };
  }, [destinationMarker, mapReady]);

  // Segments du plan de trajet sélectionné — mêmes règles de redessin que le
  // tracé point-à-point (upsertRouteLayer) : mise à jour en place si possible,
  // recréation après un changement de style qui purge les couches perso.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const segments = tripSegments ?? null;
    tripSegmentsRef.current = segments;
    upsertTripSegmentsLayer(map, segments);
    if (segments && segments.length > 0) {
      const bounds = segments.reduce(
        (b, seg) => seg.coordinates.reduce((bb, [lon, lat]) => bb.extend([lon, lat]), b),
        new LngLatBounds(),
      );
      map.fitBounds(bounds, { padding: 60 });
    }
  }, [tripSegments, mapReady]);

  // Bascule de style : les Markers sont des éléments DOM indépendants des
  // couches du style, ils survivent à setStyle() sans avoir à être recréés.
  // Le tracé d'itinéraire (source/couche perso), lui, est purgé par setStyle()
  // — on le redessine dès que le nouveau style est prêt.
  function handleStyleChange(id: MapStyleId) {
    if (!mapRef.current || id === styleId) return;
    setStyleId(id);
    applyStyle(mapRef.current, id);
  }

  // Source/couches groupées des arrêts — recréées après un changement de
  // style (setStyle purge tout), mises à jour en place sinon (setData, pas de
  // flash de disparition/réapparition à chaque nouveau rayon de recherche).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    upsertStopsSource(map, stops);
  }, [stops, mapReady]);

  // Cercle du rayon de recherche — recentré/redimensionné à chaque
  // changement de centre ou de rayon (ex. sélection d'un nouveau rayon dans
  // le sélecteur), jamais un cercle figé qui ne suivrait plus la carte.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const radius = radiusCircleMeters ?? null;
    radiusCircleRef.current = radius;
    upsertRadiusCircleLayer(map, center, radius);
  }, [center.lat, center.lon, radiusCircleMeters, mapReady]);

  // Marqueur de la position utilisateur (point bleu + halo, style Maps).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !userLocation) return;

    const el = document.createElement('div');
    el.className = 'user-location-dot';
    el.setAttribute('aria-label', 'Ma position');

    userMarkerRef.current?.remove();
    userMarkerRef.current = new Marker({ element: el }).setLngLat([
      userLocation.lon,
      userLocation.lat,
    ]).addTo(map);

    return () => {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
    };
  }, [userLocation, mapReady]);

  // Tracé d'itinéraire : mise à jour en place quand la source existe déjà,
  // suppression nette quand routeGeometry repasse à null. Un nouveau tracé
  // cadre automatiquement la carte sur l'ensemble du parcours.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const geometry = routeGeometry ?? null;
    routeGeometryRef.current = geometry;
    upsertRouteLayer(map, geometry);
    if (geometry && geometry.coordinates.length > 1) {
      const bounds = geometry.coordinates.reduce(
        (b, [lon, lat]) => b.extend([lon, lat]),
        new LngLatBounds(),
      );
      map.fitBounds(bounds, { padding: 60 });
    }
  }, [routeGeometry, mapReady]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {!onFinalFallback && (
        <div className="map-style-switcher">
          {MAP_STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={s.id === styleId ? 'is-active' : ''}
              onClick={() => handleStyleChange(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      {onRecenter && (
        <button
          type="button"
          className={`map-recenter-btn${isLocating ? ' is-loading' : ''}`}
          onClick={onRecenter}
          disabled={isLocating}
          aria-label="Recentrer sur ma position"
          title="Recentrer sur ma position"
        >
          {isLocating ? (
            <LoaderIcon className="icon-spin" width={20} height={20} aria-hidden="true" />
          ) : (
            <LocateFixedIcon width={20} height={20} aria-hidden="true" />
          )}
        </button>
      )}
      <details className="map-legend">
        <summary>Légende</summary>
        <ul>
          {Object.entries(STOP_TYPE_COLORS).map(([type, color]) => (
            <li key={type}>
              <span
                className="map-legend-dot"
                style={{ backgroundColor: color }}
                aria-hidden="true"
              />
              {STOP_TYPE_LABELS[type] ?? type}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

// =============================================================================
// Carte MapLibre. Styles vectoriels MapTiler (rendu net à toute résolution,
// zoom fluide, bâtiments visibles) — nécessite une clé API gratuite
// (VITE_MAPTILER_KEY, voir .env.example et README). Ni Google Maps ni sa
// clé jamais configurée comme dans l'ancien projet.
//
// Si la clé n'est pas encore renseignée, repli automatique sur des tuiles
// OpenStreetMap brutes (moins nettes, mais garde l'app utilisable pendant
// la configuration) — jamais un écran cassé faute de clé.
// =============================================================================
import { useEffect, useRef, useState } from 'react';
import {
  LngLatBounds,
  Map,
  Marker,
  NavigationControl,
  Popup,
  type GeoJSONSource,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Stop } from '@/lib/api/types';
import type { RouteGeometry } from '@/hooks/useRoute';
import { LoaderIcon, LocateFixedIcon } from '@/components/icons';

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;

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

function resolveMapStyle(styleId: MapStyleId): string | StyleSpecification {
  if (!MAPTILER_KEY) {
    return OSM_FALLBACK_STYLE;
  }
  return `https://api.maptiler.com/maps/${styleId}/style.json?key=${MAPTILER_KEY}`;
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

const STOP_TYPE_LABELS: Record<string, string> = {
  BUS_STOP: 'Bus',
  GBAKA_STOP: 'Gbaka',
  WORO_WORO_STOP: 'Woro-woro',
  TAXI_STAND: 'Taxi',
  MOTO_TAXI_STAND: 'Moto-taxi',
  STATION: 'Gare / Station',
  PLATFORM: 'Quai',
};

interface StopsMapProps {
  center: { lat: number; lon: number };
  stops: Stop[];
  onSelectStop?: (stop: Stop) => void;
  userLocation?: { lat: number; lon: number } | null;
  isLocating?: boolean;
  onRecenter?: () => void;
  // Tracé d'itinéraire (GeoJSON LineString, coords [lon, lat]) — null = aucun.
  routeGeometry?: RouteGeometry | null;
}

// Source/couche du tracé d'itinéraire (ids réservés à cet usage).
const ROUTE_SOURCE_ID = 'route';
const ROUTE_LAYER_ID = 'route-line';

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

export function StopsMap({
  center,
  stops,
  onSelectStop,
  userLocation,
  isLocating,
  onRecenter,
  routeGeometry,
}: StopsMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const userMarkerRef = useRef<Marker | null>(null);
  // Dernière géométrie connue : permet de redessiner le tracé après un
  // changement de style (setStyle purge les sources/couches perso).
  const routeGeometryRef = useRef<RouteGeometry | null>(null);
  const [styleId, setStyleId] = useState<MapStyleId>(DEFAULT_STYLE);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new Map({
      container: containerRef.current,
      style: resolveMapStyle(DEFAULT_STYLE),
      center: [center.lon, center.lat],
      zoom: 15,
    });
    map.addControl(new NavigationControl(), 'top-right');
    map.once('load', () => setMapReady(true));
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

  // Bascule de style : les Markers sont des éléments DOM indépendants des
  // couches du style, ils survivent à setStyle() sans avoir à être recréés.
  // Le tracé d'itinéraire (source/couche perso), lui, est purgé par setStyle()
  // — on le redessine dès que le nouveau style est prêt.
  function handleStyleChange(id: MapStyleId) {
    if (!mapRef.current || id === styleId) return;
    setStyleId(id);
    const map = mapRef.current;
    map.setStyle(resolveMapStyle(id));
    map.once('style.load', () => {
      const geometry = routeGeometryRef.current;
      if (geometry) upsertRouteLayer(map, geometry);
    });
  }

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = stops.map((stop) => {
      const color = STOP_TYPE_COLORS[stop.stopType] ?? '#0A9396';
      const marker = new Marker({ color })
        .setLngLat([stop.lon, stop.lat])
        .setPopup(new Popup({ offset: 12 }).setText(stop.name ?? 'Arrêt sans nom'))
        .addTo(map);

      // Classe pour l'animation d'entrée (le positionnement MapLibre vit sur
      // l'élément lui-même, donc le CSS anime le <svg> interne, pas le wrapper).
      marker.getElement().classList.add('stop-marker');

      if (onSelectStop) {
        marker.getElement().addEventListener('click', () => onSelectStop(stop));
      }
      return marker;
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };
  }, [stops, onSelectStop, mapReady]);

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
      {MAPTILER_KEY && (
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

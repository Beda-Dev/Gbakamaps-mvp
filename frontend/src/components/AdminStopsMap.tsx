// =============================================================================
// Carte d'édition admin — arrêts affichés en Markers DOM déplaçables
// (glisser-déposer), délibérément SÉPARÉE de StopsMap.tsx : la carte
// publique utilise depuis §12.11 une couche GeoJSON groupée (clustering
// MapLibre/supercluster) pour des centaines d'arrêts, qui ne supporte pas
// nativement le drag — un Marker MapLibre `draggable: true` classique est
// la bonne primitive ici, sur un jeu d'arrêts volontairement restreint
// (résultats de recherche admin, pas toute la base).
//
// Déplacement multiple (demande explicite de l'utilisateur, "on puisse
// déplacer un ou plusieurs arrêts, via un glisser-déposer") : si l'arrêt
// glissé fait partie de la sélection multiple ET que la sélection contient
// plus d'un arrêt, TOUS les arrêts sélectionnés se déplacent ensemble du
// même delta — sinon, seul l'arrêt glissé bouge (comportement single-drag
// normal, jamais surprenant).
// =============================================================================
import { useEffect, useRef, useState } from 'react';
import { Map, Marker, NavigationControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { STOP_TYPE_COLORS } from '@/components/StopsMap';
import type { Stop } from '@/lib/api/types';

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;

function resolveStyle(): string {
  // Repli minimal (pas la chaîne à 3 niveaux de StopsMap.tsx — un écran
  // admin interne, moins critique qu'une rupture de service public) :
  // OSM brut si aucune clé MapTiler n'est configurée.
  if (MAPTILER_KEY) {
    return `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`;
  }
  return 'https://demotiles.maplibre.org/style.json';
}

interface AdminStopsMapProps {
  center: { lat: number; lon: number };
  stops: Stop[];
  selectedIds: Set<string>;
  pendingNewPoint: { lat: number; lon: number } | null;
  onMapClick?: (point: { lat: number; lon: number }) => void;
  // Un déplacement : soit un seul arrêt (id, coords), soit un groupe
  // (plusieurs ids, chacun décalé du même delta réel en lat/lon).
  onMoveStops: (moves: { id: string; lat: number; lon: number }[]) => void;
}

export function AdminStopsMap({
  center,
  stops,
  selectedIds,
  pendingNewPoint,
  onMapClick,
  onMoveStops,
}: AdminStopsMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  // `globalThis.Map` explicitement : `Map` dans ce fichier désigne la classe
  // MapLibre (import ci-dessus), pas la collection native.
  const markersRef = useRef<globalThis.Map<string, Marker>>(new globalThis.Map());
  const pendingMarkerRef = useRef<Marker | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const onMoveStopsRef = useRef(onMoveStops);
  const onMapClickRef = useRef(onMapClick);
  const selectedIdsRef = useRef(selectedIds);
  const stopsRef = useRef(stops);
  useEffect(() => {
    onMoveStopsRef.current = onMoveStops;
  }, [onMoveStops]);
  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);
  useEffect(() => {
    stopsRef.current = stops;
  }, [stops]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new Map({
      container: containerRef.current,
      style: resolveStyle(),
      center: [center.lon, center.lat],
      zoom: 15,
    });
    map.addControl(new NavigationControl(), 'top-right');
    map.once('load', () => setMapReady(true));
    map.on('click', (e) => {
      onMapClickRef.current?.({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    });
    mapRef.current = map;
    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la carte ne doit s'initialiser qu'une fois
  }, []);

  useEffect(() => {
    mapRef.current?.setCenter([center.lon, center.lat]);
  }, [center.lat, center.lon]);

  // Un marqueur déplaçable par arrêt chargé — recréés si la liste change,
  // mais PAS repositionnés sur les arrêts déjà présents (un arrêt en cours
  // de glisser ne doit jamais être "rappelé" à sa position serveur avant
  // que l'utilisateur ait relâché).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const currentIds = new Set(stops.map((s) => s.id));
    for (const [id, marker] of markersRef.current) {
      if (!currentIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    for (const stop of stops) {
      if (markersRef.current.has(stop.id)) continue; // déjà affiché, ne pas réinitialiser sa position
      const color = STOP_TYPE_COLORS[stop.stopType] ?? '#0A9396';
      const marker = new Marker({ color, draggable: true })
        .setLngLat([stop.lon, stop.lat])
        .addTo(map);

      let dragStartLngLat: { lng: number; lat: number } | null = null;
      marker.on('dragstart', () => {
        dragStartLngLat = marker.getLngLat();
      });
      marker.on('dragend', () => {
        const end = marker.getLngLat();
        const selected = selectedIdsRef.current;
        const isPartOfMultiSelection = selected.has(stop.id) && selected.size > 1;

        if (!isPartOfMultiSelection || !dragStartLngLat) {
          onMoveStopsRef.current([{ id: stop.id, lat: end.lat, lon: end.lng }]);
          return;
        }

        // Déplacement groupé : même delta réel appliqué à chaque arrêt
        // sélectionné (y compris celui glissé), marqueurs déplacés
        // immédiatement pour un retour visuel cohérent avant confirmation
        // serveur (les mutations PATCH suivent en arrière-plan).
        const deltaLat = end.lat - dragStartLngLat.lat;
        const deltaLon = end.lng - dragStartLngLat.lng;
        const moves: { id: string; lat: number; lon: number }[] = [];
        for (const s of stopsRef.current) {
          if (!selected.has(s.id)) continue;
          const m = markersRef.current.get(s.id);
          if (!m) continue;
          const newLat = s.id === stop.id ? end.lat : s.lat + deltaLat;
          const newLon = s.id === stop.id ? end.lng : s.lon + deltaLon;
          if (s.id !== stop.id) m.setLngLat([newLon, newLat]);
          moves.push({ id: s.id, lat: newLat, lon: newLon });
        }
        onMoveStopsRef.current(moves);
      });

      markersRef.current.set(stop.id, marker);
    }
  }, [stops, mapReady]);

  // Halo de sélection — classe CSS sur l'élément DOM du marqueur (pas de
  // reconstruction du marqueur, juste un indicateur visuel).
  useEffect(() => {
    for (const [id, marker] of markersRef.current) {
      marker.getElement().classList.toggle('admin-stop-marker--selected', selectedIds.has(id));
    }
  }, [selectedIds, stops]);

  // Point en attente de création (clic sur la carte en mode "ajouter") —
  // marqueur temporaire visuellement distinct (pas encore un vrai arrêt).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    pendingMarkerRef.current?.remove();
    pendingMarkerRef.current = pendingNewPoint
      ? new Marker({ color: '#c1121f' }).setLngLat([pendingNewPoint.lon, pendingNewPoint.lat]).addTo(map)
      : null;
    return () => {
      pendingMarkerRef.current?.remove();
      pendingMarkerRef.current = null;
    };
  }, [pendingNewPoint, mapReady]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}

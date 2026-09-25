import type { Layer } from 'leaflet';
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import workerUrl from './maplibreWorker?worker&url';

// OpenFreeMap vector tiles, drawn by MapLibre inside the Leaflet map (§6 Map):
// no API key, no request limit, commercial use allowed - unlike the OSM
// Foundation's own tile server, whose policy lets it withdraw access from
// commercial or heavy users without notice. Attribution is a condition of use.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> ' +
  '&copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';

/**
 * Adds the basemap the first time the Map tab is shown. MapLibre is a large
 * library, so it is imported then rather than with the app - the Areas and
 * Crags tabs never pay for it. If the style or tiles can't load (no signal),
 * the markers still sit on the plain map background, as before.
 */
export function VectorBasemap({ active }: { active: boolean }) {
  const map = useMap();
  const layerRef = useRef<Layer | null>(null);

  // Added once and kept when the user swipes away from the Map tab.
  useEffect(() => {
    if (!active || layerRef.current) return;
    let cancelled = false;
    Promise.all([
      import('maplibre-gl'),
      import('@maplibre/maplibre-gl-leaflet'),
      import('maplibre-gl/dist/maplibre-gl.css'),
    ]).then(([{ setWorkerUrl }, { maplibreGL }]) => {
      if (cancelled || layerRef.current) return;
      setWorkerUrl(workerUrl);
      layerRef.current = maplibreGL({ style: STYLE_URL, attributionControl: { customAttribution: ATTRIBUTION } }).addTo(map);
    });
    return () => {
      cancelled = true;
    };
  }, [active, map]);

  useEffect(
    () => () => {
      layerRef.current?.remove();
      layerRef.current = null;
    },
    [map],
  );

  return null;
}

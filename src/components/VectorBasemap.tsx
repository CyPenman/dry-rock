import type { Layer } from 'leaflet';
import { useEffect, useRef, useState } from 'react';
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

// The lazy MapLibre chunks are named by content hash, and one imports the main
// bundle by its hashed name, so every deploy renames them and GitHub Pages drops
// the old files. A page still running the previous deploy (an installed app
// resumed from the background) then can't load them. One reload picks up the
// new deploy; the flag stops a reload loop if the import fails for another reason.
const RELOADED_FLAG = 'dry-rock:basemap-reloaded';

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Adds the basemap the first time the Map tab is shown. MapLibre is a large
 * library, so it is imported then rather than with the app - the Areas and
 * Crags tabs never pay for it. If the style or tiles can't load (no signal),
 * the markers still sit on the plain map background, with a note saying why.
 */
export function VectorBasemap({ active }: { active: boolean }) {
  const map = useMap();
  const layerRef = useRef<Layer | null>(null);
  // `importFailed`: the chunks never arrived. Browsers remember a failed
  // dynamic import, so only a page reload can try those again.
  const [error, setError] = useState<{ message: string; importFailed: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Added once and kept when the user swipes away from the Map tab.
  useEffect(() => {
    if (!active || layerRef.current) return;
    let cancelled = false;
    Promise.all([
      import('maplibre-gl'),
      import('@maplibre/maplibre-gl-leaflet'),
      import('maplibre-gl/dist/maplibre-gl.css'),
    ]).then(
      ([{ setWorkerUrl }, { maplibreGL }]) => {
        if (cancelled || layerRef.current) return;
        try {
          sessionStorage.removeItem(RELOADED_FLAG);
        } catch {
          // Storage blocked - only the reload guard is lost.
        }
        setWorkerUrl(workerUrl);
        try {
          // MapLibre throws here if the phone can't give it WebGL.
          const layer = maplibreGL({ style: STYLE_URL, attributionControl: { customAttribution: ATTRIBUTION } }).addTo(map);
          layerRef.current = layer;
          const glMap = layer.getMaplibreMap();
          // Only a failure before the style loads leaves the map blank; tile
          // errors afterwards (patchy signal) just leave gaps.
          const onError = (e: { error?: unknown }) => {
            if (!glMap.isStyleLoaded()) setError({ message: describe(e.error), importFailed: false });
          };
          glMap.on('error', onError);
          glMap.once('load', () => {
            glMap.off('error', onError);
            setError(null);
          });
        } catch (err) {
          setError({ message: describe(err), importFailed: false });
        }
      },
      (err: unknown) => {
        if (cancelled) return;
        let reloaded = false;
        try {
          reloaded = sessionStorage.getItem(RELOADED_FLAG) != null;
          if (!reloaded) sessionStorage.setItem(RELOADED_FLAG, '1');
        } catch {
          reloaded = true;
        }
        if (!reloaded) window.location.reload();
        else setError({ message: describe(err), importFailed: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [active, map, attempt]);

  useEffect(
    () => () => {
      layerRef.current?.remove();
      layerRef.current = null;
    },
    [map],
  );

  if (!error) return null;
  return (
    <div
      className="absolute left-14 right-3 top-3 rounded-lg px-3 py-2 text-xs"
      style={{ zIndex: 1000, background: 'var(--ground-raised)', border: '1px solid var(--border)', color: 'var(--text-dim)' }}
    >
      The map background couldn't load ({error.message}). The crag pins are still in the right places.{' '}
      <button
        type="button"
        style={{ color: 'var(--signal)' }}
        onClick={() => {
          if (error.importFailed) {
            window.location.reload();
            return;
          }
          layerRef.current?.remove();
          layerRef.current = null;
          setError(null);
          setAttempt((n) => n + 1);
        }}
      >
        Try again
      </button>
    </div>
  );
}

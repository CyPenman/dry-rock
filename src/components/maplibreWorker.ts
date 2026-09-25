// MapLibre's tile-parsing web worker, as its own entry so Vite bundles it.
// MapLibre finds its worker file next to its own module by URL, which breaks
// once Vite has bundled it - VectorBasemap.tsx points it here instead.
import 'maplibre-gl/dist/maplibre-gl-worker.mjs';

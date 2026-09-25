import { execSync } from 'node:child_process'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// MapLibre's worker (src/components/maplibreWorker.ts) is a module that only
// has side effects - it sets up the worker's message handling - but MapLibre's
// package.json declares its dist files side-effect free, so the production
// bundle tree-shakes the worker to an empty file. Mark that one module as
// having side effects when the worker bundle resolves it.
function keepMaplibreWorker(): Plugin {
  return {
    name: 'keep-maplibre-worker',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!source.endsWith('maplibre-gl-worker.mjs')) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      return resolved && { ...resolved, moduleSideEffects: true }
    },
  }
}

// Stamped into every emailed report (src/api/reports.ts) so it can be replayed
// against the model that produced it: short commit hash plus build date.
function appBuild(): string {
  const date = new Date().toISOString().slice(0, 10)
  try {
    return `${execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()} ${date}`
  } catch {
    return `unknown ${date}`
  }
}

// GitHub Pages serves project sites from /<repo-name>/ - name the repo
// "dry-rock" to match, or change this to "/<your-repo-name>/".
const BASE_PATH = '/dry-rock/'

// https://vite.dev/config/
export default defineConfig({
  base: BASE_PATH,
  define: {
    __APP_BUILD__: JSON.stringify(appBuild()),
  },
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
  worker: {
    plugins: () => [keepMaplibreWorker()],
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'icons/*.png'],
      manifest: {
        name: 'Dry Rock - UK crag conditions',
        short_name: 'Dry Rock',
        description: 'Where in England and Wales is the rock most likely to be dry and climbable, and on which day.',
        theme_color: '#22262A',
        background_color: '#22262A',
        display: 'standalone',
        start_url: BASE_PATH,
        scope: BASE_PATH,
        // vite-plugin-pwa doesn't rebase manifest icon `src` for a non-root
        // `base` (only start_url/scope) - prefix these manually or they 404
        // under GitHub Pages' /<repo-name>/ path.
        icons: [
          { src: `${BASE_PATH}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${BASE_PATH}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
          { src: `${BASE_PATH}icons/icon-maskable-192.png`, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: `${BASE_PATH}icons/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Cache the app shell for offline use, plus the last successful
        // Open-Meteo response - §2: "opening the app in a crag car park with
        // one bar still shows yesterday's data with a staleness warning."
        // The raw forecast bundle itself already lives in IndexedDB (§3.6);
        // this is a second, coarser safety net at the HTTP layer.
        //
        // MapLibre (about 2MB with its worker) is only loaded when the Map tab
        // opens - leave it out of the install-time precache and cache it the
        // first time it is used instead.
        globIgnores: ['**/maplibre*', '**/leaflet-maplibre*'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://api.open-meteo.com',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'open-meteo-forecast',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 3 },
            },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/assets\/(maplibre|leaflet-maplibre)/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'maplibre',
              expiration: { maxEntries: 10 },
            },
          },
          // OpenFreeMap basemap, kept for offline use so a crag car park with
          // no signal still shows the map around any area viewed before.
          // The style and the TileJSON (/planet) are unversioned - fetch them
          // fresh when online, fall back to the saved copy when not. The
          // TileJSON names the dated tile set, so offline it keeps pointing
          // at the tiles already saved.
          {
            urlPattern: ({ url }) =>
              url.origin === 'https://tiles.openfreemap.org' && (url.pathname.startsWith('/styles/') || url.pathname === '/planet'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'map-style',
              networkTimeoutSeconds: 5,
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 10 },
            },
          },
          // Tiles (under a dated /planet/<version>/ path, so never changed in
          // place), fonts, sprites and the shaded-relief overview: served from
          // the phone once saved. Capped by count and age so the cache can't
          // grow without end; dropped first if the phone runs short of space.
          {
            urlPattern: ({ url }) =>
              url.origin === 'https://tiles.openfreemap.org' && /^\/(planet\/|fonts\/|sprites\/|natural_earth\/)/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 1500, maxAgeSeconds: 60 * 60 * 24 * 30, purgeOnQuotaError: true },
            },
          },
        ],
      },
    }),
  ],
})

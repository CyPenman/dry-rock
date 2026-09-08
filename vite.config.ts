import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves project sites from /<repo-name>/ - name the repo
// "dry-rock" to match, or change this to "/<your-repo-name>/".
const BASE_PATH = '/dry-rock/'

// https://vite.dev/config/
export default defineConfig({
  base: BASE_PATH,
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'icons/*.png'],
      manifest: {
        name: 'Dry Rock - UK Crag Conditions',
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
        ],
      },
    }),
  ],
})

import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fr } from './src/i18n/fr.js';

// Pre-render static copy from src/i18n/fr.js into index.html so the first
// paint already has final text sizes (no layout shift when JS boots).
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const t = (path) => path.split('.').reduce((o, k) => o?.[k], fr);
const i18nHtml = () => ({
  name: 'sama-yoon-i18n-html',
  transformIndexHtml: (html) =>
    html
      .replace(/(data-i18n="([\w.]+)"[^>]*>)(<\/)/g, (_, open, key, close) => `${open}${esc(t(key))}${close}`)
      .replace(/(data-filter="(\w+)"[^>]*>)(<\/)/g, (_, open, key, close) => `${open}${esc(fr.filters[key])}${close}`),
});

export default defineConfig({
  plugins: [
    i18nHtml(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Sama Yoon — La mobilité intelligente à Dakar',
        short_name: 'Sama Yoon',
        description: 'Carte de fluidité, itinéraires alternatifs et info-trafic citoyenne pendant les JOJ Dakar 2026.',
        lang: 'fr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F2E3C6',
        theme_color: '#1F2F5C',
        categories: ['travel', 'navigation', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}', 'data/**/*.json'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // Datasets: show cached copy instantly, refresh in background so a
            // new data version reaches users without redeploying the shell.
            urlPattern: ({ url }) => url.pathname.startsWith('/data/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'sy-data', expiration: { maxEntries: 40 } },
          },
          {
            // OSM tiles: offline map of the areas already viewed. Bounded to
            // respect the OSM tile usage policy.
            urlPattern: ({ url }) => url.hostname === 'tile.openstreetmap.org',
            handler: 'CacheFirst',
            options: {
              cacheName: 'sy-tiles',
              expiration: { maxEntries: 300, maxAgeSeconds: 7 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com',
            handler: 'CacheFirst',
            options: { cacheName: 'sy-fonts', expiration: { maxEntries: 10, maxAgeSeconds: 365 * 24 * 3600 }, cacheableResponse: { statuses: [0, 200] } },
          },
          {
            // Live airport board: fresh when online, last answer when offline.
            urlPattern: ({ url }) => url.pathname.startsWith('/.netlify/functions/aibd'),
            handler: 'NetworkFirst',
            options: { cacheName: 'sy-aibd', networkTimeoutSeconds: 4, expiration: { maxEntries: 2, maxAgeSeconds: 3600 } },
          },
          {
            urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/rest/'),
            handler: 'NetworkFirst',
            options: { cacheName: 'sy-api', networkTimeoutSeconds: 4, expiration: { maxEntries: 20, maxAgeSeconds: 2 * 3600 } },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: { leaflet: ['leaflet'] },
      },
    },
  },
});

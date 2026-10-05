import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fr } from './src/i18n/fr.js';

// Pre-render static copy from src/i18n/fr.js into index.html so the first
// paint already has final text sizes (no layout shift when JS boots).
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const t = (path) => path.split('.').reduce((o, k) => o?.[k], fr);
// Canonical public URL (absolute URLs are required by social previews).
const SITE_URL = (process.env.VITE_PUBLIC_URL || 'https://samayoon.app').replace(/\/+$/, '');
const i18nHtml = () => ({
  name: 'sama-yoon-i18n-html',
  transformIndexHtml: (html) =>
    html
      .replaceAll('%SITE_URL%', SITE_URL)
      .replace(/(data-i18n="([\w.]+)"[^>]*>)(<\/)/g, (_, open, key, close) => `${open}${esc(t(key))}${close}`)
      .replace(/(data-filter="(\w+)"[^>]*>)(<\/)/g, (_, open, key, close) => `${open}${esc(fr.filters[key])}${close}`),
});

const seoFiles = () => ({
  name: 'sama-yoon-seo-files',
  apply: 'build',
  generateBundle() {
    const today = new Date().toISOString().slice(0, 10);
    this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *\nAllow: /\nDisallow: /.netlify/\n\nSitemap: ${SITE_URL}/sitemap.xml\n` });
    this.emitFile({
      type: 'asset',
      fileName: 'sitemap.xml',
      source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE_URL}/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>\n</urlset>\n`,
    });
  },
});

export default defineConfig({
  plugins: [
    i18nHtml(),
    seoFiles(),
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
        id: '/',
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
        // Web Push handlers (notifications) live in public/push-sw.js.
        importScripts: ['push-sw.js'],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}', 'data/**/*.json'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/\.netlify\//],
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

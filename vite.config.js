import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.svg', 'icon-512.svg'],
      manifest: {
        name: 'Khelit',
        short_name: 'Khelit',
        description: 'Academy Management — Students, Attendance & Fees',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'icon-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
          {
            src: 'icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Precaching downloads EVERYTHING listed here in the background right
        // after the first page load — for a parent who opened /join on mobile
        // data, that meant ~2.9 MB of owner-only export/report tooling they
        // will never open. These six are excluded and fetched on demand
        // instead; src/sw.js runtime-caches them the first time they're
        // actually used, so offline still works from the second use on.
        globIgnores: [
          '**/exceljs.min-*.js',            // Excel export  (~939 KB)
          '**/exportImport-*.js',           // backup/import (~895 KB)
          '**/sessionPDF-*.js',             // PDF reports   (~606 KB)
          '**/index.es-*.js',               // PDF toolchain (~151 KB)
          '**/generateCategoricalChart-*.js', // recharts    (~351 KB)
          '**/jsQR-*.js',                   // QR scanner    (~130 KB)
        ],
      },
      // NOTE: no `workbox` block here on purpose. With strategies:'injectManifest'
      // vite-plugin-pwa ignores it entirely — the runtimeCaching/navigateFallback
      // that used to sit here never ran. Both live in src/sw.js, which is the
      // file that actually ships.
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Split ONLY stable, eager vendor libs into their own long-cached chunks.
        // Heavy route-only libs (recharts, xlsx, jsQR, qrcode) are deliberately NOT
        // matched here, so Rollup keeps them in their lazy route chunks — matching
        // here would pull them into the eager bundle and bloat first load.
        // App code is never manually chunked (avoids duplicate-module / context bugs).
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|@remix-run[\\/]router|scheduler|use-sync-external-store)[\\/]/.test(id)) {
            return 'react-vendor'
          }
          if (/[\\/]node_modules[\\/]@supabase[\\/]/.test(id)) {
            return 'supabase'
          }
          // everything else → Rollup default (lazy libs stay lazy)
        },
      },
    },
  },
})

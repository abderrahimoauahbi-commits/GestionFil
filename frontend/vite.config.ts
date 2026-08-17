import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const hoteTauri = !!process.env.TAURI_ENV_PLATFORM

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icone-192.png', 'icone-512.png'],
      manifest: {
        name: 'Gestion Fil - Polyfashions Carpet',
        short_name: 'Gestion Fil',
        description: 'Pilotage des achats, stocks et production de matieres premieres',
        lang: 'fr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        categories: ['business', 'productivity'],
        icons: [
          { src: 'icone-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icone-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Cockpit', url: '/', description: 'Indicateurs du jour' },
          { name: 'Mouvements', url: '/mouvements', description: 'Saisir un mouvement de stock' },
          { name: 'Receptions', url: '/receptions', description: 'Peser une reception' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // L'API n'est JAMAIS mise en cache : afficher un stock perime serait
        // pire que de ne rien afficher. L'application est concue pour
        // fonctionner connectee (ADR-001, mode toujours relie au serveur).
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
      // Dans l'enveloppe Tauri, le service worker n'apporte rien : les fichiers
      // sont deja servis depuis le disque.
      disable: hoteTauri,
    }),
  ],

  server: {
    port: 5173,
    strictPort: true,
    // Le front appelle /api sans connaitre l'hote du backend : la meme
    // configuration sert au navigateur, a Tauri et a la PWA.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true },
    },
  },

  // Tauri sert les fichiers depuis le disque : chemins relatifs obligatoires.
  base: hoteTauri ? './' : '/',

  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    target: hoteTauri ? 'esnext' : 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Separe les dependances stables du code applicatif : une correction
        // metier ne fait pas retelecharger React et Radix.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          donnees: ['@tanstack/react-query', '@tanstack/react-table'],
          interface: ['lucide-react', 'sonner'],
        },
      },
    },
  },

  clearScreen: false,
})

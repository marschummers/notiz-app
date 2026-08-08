import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: '/notiz-app/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Notiz App',
        short_name: 'Notiz App',
        description: 'Handschriftliche Notizen mit Apple Pencil, Ordnerstruktur und Tags',
        theme_color: '#17140f',
        background_color: '#17140f',
        display: 'standalone',
        start_url: '/notiz-app/',
        scope: '/notiz-app/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // tests4.html soll fuer die Diagnose-Testmatrix bewusst NICHT vom Service
        // Worker vorgehalten werden - immer frisch vom Netz, kein Stale-Cache waehrend
        // des iterativen Testens. Ein Service Worker kann Touch-/Pointer-Events selbst
        // nicht beeinflussen (er faengt nur fetch-Requests ab), das ist reine Hygiene.
        globIgnores: ['tests4.html'],
        cacheId: 'notiz-app',
      },
    }),
  ],
})

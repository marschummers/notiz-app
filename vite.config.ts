import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Relative Pfade funktionieren sowohl unter der eigenen Domain (/) als auch waehrend des
  // Uebergangs unter der bisherigen GitHub-Pages-Adresse (/notiz-app/).
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Workspace',
        short_name: 'Workspace',
        description: 'Notizen, Wissensmanagement und gemeinsame Projekte an einem Ort',
        theme_color: '#11151f',
        background_color: '#11151f',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png?v=2', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'icon-512.png?v=2', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // tests4.html soll fuer die Diagnose-Testmatrix bewusst NICHT vom Service
        // Worker vorgehalten werden - immer frisch vom Netz, kein Stale-Cache waehrend
        // des iterativen Testens. Ein Service Worker kann Touch-/Pointer-Events selbst
        // nicht beeinflussen (er faengt nur fetch-Requests ab), das ist reine Hygiene.
        //
        // pdf.js (Worker + Render-Code, siehe lib/pdfRender.ts) wird per dynamischem Import
        // nur bei tatsaechlicher PDF-Nutzung nachgeladen und bewusst vom Precache
        // ausgeschlossen - mehrere MB, die sonst jede Installation/jeder App-Start laden
        // wuerde, auch ohne die Funktion je zu benutzen. Offline-PDF-Einfuegen ist fuer
        // diese erste Version explizit nicht vorgesehen.
        globIgnores: ['tests4.html', 'assets/pdf.worker-*.mjs', 'assets/pdfRender-*.js'],
        cacheId: 'notiz-app',
      },
    }),
  ],
})


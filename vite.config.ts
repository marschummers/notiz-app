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
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Notiz App Prototyp',
        short_name: 'Notiz Proto',
        description: 'Prototyp fuer handschriftliche Notizen mit Apple Pencil',
        theme_color: '#1c1b19',
        background_color: '#1c1b19',
        display: 'standalone',
        start_url: '/notiz-app/',
        scope: '/notiz-app/',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        cacheId: 'notiz-app',
      },
    }),
  ],
})

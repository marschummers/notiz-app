import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './lib/auth.tsx'
import { ThemeProvider } from './lib/theme.tsx'
import TestsIndex from './pages/TestsIndex.tsx'
import { PointerTestPage } from './pages/PointerTestPage.tsx'
import { TouchTestPage } from './pages/TouchTestPage.tsx'

// vite-plugin-pwa erzeugt den Service Worker (injectRegister: false in vite.config.ts), meldet
// ihn aber nicht selbst an - das muss hier explizit passieren, sonst bleibt die generierte
// sw.js im Browser komplett wirkungslos (kein Offline-Start, kein Caching). registerType:
// 'prompt' (siehe vite.config.ts) heisst: eine neue Version wird im Hintergrund geladen, aber
// erst beim naechsten Neustart/Neuladen aktiv - der bestehende "App aktualisieren"-Button
// (lib/forceUpdate.ts) bleibt der zuverlaessige Weg, eine neue Version sofort zu erzwingen.
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <HashRouter>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/tests" element={<TestsIndex />} />
          <Route
            path="/tests/1"
            element={
              <PointerTestPage
                title="Test 1: Pointer Events, touch-action: none, ohne Pointer Capture"
                touchAction="none"
              />
            }
          />
          <Route
            path="/tests/2"
            element={
              <PointerTestPage
                title="Test 2: Pointer Events, touch-action: manipulation, ohne Pointer Capture"
                touchAction="manipulation"
              />
            }
          />
          <Route path="/tests/3" element={<TouchTestPage />} />
        </Routes>
        </HashRouter>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
)


import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './lib/auth.tsx'
import TestsIndex from './pages/TestsIndex.tsx'
import { PointerTestPage } from './pages/PointerTestPage.tsx'
import { TouchTestPage } from './pages/TouchTestPage.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
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
  </StrictMode>,
)

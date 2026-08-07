import { useAuth } from './lib/auth'
import LoginPage from './pages/LoginPage'
import Workspace from './pages/Workspace'
import './App.css'

export default function App() {
  const { configured, loading, session } = useAuth()

  if (!configured) {
    return (
      <div className="auth-loading">
        Supabase ist nicht konfiguriert (fehlende Umgebungsvariablen VITE_SUPABASE_URL /
        VITE_SUPABASE_ANON_KEY).
      </div>
    )
  }

  if (loading) {
    return <div className="auth-loading">Lädt…</div>
  }

  if (!session) return <LoginPage />

  return <Workspace />
}

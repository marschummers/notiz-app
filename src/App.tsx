import { useAuth } from './lib/auth'
import LoginPage from './pages/LoginPage'
import Workspace from './pages/Workspace'
import GuestWorkspace from './pages/GuestWorkspace'
import InvitationPage from './pages/InvitationPage'
import { pendingInvitationToken } from './lib/projectInvitations'
import './App.css'

export default function App() {
  const { configured, loading, session, approved, isGuest, refreshApproval, signOut } = useAuth()
  const invitationToken = pendingInvitationToken()

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

  if (invitationToken) return <InvitationPage token={invitationToken} />

  if (approved === null) return <div className="auth-loading">Prüfe Freigabe…</div>

  if (!approved && !isGuest) {
    return (
      <div className="access-waiting-screen">
        <div className="access-waiting-card">
          <p className="access-waiting-eyebrow">Zugang beantragt</p>
          <h1>Warte auf Freigabe</h1>
          <p>
            Deine Anmeldung als <strong>{session.user.email}</strong> ist eingegangen. Sobald dein Zugang freigegeben
            wurde, kannst du die Notiz-App verwenden.
          </p>
          <button className="primary" onClick={refreshApproval}>Freigabe erneut prüfen</button>
          <button className="secondary-action" onClick={signOut}>Abmelden</button>
        </div>
      </div>
    )
  }

  return isGuest && !approved ? <GuestWorkspace /> : <Workspace />
}


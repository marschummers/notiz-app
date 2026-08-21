import { useState } from 'react'
import { acceptProjectInvitation, discardPendingInvitation } from '../lib/projectInvitations'
import { useAuth } from '../lib/auth'
import './LoginPage.css'

export default function InvitationPage({ token, onResolved }: { token: string; onResolved: () => void }) {
  const { session, refreshApproval, signOut } = useAuth()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function accept() {
    setWorking(true)
    setError(null)
    try {
      await acceptProjectInvitation(token)
      await refreshApproval()
      onResolved()
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
      setWorking(false)
    }
  }

  function discard() {
    if (!confirm('Möchtest du diese Einladung wirklich verwerfen? Du kannst den ursprünglichen Einladungslink später erneut öffnen.')) return
    discardPendingInvitation()
    onResolved()
  }

  return <div className="login-screen">
    <h1>Projekteinladung</h1>
    <div className="login-panel">
      <p className="hint">Du bist aktuell als <strong>{session?.user.email}</strong> angemeldet. Nimm die Einladung nur an, wenn sie für diese E-Mail-Adresse erstellt wurde. Danach siehst du ausschließlich das freigegebene Projekt.</p>
      {error && <p className="login-error">{error}</p>}
      <button className="primary-button" onClick={accept} disabled={working}>{working ? 'Wird freigeschaltet…' : 'Einladung annehmen'}</button>
      <button className="secondary-button" onClick={signOut}>Mit anderer E-Mail-Adresse anmelden</button>
      <button className="secondary-button" onClick={discard}>Einladung verwerfen und zurück</button>
    </div>
  </div>
}

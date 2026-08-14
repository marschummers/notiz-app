import { useState } from 'react'
import { acceptProjectInvitation } from '../lib/projectInvitations'
import { useAuth } from '../lib/auth'
import './LoginPage.css'

export default function InvitationPage({ token }: { token: string }) {
  const { session, refreshApproval, signOut } = useAuth()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function accept() {
    setWorking(true)
    setError(null)
    try {
      await acceptProjectInvitation(token)
      await refreshApproval()
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
      setWorking(false)
    }
  }

  return <div className="login-screen">
    <h1>Projekteinladung</h1>
    <div className="login-panel">
      <p className="hint">Die Einladung ist für <strong>{session?.user.email}</strong> bestimmt. Nach der Annahme siehst du ausschließlich das freigegebene Projekt.</p>
      {error && <p className="login-error">{error}</p>}
      <button className="primary-button" onClick={accept} disabled={working}>{working ? 'Wird freigeschaltet…' : 'Einladung annehmen'}</button>
      <button className="secondary-button" onClick={signOut}>Mit anderer E-Mail-Adresse anmelden</button>
    </div>
  </div>
}

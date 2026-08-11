import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabaseClient'
import './AccessRequestsView.css'

interface AccessProfile {
  id: string
  email: string
  display_name: string | null
  approved: boolean
  created_at: string
}

export default function AccessRequestsView({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
  const [profiles, setProfiles] = useState<AccessProfile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    if (!supabase) return
    const { data, error: loadError } = await supabase
      .from('notiz_profiles')
      .select('id, email, display_name, approved, created_at')
      .order('created_at', { ascending: true })
    if (loadError) setError(loadError.message)
    else {
      setError(null)
      setProfiles(data ?? [])
    }
  }

  useEffect(() => { load() }, [])

  async function setApproved(profile: AccessProfile, approved: boolean) {
    if (!supabase) return
    const action = approved ? 'freigeben' : 'den Zugang entziehen'
    if (!confirm(`Möchtest du für ${profile.email} wirklich ${action}?`)) return
    setBusyId(profile.id)
    const { error: updateError } = await supabase.from('notiz_profiles').update({ approved }).eq('id', profile.id)
    setBusyId(null)
    if (updateError) setError(updateError.message)
    else await load()
  }

  const pending = profiles?.filter((profile) => !profile.approved) ?? []
  const approved = profiles?.filter((profile) => profile.approved) ?? []

  return (
    <main className="access-view">
      <header className="access-header">
        {!sidebarOpen && <button className="dashboard-sidebar-toggle" onClick={onToggleSidebar} aria-label="Seitenleiste öffnen">☰</button>}
        <div><p>Zugangsverwaltung</p><h1>Mitglieder</h1></div>
      </header>
      {error && <p className="access-error">{error}</p>}
      <AccessGroup title={`Offene Anfragen (${pending.length})`} empty="Keine offenen Anfragen.">
        {pending.map((profile) => <AccessRow key={profile.id} profile={profile} busy={busyId === profile.id} action="Freigeben" onAction={() => setApproved(profile, true)} />)}
      </AccessGroup>
      <AccessGroup title={`Freigegeben (${approved.length})`} empty="Noch keine freigegebenen Mitglieder.">
        {approved.map((profile) => <AccessRow key={profile.id} profile={profile} busy={busyId === profile.id} action="Zugang entziehen" onAction={() => setApproved(profile, false)} />)}
      </AccessGroup>
    </main>
  )
}

function AccessGroup({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  return <section className="access-group"><h2>{title}</h2><div className="access-list">{children || <p>{empty}</p>}</div></section>
}

function AccessRow({ profile, busy, action, onAction }: { profile: AccessProfile; busy: boolean; action: string; onAction: () => void }) {
  return <div className="access-row"><div><strong>{profile.display_name || profile.email}</strong>{profile.display_name && <span>{profile.email}</span>}<small>Angemeldet am {new Date(profile.created_at).toLocaleDateString('de-DE')}</small></div><button className={profile.approved ? 'secondary-action' : 'primary'} onClick={onAction} disabled={busy}>{busy ? '…' : action}</button></div>
}


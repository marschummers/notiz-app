import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabaseClient'
import './AccessRequestsView.css'

interface AccessProfile {
  id: string
  email: string
  display_name: string | null
  approved: boolean
  rejected_at: string | null
  created_at: string
}

interface AccessAction {
  label: string
  className: string
  onClick: () => void
}

export default function AccessRequestsView({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
  const [profiles, setProfiles] = useState<AccessProfile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    if (!supabase) return
    const { data, error: loadError } = await supabase
      .from('notiz_profiles')
      .select('id, email, display_name, approved, rejected_at, created_at')
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
    const { error: updateError } = await supabase
      .from('notiz_profiles')
      .update({ approved, rejected_at: approved ? null : profile.rejected_at })
      .eq('id', profile.id)
    setBusyId(null)
    if (updateError) setError(updateError.message)
    else await load()
  }

  async function reject(profile: AccessProfile) {
    if (!supabase) return
    if (!confirm(`Möchtest du die Zugangsanfrage von ${profile.email} wirklich ablehnen? Das Konto und vorhandene Daten werden nicht gelöscht.`)) return
    setBusyId(profile.id)
    const { error: updateError } = await supabase
      .from('notiz_profiles')
      .update({ approved: false, rejected_at: new Date().toISOString() })
      .eq('id', profile.id)
    setBusyId(null)
    if (updateError) setError(updateError.message)
    else await load()
  }

  const pending = profiles?.filter((profile) => !profile.approved && !profile.rejected_at) ?? []
  const approved = profiles?.filter((profile) => profile.approved) ?? []
  const rejected = profiles?.filter((profile) => !profile.approved && profile.rejected_at) ?? []

  return (
    <main className="access-view">
      <header className="access-header">
        {!sidebarOpen && <button className="dashboard-sidebar-toggle" onClick={onToggleSidebar} aria-label="Seitenleiste öffnen">☰</button>}
        <div><p>Zugangsverwaltung</p><h1>Mitglieder</h1></div>
      </header>
      {error && <p className="access-error">{error}</p>}
      <AccessGroup title={`Offene Anfragen (${pending.length})`} empty="Keine offenen Anfragen.">
        {pending.map((profile) => <AccessRow key={profile.id} profile={profile} busy={busyId === profile.id} actions={[
          { label: 'Ablehnen', className: 'danger-action', onClick: () => reject(profile) },
          { label: 'Freigeben', className: 'primary', onClick: () => setApproved(profile, true) },
        ]} />)}
      </AccessGroup>
      <AccessGroup title={`Freigegeben (${approved.length})`} empty="Noch keine freigegebenen Mitglieder.">
        {approved.map((profile) => <AccessRow key={profile.id} profile={profile} busy={busyId === profile.id} actions={[
          { label: 'Zugang entziehen', className: 'secondary-action', onClick: () => setApproved(profile, false) },
        ]} />)}
      </AccessGroup>
      <AccessGroup title={`Abgelehnt (${rejected.length})`} empty="Keine abgelehnten Anfragen.">
        {rejected.map((profile) => <AccessRow key={profile.id} profile={profile} busy={busyId === profile.id} rejectedAt={profile.rejected_at} actions={[
          { label: 'Doch freigeben', className: 'secondary-action', onClick: () => setApproved(profile, true) },
        ]} />)}
      </AccessGroup>
    </main>
  )
}

function AccessGroup({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  return <section className="access-group"><h2>{title}</h2><div className="access-list">{children || <p>{empty}</p>}</div></section>
}

function AccessRow({ profile, busy, rejectedAt, actions }: { profile: AccessProfile; busy: boolean; rejectedAt?: string | null; actions: AccessAction[] }) {
  return <div className="access-row"><div><strong>{profile.display_name || profile.email}</strong>{profile.display_name && <span>{profile.email}</span>}<small>Angemeldet am {new Date(profile.created_at).toLocaleDateString('de-DE')}</small>{rejectedAt && <small>Abgelehnt am {new Date(rejectedAt).toLocaleDateString('de-DE')}</small>}</div><div className="access-row-actions">{busy ? <button disabled>…</button> : actions.map((action) => <button key={action.label} className={action.className} onClick={action.onClick}>{action.label}</button>)}</div></div>
}


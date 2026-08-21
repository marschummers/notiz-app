import { type FormEvent, useEffect, useRef, useState } from 'react'
import { ADMIN_EMAIL, useAuth } from '../lib/auth'
import { ensureDefaultFolderStructure } from '../lib/actions'
import { syncAll, updateOwnDisplayName } from '../lib/sync'
import { db } from '../db/db'
import { useTheme } from '../lib/theme'
import type { Selection } from '../lib/selection'
import Sidebar from '../components/Sidebar'
import PageList from '../components/PageList'
import PageEditor from '../components/PageEditor'
import TasksView from '../components/TasksView'
import SearchView from '../components/SearchView'
import AllNotesView from '../components/AllNotesView'
import Dashboard from '../components/Dashboard'
import ProjectsView from '../components/ProjectsView'
import AccessRequestsView from '../components/AccessRequestsView'
import './Workspace.css'
import type { ProjectNavigation } from '../lib/projectNavigation'
import { subscribeProjectRealtime } from '../lib/projectRealtime'

// Deutlich unter den bestehenden Desktop-Breakpoints (800/820 in Dashboard.css/ProjectsView.css)
// - erfasst gezielt nur Handy/schmales Tablet-Hochformat, keine normalen (auch schmaleren)
// Desktop-Fenster, damit sich am Desktop-Verhalten nichts aendert.
const MOBILE_BREAKPOINT = 768
function isMobileViewportNow(): boolean {
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches
}

export default function Workspace() {
  const DEFAULT_SIDEBAR_WIDTH = 260
  const MIN_SIDEBAR_WIDTH = 200
  const { session, signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [selection, setSelection] = useState<Selection>({ type: 'folder', id: undefined })
  const [activeView, setActiveView] = useState<'start' | 'notes' | 'projects' | 'tasks' | 'search' | 'all-notes' | 'access'>('start')
  const [projectNavigation, setProjectNavigation] = useState<ProjectNavigation>({ type: 'overview' })
  const [openPageId, setOpenPageId] = useState<string | null>(null)
  const [pageReturnProjectId, setPageReturnProjectId] = useState<string | null>(null)
  // Auf dem Handy soll die Sidebar als Overlay starten (zu), auf dem Desktop wie bisher offen -
  // isMobileViewport wird per matchMedia synchron beim ersten Render ermittelt, kein Flackern.
  const [isMobileViewport, setIsMobileViewport] = useState(isMobileViewportNow)
  const [sidebarOpen, setSidebarOpen] = useState(() => !isMobileViewportNow())
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [resizingSidebar, setResizingSidebar] = useState(false)
  const sidebarResizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [profileDisplayName, setProfileDisplayName] = useState<string | null>()
  const [editingProfileName, setEditingProfileName] = useState(false)

  async function handleSync() {
    setSyncing(true)
    setSyncError(null)
    try {
      await syncAll()
      // Erst NACH dem Download pruefen, ob das Konto leer ist: Auf einem neuen Geraet soll
      // niemals eine zweite Standardstruktur neben bereits synchronisierten Ordnern entstehen.
      // Neu angelegte Vorgaben direkt ein zweites Mal synchronisieren, damit sie auch auf den
      // anderen Geraeten dieses Benutzers erscheinen.
      if (await ensureDefaultFolderStructure()) await syncAll()
      const currentProfile = session?.user.id ? await db.userProfiles.get(session.user.id) : undefined
      setProfileDisplayName(currentProfile?.displayName?.trim() || null)
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e))
    } finally {
      setSyncing(false)
    }
  }

  // Einmal beim Öffnen synchronisieren, damit man auf einem neuen Gerät sofort seine Ordner/
  // Seiten sieht statt erst manuell den Button drücken zu müssen.
  useEffect(() => {
    handleSync()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => subscribeProjectRealtime(), [])

  // Beim Ueberschreiten der Handy-/Desktop-Grenze (z.B. Bildschirmdrehung, Fenstergroesse) den
  // jeweiligen Standardzustand der Sidebar wiederherstellen - offen auf dem Desktop, zu auf dem
  // Handy, statt einen ggf. nicht mehr passenden Zustand ueber den Wechsel hinweg zu behalten.
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`)
    function onChange(e: MediaQueryListEvent) {
      setIsMobileViewport(e.matches)
      setSidebarOpen(!e.matches)
    }
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  function openPage(id: string, returnProjectId?: string) {
    setOpenPageId(id)
    setPageReturnProjectId(returnProjectId ?? null)
    // Beim Schreiben soll wirklich der komplette Bildschirm zur Verfuegung stehen - die
    // Sidebar faehrt automatisch ein, laesst sich aber jederzeit wieder ausklappen. Gilt schon
    // immer auf jeder Bildschirmgroesse, bewusst unveraendert.
    setSidebarOpen(false)
  }

  // Auf dem Handy liegt die Sidebar als Overlay ueber dem Inhalt (siehe Sidebar.css) - nach der
  // Auswahl eines Menuepunkts soll sie automatisch zufahren, damit der gewaehlte Bereich sichtbar
  // wird, ohne extra antippen zu muessen. Auf dem Desktop bleibt das bestehende Verhalten
  // (Sidebar bleibt beim Navigieren offen) unveraendert.
  function withMobileClose<Args extends unknown[]>(fn: (...args: Args) => void) {
    return (...args: Args) => {
      fn(...args)
      if (isMobileViewport) setSidebarOpen(false)
    }
  }

  // Gemeinsam von Sidebar (Ordner-/Tag-Klick) UND SearchView (Ordner-/Tag-Treffer) genutzt,
  // damit ein Suchergebnis genau dorthin springt, wo ein normaler Sidebar-Klick auch hinfuehrt.
  const selectFolderOrTag = withMobileClose((s: Selection) => {
    setSelection(s)
    setActiveView('notes')
    setOpenPageId(null)
  })

  function startSidebarResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    sidebarResizeRef.current = { pointerId: e.pointerId, startX: e.clientX, startWidth: sidebarWidth }
    e.currentTarget.setPointerCapture(e.pointerId)
    setResizingSidebar(true)
  }

  function moveSidebarResize(e: React.PointerEvent<HTMLDivElement>) {
    const resize = sidebarResizeRef.current
    if (!resize || resize.pointerId !== e.pointerId) return
    const maxWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(560, window.innerWidth - 160))
    setSidebarWidth(Math.min(maxWidth, Math.max(MIN_SIDEBAR_WIDTH, resize.startWidth + e.clientX - resize.startX)))
  }

  function finishSidebarResize(e: React.PointerEvent<HTMLDivElement>) {
    if (sidebarResizeRef.current?.pointerId !== e.pointerId) return
    sidebarResizeRef.current = null
    setResizingSidebar(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  // Ctrl+K/Cmd+K oeffnet die Suche von ueberall im Workspace aus, wie in den meisten Apps mit
  // Befehls-/Suchpalette ueblich.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setActiveView('search')
        setOpenPageId(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="workspace">
      <Sidebar
        open={sidebarOpen}
        width={sidebarWidth}
        resizing={resizingSidebar}
        selection={selection}
        activeView={activeView}
        onSelect={selectFolderOrTag}
        onSelectStart={withMobileClose(() => {
          setActiveView('start')
          setOpenPageId(null)
        })}
        onSelectNotes={withMobileClose(() => {
          setActiveView('notes')
          setOpenPageId(null)
        })}
        onSelectProjects={withMobileClose(() => {
          setProjectNavigation({ type: 'overview' })
          setActiveView('projects')
          setOpenPageId(null)
        })}
        onSelectTasks={withMobileClose(() => {
          setActiveView('tasks')
          setOpenPageId(null)
        })}
        onSelectSearch={withMobileClose(() => {
          setActiveView('search')
          setOpenPageId(null)
        })}
        onSelectAllNotes={withMobileClose(() => {
          setActiveView('all-notes')
          setOpenPageId(null)
        })}
        onSelectAccess={withMobileClose(() => {
          setActiveView('access')
          setOpenPageId(null)
        })}
        onSelectFavorite={openPage}
        onSync={handleSync}
        syncing={syncing}
        syncError={syncError}
        userEmail={session?.user.email}
        userDisplayName={profileDisplayName ?? undefined}
        onEditDisplayName={() => setEditingProfileName(true)}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSignOut={signOut}
        userId={session?.user.id ?? ''}
        projectNavigation={projectNavigation}
        onProjectNavigate={withMobileClose((navigation: ProjectNavigation) => { setProjectNavigation(navigation); setActiveView('projects'); setOpenPageId(null) })}
      />
      {/* Ziehgriff fuer die Desktop-Breite ergibt auf dem Handy (Sidebar liegt dort als
          Overlay mit fester Breite, siehe Sidebar.css) keinen Sinn - dort nicht rendern. */}
      {sidebarOpen && !isMobileViewport && (
        <div
          className={`sidebar-resize-handle${resizingSidebar ? ' active' : ''}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="Breite der Seitenleiste ändern"
          title="Seitenleiste breiter oder schmaler ziehen"
          onPointerDown={startSidebarResize}
          onPointerMove={moveSidebarResize}
          onPointerUp={finishSidebarResize}
          onPointerCancel={finishSidebarResize}
          onDoubleClick={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
        />
      )}
      {/* Abdunkel-Hintergrund fuer die mobile Overlay-Sidebar - antippen schliesst sie wieder,
          wie bei einem ueblichen Drawer-Menü. Nur auf dem Handy relevant, siehe Sidebar.css. */}
      {isMobileViewport && sidebarOpen && (
        <div className="mobile-sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
      )}
      {openPageId ? (
        <PageEditor
          pageId={openPageId}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onBack={() => {
            setOpenPageId(null)
            if (pageReturnProjectId) {
              setProjectNavigation({ type: 'project', id: pageReturnProjectId })
              setActiveView('projects')
            }
            setPageReturnProjectId(null)
            // Auf dem Desktop wie bisher die Sidebar wieder ausklappen; auf dem Handy soll nach
            // "Zurueck" nicht ungefragt das Overlay-Menue aufgehen, sondern nur die Liste.
            setSidebarOpen(!isMobileViewport)
            handleSync()
          }}
          onOpenPage={(id) => openPage(id, pageReturnProjectId ?? undefined)}
        />
      ) : activeView === 'start' ? (
        <Dashboard
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onOpenPage={openPage}
          onOpenSearch={() => setActiveView('search')}
          onOpenAllNotes={() => setActiveView('all-notes')}
          onOpenTasks={() => setActiveView('tasks')}
          onOpenProjects={() => { setProjectNavigation({ type: 'overview' }); setActiveView('projects') }}
          userId={session?.user.id ?? ''}
        />
      ) : activeView === 'projects' ? (
        <ProjectsView
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          userId={session?.user.id ?? ''}
          userEmail={session?.user.email}
          navigation={projectNavigation}
          onNavigate={setProjectNavigation}
          onOpenPage={(id) => {
            const projectId = projectNavigation.type === 'project' ? projectNavigation.id : undefined
            setActiveView('notes')
            openPage(id, projectId)
          }}
        />
      ) : activeView === 'access' && session?.user.email === ADMIN_EMAIL ? (
        <AccessRequestsView sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((value) => !value)} />
      ) : activeView === 'tasks' ? (
        <TasksView
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onOpenPage={openPage}
          onOpenProject={(projectId, taskId) => {
            setProjectNavigation({ type: 'project', id: projectId, taskId })
            setActiveView('projects')
            setOpenPageId(null)
          }}
        />
      ) : activeView === 'search' ? (
        <SearchView
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onOpenPage={openPage}
          onSelectFolder={(id) => selectFolderOrTag({ type: 'folder', id })}
          onSelectTag={(id) => selectFolderOrTag({ type: 'tag', id })}
        />
      ) : activeView === 'all-notes' ? (
        <AllNotesView sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((v) => !v)} onOpenPage={openPage} />
      ) : (
        <PageList selection={selection} sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((v) => !v)} onOpenPage={openPage} />
      )}
      {(profileDisplayName === null || editingProfileName) && session?.user.email && (
        <ProfileNameDialog
          email={session.user.email}
          initialName={profileDisplayName ?? ''}
          onCancel={profileDisplayName ? () => setEditingProfileName(false) : undefined}
          onSave={async (name) => {
            await updateOwnDisplayName(name)
            setProfileDisplayName(name.trim())
            setEditingProfileName(false)
          }}
        />
      )}
    </div>
  )
}

function ProfileNameDialog({ email, initialName, onSave, onCancel }: { email: string; initialName: string; onSave: (name: string) => Promise<void>; onCancel?: () => void }) {
  const [name, setName] = useState(initialName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await onSave(name)
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
      setSaving(false)
    }
  }

  return (
    <div className="profile-name-backdrop">
      <section className="profile-name-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-name-title">
        <p className="profile-name-eyebrow">Dein Profil</p>
        <h2 id="profile-name-title">Wie sollen andere dich sehen?</h2>
        <p>Dieser Name wird bei Projekten und Aufgaben statt deiner E-Mail-Adresse angezeigt.</p>
        <form onSubmit={submit}>
          <label>
            <span>Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Vor- und Nachname" autoFocus autoComplete="name" />
          </label>
          <small>{email}</small>
          {error && <p className="profile-name-error">{error}</p>}
          <div className="profile-name-actions">
            {onCancel && <button type="button" className="secondary" onClick={onCancel} disabled={saving}>Abbrechen</button>}
            <button className="primary" disabled={!name.trim() || saving}>{saving ? 'Wird gespeichert …' : 'Namen speichern'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}

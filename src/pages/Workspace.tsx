import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import { ensureDefaultFolderStructure } from '../lib/actions'
import { syncAll } from '../lib/sync'
import type { Selection } from '../lib/selection'
import Sidebar from '../components/Sidebar'
import PageList from '../components/PageList'
import PageEditor from '../components/PageEditor'
import TasksView from '../components/TasksView'
import SearchView from '../components/SearchView'
import AllNotesView from '../components/AllNotesView'
import './Workspace.css'

export default function Workspace() {
  const DEFAULT_SIDEBAR_WIDTH = 260
  const MIN_SIDEBAR_WIDTH = 200
  const { session, signOut } = useAuth()
  const [selection, setSelection] = useState<Selection>({ type: 'folder', id: undefined })
  const [activeView, setActiveView] = useState<'notes' | 'tasks' | 'search' | 'all-notes'>('notes')
  const [openPageId, setOpenPageId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [resizingSidebar, setResizingSidebar] = useState(false)
  const sidebarResizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

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

  function openPage(id: string) {
    setOpenPageId(id)
    // Beim Schreiben soll wirklich der komplette Bildschirm zur Verfuegung stehen - die
    // Sidebar faehrt automatisch ein, laesst sich aber jederzeit wieder ausklappen.
    setSidebarOpen(false)
  }

  // Gemeinsam von Sidebar (Ordner-/Tag-Klick) UND SearchView (Ordner-/Tag-Treffer) genutzt,
  // damit ein Suchergebnis genau dorthin springt, wo ein normaler Sidebar-Klick auch hinfuehrt.
  function selectFolderOrTag(s: Selection) {
    setSelection(s)
    setActiveView('notes')
    setOpenPageId(null)
  }

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
        onSelectTasks={() => {
          setActiveView('tasks')
          setOpenPageId(null)
        }}
        onSelectSearch={() => {
          setActiveView('search')
          setOpenPageId(null)
        }}
        onSelectAllNotes={() => {
          setActiveView('all-notes')
          setOpenPageId(null)
        }}
        onSelectFavorite={openPage}
        onSync={handleSync}
        syncing={syncing}
        syncError={syncError}
        userEmail={session?.user.email}
        onSignOut={signOut}
      />
      {sidebarOpen && (
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
      {openPageId ? (
        <PageEditor
          pageId={openPageId}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onBack={() => {
            setOpenPageId(null)
            setSidebarOpen(true)
            handleSync()
          }}
          onOpenPage={openPage}
        />
      ) : activeView === 'tasks' ? (
        <TasksView onOpenPage={openPage} />
      ) : activeView === 'search' ? (
        <SearchView
          onOpenPage={openPage}
          onSelectFolder={(id) => selectFolderOrTag({ type: 'folder', id })}
          onSelectTag={(id) => selectFolderOrTag({ type: 'tag', id })}
        />
      ) : activeView === 'all-notes' ? (
        <AllNotesView onOpenPage={openPage} />
      ) : (
        <PageList selection={selection} sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((v) => !v)} onOpenPage={openPage} />
      )}
    </div>
  )
}

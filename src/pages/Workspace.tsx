import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { syncAll } from '../lib/sync'
import type { Selection } from '../lib/selection'
import Sidebar from '../components/Sidebar'
import PageList from '../components/PageList'
import PageEditor from '../components/PageEditor'
import TasksView from '../components/TasksView'
import SearchView from '../components/SearchView'
import './Workspace.css'

export default function Workspace() {
  const { session, signOut } = useAuth()
  const [selection, setSelection] = useState<Selection>({ type: 'folder', id: undefined })
  const [activeView, setActiveView] = useState<'notes' | 'tasks' | 'search'>('notes')
  const [openPageId, setOpenPageId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  async function handleSync() {
    setSyncing(true)
    setSyncError(null)
    try {
      await syncAll()
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
        onSelectFavorite={openPage}
        onSync={handleSync}
        syncing={syncing}
        syncError={syncError}
        userEmail={session?.user.email}
        onSignOut={signOut}
      />
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
      ) : (
        <PageList selection={selection} sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((v) => !v)} onOpenPage={openPage} />
      )}
    </div>
  )
}

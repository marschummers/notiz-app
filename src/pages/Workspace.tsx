import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { syncAll } from '../lib/sync'
import type { Selection } from '../lib/selection'
import Sidebar from '../components/Sidebar'
import PageList from '../components/PageList'
import PageEditor from '../components/PageEditor'
import TasksView from '../components/TasksView'
import './Workspace.css'

export default function Workspace() {
  const { session, signOut } = useAuth()
  const [selection, setSelection] = useState<Selection>({ type: 'folder', id: undefined })
  const [activeView, setActiveView] = useState<'notes' | 'tasks'>('notes')
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

  return (
    <div className="workspace">
      <Sidebar
        open={sidebarOpen}
        selection={selection}
        activeView={activeView}
        onSelect={(s) => {
          setSelection(s)
          setActiveView('notes')
          setOpenPageId(null)
        }}
        onSelectTasks={() => {
          setActiveView('tasks')
          setOpenPageId(null)
        }}
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
        />
      ) : activeView === 'tasks' ? (
        <TasksView onOpenPage={openPage} />
      ) : (
        <PageList selection={selection} sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((v) => !v)} onOpenPage={openPage} />
      )}
    </div>
  )
}

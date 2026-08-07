import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { syncAll } from '../lib/sync'
import type { Selection } from '../lib/selection'
import Sidebar from '../components/Sidebar'
import PageList from '../components/PageList'
import PageEditor from '../components/PageEditor'
import './Workspace.css'

export default function Workspace() {
  const { session, signOut } = useAuth()
  const [selection, setSelection] = useState<Selection>({ type: 'folder', id: undefined })
  const [openPageId, setOpenPageId] = useState<string | null>(null)
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

  return (
    <div className="workspace">
      <Sidebar
        selection={selection}
        onSelect={(s) => {
          setSelection(s)
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
          onBack={() => {
            setOpenPageId(null)
            handleSync()
          }}
        />
      ) : (
        <PageList selection={selection} onOpenPage={setOpenPageId} />
      )}
    </div>
  )
}

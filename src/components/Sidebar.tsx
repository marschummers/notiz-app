import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { createFolder, deleteTag } from '../lib/actions'
import { forceUpdate } from '../lib/forceUpdate'
import type { Selection } from '../lib/selection'
import FolderTree from './FolderTree'
import BrandLogo from './BrandLogo'
import type { AppTheme } from '../lib/theme'
import { ADMIN_EMAIL } from '../lib/auth'
import type { ProjectNavigation } from '../lib/projectNavigation'
import ProjectSidebar from './ProjectSidebar'
import './Sidebar.css'

interface Props {
  open: boolean
  width: number
  resizing: boolean
  selection: Selection
  activeView: 'start' | 'notes' | 'projects' | 'tasks' | 'search' | 'all-notes' | 'access'
  onSelect: (s: Selection) => void
  onSelectStart: () => void
  onSelectNotes: () => void
  onSelectProjects: () => void
  onSelectTasks: () => void
  onSelectSearch: () => void
  onSelectAllNotes: () => void
  onSelectAccess: () => void
  onSelectFavorite: (pageId: string) => void
  onSync: () => void
  syncing: boolean
  syncError: string | null
  userEmail: string | undefined
  userDisplayName?: string
  onEditDisplayName: () => void
  theme: AppTheme
  onToggleTheme: () => void
  onSignOut: () => void
  userId: string
  projectNavigation: ProjectNavigation
  onProjectNavigate: (navigation: ProjectNavigation) => void
}

export default function Sidebar({
  open,
  width,
  resizing,
  selection,
  activeView,
  onSelect,
  onSelectStart,
  onSelectNotes,
  onSelectProjects,
  onSelectTasks,
  onSelectSearch,
  onSelectAllNotes,
  onSelectAccess,
  onSelectFavorite,
  onSync,
  syncing,
  syncError,
  userEmail,
  userDisplayName,
  onEditDisplayName,
  theme,
  onToggleTheme,
  onSignOut,
  userId,
  projectNavigation,
  onProjectNavigate,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [updating, setUpdating] = useState(false)
  const tags = useLiveQuery(() => db.tags.filter((t) => !t.deletedAt).sortBy('name'), [])
  const openTaskCount = useLiveQuery(() => db.tasks.filter((t) => !t.deletedAt && !t.completed).count(), [])
  // Zuletzt favorisiert zuerst - favoritedAt liefert Status und Sortierung in einem Feld
  // (siehe db/types.ts Page), keine separate Sortierlogik noetig. Sortierung ueber eine Kopie
  // statt .sort()/.reverse() direkt auf dem useLiveQuery-Ergebnis: das kann ueber mehrere
  // Renders hinweg dieselbe Array-Referenz liefern, ein In-Place-Reverse wuerde die Reihenfolge
  // dann bei jedem weiteren (auch fachfremden) Rerender erneut umdrehen.
  const favoritesRaw = useLiveQuery(() => db.pages.filter((p) => !p.deletedAt && !!p.favoritedAt).toArray(), [])
  const favorites = favoritesRaw ? [...favoritesRaw].sort((a, b) => (b.favoritedAt ?? 0) - (a.favoritedAt ?? 0)) : undefined

  async function handleForceUpdate() {
    setUpdating(true)
    await forceUpdate()
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Solange eine der uebergreifenden Ansichten (Aufgaben/Suche/Alle Notizen) aktiv ist, soll in
  // Ordnern/Tags nichts als "ausgewaehlt" markiert sein, auch wenn `selection` (fuer den
  // Rueckweg zu Notizen) noch den letzten Ordner/Tag im Speicher haelt. Ein Platzhalter, der nie
  // zu einem echten Ordner passt, statt FolderTree selbst anzufassen.
  const visibleSelection: Selection = activeView === 'notes' ? selection : { type: 'folder', id: '__none__' }

  return (
    <div
      className={`sidebar${open ? '' : ' collapsed'}${resizing ? ' resizing' : ''}`}
      style={open ? { width, minWidth: width } : undefined}
    >
      <div className="sidebar-brand">
        <BrandLogo />
      </div>
      <div className="sidebar-section">
        <div className={`tree-row main-nav-row${activeView === 'start' ? ' selected' : ''}`} onClick={onSelectStart}>
          <span className="tree-label">⌂ Start</span>
        </div>
        <div className={`tree-row main-nav-row${activeView === 'notes' ? ' selected' : ''}`} onClick={onSelectNotes}>
          <span className="tree-label">▤ Notizen</span>
        </div>
        <div className={`tree-row main-nav-row${activeView === 'projects' ? ' selected' : ''}`} onClick={onSelectProjects}>
          <span className="tree-label">▦ Projekte</span>
        </div>
      </div>

      {activeView === 'projects' ? <ProjectSidebar userId={userId} navigation={projectNavigation} onNavigate={onProjectNavigate}/> : <>
      <div className="sidebar-section sidebar-tools-section">
        <div className={`tree-row${activeView === 'tasks' ? ' selected' : ''}`} onClick={onSelectTasks}>
          <span className="tree-label">☑ Aufgaben</span>
          {!!openTaskCount && <span className="task-badge">{openTaskCount}</span>}
        </div>
        <div className={`tree-row${activeView === 'search' ? ' selected' : ''}`} onClick={onSelectSearch}>
          <span className="tree-label">🔍 Suche</span>
        </div>
        <div className={`tree-row${activeView === 'all-notes' ? ' selected' : ''}`} onClick={onSelectAllNotes}>
          <span className="tree-label">🗂️ Alle Notizen</span>
        </div>
        {userEmail === ADMIN_EMAIL && (
          <div className={`tree-row${activeView === 'access' ? ' selected' : ''}`} onClick={onSelectAccess}>
            <span className="tree-label">♙ Zugänge</span>
          </div>
        )}
      </div>

      {!!favorites?.length && (
        <div className="sidebar-section">
          <div className="sidebar-heading">
            <span>Favoriten</span>
          </div>
          {favorites.map((page) => (
            <div key={page.id} className="tree-row" onClick={() => onSelectFavorite(page.id)}>
              <span className="tree-label">★ {page.title || 'Ohne Titel'}</span>
            </div>
          ))}
        </div>
      )}

      <div className="sidebar-section">
        <div className="sidebar-heading">
          <span>Ordner</span>
          <button className="tree-action" onClick={() => createFolder(undefined)} title="Neuer Ordner">
            +
          </button>
        </div>
        <div
          data-folder-drop-target="__root__"
          className={`tree-row root-row${visibleSelection.type === 'folder' && visibleSelection.id === undefined ? ' selected' : ''}`}
          onClick={() => onSelect({ type: 'folder', id: undefined })}
        >
          <span className="tree-label">Nicht abgelegt</span>
        </div>
        <FolderTree
          parentId={undefined}
          depth={0}
          selection={visibleSelection}
          onSelect={onSelect}
          expanded={expanded}
          onToggleExpand={toggleExpand}
        />
      </div>
      <div className="sidebar-section">
        <div className="sidebar-heading">
          <span>Tags</span>
        </div>
        {(tags ?? []).length === 0 && <p className="sidebar-hint">Noch keine Tags vergeben.</p>}
        {(tags ?? []).map((tag) => (
          <div
            key={tag.id}
            className={`tree-row${visibleSelection.type === 'tag' && visibleSelection.id === tag.id ? ' selected' : ''}`}
            onClick={() => onSelect({ type: 'tag', id: tag.id })}
          >
            <span className="tree-label">#{tag.name}</span>
            <button
              className="tree-action"
              onClick={(e) => {
                e.stopPropagation()
                if (window.confirm(`Tag "#${tag.name}" löschen? (bleibt an Seiten nicht mehr sichtbar)`)) {
                  deleteTag(tag.id)
                  if (selection.type === 'tag' && selection.id === tag.id) onSelect({ type: 'folder', id: undefined })
                }
              }}
              aria-label="Tag löschen"
              title="Tag löschen"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      </>}

      <div className="sidebar-footer">
        <button onClick={onSync} disabled={syncing}>
          {syncing ? 'Synchronisiere…' : 'Synchronisieren'}
        </button>
        {syncError && <p className="sidebar-error">{syncError}</p>}
        <button onClick={handleForceUpdate} disabled={updating} title="Hilft, wenn eine alte Version haengen bleibt (z.B. auf dem iPad)">
          {updating ? 'Aktualisiere…' : 'App aktualisieren'}
        </button>
        <button className="theme-switch" onClick={onToggleTheme}>
          Design: {theme === 'winweb' ? 'Winweb' : 'Kupfer'} · wechseln
        </button>
        {userEmail && (
          <div className="sidebar-account">
            <div className="sidebar-account-identity">
              {userDisplayName && <strong>{userDisplayName}</strong>}
              <span>{userEmail}</span>
            </div>
            <div className="sidebar-account-actions">
              <button onClick={onEditDisplayName}>Name ändern</button>
              <button onClick={onSignOut}>Abmelden</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

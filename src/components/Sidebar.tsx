import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { createFolder, deleteTag } from '../lib/actions'
import type { Selection } from '../lib/selection'
import FolderTree from './FolderTree'
import './Sidebar.css'

interface Props {
  selection: Selection
  onSelect: (s: Selection) => void
  onSync: () => void
  syncing: boolean
  syncError: string | null
  userEmail: string | undefined
  onSignOut: () => void
}

export default function Sidebar({ selection, onSelect, onSync, syncing, syncError, userEmail, onSignOut }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const tags = useLiveQuery(() => db.tags.filter((t) => !t.deletedAt).sortBy('name'), [])

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="sidebar">
      <div className="sidebar-section">
        <div className="sidebar-heading">
          <span>Ordner</span>
          <button className="tree-action" onClick={() => createFolder(undefined)} title="Neuer Ordner">
            +
          </button>
        </div>
        <div
          className={`tree-row root-row${selection.type === 'folder' && selection.id === undefined ? ' selected' : ''}`}
          onClick={() => onSelect({ type: 'folder', id: undefined })}
        >
          <span className="tree-label">Nicht abgelegt</span>
        </div>
        <FolderTree
          parentId={undefined}
          depth={0}
          selection={selection}
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
            className={`tree-row${selection.type === 'tag' && selection.id === tag.id ? ' selected' : ''}`}
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

      <div className="sidebar-footer">
        <button onClick={onSync} disabled={syncing}>
          {syncing ? 'Synchronisiere…' : 'Synchronisieren'}
        </button>
        {syncError && <p className="sidebar-error">{syncError}</p>}
        {userEmail && (
          <div className="sidebar-account">
            <span>{userEmail}</span>
            <button onClick={onSignOut}>Abmelden</button>
          </div>
        )}
      </div>
    </div>
  )
}

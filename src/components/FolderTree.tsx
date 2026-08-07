import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { createFolder, deleteFolder, renameFolder } from '../lib/actions'
import type { Selection } from '../lib/selection'

interface Props {
  parentId: string | undefined
  depth: number
  selection: Selection
  onSelect: (s: Selection) => void
  expanded: Set<string>
  onToggleExpand: (id: string) => void
}

export default function FolderTree({ parentId, depth, selection, onSelect, expanded, onToggleExpand }: Props) {
  const folders = useLiveQuery(
    () => db.folders.filter((f) => !f.deletedAt && f.parentId === parentId).sortBy('order'),
    [parentId],
  )

  if (!folders) return null

  return (
    <>
      {folders.map((folder) => {
        const isSelected = selection.type === 'folder' && selection.id === folder.id
        const isExpanded = expanded.has(folder.id)
        return (
          <div key={folder.id}>
            <div
              className={`tree-row${isSelected ? ' selected' : ''}`}
              style={{ paddingLeft: 10 + depth * 16 }}
              onClick={() => onSelect({ type: 'folder', id: folder.id })}
            >
              <button
                className="tree-toggle"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleExpand(folder.id)
                }}
                aria-label={isExpanded ? 'Einklappen' : 'Ausklappen'}
              >
                {isExpanded ? '▾' : '▸'}
              </button>
              <span className="tree-label">{folder.name}</span>
              <button
                className="tree-action"
                onClick={(e) => {
                  e.stopPropagation()
                  createFolder(folder.id).then((id) => {
                    onToggleExpand(folder.id)
                    onSelect({ type: 'folder', id })
                  })
                }}
                aria-label="Unterordner anlegen"
                title="Unterordner anlegen"
              >
                +
              </button>
              <button
                className="tree-action"
                onClick={(e) => {
                  e.stopPropagation()
                  const name = window.prompt('Ordner umbenennen', folder.name)
                  if (name && name.trim()) renameFolder(folder.id, name.trim())
                }}
                aria-label="Umbenennen"
                title="Umbenennen"
              >
                ✎
              </button>
              <button
                className="tree-action"
                onClick={(e) => {
                  e.stopPropagation()
                  if (window.confirm(`"${folder.name}" inkl. Unterordnern und Seiten löschen?`)) {
                    deleteFolder(folder.id)
                    if (isSelected) onSelect({ type: 'folder', id: undefined })
                  }
                }}
                aria-label="Löschen"
                title="Löschen"
              >
                ✕
              </button>
            </div>
            {isExpanded && (
              <FolderTree
                parentId={folder.id}
                depth={depth + 1}
                selection={selection}
                onSelect={onSelect}
                expanded={expanded}
                onToggleExpand={onToggleExpand}
              />
            )}
          </div>
        )
      })}
    </>
  )
}

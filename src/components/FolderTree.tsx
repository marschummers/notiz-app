import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { createFolder, deleteFolder, renameFolder, reorderFolders } from '../lib/actions'
import type { Selection } from '../lib/selection'
import { useDragReorder } from '../lib/useDragReorder'
import DragHandle from './DragHandle'

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

  // ':scope > div > [data-drag-id]' statt nur '[data-drag-id]': FolderTree ist rekursiv, ein
  // ausgeklappter Unterordner rendert seine eigenen Zeilen als Nachfahren INNERHALB dieses
  // Containers - ohne die Scope-Einschraenkung wuerde das Ziehen auf dieser Ebene versehentlich
  // gegen Zeilen einer tieferen Ebene hittesten.
  const { containerRef, dragId, liveIds, onHandleTouchStart, onHandleTouchMove, onHandleTouchEnd, onHandleMouseDown } =
    useDragReorder(reorderFolders, ':scope > div > [data-drag-id]')

  if (!folders) return null

  const naturalIds = folders.map((f) => f.id)
  const foldersById = new Map(folders.map((f) => [f.id, f]))
  const displayIds = liveIds ?? naturalIds
  const displayFolders = displayIds.map((id) => foldersById.get(id)).filter((f): f is NonNullable<typeof f> => !!f)

  return (
    <div ref={containerRef}>
      {displayFolders.map((folder) => {
        const isSelected = selection.type === 'folder' && selection.id === folder.id
        const isExpanded = expanded.has(folder.id)
        return (
          <div key={folder.id}>
            <div
              data-drag-id={folder.id}
              data-folder-drop-target={folder.id}
              className={`tree-row${isSelected ? ' selected' : ''}${dragId === folder.id ? ' dragging' : ''}`}
              style={{ paddingLeft: 10 + depth * 16 }}
              onClick={() => onSelect({ type: 'folder', id: folder.id })}
            >
              <DragHandle
                onTouchStart={(e) => onHandleTouchStart(folder.id, naturalIds, e)}
                onTouchMove={onHandleTouchMove}
                onTouchEnd={onHandleTouchEnd}
                onMouseDown={(e) => onHandleMouseDown(folder.id, naturalIds, e)}
              />
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
    </div>
  )
}

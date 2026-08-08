import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { createPage, deletePage, movePage, reorderPages } from '../lib/actions'
import { formatRelativeTime } from '../lib/format'
import type { Selection } from '../lib/selection'
import { useDragReorder } from '../lib/useDragReorder'
import DragHandle from './DragHandle'
import './PageList.css'

interface Props {
  selection: Selection
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onOpenPage: (id: string) => void
}

export default function PageList({ selection, sidebarOpen, onToggleSidebar, onOpenPage }: Props) {
  const folder = useLiveQuery(
    () => (selection.type === 'folder' && selection.id ? db.folders.get(selection.id) : undefined),
    [selection.type, selection.type === 'folder' ? selection.id : null],
  )

  const tag = useLiveQuery(
    () => (selection.type === 'tag' ? db.tags.get(selection.id) : undefined),
    [selection.type, selection.type === 'tag' ? selection.id : null],
  )

  const pages = useLiveQuery(async () => {
    if (selection.type === 'folder') {
      return db.pages
        .filter((p) => !p.deletedAt && p.folderId === selection.id)
        .sortBy('order')
    }
    const links = await db.pageTags.filter((pt) => !pt.deletedAt && pt.tagId === selection.id).toArray()
    const pageIds = new Set(links.map((l) => l.pageId))
    const all = await db.pages.filter((p) => !p.deletedAt && pageIds.has(p.id)).sortBy('order')
    return all
  }, [selection.type, selection.type === 'folder' ? selection.id : selection.id])

  const heading = selection.type === 'folder' ? (selection.id ? folder?.name ?? '…' : 'Nicht abgelegt') : `#${tag?.name ?? '…'}`

  // Umsortieren INNERHALB der Liste ergibt nur innerhalb eines Ordners Sinn - eine Tag-Ansicht
  // mischt Seiten aus verschiedenen Ordnern, deren `order`-Feld aber weiterhin ihre Position
  // INNERHALB ihres jeweiligen Ordners bestimmt (siehe reorderPages), das wuerde sich sonst
  // ueberschneiden. Der Griff selbst bleibt aber auch in der Tag-Ansicht sichtbar/nutzbar, da
  // das Verschieben in einen ANDEREN Ordner (siehe externalDrop unten) davon unberuehrt ist.
  const canReorder = selection.type === 'folder'
  const { containerRef, dragId, liveIds, onHandleTouchStart, onHandleTouchMove, onHandleTouchEnd, onHandleMouseDown } = useDragReorder(
    canReorder ? reorderPages : () => {},
    '[data-drag-id]',
    {
      // Sidebar/FolderTree markieren Ordner-Zeilen mit data-folder-drop-target (Wurzel = "__root__",
      // siehe FolderTree.tsx/Sidebar.tsx) - beim Loslassen darueber wandert die Seite in diesen
      // Ordner, statt innerhalb der aktuellen Liste umsortiert zu werden.
      selector: '[data-folder-drop-target]',
      attr: 'folderDropTarget',
      onDropOnExternal: (pageId, targetKey) => {
        movePage(pageId, targetKey === '__root__' ? undefined : targetKey)
      },
    },
  )
  const naturalIds = (pages ?? []).map((p) => p.id)
  const pagesById = new Map((pages ?? []).map((p) => [p.id, p]))
  const displayIds = liveIds ?? naturalIds
  const displayPages = displayIds.map((id) => pagesById.get(id)).filter((p): p is NonNullable<typeof p> => !!p)

  return (
    <div className="page-list">
      <div className="page-list-header">
        <button className="sidebar-toggle" onClick={onToggleSidebar} aria-label={sidebarOpen ? 'Seitenleiste einfahren' : 'Seitenleiste ausfahren'}>
          ☰
        </button>
        <h1>{heading}</h1>
        {selection.type === 'folder' && (
          <button onClick={() => createPage(selection.id).then((id) => onOpenPage(id))}>+ Neue Seite</button>
        )}
      </div>
      {(pages ?? []).length === 0 && <p className="page-list-hint">Noch keine Seiten hier.</p>}
      <div className="page-grid" ref={containerRef}>
        {displayPages.map((page) => (
          <div
            key={page.id}
            data-drag-id={page.id}
            className={`page-tile${dragId === page.id ? ' dragging' : ''}`}
            onClick={() => onOpenPage(page.id)}
          >
            <DragHandle
              className="page-tile-handle"
              onTouchStart={(e) => onHandleTouchStart(page.id, naturalIds, e)}
              onTouchMove={onHandleTouchMove}
              onTouchEnd={onHandleTouchEnd}
              onMouseDown={(e) => onHandleMouseDown(page.id, naturalIds, e)}
            />
            <div className="page-tile-preview">Bearbeitet {formatRelativeTime(page.updatedAt)}</div>
            <div className="page-tile-title">{page.title || 'Ohne Titel'}</div>
            <button
              className="page-tile-delete"
              onClick={(e) => {
                e.stopPropagation()
                if (window.confirm(`"${page.title || 'Ohne Titel'}" löschen?`)) deletePage(page.id)
              }}
              aria-label="Seite löschen"
              title="Seite löschen"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

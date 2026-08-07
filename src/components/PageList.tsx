import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { createPage, deletePage } from '../lib/actions'
import type { Selection } from '../lib/selection'
import './PageList.css'

interface Props {
  selection: Selection
  onOpenPage: (id: string) => void
}

export default function PageList({ selection, onOpenPage }: Props) {
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

  return (
    <div className="page-list">
      <div className="page-list-header">
        <h1>{heading}</h1>
        {selection.type === 'folder' && (
          <button onClick={() => createPage(selection.id).then((id) => onOpenPage(id))}>+ Neue Seite</button>
        )}
      </div>
      {(pages ?? []).length === 0 && <p className="page-list-hint">Noch keine Seiten hier.</p>}
      <div className="page-grid">
        {(pages ?? []).map((page) => (
          <div key={page.id} className="page-tile" onClick={() => onOpenPage(page.id)}>
            <div className="page-tile-preview">{page.strokes.length === 0 ? 'Leer' : `${page.strokes.length} Striche`}</div>
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

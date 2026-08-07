import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { addTagToPage, findOrCreateTag, removeTagFromPage, renamePage, updatePageStrokes } from '../lib/actions'
import DrawingCanvas from './DrawingCanvas'
import './PageEditor.css'

interface Props {
  pageId: string
  onBack: () => void
}

export default function PageEditor({ pageId, onBack }: Props) {
  const [newTag, setNewTag] = useState('')
  const page = useLiveQuery(() => db.pages.get(pageId), [pageId])
  const tagLinks = useLiveQuery(() => db.pageTags.filter((pt) => !pt.deletedAt && pt.pageId === pageId).toArray(), [pageId])
  const allTags = useLiveQuery(() => db.tags.filter((t) => !t.deletedAt).toArray(), [])

  if (!page) return null

  const tagIds = new Set((tagLinks ?? []).map((l) => l.tagId))
  const pageTags = (allTags ?? []).filter((t) => tagIds.has(t.id))

  async function submitNewTag() {
    const trimmed = newTag.trim()
    if (!trimmed) return
    const tagId = await findOrCreateTag(trimmed)
    await addTagToPage(pageId, tagId)
    setNewTag('')
  }

  return (
    <div className="page-editor">
      <div className="page-editor-header">
        <button className="back-button" onClick={onBack}>
          ← Zurück
        </button>
        <input
          className="page-title-input"
          value={page.title}
          onChange={(e) => renamePage(pageId, e.target.value)}
          placeholder="Ohne Titel"
        />
      </div>
      <div className="page-tags-row">
        {pageTags.map((tag) => (
          <span key={tag.id} className="tag-chip">
            #{tag.name}
            <button onClick={() => removeTagFromPage(pageId, tag.id)} aria-label={`Tag ${tag.name} entfernen`}>
              ✕
            </button>
          </span>
        ))}
        <input
          className="tag-input"
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submitNewTag()
            }
          }}
          onBlur={submitNewTag}
          placeholder="+ Tag"
        />
      </div>
      <div className="page-editor-canvas">
        <DrawingCanvas key={pageId} initialStrokes={page.strokes} onChange={(strokes) => updatePageStrokes(pageId, strokes)} />
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import {
  addTagToPage,
  createTask,
  deleteTask,
  findOrCreateTag,
  moveTask,
  removeTagFromPage,
  renamePage,
  toggleTask,
  updatePageBackground,
  updatePageStrokes,
  updateTaskText,
} from '../lib/actions'
import type { PageBackground } from '../db/types'
import DrawingCanvas from './DrawingCanvas'
import './PageEditor.css'

const BACKGROUND_LABELS: Record<PageBackground, string> = {
  lined: 'Liniert',
  dotted: 'Gepunktet',
  cornell: 'Cornell',
  blank: 'Leer',
}

interface Props {
  pageId: string
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onBack: () => void
}

export default function PageEditor({ pageId, sidebarOpen, onToggleSidebar, onBack }: Props) {
  const [newTag, setNewTag] = useState('')
  const [taskMode, setTaskMode] = useState(false)
  const page = useLiveQuery(() => db.pages.get(pageId), [pageId])
  const tagLinks = useLiveQuery(() => db.pageTags.filter((pt) => !pt.deletedAt && pt.pageId === pageId).toArray(), [pageId])
  const allTags = useLiveQuery(() => db.tags.filter((t) => !t.deletedAt).toArray(), [])
  const tasks = useLiveQuery(() => db.tasks.filter((t) => !t.deletedAt && t.pageId === pageId).toArray(), [pageId])

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
        <button className="sidebar-toggle" onClick={onToggleSidebar} aria-label={sidebarOpen ? 'Seitenleiste einfahren' : 'Seitenleiste ausfahren'}>
          ☰
        </button>
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
        <select
          className="background-select"
          value={page.background ?? 'lined'}
          onChange={(e) => updatePageBackground(pageId, e.target.value as PageBackground)}
          aria-label="Seitenhintergrund"
        >
          {Object.entries(BACKGROUND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="page-editor-canvas">
        <DrawingCanvas
          key={pageId}
          initialStrokes={page.strokes}
          background={page.background ?? 'lined'}
          title={page.title}
          updatedAt={page.updatedAt}
          onChange={(strokes) => updatePageStrokes(pageId, strokes)}
          tasks={tasks ?? []}
          taskMode={taskMode}
          onCreateTask={async (x, y) => {
            const id = await createTask(pageId, x, y)
            // Nur EIN Todo pro Aktivierung anlegen - der Modus schaltet sich danach von
            // selbst wieder aus, damit der naechste Tap nicht versehentlich ein zweites anlegt.
            setTaskMode(false)
            return id
          }}
          onToggleTask={(id, completed) => toggleTask(id, completed)}
          onEditTaskText={(id, text) => updateTaskText(id, text)}
          onDeleteTask={(id) => deleteTask(id)}
          onMoveTask={(id, x, y) => moveTask(id, x, y)}
          toolbarExtra={
            <button className={taskMode ? 'active' : ''} onClick={() => setTaskMode((v) => !v)}>
              {taskMode ? '☑' : '☐'} Aufgabe
            </button>
          }
        />
      </div>
    </div>
  )
}

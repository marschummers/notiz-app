import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import {
  addTagToPage,
  attachPdfToPage,
  createTask,
  createTextBlock,
  deleteTask,
  deleteTextBlock,
  findOrCreateTag,
  moveTask,
  moveTextBlock,
  removePdfFromPage,
  removeTagFromPage,
  renamePage,
  toggleFavorite,
  toggleTask,
  updatePageBackground,
  updatePageStrokes,
  updateTaskText,
  updateTextBlockText,
  updateTextBlockWidth,
} from '../lib/actions'
import type { PageBackground } from '../db/types'
import Backlinks from './Backlinks'
import DrawingCanvas from './DrawingCanvas'
import { LassoIcon, TaskIcon, TextFieldIcon } from './icons'
import PageProperties from './PageProperties'
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
  onOpenPage: (pageId: string) => void
}

export default function PageEditor({ pageId, sidebarOpen, onToggleSidebar, onBack, onOpenPage }: Props) {
  const [newTag, setNewTag] = useState('')
  const [taskMode, setTaskMode] = useState(false)
  const [textBlockMode, setTextBlockMode] = useState(false)
  const [lassoMode, setLassoMode] = useState(false)
  const page = useLiveQuery(() => db.pages.get(pageId), [pageId])
  const tagLinks = useLiveQuery(() => db.pageTags.filter((pt) => !pt.deletedAt && pt.pageId === pageId).toArray(), [pageId])
  const allTags = useLiveQuery(() => db.tags.filter((t) => !t.deletedAt).toArray(), [])
  const tasks = useLiveQuery(() => db.tasks.filter((t) => !t.deletedAt && t.pageId === pageId).toArray(), [pageId])
  const textBlocks = useLiveQuery(() => db.textBlocks.filter((t) => !t.deletedAt && t.pageId === pageId).toArray(), [pageId])
  // Eine Seite traegt hoechstens einen aktiven PDF-Ausdruck (siehe lib/actions.ts
  // attachPdfToPage) - .first() statt .toArray(), es gibt nie mehr als eine passende Zeile.
  const pdfPrintout = useLiveQuery(
    () => db.pdfPrintouts.filter((p) => !p.deletedAt && p.pageId === pageId).first(),
    [pageId],
  )
  // Fuer die [[-Seitenlink-Autocomplete in Textfeldern - dieselben Daten, die auch die globale
  // Suche (SearchView.tsx) schon verwendet, hier nur auf id+title reduziert.
  const pageLinkCandidates = useLiveQuery(
    () => db.pages.filter((p) => !p.deletedAt).toArray(),
    [],
  )?.map((p) => ({ id: p.id, title: p.title || 'Ohne Titel' }))

  // Lokaler Entwurf statt direkt page.title als value: renamePage() speichert asynchron ueber
  // Dexie, das Zurueckkommen des neuen Titels via useLiveQuery ist dadurch von der eigentlichen
  // Tastatureingabe entkoppelt. Ohne lokalen Entwurf wuerde React bei jedem Tastendruck das
  // <input> mit dem (verzoegert) zurueckkommenden page.title neu belegen - das setzt den Cursor
  // in den meisten Browsern ans Ende, selbst wenn der Text identisch ist. Der Entwurf wird nur
  // beim Wechsel auf eine ANDERE Seite aus page.title neu befuellt (syncedPageIdRef verhindert,
  // dass eine durch die eigene Eingabe ausgeloeste page.title-Aktualisierung den gerade
  // getippten Text ueberschreibt).
  const [titleDraft, setTitleDraft] = useState('')
  const syncedPageIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (page && syncedPageIdRef.current !== pageId) {
      setTitleDraft(page.title)
      syncedPageIdRef.current = pageId
    }
  }, [page, pageId])

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
          value={titleDraft}
          onChange={(e) => {
            setTitleDraft(e.target.value)
            renamePage(pageId, e.target.value)
          }}
          placeholder="Ohne Titel"
        />
        <button
          className={`favorite-toggle${page.favoritedAt ? ' active' : ''}`}
          onClick={() => toggleFavorite(pageId, !page.favoritedAt)}
          aria-label={page.favoritedAt ? 'Favorit entfernen' : 'Als Favorit markieren'}
          title={page.favoritedAt ? 'Favorit entfernen' : 'Als Favorit markieren'}
        >
          {page.favoritedAt ? '★' : '☆'}
        </button>
        <PageProperties page={page} />
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
          textBlocks={textBlocks ?? []}
          textBlockMode={textBlockMode}
          pageLinkCandidates={pageLinkCandidates ?? []}
          onCreateTextBlock={async (x, y) => {
            const id = await createTextBlock(pageId, x, y)
            setTextBlockMode(false)
            return id
          }}
          onEditTextBlockText={(id, text) => updateTextBlockText(id, text)}
          onDeleteTextBlock={(id) => deleteTextBlock(id)}
          onMoveTextBlock={(id, x, y) => moveTextBlock(id, x, y)}
          onResizeTextBlockWidth={(id, width) => updateTextBlockWidth(id, width)}
          onOpenPageLink={(targetPageId) => onOpenPage(targetPageId)}
          pdfPrintout={pdfPrintout ?? null}
          onAttachPdf={async (file) => {
            await attachPdfToPage(pageId, file)
          }}
          onRemovePdf={() => {
            if (pdfPrintout) removePdfFromPage(pdfPrintout.id)
          }}
          lassoMode={lassoMode}
          onRequestExitLasso={() => setLassoMode(false)}
          toolbarExtra={
            <>
              <button
                className={`icon-button${taskMode ? ' active' : ''}`}
                onClick={() => {
                  setTaskMode((v) => !v)
                  setTextBlockMode(false)
                  setLassoMode(false)
                }}
                aria-label="Aufgabe"
                title="Aufgabe"
              >
                <TaskIcon />
              </button>
              <button
                className={`icon-button${textBlockMode ? ' active' : ''}`}
                onClick={() => {
                  setTextBlockMode((v) => !v)
                  setTaskMode(false)
                  setLassoMode(false)
                }}
                aria-label="Textfeld"
                title="Textfeld"
              >
                <TextFieldIcon />
              </button>
              <button
                className={`icon-button${lassoMode ? ' active' : ''}`}
                onClick={() => {
                  setLassoMode((v) => !v)
                  setTaskMode(false)
                  setTextBlockMode(false)
                }}
                aria-label="Lasso-Auswahl"
                title="Lasso-Auswahl"
              >
                <LassoIcon />
              </button>
            </>
          }
        />
      </div>
      <Backlinks pageId={pageId} onOpenPage={onOpenPage} />
    </div>
  )
}


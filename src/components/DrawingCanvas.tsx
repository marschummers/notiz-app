import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { PageBackground, Point, Stroke } from '../db/types'
import { formatRelativeTime } from '../lib/format'
import { BroomIcon, EraserIcon, UndoIcon } from './icons'
import './DrawingCanvas.css'

const COLORS = ['#08060d', '#d1263f', '#1d5fd6']

// x-Koordinaten (Striche + Tasks) werden relativ zur Dokumentbreite gespeichert (Bruchteil,
// z.B. 0.5 = Seitenmitte) statt als absolute Pixel - so bleibt ein Element auf einem breiten
// PC-Bildschirm und einem schmalen iPad an derselben relativen Stelle, obwohl die Zeichenflaeche
// bewusst responsiv bleibt (siehe .drawing-canvas-wrap in DrawingCanvas.css). y bleibt bewusst
// unveraendert absolut (Dokument-/Scroll-Koordinate, nicht durch unterschiedliche Bildschirm-
// hoehen verfaelscht).
//
// Vor diesem Update gespeicherte Seiten/Tasks haben x noch als absoluten Content-Pixel-Wert
// (typischerweise zwei- bis vierstellig). LEGACY_ABS_X_THRESHOLD trennt beide Faelle robust,
// ohne dass eine explizite Datenmigration noetig waere: alte Werte werden unveraendert wie
// bisher als Pixel interpretiert und erst beim naechsten Speichern (Strich zeichnen/Task
// verschieben) automatisch ins neue relative Format ueberfuehrt - komplett non-destruktiv und
// unabhaengig davon, welches Geraet zuerst aktualisiert wird.
const LEGACY_ABS_X_THRESHOLD = 8

function toAbsoluteX(storedX: number, canvasWidth: number): number {
  if (canvasWidth <= 0 || Math.abs(storedX) > LEGACY_ABS_X_THRESHOLD) return storedX
  return storedX * canvasWidth
}

function toStoredX(absoluteX: number, canvasWidth: number): number {
  if (canvasWidth <= 0) return absoluteX
  return absoluteX / canvasWidth
}

function midPoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, pressure: (a.pressure + b.pressure) / 2 }
}

function drawSegment(ctx: CanvasRenderingContext2D, from: Point, control: Point, to: Point, stroke: Stroke) {
  ctx.globalCompositeOperation = stroke.eraser ? 'destination-out' : 'source-over'
  ctx.strokeStyle = stroke.color
  ctx.lineWidth = stroke.eraser ? stroke.width * 3 : Math.max(stroke.width * control.pressure, 0.8)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.quadraticCurveTo(control.x, control.y, to.x, to.y)
  ctx.stroke()
}

function redrawAll(ctx: CanvasRenderingContext2D, width: number, height: number, strokes: Stroke[]) {
  ctx.clearRect(0, 0, width, height)
  for (const stroke of strokes) {
    const pts = stroke.points
    if (pts.length === 1) {
      drawSegment(ctx, pts[0], pts[0], pts[0], stroke)
      continue
    }
    for (let i = 1; i < pts.length - 1; i++) {
      const from = i === 1 ? pts[0] : midPoint(pts[i - 1], pts[i])
      const to = midPoint(pts[i], pts[i + 1])
      drawSegment(ctx, from, pts[i], to, stroke)
    }
  }
}

// Wandelt Striche zwischen internem (absolutem, Canvas-Pixel-) und gespeichertem (relativem)
// x-Format um - siehe toAbsoluteX/toStoredX oben. y bleibt in beiden Richtungen unveraendert.
function withStrokesX(strokes: Stroke[], convert: (x: number, width: number) => number, width: number): Stroke[] {
  return strokes.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p, x: convert(p.x, width) })) }))
}

// Seitenlinks im Text eines Textfelds werden als "[[pageId:Titel]]" im Plaintext codiert (siehe
// db/types.ts TextBlock) - kein eigenes Feld/Schema noetig, Sync bewegt einfach den String wie
// bisher. Der Titel wird mitgespeichert (nicht live nachgeschlagen), damit ein Link auch dann
// noch lesbar bleibt, wenn die Zielseite geloescht wurde; beim Anlegen ist er aber immer aktuell,
// und ein Umbenennen der Zielseite bricht den Link nicht (navigiert wird ueber die pageId).
const LINK_PATTERN = /\[\[([^\]:]+):([^\]]+)\]\]/g

type TextSegment = { type: 'text'; value: string } | { type: 'link'; pageId: string; title: string }

function parseLinkedText(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  let lastIndex = 0
  LINK_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = LINK_PATTERN.exec(text))) {
    if (match.index > lastIndex) segments.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    segments.push({ type: 'link', pageId: match[1], title: match[2] })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) segments.push({ type: 'text', value: text.slice(lastIndex) })
  return segments
}

// Sucht rueckwaerts vom Cursor aus nach einem offenen "[[" (ohne dazwischenliegendes "]]" oder
// Zeilenumbruch) - liefert dessen Startposition + die bereits eingegebene Filter-Query, oder
// null, wenn gerade kein Verlinkungs-Trigger aktiv ist.
function findActiveLinkTrigger(text: string, cursor: number): { start: number; query: string } | null {
  const upToCursor = text.slice(0, cursor)
  const openIdx = upToCursor.lastIndexOf('[[')
  if (openIdx === -1) return null
  const between = upToCursor.slice(openIdx + 2)
  if (between.includes(']]') || between.includes('\n')) return null
  return { start: openIdx, query: between }
}

function describeTouch(t: Touch): { touchType: string; force: number } {
  // touchType ist eine nicht-standardisierte WebKit-Erweiterung des Touch-Interface,
  // die im DOM-Lib-Typing von TypeScript fehlt ('stylus' fuer Apple Pencil, 'direct' fuer Finger).
  const touchType = (t as unknown as { touchType?: string }).touchType ?? 'direct'
  const force = typeof t.force === 'number' && t.force > 0 ? t.force : 0.5
  return { touchType, force }
}

interface ViewState {
  scale: number
  x: number
  y: number
}

const MIN_SCALE = 0.5
const MAX_SCALE = 4

interface PinchState {
  startDist: number
  startScale: number
  startMidX: number
  startMidY: number
  startPanX: number
  startPanY: number
}

// Ein To-do, wie es auf der Seite platziert dargestellt wird - siehe db/types.ts Task, hier
// bewusst ohne pageId/createdAt/deletedAt (die kennt DrawingCanvas nicht, das ist reine
// Darstellung + Interaktion, die eigentlichen Dexie-Operationen laufen ueber die Callback-Props).
interface DrawingTask {
  id: string
  text: string
  completed: boolean
  x: number
  y: number
}

// Wie lange (ms) der Finger ohne nennenswerte Bewegung ruhen muss, bevor aus einem Antippen
// ein Verschieben wird - lang genug, dass ein normaler Tap (Checkbox/Text/Loeschen) nicht aus
// Versehen zum Ziehen wird, kurz genug, dass es sich nicht traege anfuehlt.
const LONG_PRESS_MS = 450
// Bewegung in Pixern, ab der ein wartender Long-Press abgebrochen wird (z.B. ein Wisch statt
// eines ruhigen Haltens).
const LONG_PRESS_CANCEL_DISTANCE = 8

// Ein einzelner To-do-Block auf dem Papier: Checkbox, Text (oder Eingabefeld beim Bearbeiten),
// Loeschen-Button. Sitzt oberhalb des Zeichen-Overlays (siehe .task-layer weiter unten) und hat
// eigenes pointer-events:auto, damit Antippen hier nie als Zeichen-/Zoom-Geste interpretiert wird.
// Langes Gedrueckthalten mit dem FINGER (nicht dem Stift - der tippt fuer Checkbox/Text/Editieren)
// verschiebt den Block an eine neue Position, siehe onTouchStart/-Move/-End unten.
function TaskBlock({
  task,
  editing,
  clientToContent,
  onStartEdit,
  onToggle,
  onSaveText,
  onDelete,
  onMove,
}: {
  task: DrawingTask
  editing: boolean
  clientToContent: (clientX: number, clientY: number) => { x: number; y: number }
  onStartEdit: () => void
  onToggle: () => void
  onSaveText: (text: string) => void
  onDelete: () => void
  onMove: (x: number, y: number) => void
}) {
  const [draft, setDraft] = useState(task.text)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressArmedRef = useRef(false)
  const draggingRef = useRef(false)
  const startClientRef = useRef<{ x: number; y: number } | null>(null)
  const justDraggedRef = useRef(false)
  const mouseMoveHandlerRef = useRef<((e: MouseEvent) => void) | null>(null)
  const mouseUpHandlerRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (editing) setDraft(task.text)
  }, [editing, task.text])

  // Laufende Maus-Listener am Fenster entfernen, falls der Block waehrend eines Ziehens
  // verschwindet (z.B. durch Loeschen) - sonst haengen sie auf window herum.
  useEffect(() => {
    return () => {
      if (mouseMoveHandlerRef.current) window.removeEventListener('mousemove', mouseMoveHandlerRef.current)
      if (mouseUpHandlerRef.current) window.removeEventListener('mouseup', mouseUpHandlerRef.current)
    }
  }, [])

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  function startDrag(clientX: number, clientY: number) {
    draggingRef.current = true
    setDragPos(clientToContent(clientX, clientY))
  }

  function updateDrag(clientX: number, clientY: number) {
    setDragPos(clientToContent(clientX, clientY))
  }

  function finishDrag() {
    draggingRef.current = false
    justDraggedRef.current = true
    setTimeout(() => {
      justDraggedRef.current = false
    }, 300)
    setDragPos((pos) => {
      if (pos) onMove(pos.x, pos.y)
      return null
    })
  }

  function handleTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    const t = e.touches[0]
    if (!t) return
    const touchType = (t as unknown as { touchType?: string }).touchType ?? 'direct'
    // Nur der Finger loest Verschieben aus - der Stift tippt fuer Checkbox/Text/Bearbeiten,
    // dafuer reicht der normale onClick weiter unten.
    if (touchType !== 'direct') return
    startClientRef.current = { x: t.clientX, y: t.clientY }
    longPressArmedRef.current = true
    clearLongPressTimer()
    longPressTimerRef.current = setTimeout(() => {
      if (!longPressArmedRef.current) return
      startDrag(t.clientX, t.clientY)
    }, LONG_PRESS_MS)
  }

  function handleTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    const t = e.touches[0]
    const start = startClientRef.current
    if (!t || !start) return
    if (!draggingRef.current) {
      const moved = Math.hypot(t.clientX - start.x, t.clientY - start.y)
      if (moved > LONG_PRESS_CANCEL_DISTANCE) {
        // Bewegung, bevor der Long-Press ausgeloest hat - kein Ziehen, einfach abbrechen.
        longPressArmedRef.current = false
        clearLongPressTimer()
      }
      return
    }
    // Kein e.preventDefault() hier: Reacts synthetische Touch-Handler sind passiv registriert,
    // das wuerde nur eine Konsolenwarnung erzeugen. touch-action: none (siehe .task-block in
    // DrawingCanvas.css) unterdrueckt Scrollen/Zoomen bereits auf CSS-Ebene.
    e.stopPropagation()
    updateDrag(t.clientX, t.clientY)
  }

  function handleTouchEnd() {
    clearLongPressTimer()
    longPressArmedRef.current = false
    startClientRef.current = null
    if (draggingRef.current) finishDrag()
  }

  // Der Greif-Punkt links am Block: hier startet das Ziehen sofort (kein Warten wie beim
  // Long-Press auf dem restlichen Block noetig, da das Greifen hier eindeutig beabsichtigt ist)
  // - und funktioniert zusaetzlich mit der Maus, fuer Tests/Bedienung am PC ohne Touchscreen.
  function handleHandleTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    e.stopPropagation()
    const t = e.touches[0]
    if (!t) return
    const touchType = (t as unknown as { touchType?: string }).touchType ?? 'direct'
    if (touchType !== 'direct') return
    clearLongPressTimer()
    longPressArmedRef.current = false
    startDrag(t.clientX, t.clientY)
  }

  function handleHandleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    e.stopPropagation()
    e.preventDefault()
    startDrag(e.clientX, e.clientY)
    const onMove = (ev: MouseEvent) => updateDrag(ev.clientX, ev.clientY)
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      mouseMoveHandlerRef.current = null
      mouseUpHandlerRef.current = null
      finishDrag()
    }
    mouseMoveHandlerRef.current = onMove
    mouseUpHandlerRef.current = onUp
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const pos = dragPos ?? { x: task.x, y: task.y }

  return (
    <div
      className={`task-block${task.completed ? ' completed' : ''}${dragPos ? ' dragging' : ''}`}
      style={{ left: pos.x, top: pos.y }}
      onClick={(e) => e.stopPropagation()}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <div
        className="task-drag-handle"
        onTouchStart={handleHandleTouchStart}
        onMouseDown={handleHandleMouseDown}
        aria-hidden="true"
      >
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <input
        type="checkbox"
        className="task-checkbox"
        checked={task.completed}
        onChange={() => {
          if (justDraggedRef.current) return
          onToggle()
        }}
      />
      {editing ? (
        <input
          className="task-text-input"
          value={draft}
          autoFocus
          placeholder="Aufgabe eingeben …"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onSaveText(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onSaveText(draft)
            }
          }}
        />
      ) : (
        <span
          className="task-text"
          onClick={() => {
            if (justDraggedRef.current) return
            onStartEdit()
          }}
        >
          {task.text || 'Aufgabe eingeben …'}
        </span>
      )}
      <button className="task-delete" onClick={onDelete} aria-label="Aufgabe löschen" title="Aufgabe löschen">
        ✕
      </button>
    </div>
  )
}

// Ein per Tastatur beschriebenes Textfeld auf der Seite - gleiche Platzierungs-/Zieh-Logik wie
// TaskBlock (bewusst dupliziert statt TaskBlock zu verallgemeinern, um bestehenden, bereits
// getesteten Task-Code nicht anzufassen), aber ohne Checkbox und mit [[-Seitenverlinkung: "[["
// im Text oeffnet eine kleine Trefferliste bestehender Seiten, Klick/Enter fuegt "[[pageId:
// Titel]]" ein. In der schreibgeschuetzten Ansicht wird das als klickbarer Link gerendert.
interface DrawingTextBlock {
  id: string
  text: string
  x: number
  y: number
}

function TextBlockItem({
  block,
  editing,
  clientToContent,
  pageLinkCandidates,
  onStartEdit,
  onSaveText,
  onDelete,
  onMove,
  onOpenPageLink,
}: {
  block: DrawingTextBlock
  editing: boolean
  clientToContent: (clientX: number, clientY: number) => { x: number; y: number }
  pageLinkCandidates: { id: string; title: string }[]
  onStartEdit: () => void
  onSaveText: (text: string) => void
  onDelete: () => void
  onMove: (x: number, y: number) => void
  onOpenPageLink: (pageId: string) => void
}) {
  const [draft, setDraft] = useState(block.text)
  const [linkTrigger, setLinkTrigger] = useState<{ start: number; query: string } | null>(null)
  const [linkActiveIndex, setLinkActiveIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressArmedRef = useRef(false)
  const draggingRef = useRef(false)
  const startClientRef = useRef<{ x: number; y: number } | null>(null)
  const justDraggedRef = useRef(false)
  const mouseMoveHandlerRef = useRef<((e: MouseEvent) => void) | null>(null)
  const mouseUpHandlerRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (editing) {
      setDraft(block.text)
      setLinkTrigger(null)
    }
  }, [editing, block.text])

  useEffect(() => {
    return () => {
      if (mouseMoveHandlerRef.current) window.removeEventListener('mousemove', mouseMoveHandlerRef.current)
      if (mouseUpHandlerRef.current) window.removeEventListener('mouseup', mouseUpHandlerRef.current)
    }
  }, [])

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  function startDrag(clientX: number, clientY: number) {
    draggingRef.current = true
    setDragPos(clientToContent(clientX, clientY))
  }

  function updateDrag(clientX: number, clientY: number) {
    setDragPos(clientToContent(clientX, clientY))
  }

  function finishDrag() {
    draggingRef.current = false
    justDraggedRef.current = true
    setTimeout(() => {
      justDraggedRef.current = false
    }, 300)
    setDragPos((pos) => {
      if (pos) onMove(pos.x, pos.y)
      return null
    })
  }

  function handleTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    const t = e.touches[0]
    if (!t) return
    const touchType = (t as unknown as { touchType?: string }).touchType ?? 'direct'
    if (touchType !== 'direct') return
    startClientRef.current = { x: t.clientX, y: t.clientY }
    longPressArmedRef.current = true
    clearLongPressTimer()
    longPressTimerRef.current = setTimeout(() => {
      if (!longPressArmedRef.current) return
      startDrag(t.clientX, t.clientY)
    }, LONG_PRESS_MS)
  }

  function handleTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    const t = e.touches[0]
    const start = startClientRef.current
    if (!t || !start) return
    if (!draggingRef.current) {
      const moved = Math.hypot(t.clientX - start.x, t.clientY - start.y)
      if (moved > LONG_PRESS_CANCEL_DISTANCE) {
        longPressArmedRef.current = false
        clearLongPressTimer()
      }
      return
    }
    e.stopPropagation()
    updateDrag(t.clientX, t.clientY)
  }

  function handleTouchEnd() {
    clearLongPressTimer()
    longPressArmedRef.current = false
    startClientRef.current = null
    if (draggingRef.current) finishDrag()
  }

  function handleHandleTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    e.stopPropagation()
    const t = e.touches[0]
    if (!t) return
    const touchType = (t as unknown as { touchType?: string }).touchType ?? 'direct'
    if (touchType !== 'direct') return
    clearLongPressTimer()
    longPressArmedRef.current = false
    startDrag(t.clientX, t.clientY)
  }

  function handleHandleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    e.stopPropagation()
    e.preventDefault()
    startDrag(e.clientX, e.clientY)
    const onMoveHandler = (ev: MouseEvent) => updateDrag(ev.clientX, ev.clientY)
    const onUp = () => {
      window.removeEventListener('mousemove', onMoveHandler)
      window.removeEventListener('mouseup', onUp)
      mouseMoveHandlerRef.current = null
      mouseUpHandlerRef.current = null
      finishDrag()
    }
    mouseMoveHandlerRef.current = onMoveHandler
    mouseUpHandlerRef.current = onUp
    window.addEventListener('mousemove', onMoveHandler)
    window.addEventListener('mouseup', onUp)
  }

  const matchedPages = linkTrigger
    ? pageLinkCandidates.filter((p) => p.title.toLowerCase().includes(linkTrigger.query.toLowerCase())).slice(0, 6)
    : []

  function handleDraftChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value
    setDraft(value)
    const cursor = e.target.selectionStart ?? value.length
    setLinkTrigger(findActiveLinkTrigger(value, cursor))
    setLinkActiveIndex(0)
  }

  function insertLink(page: { id: string; title: string }) {
    if (!linkTrigger) return
    const cursor = textareaRef.current?.selectionStart ?? draft.length
    const before = draft.slice(0, linkTrigger.start)
    const after = draft.slice(cursor)
    const inserted = `[[${page.id}:${page.title}]]`
    const next = before + inserted + after
    setDraft(next)
    setLinkTrigger(null)
    requestAnimationFrame(() => {
      const pos = before.length + inserted.length
      textareaRef.current?.setSelectionRange(pos, pos)
      textareaRef.current?.focus()
    })
  }

  function handleDraftKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (linkTrigger && matchedPages.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setLinkActiveIndex((i) => Math.min(i + 1, matchedPages.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setLinkActiveIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        insertLink(matchedPages[linkActiveIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setLinkTrigger(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      // Enter (ohne Shift) speichert - Shift+Enter erlaubt einen Zeilenumbruch, das Textfeld
      // darf im Gegensatz zum einzeiligen Task-Text mehrzeilig sein.
      e.preventDefault()
      onSaveText(draft)
    }
  }

  const pos = dragPos ?? { x: block.x, y: block.y }
  const segments = block.text ? parseLinkedText(block.text) : []

  return (
    <div
      className={`text-block${dragPos ? ' dragging' : ''}`}
      style={{ left: pos.x, top: pos.y }}
      onClick={(e) => e.stopPropagation()}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <div
        className="text-block-drag-handle"
        onTouchStart={handleHandleTouchStart}
        onMouseDown={handleHandleMouseDown}
        aria-hidden="true"
      >
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      {editing ? (
        <div className="text-block-edit-wrap">
          <textarea
            ref={textareaRef}
            className="text-block-input"
            value={draft}
            autoFocus
            rows={3}
            placeholder="Text eingeben, [[ für Seitenlink …"
            onChange={handleDraftChange}
            onKeyDown={handleDraftKeyDown}
            onBlur={() => onSaveText(draft)}
          />
          {linkTrigger && matchedPages.length > 0 && (
            <div className="link-autocomplete">
              {matchedPages.map((p, i) => (
                <div
                  key={p.id}
                  className={`link-autocomplete-row${i === linkActiveIndex ? ' active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    insertLink(p)
                  }}
                >
                  📄 {p.title}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div
          className="text-block-content"
          onClick={() => {
            if (justDraggedRef.current) return
            onStartEdit()
          }}
        >
          {segments.length > 0 ? (
            segments.map((seg, i) =>
              seg.type === 'link' ? (
                <span
                  key={i}
                  className="page-link"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenPageLink(seg.pageId)
                  }}
                >
                  {/* Aktuellen Titel live nachschlagen statt den beim Einfuegen gespeicherten zu
                      zeigen, damit ein Link nach Umbenennen der Zielseite nicht nur weiter
                      funktioniert, sondern auch den neuen Titel anzeigt. Faellt auf den
                      gespeicherten Titel zurueck, falls die Seite zwischenzeitlich geloescht wurde. */}
                  📄 {pageLinkCandidates.find((p) => p.id === seg.pageId)?.title ?? seg.title}
                </span>
              ) : (
                <span key={i}>{seg.value}</span>
              ),
            )
          ) : (
            <span className="text-block-placeholder">Text eingeben …</span>
          )}
        </div>
      )}
      <button className="task-delete" onClick={onDelete} aria-label="Textfeld löschen" title="Textfeld löschen">
        ✕
      </button>
    </div>
  )
}

interface Props {
  initialStrokes: Stroke[]
  onChange: (strokes: Stroke[]) => void
  background: PageBackground
  title: string
  updatedAt: number
  // To-do-Funktion - alles optional/mit Default, damit DrawingCanvas auch ohne Task-Anbindung
  // (z.B. falls anderweitig verwendet) unveraendert funktioniert.
  tasks?: DrawingTask[]
  taskMode?: boolean
  onCreateTask?: (x: number, y: number) => Promise<string> | void
  onToggleTask?: (id: string, completed: boolean) => void
  onEditTaskText?: (id: string, text: string) => void
  onDeleteTask?: (id: string) => void
  onMoveTask?: (id: string, x: number, y: number) => void
  // Textfeld-Funktion - gleiches optionales Muster wie die To-do-Funktion oben.
  textBlocks?: DrawingTextBlock[]
  textBlockMode?: boolean
  pageLinkCandidates?: { id: string; title: string }[]
  onCreateTextBlock?: (x: number, y: number) => Promise<string> | void
  onEditTextBlockText?: (id: string, text: string) => void
  onDeleteTextBlock?: (id: string) => void
  onMoveTextBlock?: (id: string, x: number, y: number) => void
  onOpenPageLink?: (pageId: string) => void
  toolbarExtra?: ReactNode
}

export default function DrawingCanvas({
  initialStrokes,
  onChange,
  background,
  title,
  updatedAt,
  tasks = [],
  taskMode = false,
  onCreateTask,
  onToggleTask,
  onEditTaskText,
  onDeleteTask,
  onMoveTask,
  textBlocks = [],
  textBlockMode = false,
  pageLinkCandidates = [],
  onCreateTextBlock,
  onEditTextBlockText,
  onDeleteTextBlock,
  onMoveTextBlock,
  onOpenPageLink,
  toolbarExtra,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  // Safari behandelt <canvas> mit gezeichnetem Inhalt wie ein Bild (Hover-Vorschau,
  // "Teilen"-Angebot per Pencil) - das faengt Touch-Sequenzen komplett ab, bevor sie unsere
  // Handler erreichen. Deshalb nimmt ein unsichtbares Overlay-Div die Eingabe entgegen, das
  // Canvas darunter ist rein zur Darstellung da (pointer-events: none).
  const overlayRef = useRef<HTMLDivElement>(null)
  const backgroundRef = useRef<HTMLDivElement>(null)
  const taskLayerRef = useRef<HTMLDivElement>(null)
  const statusRef = useRef<HTMLDivElement>(null)

  const strokesRef = useRef<Stroke[]>(initialStrokes)
  const currentStrokeRef = useRef<Stroke | null>(null)
  const activeTouchIdRef = useRef<number | null>(null)
  const stylusDetectedRef = useRef(false)

  // Zwei-Finger-Zoom/Pan: eigener Zustand getrennt von der Zeichen-Logik. fingersRef verfolgt
  // aktive Finger-Kontakte (nicht Stift), pinchStateRef nur waehrend einer aktiven Zoom-Geste.
  const viewRef = useRef<ViewState>({ scale: 1, x: 0, y: 0 })
  const fingersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchStateRef = useRef<PinchState | null>(null)
  const resetZoomRef = useRef<() => void>(() => {})

  const [color, setColor] = useState(COLORS[0])
  const [baseWidth, setBaseWidth] = useState(3)
  const [eraser, setEraser] = useState(false)
  const [strokeCount, setStrokeCount] = useState(initialStrokes.length)
  const [zoomPercent, setZoomPercent] = useState(100)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingTextBlockId, setEditingTextBlockId] = useState<string | null>(null)
  // Aktuelle Breite der Zeichenflaeche in CSS-Pixeln - Nenner fuer die relative x-Umrechnung
  // (siehe toAbsoluteX/toStoredX). canvasWidthRef fuer den Touch-Event-Mount-Effekt (dort sind
  // nur Refs sicher aktuell, siehe colorRef/baseWidthRef-Muster), canvasWidth-State fuer die
  // JSX-Task-Positionen, die bei jeder Groessenaenderung neu berechnet werden sollen.
  const canvasWidthRef = useRef(0)
  const [canvasWidth, setCanvasWidth] = useState(0)

  // useLayoutEffect statt useEffect: misst die Breite synchron vor dem ersten Bildaufbau, damit
  // vorhandene Tasks nicht kurz an der falschen (unkonvertierten) Position aufblitzen.
  useLayoutEffect(() => {
    const w = canvasRef.current?.clientWidth ?? 0
    canvasWidthRef.current = w
    setCanvasWidth(w)
  }, [])

  const colorRef = useRef(color)
  const baseWidthRef = useRef(baseWidth)
  const eraserRef = useRef(eraser)
  useEffect(() => {
    colorRef.current = color
  }, [color])
  useEffect(() => {
    baseWidthRef.current = baseWidth
  }, [baseWidth])
  useEffect(() => {
    eraserRef.current = eraser
  }, [eraser])

  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  function updateDebug(type: string, pressure: number) {
    if (!statusRef.current) return
    statusRef.current.textContent = `Typ: ${type} | Stift erkannt: ${stylusDetectedRef.current ? 'ja' : 'nein'} | Druck: ${pressure.toFixed(2)}`
  }

  function finishCurrentStroke() {
    const stroke = currentStrokeRef.current
    if (stroke) {
      strokesRef.current.push(stroke)
      setStrokeCount(strokesRef.current.length)
      onChangeRef.current(withStrokesX(strokesRef.current, toStoredX, canvasWidthRef.current))
    }
    currentStrokeRef.current = null
    activeTouchIdRef.current = null
  }

  useEffect(() => {
    const canvas = canvasRef.current
    const overlay = overlayRef.current
    const background = backgroundRef.current
    if (!canvas || !overlay || !background) return

    // Beim Oeffnen einer Seite faehrt die Sidebar per CSS-Transition ein (siehe Workspace.tsx,
    // setSidebarOpen(false) nach openPage) - die Zeichenflaeche waechst dabei ueber mehrere
    // ResizeObserver-Ticks hinweg schrittweise auf ihre Endbreite (schon die urspruengliche
    // Ursache des "Tinte 3cm daneben"-Bugs, siehe Kommentar unten). Die einmalige Laden-
    // Umrechnung von gespeichertem (relativem) ins interne absolute Koordinatensystem darf
    // deshalb NICHT die allererste (noch mitten in der Animation gemessene, zu schmale) Breite
    // verwenden, sonst landet die Tinte an der falschen Stelle. Stattdessen wird abgewartet, bis
    // sich die Breite eine Weile nicht mehr aendert (SETTLE_MS ohne neuen ResizeObserver-Tick) -
    // bis dahin bleibt die Flaeche leer statt Tinte kurz an falscher Position aufblitzen zu lassen.
    const SETTLE_MS = 120
    let initialConversionDone = false
    let settleTimer: ReturnType<typeof setTimeout> | null = null

    function resize() {
      const dpr = window.devicePixelRatio || 1
      const { clientWidth, clientHeight } = canvas!
      canvasWidthRef.current = clientWidth
      setCanvasWidth(clientWidth)
      canvas!.width = clientWidth * dpr
      canvas!.height = clientHeight * dpr
      const ctx = canvas!.getContext('2d')
      if (!ctx) return
      ctx.scale(dpr, dpr)
      ctxRef.current = ctx
      if (initialConversionDone) redrawAll(ctx, clientWidth, clientHeight, strokesRef.current)

      if (!initialConversionDone) {
        if (settleTimer) clearTimeout(settleTimer)
        settleTimer = setTimeout(() => {
          if (initialConversionDone) return
          initialConversionDone = true
          strokesRef.current = withStrokesX(strokesRef.current, toAbsoluteX, canvasWidthRef.current)
          const freshCtx = ctxRef.current
          if (freshCtx) redrawAll(freshCtx, canvas!.clientWidth, canvas!.clientHeight, strokesRef.current)
        }, SETTLE_MS)
      }
    }
    resize()
    // ResizeObserver statt nur window-'resize': die Zeichenflaeche aendert ihre Groesse auch,
    // wenn die Sidebar per CSS-Transition ein-/ausfaehrt (kein Browser-weites Resize-Event) -
    // ohne das blieb die interne Canvas-Aufloesung auf dem alten (schmaleren) Stand stehen und
    // der Browser streckte das Bild optisch, was Eingabe und Tinte gegeneinander verschob.
    const resizeObserver = new ResizeObserver(() => resize())
    resizeObserver.observe(canvas)

    // Zoom/Pan wird rein per CSS-Transform auf Hintergrund+Canvas dargestellt (das Overlay,
    // also die Touch-Zielflaeche, bleibt unveraendert auf voller Groesse) - die Striche selbst
    // bleiben in unskaliertem Koordinatenraum gespeichert, nur die Darstellung skaliert.
    function applyView(scale: number, x: number, y: number) {
      const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
      viewRef.current = { scale: clamped, x, y }
      const transform = `translate(${x}px, ${y}px) scale(${clamped})`
      canvas!.style.transform = transform
      background!.style.transform = transform
      if (taskLayerRef.current) taskLayerRef.current.style.transform = transform
    }

    function resetZoom() {
      applyView(1, 0, 0)
      setZoomPercent(100)
    }
    resetZoomRef.current = resetZoom

    function pointFrom(clientX: number, clientY: number, pressure: number): Point {
      const rect = overlay!.getBoundingClientRect()
      const view = viewRef.current
      return { x: (clientX - rect.left - view.x) / view.scale, y: (clientY - rect.top - view.y) / view.scale, pressure }
    }

    function startPinch() {
      const pts = Array.from(fingersRef.current.values())
      if (pts.length !== 2) return
      const [a, b] = pts
      pinchStateRef.current = {
        startDist: Math.hypot(b.x - a.x, b.y - a.y),
        startScale: viewRef.current.scale,
        startMidX: (a.x + b.x) / 2,
        startMidY: (a.y + b.y) / 2,
        startPanX: viewRef.current.x,
        startPanY: viewRef.current.y,
      }
    }

    function updatePinch(ax: number, ay: number, bx: number, by: number) {
      const state = pinchStateRef.current
      if (!state || state.startDist < 1) return
      const dist = Math.hypot(bx - ax, by - ay)
      const midX = (ax + bx) / 2
      const midY = (ay + by) / 2
      const rect = overlay!.getBoundingClientRect()
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.startScale * (dist / state.startDist)))
      // Der Punkt unter der urspruenglichen Fingermitte soll unter der neuen Fingermitte bleiben
      // (klassisches Pinch-to-Point-Zoomverhalten statt Zoom immer zur Ecke hin).
      const startLocalX = state.startMidX - rect.left
      const startLocalY = state.startMidY - rect.top
      const contentX = (startLocalX - state.startPanX) / state.startScale
      const contentY = (startLocalY - state.startPanY) / state.startScale
      const newLocalX = midX - rect.left
      const newLocalY = midY - rect.top
      applyView(newScale, newLocalX - contentX * newScale, newLocalY - contentY * newScale)
    }

    function startStroke(p: Point) {
      currentStrokeRef.current = {
        points: [p],
        color: colorRef.current,
        width: baseWidthRef.current,
        eraser: eraserRef.current,
      }
    }

    function extendStroke(p: Point) {
      const ctx = ctxRef.current
      const stroke = currentStrokeRef.current
      if (!ctx || !stroke) return
      const pts = stroke.points
      pts.push(p)
      const n = pts.length
      if (n >= 3) {
        const from = midPoint(pts[n - 3], pts[n - 2])
        const to = midPoint(pts[n - 2], pts[n - 1])
        drawSegment(ctx, from, pts[n - 2], to, stroke)
      } else if (n === 2) {
        drawSegment(ctx, pts[0], pts[0], pts[1], stroke)
      }
    }

    // --- Touch Events (Apple Pencil + Finger) statt Pointer Events ---
    // Pointer Events verschlucken auf iPadOS zuverlaessig jeden Kontakt, der kurz nach einem
    // vorherigen Loslassen kommt (siehe /tests Diagnose-Testmatrix). Klassische Touch Events
    // hatten dieses Problem nicht.
    function onTouchStart(e: TouchEvent) {
      e.preventDefault()
      for (const t of Array.from(e.changedTouches)) {
        const { touchType, force } = describeTouch(t)
        if (touchType === 'stylus') stylusDetectedRef.current = true

        // Finger zeichnen nie, nur der Stift darf - ein einzelner Finger wird komplett
        // ignoriert (kein Testfallback mehr), zwei Finger gleichzeitig starten stattdessen
        // eine Pinch-Zoom-Geste; ein dritter Finger wird ignoriert.
        if (touchType === 'direct') {
          fingersRef.current.set(t.identifier, { x: t.clientX, y: t.clientY })
          if (fingersRef.current.size === 2) startPinch()
          continue
        }

        // Der Stift ist immer autoritativ: falls durch ein verpasstes touchend/-cancel noch
        // ein alter Strich als "aktiv" markiert ist, hier hart abschliessen statt den neuen
        // Kontakt zu ignorieren.
        if (activeTouchIdRef.current !== null && activeTouchIdRef.current !== t.identifier) {
          finishCurrentStroke()
        }

        activeTouchIdRef.current = t.identifier
        const p = pointFrom(t.clientX, t.clientY, force)
        startStroke(p)
        updateDebug(touchType, force)
      }
    }

    function onTouchMove(e: TouchEvent) {
      e.preventDefault()
      if (fingersRef.current.size === 2 && pinchStateRef.current) {
        // e.touches (nicht nur changedTouches) enthaelt immer den vollen aktuellen Stand
        // beider verfolgter Finger, unabhaengig davon welcher sich gerade bewegt hat.
        const ids = Array.from(fingersRef.current.keys())
        const pts = Array.from(e.touches).filter((t) => ids.includes(t.identifier))
        if (pts.length === 2) {
          fingersRef.current.set(pts[0].identifier, { x: pts[0].clientX, y: pts[0].clientY })
          fingersRef.current.set(pts[1].identifier, { x: pts[1].clientX, y: pts[1].clientY })
          updatePinch(pts[0].clientX, pts[0].clientY, pts[1].clientX, pts[1].clientY)
        }
        return
      }
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== activeTouchIdRef.current) continue
        const { touchType, force } = describeTouch(t)
        const p = pointFrom(t.clientX, t.clientY, force)
        extendStroke(p)
        updateDebug(touchType, force)
      }
    }

    function onTouchEnd(e: TouchEvent) {
      for (const t of Array.from(e.changedTouches)) {
        const { touchType } = describeTouch(t)
        if (touchType === 'direct') {
          fingersRef.current.delete(t.identifier)
          if (fingersRef.current.size < 2) {
            pinchStateRef.current = null
            setZoomPercent(Math.round(viewRef.current.scale * 100))
          }
        }
        if (t.identifier === activeTouchIdRef.current) finishCurrentStroke()
      }
    }

    overlay.addEventListener('touchstart', onTouchStart, { passive: false })
    overlay.addEventListener('touchmove', onTouchMove, { passive: false })
    overlay.addEventListener('touchend', onTouchEnd, { passive: false })
    overlay.addEventListener('touchcancel', onTouchEnd, { passive: false })

    // --- Maus-Fallback nur fuers Testen am Desktop ---
    let mouseDown = false
    function onMouseDown(e: MouseEvent) {
      mouseDown = true
      startStroke(pointFrom(e.clientX, e.clientY, 0.5))
      updateDebug('mouse', 0.5)
    }
    function onMouseMove(e: MouseEvent) {
      if (!mouseDown) return
      extendStroke(pointFrom(e.clientX, e.clientY, 0.5))
    }
    function onMouseUp() {
      if (!mouseDown) return
      mouseDown = false
      finishCurrentStroke()
    }
    overlay.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      resizeObserver.disconnect()
      if (settleTimer) clearTimeout(settleTimer)
      overlay.removeEventListener('touchstart', onTouchStart)
      overlay.removeEventListener('touchmove', onTouchMove)
      overlay.removeEventListener('touchend', onTouchEnd)
      overlay.removeEventListener('touchcancel', onTouchEnd)
      overlay.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function undo() {
    strokesRef.current.pop()
    setStrokeCount(strokesRef.current.length)
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (canvas && ctx) redrawAll(ctx, canvas.clientWidth, canvas.clientHeight, strokesRef.current)
    onChangeRef.current(withStrokesX(strokesRef.current, toStoredX, canvasWidthRef.current))
  }

  function clearAll() {
    if (!window.confirm('Zeichenfläche wirklich komplett leeren? Das kann nicht rückgängig gemacht werden.')) return
    strokesRef.current = []
    setStrokeCount(0)
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (canvas && ctx) redrawAll(ctx, canvas.clientWidth, canvas.clientHeight, strokesRef.current)
    onChangeRef.current(withStrokesX(strokesRef.current, toStoredX, canvasWidthRef.current))
  }

  // Platziert ein neues To-do ODER Textfeld an der Tap-Position (je nach aktivem Modus - beide
  // schliessen sich in PageEditor.tsx gegenseitig aus), nur bei Klick auf leere Flaeche (nicht
  // auf einen bestehenden Block, siehe .task-layer-Guard unten). Nutzt dieselbe
  // Koordinatenumrechnung wie die Striche (ueber overlayRef/viewRef), damit ein Block an der
  // angetippten Stelle bleibt, auch wenn spaeter gezoomt/verschoben wird.
  async function handleTaskLayerClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return
    if (taskMode && onCreateTask) {
      const { x, y } = clientToContent(e.clientX, e.clientY)
      const id = await onCreateTask(toStoredX(x, canvasWidth), y)
      if (id) setEditingTaskId(id)
      return
    }
    if (textBlockMode && onCreateTextBlock) {
      const { x, y } = clientToContent(e.clientX, e.clientY)
      const id = await onCreateTextBlock(toStoredX(x, canvasWidth), y)
      if (id) setEditingTextBlockId(id)
    }
  }

  // Rechnet Bildschirmkoordinaten in den unskalierten Inhaltsraum um (gleiche Umrechnung wie
  // beim Strichzeichnen, siehe pointFrom oben) - wird sowohl fuers Task-Anlegen als auch fuers
  // Verschieben per Long-Press gebraucht, damit ein Task immer unter Finger/Stift bleibt.
  function clientToContent(clientX: number, clientY: number): { x: number; y: number } {
    const overlay = overlayRef.current
    const view = viewRef.current
    if (!overlay) return { x: clientX, y: clientY }
    const rect = overlay.getBoundingClientRect()
    return {
      x: (clientX - rect.left - view.x) / view.scale,
      y: (clientY - rect.top - view.y) / view.scale,
    }
  }

  return (
    <div className="drawing">
      <div className="drawing-toolbar">
        {COLORS.map((c) => (
          <button
            key={c}
            className="swatch"
            style={{ background: c, outline: !eraser && color === c ? '2px solid #999' : 'none' }}
            onClick={() => {
              setColor(c)
              setEraser(false)
            }}
            aria-label={`Farbe ${c}`}
          />
        ))}
        <input
          type="range"
          min={1}
          max={12}
          value={baseWidth}
          onChange={(e) => setBaseWidth(Number(e.target.value))}
        />
        <button className={`icon-button${eraser ? ' active' : ''}`} onClick={() => setEraser((v) => !v)} aria-label="Radierer" title="Radierer">
          <EraserIcon />
        </button>
        <button className="icon-button" onClick={undo} disabled={strokeCount === 0} aria-label="Rückgängig" title="Rückgängig">
          <UndoIcon />
        </button>
        <button className="icon-button" onClick={clearAll} disabled={strokeCount === 0} aria-label="Leeren" title="Leeren">
          <BroomIcon />
        </button>
        {zoomPercent !== 100 && (
          <button onClick={() => resetZoomRef.current()}>Zoom {zoomPercent}% zurücksetzen</button>
        )}
        {toolbarExtra}
        <div className="drawing-status" ref={statusRef}>
          Noch keine Eingabe
        </div>
      </div>
      <div className="drawing-canvas-wrap">
        {/* Eigenes Element statt CSS-Hintergrund direkt auf dem <canvas>: WebKit aktualisiert
            den Compositor-Layer eines Canvas-Elements beim Klassenwechsel manchmal nicht
            zuverlässig (Papiermuster blieb nach "Leer" -> "Liniert" bis zum Neuladen falsch). */}
        <div
          key={background}
          ref={backgroundRef}
          className={`drawing-background bg-${background}`}
          style={{ transform: `translate(${viewRef.current.x}px, ${viewRef.current.y}px) scale(${viewRef.current.scale})` }}
        >
          {background === 'cornell' && (
            <div className="cornell-page">
              <div className="cornell-title">{title || 'Ohne Titel'}</div>
              <div className="cornell-subject">
                <span className="cornell-label">Subject</span>
              </div>
              <div className="cornell-main">
                <div className="cornell-details">
                  <span className="cornell-label">Details</span>
                </div>
                <div className="cornell-keypoints">
                  <span className="cornell-label">Key Points</span>
                </div>
              </div>
              <div className="cornell-summary">
                <span className="cornell-label">Summary</span>
              </div>
            </div>
          )}
        </div>
        <div className="page-updated-at">Bearbeitet {formatRelativeTime(updatedAt)}</div>
        <canvas ref={canvasRef} className="drawing-canvas" draggable={false} onDragStart={(e) => e.preventDefault()} />
        <div ref={overlayRef} className="drawing-overlay" />
        {/* Liegt ueber .drawing-overlay (spaeter im DOM = oben in der Stapelreihenfolge) - ein
            Tap auf einen Task-Block trifft dadurch immer den Block selbst, nie das Zeichen-
            Overlay darunter, das DrawingCanvas' eigene Touch-/Zoom-Logik bleibt unberuehrt.
            Der Layer selbst ist nur im Aufgaben-Modus antippbar (pointer-events), einzelne
            Task-Bloecke bleiben aber immer bedienbar. */}
        <div
          ref={taskLayerRef}
          className={`task-layer${taskMode ? ' task-mode' : ''}${textBlockMode ? ' text-mode' : ''}`}
          style={{ transform: `translate(${viewRef.current.x}px, ${viewRef.current.y}px) scale(${viewRef.current.scale})` }}
          onClick={handleTaskLayerClick}
        >
          {tasks.map((t) => (
            <TaskBlock
              key={t.id}
              task={{ ...t, x: toAbsoluteX(t.x, canvasWidth) }}
              editing={editingTaskId === t.id}
              clientToContent={clientToContent}
              onStartEdit={() => setEditingTaskId(t.id)}
              onToggle={() => onToggleTask?.(t.id, !t.completed)}
              onSaveText={(text) => {
                onEditTaskText?.(t.id, text)
                setEditingTaskId(null)
              }}
              onDelete={() => onDeleteTask?.(t.id)}
              onMove={(x, y) => onMoveTask?.(t.id, toStoredX(x, canvasWidth), y)}
            />
          ))}
          {textBlocks.map((b) => (
            <TextBlockItem
              key={b.id}
              block={{ ...b, x: toAbsoluteX(b.x, canvasWidth) }}
              editing={editingTextBlockId === b.id}
              clientToContent={clientToContent}
              pageLinkCandidates={pageLinkCandidates}
              onStartEdit={() => setEditingTextBlockId(b.id)}
              onSaveText={(text) => {
                onEditTextBlockText?.(b.id, text)
                setEditingTextBlockId(null)
              }}
              onDelete={() => onDeleteTextBlock?.(b.id)}
              onMove={(x, y) => onMoveTextBlock?.(b.id, toStoredX(x, canvasWidth), y)}
              onOpenPageLink={(pageId) => onOpenPageLink?.(pageId)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

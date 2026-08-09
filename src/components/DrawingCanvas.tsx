import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { PageBackground, Point, Stroke } from '../db/types'
import { formatRelativeTime } from '../lib/format'
import { parseLinkedText } from '../lib/pageLinks'
import type { RenderedPdfPage } from '../lib/pdfRender'
import { loadPdfBlob } from '../lib/pdfStorage'
import { BroomIcon, EraserIcon, PdfIcon, TrashIcon, UndoIcon } from './icons'
import './DrawingCanvas.css'

// Vertikaler Abstand zwischen zwei uebereinander gestapelten PDF-Seiten (siehe .pdf-layer
// weiter unten) - eigene Konstante statt CSS-Margin, damit die JS-Berechnung der benoetigten
// Gesamthoehe (siehe contentHeight) exakt mit der tatsaechlichen Darstellung uebereinstimmt.
const PDF_PAGE_GAP = 14

// Hoehe eines einzelnen Papiermuster-Segments (siehe .drawing-background-chunk in
// DrawingCanvas.css) - WebKit rastert einen CSS-Gradient-Hintergrund auf einem sehr hohen
// Element (bei mehrseitigen PDFs kann die Zeichenflaeche mehrere Tausend Pixel hoch werden)
// manchmal nur teilweise. Das Papiermuster wird deshalb auf mehrere gestapelte, ausreichend
// kleine Segmente verteilt statt auf ein einziges hohes Element gerendert. 2400 ist ein
// gemeinsames Vielfaches von 40px (liniert) und 24px (gepunktet), Segmentgrenzen fallen dadurch
// exakt auf eine Musterperiode und die Naht zwischen zwei Segmenten bleibt unsichtbar.
const PATTERN_CHUNK_HEIGHT = 2400

// Haengt ein bereits von pdf.js gerendertes <canvas> (siehe lib/pdfRender.ts) direkt in den DOM
// statt es erneut ueber eine DataURL zu kodieren - das Original bleibt ein einziges, nur im
// Speicher gehaltenes Canvas-Element pro Seite.
function PdfPageHost({ canvas, style }: { canvas: HTMLCanvasElement; style?: CSSProperties }) {
  const hostRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.appendChild(canvas)
    return () => {
      if (host.contains(canvas)) host.removeChild(canvas)
    }
  }, [canvas])
  return <div className="pdf-page" ref={hostRef} style={style} />
}

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

interface PdfPageBox {
  left: number
  top: number
  width: number
  height: number
}

// Vertikale Stapel-Position + Groesse jeder PDF-Seite im internen absoluten Koordinatenraum
// (dieselbe Breite wie die Zeichenflaeche, siehe canvasWidth) - EINZIGE Stelle, die diese
// Rechnung macht (sowohl fuer die Gesamthoehe der Notizflaeche als auch fuer die PDF-Bindung von
// Strichen, siehe findPdfPageAt/pdfPageBox unten), damit beide nie auseinanderlaufen koennen.
function computePdfPageLayout(pdfPages: RenderedPdfPage[], canvasWidth: number): PdfPageBox[] {
  let top = 0
  return pdfPages.map((p) => {
    const height = canvasWidth > 0 ? (canvasWidth * p.height) / p.width : 0
    const box: PdfPageBox = { left: 0, top, width: canvasWidth, height }
    top += height + PDF_PAGE_GAP
    return box
  })
}

// Liefert die 1-indexierte (wie pdf.js) Seitennummer, auf der ein Punkt mit dieser absoluten
// Y-Koordinate liegt - oder null, wenn er auf keiner PDF-Seite liegt (kein PDF geladen, oder Y
// liegt im Papierbereich unterhalb der letzten Seite).
function findPdfPageAt(y: number, pdfPages: RenderedPdfPage[], canvasWidth: number): number | null {
  const layout = computePdfPageLayout(pdfPages, canvasWidth)
  for (let i = 0; i < layout.length; i++) {
    if (y >= layout[i].top && y < layout[i].top + layout[i].height) return i + 1
  }
  return null
}

// Liefert Position/Groesse der PDF-Seite, an die ein Anker gebunden ist - oder null, wenn sie
// gerade nicht aufloesbar ist: entweder weil printoutId nicht mehr zum AKTUELL angezeigten PDF
// passt (das urspruengliche PDF wurde durch ein anderes ersetzt - deren Seiten haben voellig
// andere Masse/Anzahl, ein Abgleich rein ueber die Seitennummer waere hier falsch), oder weil
// diese Seitennummer im aktuellen pdfPages (noch) nicht existiert (PDF laedt noch, oder das neue
// PDF hat weniger Seiten als das alte).
function pdfPageBox(
  anchor: { printoutId: string; pageNumber: number },
  activePrintoutId: string | undefined,
  pdfPages: RenderedPdfPage[],
  canvasWidth: number,
): PdfPageBox | null {
  if (!activePrintoutId || anchor.printoutId !== activePrintoutId) return null
  const idx = anchor.pageNumber - 1
  const layout = computePdfPageLayout(pdfPages, canvasWidth)
  if (idx < 0 || idx >= layout.length || canvasWidth <= 0 || layout[idx].height <= 0) return null
  return layout[idx]
}

// Wandelt einen GERADE FERTIG GEZEICHNETEN, an eine PDF-Seite gebundenen Strich von absoluten
// Pixeln (wie waehrend des Zeichnens ueblich) in die dauerhafte Bruchteils-Form um (x/y relativ
// zu Breite/Hoehe seiner Seite, siehe pdfPageBox) - liefert null, falls die Seite unerwartet doch
// nicht aufloesbar war (siehe finishCurrentStroke fuer den Umgang damit). Wird genau einmal pro
// Strich aufgerufen, direkt beim Abschluss (siehe finishCurrentStroke) - ab dann lebt der Strich
// dauerhaft in Bruchteils-Form in strokesRef.current, absolute Pixel werden nur noch transient
// fuers Zeichnen abgeleitet (siehe toDrawableStrokes), nie zurueckgeschrieben. Das ist der
// Unterschied zu normaler (nicht gebundener) Tinte, die weiterhin einmalig beim Laden in
// absolute Pixel aufgeloest und dann so belassen wird (siehe SETTLE_MS im Mount-Effekt) - eine
// PDF-Seite hat aber (anders als Papier) ein konkretes visuelles Ziel, das bei jeder
// Groessenaenderung (Resize/Rotation) neu getroffen werden muss, siehe toDrawableStrokes.
function strokeToStored(
  stroke: Stroke,
  canvasWidth: number,
  pdfPages: RenderedPdfPage[],
  activePrintoutId: string | undefined,
): Stroke | null {
  if (!stroke.pdfAnchor) return null
  const box = pdfPageBox(stroke.pdfAnchor, activePrintoutId, pdfPages, canvasWidth)
  if (!box) return null
  return {
    ...stroke,
    points: stroke.points.map((p) => ({ ...p, x: (p.x - box.left) / box.width, y: (p.y - box.top) / box.height })),
  }
}

// Kehrt strokeToStored um: gespeicherte/dauerhafte Bruchteils-Form -> interner absoluter
// Koordinatenraum, FRISCH berechnet aus der aktuell dargestellten Seitengroesse (canvasWidth +
// pdfPages) statt einmalig zwischengespeichert - dadurch bleibt ein PDF-gebundener Strich auch
// bei spaeteren Groessenaenderungen (Rotation, Sidebar, Fenster-Resize) exakt ausgerichtet, da
// jeder Zeichenaufruf ueber toDrawableStrokes automatisch neu rechnet. Ohne (aufloesbare)
// PDF-Bindung bleiben die Punkte unveraendert - fuer normale Tinte ist toAbsoluteX dank seines
// LEGACY_ABS_X_THRESHOLD-Schutzes ein sicheres No-op, wenn x schon absolut ist.
function strokeToAbsolute(
  stroke: Stroke,
  canvasWidth: number,
  pdfPages: RenderedPdfPage[],
  activePrintoutId: string | undefined,
): Stroke {
  if (!stroke.pdfAnchor) {
    return { ...stroke, points: stroke.points.map((p) => ({ ...p, x: toAbsoluteX(p.x, canvasWidth) })) }
  }
  const box = pdfPageBox(stroke.pdfAnchor, activePrintoutId, pdfPages, canvasWidth)
  if (!box) return stroke // Seite (noch) nicht aufloesbar - Bruchteils-Werte unveraendert lassen (zeichnet unauffaellig nahe der Ecke statt an falscher Stelle).
  return {
    ...stroke,
    points: stroke.points.map((p) => ({ ...p, x: box.left + p.x * box.width, y: box.top + p.y * box.height })),
  }
}

// Liefert die fuers Zeichnen benoetigten absoluten Positionen ALLER Striche, ohne
// strokesRef.current selbst zu veraendern - wird bei jedem Redraw neu aufgerufen (siehe
// redrawCanvas), damit PDF-gebundene Striche automatisch der aktuellen Seitengroesse folgen.
function toDrawableStrokes(
  strokes: Stroke[],
  canvasWidth: number,
  pdfPages: RenderedPdfPage[],
  activePrintoutId: string | undefined,
): Stroke[] {
  return strokes.map((s) => strokeToAbsolute(s, canvasWidth, pdfPages, activePrintoutId))
}

// Baut die zu speichernde (Dexie/Sync-)Fassung aus strokesRef.current: PDF-gebundene Striche
// liegen dort bereits dauerhaft in Bruchteils-Form vor (siehe strokeToStored/finishCurrentStroke)
// und werden unveraendert uebernommen, nur nicht gebundene Striche brauchen weiterhin die
// x-Umrechnung wie bisher.
function toSavedStrokes(strokes: Stroke[], canvasWidth: number): Stroke[] {
  return strokes.map((s) => (s.pdfAnchor ? s : { ...s, points: s.points.map((p) => ({ ...p, x: toStoredX(p.x, canvasWidth) })) }))
}

// --- Lasso-Auswahl (siehe Props.lassoMode, redrawCanvas, startLassoGesture etc.) ---
// Ray-Casting-Punkt-in-Polygon-Test (Standardalgorithmus) - bewusst keine Bibliothek fuer so
// eine kleine, gut verstandene Funktion.
function isPointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y
    const intersect = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

// Waehlt alle Striche aus, von denen mindestens ein Punkt innerhalb der Lasso-Kontur liegt -
// deckt sowohl vollstaendig umschlossene als auch von der Kontur "sinnvoll geschnittene" Striche
// ab, ohne echte Linien-Polygon-Schnittberechnung zu brauchen. Arbeitet auf den absoluten
// (gerenderten) Positionen (siehe toDrawableStrokes), damit PDF-gebundene Striche exakt dort
// erkannt werden, wo sie gerade tatsaechlich angezeigt werden.
function computeStrokesInLasso(
  strokes: Stroke[],
  lassoPoints: Point[],
  canvasWidth: number,
  pdfPages: RenderedPdfPage[],
  activePrintoutId: string | undefined,
): Set<number> {
  const selected = new Set<number>()
  strokes.forEach((stroke, idx) => {
    const abs = strokeToAbsolute(stroke, canvasWidth, pdfPages, activePrintoutId)
    if (abs.points.some((p) => isPointInPolygon(p, lassoPoints))) selected.add(idx)
  })
  return selected
}

interface SelectionBox {
  left: number
  top: number
  right: number
  bottom: number
}

// Umschliessendes Rechteck aller ausgewaehlten Striche (absolute Positionen, optional um einen
// laufenden Verschiebe-Versatz ergaenzt) - dient gleichzeitig als visueller Auswahlrahmen UND
// als Trefferflaeche zum Greifen/Verschieben der ganzen Auswahl (siehe pointInSelectionBox).
function computeSelectionBox(
  strokes: Stroke[],
  selectedIndices: Set<number>,
  canvasWidth: number,
  pdfPages: RenderedPdfPage[],
  activePrintoutId: string | undefined,
  dragDx: number,
  dragDy: number,
): SelectionBox | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const idx of selectedIndices) {
    const stroke = strokes[idx]
    if (!stroke) continue
    const abs = strokeToAbsolute(stroke, canvasWidth, pdfPages, activePrintoutId)
    for (const p of abs.points) {
      const x = p.x + dragDx
      const y = p.y + dragDy
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (minX === Infinity) return null
  const PAD = 12 // etwas Rand um die Striche, leichter zu sehen/greifen
  return { left: minX - PAD, top: minY - PAD, right: maxX + PAD, bottom: maxY + PAD }
}

// Begrenzt einen rohen Verschiebe-Versatz so, dass KEIN an eine PDF-Seite gebundener Strich der
// Auswahl seine Seite verlassen wuerde ("duerfen nur innerhalb ihrer zugehoerigen PDF-Seite
// verschoben werden") - die Begrenzung gilt fuer die GESAMTE Auswahl gemeinsam (nicht pro
// Strich), damit sich alle ausgewaehlten Striche weiterhin exakt um denselben Abstand bewegen;
// nicht gebundene Striche schraenken den Versatz nicht ein (bewegen sich frei wie bisher).
function computeDragClamp(
  rawDx: number,
  rawDy: number,
  strokes: Stroke[],
  selectedIndices: Set<number>,
  canvasWidth: number,
  pdfPages: RenderedPdfPage[],
  activePrintoutId: string | undefined,
): { dx: number; dy: number } {
  let minDx = -Infinity
  let maxDx = Infinity
  let minDy = -Infinity
  let maxDy = Infinity
  for (const idx of selectedIndices) {
    const stroke = strokes[idx]
    if (!stroke?.pdfAnchor) continue
    const box = pdfPageBox(stroke.pdfAnchor, activePrintoutId, pdfPages, canvasWidth)
    if (!box) continue
    const abs = strokeToAbsolute(stroke, canvasWidth, pdfPages, activePrintoutId)
    const xs = abs.points.map((p) => p.x)
    const ys = abs.points.map((p) => p.y)
    const strokeMinX = Math.min(...xs)
    const strokeMaxX = Math.max(...xs)
    const strokeMinY = Math.min(...ys)
    const strokeMaxY = Math.max(...ys)
    minDx = Math.max(minDx, box.left - strokeMinX)
    maxDx = Math.min(maxDx, box.left + box.width - strokeMaxX)
    minDy = Math.max(minDy, box.top - strokeMinY)
    maxDy = Math.min(maxDy, box.top + box.height - strokeMaxY)
  }
  // minDx > maxDx koennte nur bei einer Auswahl mit widerspruechlichen Grenzen auftreten (z.B.
  // Striche von zwei verschiedenen PDF-Seiten in einer Auswahl - fuer diese erste Version nicht
  // vorgesehen) - dann lieber gar keine Bewegung als eine widerspruechliche.
  const dx = minDx > maxDx ? 0 : Math.min(Math.max(rawDx, minDx), maxDx)
  const dy = minDy > maxDy ? 0 : Math.min(Math.max(rawDy, minDy), maxDy)
  return { dx, dy }
}

// Verschiebt alle ausgewaehlten Striche endgueltig um denselben absoluten Versatz (bereits
// begrenzt, siehe computeDragClamp) und liefert ein neues Array (strokesRef.current selbst wird
// hier nicht veraendert, das macht der Aufrufer). PDF-gebundene Striche werden dabei ueber
// strokeToAbsolute/strokeToStored durch ihre eigene Seiten-Bruchteils-Form geschleust (bleiben
// also exakt an ihre Seite gebunden), nicht gebundene direkt in absoluten Pixeln verschoben.
function applySelectionMove(
  strokes: Stroke[],
  selectedIndices: Set<number>,
  dx: number,
  dy: number,
  canvasWidth: number,
  pdfPages: RenderedPdfPage[],
  activePrintoutId: string | undefined,
): Stroke[] {
  return strokes.map((stroke, idx) => {
    if (!selectedIndices.has(idx)) return stroke
    if (stroke.pdfAnchor) {
      const abs = strokeToAbsolute(stroke, canvasWidth, pdfPages, activePrintoutId)
      const moved = { ...abs, points: abs.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) }
      return strokeToStored(moved, canvasWidth, pdfPages, activePrintoutId) ?? stroke
    }
    return { ...stroke, points: stroke.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) }
  })
}

function drawDashedPath(ctx: CanvasRenderingContext2D, points: Point[]) {
  if (points.length < 2) return
  ctx.save()
  ctx.globalCompositeOperation = 'source-over' // ueberschreibt einen evtl. vom letzten Strich (Radierer) uebrig gebliebenen Blend-Modus
  ctx.setLineDash([6, 4])
  ctx.strokeStyle = '#1d5fd6'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
  ctx.closePath()
  ctx.stroke()
  ctx.restore()
}

function drawSelectionBox(ctx: CanvasRenderingContext2D, box: SelectionBox) {
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = 'rgba(29, 95, 214, 0.08)'
  ctx.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top)
  ctx.setLineDash([6, 4])
  ctx.strokeStyle = '#1d5fd6'
  ctx.lineWidth = 1.5
  ctx.strokeRect(box.left, box.top, box.right - box.left, box.bottom - box.top)
  ctx.restore()
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
  width?: number
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
  onResizeWidth,
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
  onResizeWidth: (width: number) => void
  onOpenPageLink: (pageId: string) => void
}) {
  const [draft, setDraft] = useState(block.text)
  const [linkTrigger, setLinkTrigger] = useState<{ start: number; query: string } | null>(null)
  const [linkActiveIndex, setLinkActiveIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Waehrend der Bearbeitung waechst die Hoehe automatisch mit dem Inhalt mit (siehe
  // Anforderung "gesamten Text lesen koennen") - reine CSS-Loesung reicht dafuer nicht,
  // <textarea> passt seine Hoehe nie von selbst an den Inhalt an.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!editing || !el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [editing, draft])

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
      className={`text-block${dragPos ? ' dragging' : ''}${editing ? ' active' : ''}`}
      style={{ left: pos.x, top: pos.y, width: block.width ? `${block.width}px` : undefined }}
      onClick={(e) => e.stopPropagation()}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {editing && (
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
      )}
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
            onBlur={() => {
              onSaveText(draft)
              // Per Ziehen am Rand gewaehlte Breite (CSS "resize: horizontal", siehe
              // DrawingCanvas.css) erst beim Verlassen der Bearbeitung uebernehmen - offsetWidth
              // ist die unskalierte Layout-Breite des Elements, unabhaengig vom aktuellen
              // Zoom (CSS-Transform auf der Task-Ebene beeinflusst sie nicht), also genau der
              // Wert, der auch in der schreibgeschuetzten Ansicht wieder als Breite gilt.
              const el = textareaRef.current
              if (el && el.offsetWidth > 0 && el.offsetWidth !== block.width) {
                onResizeWidth(el.offsetWidth)
              }
            }}
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
      {editing && (
        <button
          className="task-delete"
          // onMouseDown statt onClick + preventDefault: ein Klick auf diesen Button loest zuerst
          // blur auf dem fokussierten Textarea aus (siehe onBlur unten), das beendet editing und
          // laesst diesen Button (nur bei editing gerendert, siehe oben) verschwinden, BEVOR der
          // eigentliche Click-Event ankommt - onDelete wuerde dadurch nie ausgeloest. preventDefault
          // auf mousedown unterdrueckt den Fokuswechsel/blur von vornherein (gleiches Muster wie
          // link-autocomplete-row oben).
          onMouseDown={(e) => {
            e.preventDefault()
            onDelete()
          }}
          aria-label="Textfeld löschen"
          title="Textfeld löschen"
        >
          ✕
        </button>
      )}
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
  onResizeTextBlockWidth?: (id: string, width: number) => void
  onOpenPageLink?: (pageId: string) => void
  // PDF-Dateiausdruck (siehe db/types.ts PdfPrintout, lib/pdfStorage.ts) - gleiches optionales
  // Muster wie Task/Textfeld: pdfPrintout ist nur die (persistierte) Metadaten-Zeile, das
  // eigentliche Laden/Rendern der Seiten passiert intern in DrawingCanvas (braucht canvasWidth,
  // das kennt nur diese Komponente). onAttachPdf/onRemovePdf uebernehmen Storage-Upload bzw.
  // Soft-Delete - beides lebt in lib/actions.ts, nicht hier.
  pdfPrintout?: { id: string; fileName: string; storagePath: string } | null
  onAttachPdf?: (file: File) => Promise<void> | void
  onRemovePdf?: () => void
  // Lasso-Auswahl fuer Handschrift-Striche - der Modus selbst wird wie taskMode/textBlockMode
  // von aussen gesteuert (PageEditor.tsx, gleiche gegenseitige Ausschluss-Logik), die Auswahl
  // selbst (welche Striche, Verschieben, Loeschen) ist reiner DrawingCanvas-interner Zustand,
  // da sie nur die ohnehin schon geladenen Striche betrifft und ueber dieselbe onChange-Pipeline
  // wie jede andere Tinten-Aenderung gespeichert wird.
  lassoMode?: boolean
  // Wird aufgerufen, wenn innerhalb von DrawingCanvas ein anderes Zeichen-Werkzeug gewaehlt wird
  // (Farbe, Radiergummi) - der Lasso-Modus selbst wird von aussen (PageEditor.tsx) gesteuert,
  // DrawingCanvas kann ihn also nicht selbst abschalten, nur anfragen. Verhindert, dass Lasso und
  // Radiergummi/Farbe gleichzeitig "aktiv" bleiben (der Lasso-Modus faengt Stift/Finger-Eingaben
  // ohnehin vollstaendig ab, das war rein optisch/gedanklich verwirrend).
  onRequestExitLasso?: () => void
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
  onResizeTextBlockWidth,
  onOpenPageLink,
  pdfPrintout = null,
  onAttachPdf,
  onRemovePdf,
  lassoMode = false,
  onRequestExitLasso,
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
  const wrapRef = useRef<HTMLDivElement>(null)
  const pdfLayerRef = useRef<HTMLDivElement>(null)
  const pdfFileInputRef = useRef<HTMLInputElement>(null)

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

  // PDF-Anzeige (siehe db/types.ts PdfPrintout, lib/pdfStorage.ts, lib/pdfRender.ts): die
  // gerenderten Canvases selbst sind weiterhin rein lokaler Zustand (nie gespeichert, siehe
  // PdfPageHost oben) - was sich mit der dauerhaften Speicherung aendert, ist nur WOHER die
  // Bytes kommen (siehe Lade-Effekt unten, reagiert auf die von aussen (PageEditor.tsx)
  // uebergebene pdfPrintout-Metadaten-Zeile statt nur auf die lokale Dateiauswahl).
  const [pdfPages, setPdfPages] = useState<RenderedPdfPage[]>([])
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)

  // Eigene Hoehe der Zeichenflaeche (unabhaengig von canvasWidth/-Height des Canvas selbst, das
  // spaeter genau auf contentHeight unten waechst) - Basis fuer "wie hoch ist die Flaeche
  // mindestens, auch ohne PDF" (siehe contentHeight weiter unten).
  const [wrapHeight, setWrapHeight] = useState(0)
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    setWrapHeight(wrap.clientHeight)
    const ro = new ResizeObserver(() => setWrapHeight(wrap.clientHeight))
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  // Gesamthoehe der Zeichenflaeche: mindestens die sichtbare Wrap-Hoehe, oder - falls ein PDF
  // geladen ist und mehr Platz braucht - die Hoehe bis zum Ende der letzten PDF-Seite (siehe
  // computePdfPageLayout). Hintergrund/Canvas/Task-Ebene/PDF-Ebene bekommen unten alle dieselbe
  // Hoehe, dadurch bleibt die Handschrift exakt ueber den PDF-Seiten, auch beim Zoomen/Panning
  // (dieselbe CSS-Transform-Logik wie bisher, siehe applyView).
  const pdfLayout = computePdfPageLayout(pdfPages, canvasWidth)
  const pdfContentHeight = pdfLayout.length > 0 ? pdfLayout[pdfLayout.length - 1].top + pdfLayout[pdfLayout.length - 1].height : 0
  const contentHeight = Math.max(wrapHeight, pdfContentHeight)
  const contentHeightStyle = contentHeight > 0 ? `${contentHeight}px` : undefined

  // Refs fuer die Striche-PDF-Bindung, gebraucht im Mount-Effekt weiter unten (dort sind nur
  // Refs sicher aktuell, siehe colorRef/baseWidthRef-Muster) und in redrawCanvas.
  const pdfPagesRef = useRef<RenderedPdfPage[]>(pdfPages)
  useEffect(() => {
    pdfPagesRef.current = pdfPages
  }, [pdfPages])
  const pdfPrintoutRef = useRef(pdfPrintout)
  useEffect(() => {
    pdfPrintoutRef.current = pdfPrintout
  }, [pdfPrintout])

  // Lasso-Auswahl: lassoModeRef fuer den Mount-Effekt (siehe colorRef-Muster). selectedIndices
  // sind Indizes in strokesRef.current statt einer stabilen Id (Strokes haben keine) - sicher,
  // solange sich die Reihenfolge waehrend einer aktiven Auswahl nicht aendert. Das ist
  // sichergestellt, weil im Lasso-Modus keine neuen Striche gezeichnet werden (kein push) und
  // undo()/clearAll() die Auswahl explizit mit aufraeumen (kein ueberraschendes pop/Ersetzen
  // unter einer bestehenden Auswahl).
  const lassoModeRef = useRef(lassoMode)
  useEffect(() => {
    lassoModeRef.current = lassoMode
  }, [lassoMode])
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())
  const selectedIndicesRef = useRef<Set<number>>(new Set())
  const lassoPathRef = useRef<Point[]>([])
  const lassoGestureRef = useRef<'none' | 'drawing' | 'dragging'>('none')
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const dragOffsetRef = useRef<{ dx: number; dy: number } | null>(null)
  const lassoActiveTouchIdRef = useRef<number | null>(null)

  function clearSelectionState() {
    selectedIndicesRef.current = new Set()
    setSelectedIndices(new Set())
  }

  // Verlaesst man den Lasso-Modus, soll keine "Geister"-Auswahl uebrig bleiben - Auswahl,
  // Loeschen-Button und Verschieben haengen alle am aktiven Lasso-Modus.
  useEffect(() => {
    if (!lassoMode) {
      clearSelectionState()
      lassoPathRef.current = []
      lassoGestureRef.current = 'none'
      dragOffsetRef.current = null
      redrawCanvas()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lassoMode])

  // Trefferflaeche fuers Greifen der gesamten Auswahl (siehe computeSelectionBox) - null ohne
  // aktive Auswahl.
  function selectionBoxNow(): SelectionBox | null {
    return computeSelectionBox(
      strokesRef.current,
      selectedIndicesRef.current,
      canvasWidthRef.current,
      pdfPagesRef.current,
      pdfPrintoutRef.current?.id,
      0,
      0,
    )
  }

  // Startet je nach Antippstelle entweder das Verschieben der bestehenden Auswahl (Antippen
  // innerhalb ihres Rahmens) oder eine neue Lasso-Kontur (Antippen ausserhalb - hebt dabei eine
  // evtl. vorhandene Auswahl sofort auf, siehe "Klick/Tap ausserhalb hebt Auswahl auf").
  function startLassoGesture(p: Point) {
    const box = selectionBoxNow()
    if (box && p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom) {
      lassoGestureRef.current = 'dragging'
      dragStartRef.current = { x: p.x, y: p.y }
      dragOffsetRef.current = { dx: 0, dy: 0 }
    } else {
      if (selectedIndicesRef.current.size > 0) clearSelectionState()
      lassoGestureRef.current = 'drawing'
      lassoPathRef.current = [p]
    }
    redrawCanvas()
  }

  function updateLassoGesture(p: Point) {
    if (lassoGestureRef.current === 'dragging') {
      const start = dragStartRef.current
      if (!start) return
      dragOffsetRef.current = computeDragClamp(
        p.x - start.x,
        p.y - start.y,
        strokesRef.current,
        selectedIndicesRef.current,
        canvasWidthRef.current,
        pdfPagesRef.current,
        pdfPrintoutRef.current?.id,
      )
      redrawCanvas()
    } else if (lassoGestureRef.current === 'drawing') {
      lassoPathRef.current.push(p)
      redrawCanvas()
    }
  }

  function finishLassoGesture() {
    if (lassoGestureRef.current === 'dragging') {
      const offset = dragOffsetRef.current
      if (offset && (offset.dx !== 0 || offset.dy !== 0)) {
        strokesRef.current = applySelectionMove(
          strokesRef.current,
          selectedIndicesRef.current,
          offset.dx,
          offset.dy,
          canvasWidthRef.current,
          pdfPagesRef.current,
          pdfPrintoutRef.current?.id,
        )
        onChangeRef.current(toSavedStrokes(strokesRef.current, canvasWidthRef.current))
      }
      dragOffsetRef.current = null
      dragStartRef.current = null
    } else if (lassoGestureRef.current === 'drawing') {
      const path = lassoPathRef.current
      if (path.length >= 3) {
        const selected = computeStrokesInLasso(strokesRef.current, path, canvasWidthRef.current, pdfPagesRef.current, pdfPrintoutRef.current?.id)
        selectedIndicesRef.current = selected
        setSelectedIndices(selected)
      }
      lassoPathRef.current = []
    }
    lassoGestureRef.current = 'none'
    redrawCanvas()
  }

  function deleteSelection() {
    if (selectedIndicesRef.current.size === 0) return
    strokesRef.current = strokesRef.current.filter((_, idx) => !selectedIndicesRef.current.has(idx))
    setStrokeCount(strokesRef.current.length)
    clearSelectionState()
    redrawCanvas()
    onChangeRef.current(toSavedStrokes(strokesRef.current, canvasWidthRef.current))
  }

  // Entf/Backspace loescht die aktive Auswahl (Desktop) - nicht, wenn der Fokus gerade in einem
  // Eingabefeld liegt (Seitentitel, Tag, Aufgaben-/Textfeld-Text), sonst wuerde ein normales
  // Loeschen von Text darin versehentlich die Lasso-Auswahl mitloeschen.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (selectedIndicesRef.current.size === 0) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      e.preventDefault()
      deleteSelection()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // true, sobald die Breite (siehe SETTLE_MS im Mount-Effekt) sich einmal beruhigt hat und
  // normale (nicht PDF-gebundene) Tinte einmalig in absolute Pixel aufgeloest wurde. Bis dahin
  // bleibt die Flaeche leer statt Tinte kurz an falscher Position aufblitzen zu lassen.
  const widthSettledRef = useRef(false)

  // Zeichnet neu, mit fuer PDF-gebundene Striche FRISCH aus der aktuellen Seitengroesse
  // abgeleiteten Positionen (siehe toDrawableStrokes) - zentrale Stelle, die bei jeder
  // relevanten Aenderung (Breite/Resize, PDF fertig geladen) erneut aufgerufen wird, damit
  // gebundene Tinte immer exakt ausgerichtet bleibt.
  function redrawCanvas() {
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (!canvas || !ctx) return
    const width = canvasWidthRef.current
    const pages = pdfPagesRef.current
    const activeId = pdfPrintoutRef.current?.id
    const offset = dragOffsetRef.current
    let drawable = toDrawableStrokes(strokesRef.current, width, pages, activeId)
    // Waehrend eines laufenden Verschiebens der Auswahl werden nur die ausgewaehlten Striche
    // fuer DIESEN Zeichenaufruf transient um den (bereits begrenzten) Versatz verschoben -
    // strokesRef.current selbst bleibt bis zum Loslassen unveraendert (siehe finishLassoGesture).
    if (offset && selectedIndicesRef.current.size > 0) {
      const selected = selectedIndicesRef.current
      drawable = drawable.map((s, idx) =>
        selected.has(idx) ? { ...s, points: s.points.map((p) => ({ ...p, x: p.x + offset.dx, y: p.y + offset.dy })) } : s,
      )
    }
    redrawAll(ctx, canvas.clientWidth, canvas.clientHeight, drawable)

    if (lassoGestureRef.current === 'drawing') {
      drawDashedPath(ctx, lassoPathRef.current)
    }
    if (selectedIndicesRef.current.size > 0) {
      const box = computeSelectionBox(strokesRef.current, selectedIndicesRef.current, width, pages, activeId, offset?.dx ?? 0, offset?.dy ?? 0)
      if (box) drawSelectionBox(ctx, box)
    }
  }

  // Sobald sich das geladene PDF aendert (fertig geladen, entfernt, oder durch ein anderes
  // ersetzt) muss neu gezeichnet werden, damit PDF-gebundene Striche entweder neu auftauchen
  // (Seite jetzt verfuegbar) oder - falls die printoutId nicht mehr passt (siehe pdfPageBox) -
  // unauffaellig verschwinden, statt auf der falschen (neuen) Seite zu landen. Vor dem ersten
  // Breiten-Settle passiert hier nichts, das uebernimmt der Mount-Effekt selbst.
  useEffect(() => {
    if (widthSettledRef.current) redrawCanvas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfPages])

  // Laedt + rendert den aktuellen pdfPrintout, sobald er sich aendert (neu gesetzt, entfernt,
  // oder durch einen anderen ersetzt - erkennbar an einer anderen id). loadPdfBlob (siehe
  // lib/pdfStorage.ts) nutzt zuerst den lokalen Blob-Cache und laedt nur bei einem Cache-Miss aus
  // Supabase Storage nach - dadurch funktioniert ein bereits einmal geoeffnetes PDF auch offline,
  // und ein normaler Seitenaufruf laedt die Datei nicht bei jedem Mal neu herunter.
  useEffect(() => {
    if (!pdfPrintout) {
      setPdfPages([])
      setPdfError(null)
      return
    }
    let cancelled = false
    setPdfLoading(true)
    setPdfError(null)
    ;(async () => {
      try {
        // Nur pdf.js selbst (inkl. eigenem Worker-Bundle, mehrere MB) per dynamischem Import -
        // landet dadurch in einem eigenen Chunk, der nur geladen wird, wenn tatsaechlich ein PDF
        // angezeigt wird. lib/pdfStorage.ts ist dagegen winzig und steckt ueber lib/actions.ts
        // ohnehin schon im Hauptbundle, ein dynamischer Import haette dort keinen Vorteil.
        const { renderPdfPages } = await import('../lib/pdfRender')
        const blob = await loadPdfBlob(pdfPrintout)
        if (cancelled) return
        const pages = await renderPdfPages(blob, canvasWidthRef.current || 800)
        if (!cancelled) setPdfPages(pages)
      } catch (err) {
        console.error(err)
        if (!cancelled) setPdfError('PDF konnte nicht geladen werden.')
      } finally {
        if (!cancelled) setPdfLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfPrintout?.id])

  async function handlePdfFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !onAttachPdf) return
    setPdfLoading(true)
    setPdfError(null)
    try {
      await onAttachPdf(file)
    } catch (err) {
      console.error(err)
      setPdfError('PDF konnte nicht hochgeladen werden.')
      setPdfLoading(false)
    }
    // Kein setPdfLoading(false) im Erfolgsfall hier: sobald PageEditor.tsx die neue
    // pdfPrintout-Zeile liefert, uebernimmt der Lade-Effekt oben (setzt pdfLoading selbst).
  }

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
      // Ein PDF-gebundener Strich liegt hier (wie waehrend des Zeichnens ueblich) noch in
      // absoluten Pixeln vor - jetzt einmalig in die dauerhafte Bruchteils-Form ueberfuehren
      // (siehe strokeToStored). Falls das unerwartet fehlschlaegt (z.B. das PDF wurde exakt
      // waehrend dieses Strichs fertig/neu geladen): lieber als normale Tinte an der zuletzt
      // gezeichneten absoluten Position speichern als eine PDF-Bindung mit noch-absoluten,
      // spaeter falsch interpretierten Koordinaten zu persistieren.
      const finished = stroke.pdfAnchor
        ? (strokeToStored(stroke, canvasWidthRef.current, pdfPagesRef.current, pdfPrintoutRef.current?.id) ?? { ...stroke, pdfAnchor: undefined })
        : stroke
      strokesRef.current.push(finished)
      setStrokeCount(strokesRef.current.length)
      onChangeRef.current(toSavedStrokes(strokesRef.current, canvasWidthRef.current))
    }
    currentStrokeRef.current = null
    activeTouchIdRef.current = null
  }

  useEffect(() => {
    const canvas = canvasRef.current
    const overlay = overlayRef.current
    const wrap = wrapRef.current
    const background = backgroundRef.current
    if (!canvas || !overlay || !wrap || !background) return

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
      // Bei JEDER Groessenaenderung (nicht nur beim ersten Settle) neu zeichnen - PDF-gebundene
      // Striche werden dabei ueber toDrawableStrokes frisch aus der neuen Breite abgeleitet
      // (siehe redrawCanvas), bleiben also auch nach spaeteren Resizes/Rotationen exakt auf der
      // PDF-Seite ausgerichtet. Nicht gebundene Tinte bleibt unveraendert bei ihren einmal
      // aufgeloesten absoluten Pixeln (siehe unten), toAbsoluteX in strokeToAbsolute ist fuer
      // sie dabei dank LEGACY_ABS_X_THRESHOLD ein sicheres No-op.
      if (widthSettledRef.current) redrawCanvas()

      if (!widthSettledRef.current) {
        if (settleTimer) clearTimeout(settleTimer)
        settleTimer = setTimeout(() => {
          if (widthSettledRef.current) return
          widthSettledRef.current = true
          // Nur NICHT an ein PDF gebundene Striche brauchen diese einmalige Umrechnung - PDF-
          // gebundene bleiben dauerhaft in Bruchteils-Form (siehe strokeToStored) und werden nie
          // hier, sondern immer erst beim Zeichnen selbst aufgeloest (siehe redrawCanvas oben).
          strokesRef.current = strokesRef.current.map((s) =>
            s.pdfAnchor ? s : { ...s, points: s.points.map((p) => ({ ...p, x: toAbsoluteX(p.x, canvasWidthRef.current) })) },
          )
          redrawCanvas()
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
      if (pdfLayerRef.current) pdfLayerRef.current.style.transform = transform
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
      // Bindet den Strich an die PDF-Seite, auf der er beginnt (siehe findPdfPageAt) - fuer die
      // gesamte Dauer des Strichs, ein einzelner Pencil-Zug ueberquert in der Praxis nie eine
      // Seitengrenze. Ohne PDF an dieser Stelle (kein pdfPrintout oder Y liegt im Papierbereich)
      // bleibt der Strich komplett ungebunden - normale Tinte verhaelt sich dadurch unveraendert.
      const printoutId = pdfPrintoutRef.current?.id
      const pageNumber = printoutId ? findPdfPageAt(p.y, pdfPagesRef.current, canvasWidthRef.current) : null
      currentStrokeRef.current = {
        points: [p],
        color: colorRef.current,
        width: baseWidthRef.current,
        eraser: eraserRef.current,
        pdfAnchor: printoutId && pageNumber !== null ? { printoutId, pageNumber } : undefined,
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
      // Touch-Events auf der gemeinsamen Huelle beobachten, damit Zwei-Finger-Gesten auch
      // ueber den oberhalb des Zeichen-Overlays liegenden Textfeldern ankommen. Den ersten
      // Finger dort nicht unterdruecken: Textarea-Fokus, Cursorplatzierung und Textauswahl
      // bleiben so natives Browser-Verhalten. Sobald ein zweiter Finger hinzukommt, gehoert
      // die Geste wieder eindeutig dem Canvas-Pan/Zoom.
      const overTextBlock = e.target instanceof Element && e.target.closest('.text-block') !== null
      if (!overTextBlock || e.touches.length >= 2) e.preventDefault()
      for (const t of Array.from(e.changedTouches)) {
        const { touchType, force } = describeTouch(t)
        if (touchType === 'stylus') stylusDetectedRef.current = true

        if (overTextBlock && e.touches.length < 2) {
          if (touchType === 'direct') fingersRef.current.set(t.identifier, { x: t.clientX, y: t.clientY })
          continue
        }

        // Lasso-Modus: sowohl Finger als auch Stift zeichnen die Auswahlkontur bzw. verschieben
        // die Auswahl (anders als normale Tinte, die nur auf den Stift reagiert - eine
        // Auswahlgeste ist wie in OneNote bewusst auch mit dem Finger nutzbar). Nur der ERSTE
        // Finger/Stift ohne bereits laufende Lasso-Geste zaehlt, damit ein zusaetzlicher zweiter
        // Finger weiterhin ganz normal die bestehende Pinch-Zoom-Geste ausloesen kann.
        if (
          lassoModeRef.current &&
          lassoActiveTouchIdRef.current === null &&
          (touchType === 'stylus' || (touchType === 'direct' && fingersRef.current.size === 0))
        ) {
          lassoActiveTouchIdRef.current = t.identifier
          startLassoGesture(pointFrom(t.clientX, t.clientY, force))
          continue
        }

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
      const overTextBlock = e.target instanceof Element && e.target.closest('.text-block') !== null
      if (
        overTextBlock &&
        e.touches.length < 2 &&
        activeTouchIdRef.current === null &&
        lassoActiveTouchIdRef.current === null
      ) {
        return
      }
      e.preventDefault()
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== lassoActiveTouchIdRef.current) continue
        const { force } = describeTouch(t)
        updateLassoGesture(pointFrom(t.clientX, t.clientY, force))
      }
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
        if (t.identifier === lassoActiveTouchIdRef.current) {
          finishLassoGesture()
          lassoActiveTouchIdRef.current = null
          continue
        }
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

    wrap.addEventListener('touchstart', onTouchStart, { passive: false })
    wrap.addEventListener('touchmove', onTouchMove, { passive: false })
    wrap.addEventListener('touchend', onTouchEnd, { passive: false })
    wrap.addEventListener('touchcancel', onTouchEnd, { passive: false })

    // --- Maus-Fallback nur fuers Testen am Desktop ---
    let mouseDown = false
    let lassoMouseActive = false
    function onMouseDown(e: MouseEvent) {
      if (lassoModeRef.current) {
        lassoMouseActive = true
        startLassoGesture(pointFrom(e.clientX, e.clientY, 0.5))
        return
      }
      mouseDown = true
      startStroke(pointFrom(e.clientX, e.clientY, 0.5))
      updateDebug('mouse', 0.5)
    }
    function onMouseMove(e: MouseEvent) {
      if (lassoMouseActive) {
        updateLassoGesture(pointFrom(e.clientX, e.clientY, 0.5))
        return
      }
      if (!mouseDown) return
      extendStroke(pointFrom(e.clientX, e.clientY, 0.5))
    }
    function onMouseUp() {
      if (lassoMouseActive) {
        lassoMouseActive = false
        finishLassoGesture()
        return
      }
      if (!mouseDown) return
      mouseDown = false
      finishCurrentStroke()
    }
    overlay.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    // --- Mausrad/Trackpad (Desktop): normales Scrollen pannt, Ctrl/Cmd+Scrollen zoomt ---
    // Nutzt dieselbe applyView/viewRef-Logik wie der Zwei-Finger-Touch-Pinch oben (kein
    // eigener Scroll-Mechanismus) - vor allem gedacht fuer mehrseitige PDFs: auf dem iPad
    // erreicht man tiefere Seiten schon per Zwei-Finger-Pan, auf dem PC gibt es dafuer bisher
    // keine Eingabe. Ctrl/Cmd+Wheel statt normalem Wheel fuers Zoomen deckt sich mit dem
    // Browser-Standard: Trackpad-Pinch-Gesten erzeugen automatisch Wheel-Events mit
    // ctrlKey:true, die bestehende Pinch-Geste funktioniert also unveraendert weiter, nur eben
    // ueber Wheel statt Touch.
    const WHEEL_ZOOM_SPEED = 0.0015
    // Klassische Mausraeder melden oft deltaMode 1 ("Zeile") mit sehr kleinen Werten (haeufig
    // ±3) statt Pixeln - hochskalieren, sonst wirkt Scrollen dort quaelend langsam.
    const WHEEL_LINE_HEIGHT_PX = 24
    function onWheel(e: WheelEvent) {
      // Waehrend aktiv mit Maus oder Stift gezeichnet ODER eine Lasso-Geste ausgefuehrt wird,
      // soll ein Wheel-Event (z.B. ein versehentlich beruehrtes Trackpad) weder pannen/zoomen
      // noch den laufenden Strich/die Auswahlgeste beeinflussen - preventDefault trotzdem,
      // damit kein natives Scrollen/Browser-Zoom dazwischenfunkt.
      e.preventDefault()
      if (mouseDown || activeTouchIdRef.current !== null || lassoMouseActive || lassoActiveTouchIdRef.current !== null) return

      const factor = e.deltaMode === 1 ? WHEEL_LINE_HEIGHT_PX : 1
      const dx = e.deltaX * factor
      const dy = e.deltaY * factor
      const view = viewRef.current

      if (e.ctrlKey || e.metaKey) {
        const rect = overlay!.getBoundingClientRect()
        const newScale = view.scale * Math.exp(-dy * WHEEL_ZOOM_SPEED)
        const localX = e.clientX - rect.left
        const localY = e.clientY - rect.top
        // Gleiches Pinch-to-Point-Verhalten wie updatePinch oben: der Punkt unter dem Cursor
        // bleibt beim Zoomen unter dem Cursor.
        const contentX = (localX - view.x) / view.scale
        const contentY = (localY - view.y) / view.scale
        applyView(newScale, localX - contentX * newScale, localY - contentY * newScale)
        setZoomPercent(Math.round(viewRef.current.scale * 100))
        return
      }

      applyView(view.scale, view.x - dx, view.y - dy)
    }
    // Die Text-/Task-Ebene ist ein Geschwisterelement oberhalb des Overlays. Auf der gemeinsamen
    // Huelle kommen Wheel-Events aus beiden Ebenen an, ohne dass die Textarea selbst Handler oder
    // stopPropagation braucht.
    wrap.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      resizeObserver.disconnect()
      if (settleTimer) clearTimeout(settleTimer)
      wrap.removeEventListener('touchstart', onTouchStart)
      wrap.removeEventListener('touchmove', onTouchMove)
      wrap.removeEventListener('touchend', onTouchEnd)
      wrap.removeEventListener('touchcancel', onTouchEnd)
      overlay.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      wrap.removeEventListener('wheel', onWheel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function undo() {
    strokesRef.current.pop()
    setStrokeCount(strokesRef.current.length)
    // Ein pop() koennte die Indizes einer laufenden Lasso-Auswahl verschieben - sicherheitshalber
    // aufheben statt mit potenziell falschen Indizes weiterzumachen.
    clearSelectionState()
    redrawCanvas()
    onChangeRef.current(toSavedStrokes(strokesRef.current, canvasWidthRef.current))
  }

  function clearAll() {
    if (!window.confirm('Zeichenfläche wirklich komplett leeren? Das kann nicht rückgängig gemacht werden.')) return
    strokesRef.current = []
    setStrokeCount(0)
    clearSelectionState()
    redrawCanvas()
    onChangeRef.current(toSavedStrokes(strokesRef.current, canvasWidthRef.current))
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
              onRequestExitLasso?.()
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
        <button
          className={`icon-button${eraser ? ' active' : ''}`}
          onClick={() => {
            setEraser((v) => !v)
            onRequestExitLasso?.()
          }}
          aria-label="Radierer"
          title="Radierer"
        >
          <EraserIcon />
        </button>
        <button className="icon-button" onClick={undo} disabled={strokeCount === 0} aria-label="Rückgängig" title="Rückgängig">
          <UndoIcon />
        </button>
        <button className="icon-button" onClick={clearAll} disabled={strokeCount === 0} aria-label="Leeren" title="Leeren">
          <BroomIcon />
        </button>
        <input
          ref={pdfFileInputRef}
          type="file"
          accept="application/pdf"
          className="pdf-file-input"
          onChange={handlePdfFileChange}
        />
        <button
          className={`icon-button${pdfPrintout ? ' active' : ''}`}
          onClick={() => pdfFileInputRef.current?.click()}
          disabled={pdfLoading}
          aria-label="PDF einfügen"
          title="PDF einfügen"
        >
          <PdfIcon />
        </button>
        {pdfPrintout && (
          <button className="icon-button" onClick={() => onRemovePdf?.()} aria-label="PDF entfernen" title="PDF entfernen">
            ✕
          </button>
        )}
        {pdfLoading && <span className="drawing-status">PDF wird geladen …</span>}
        {pdfError && <span className="drawing-status pdf-error">{pdfError}</span>}
        {selectedIndices.size > 0 && (
          <button className="icon-button lasso-delete" onClick={deleteSelection} aria-label="Auswahl löschen" title="Auswahl löschen (Entf)">
            <TrashIcon />
          </button>
        )}
        {zoomPercent !== 100 && (
          <button onClick={() => resetZoomRef.current()}>Zoom {zoomPercent}% zurücksetzen</button>
        )}
        {toolbarExtra}
        <div className="drawing-status" ref={statusRef}>
          Noch keine Eingabe
        </div>
      </div>
      <div className="drawing-canvas-wrap" ref={wrapRef}>
        {/* Eigenes Element statt CSS-Hintergrund direkt auf dem <canvas>: WebKit aktualisiert
            den Compositor-Layer eines Canvas-Elements beim Klassenwechsel manchmal nicht
            zuverlässig (Papiermuster blieb nach "Leer" -> "Liniert" bis zum Neuladen falsch). */}
        <div
          key={background}
          ref={backgroundRef}
          className="drawing-background"
          style={{
            height: contentHeightStyle,
            transform: `translate(${viewRef.current.x}px, ${viewRef.current.y}px) scale(${viewRef.current.scale})`,
          }}
        >
          {(background === 'lined' || background === 'dotted') &&
            Array.from({ length: Math.max(1, Math.ceil(contentHeight / PATTERN_CHUNK_HEIGHT)) }).map((_, i) => {
              const top = i * PATTERN_CHUNK_HEIGHT
              const height = Math.min(PATTERN_CHUNK_HEIGHT, contentHeight - top)
              return <div key={i} className={`drawing-background-chunk bg-${background}`} style={{ top, height }} />
            })}
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
        {/* PDF-Seiten (siehe lib/pdfRender.ts) liegen ueber dem Papierhintergrund, aber unter der
            Tinte - genau wie Hintergrund/Canvas/Task-Ebene bekommt diese Ebene dieselbe Hoehe und
            denselben Zoom/Pan-Transform (siehe applyView), damit Geschriebenes exakt ausgerichtet
            bleibt. pointer-events:none (siehe CSS) - die Seiten sind reine Anzeige, nicht
            verschiebbar, Tipp-/Zeichen-Eingaben erreichen ungehindert das Overlay darunter. */}
        {pdfPages.length > 0 && (
          <div ref={pdfLayerRef} className="pdf-layer" style={{ height: contentHeightStyle }}>
            {pdfPages.map((p, i) => (
              <PdfPageHost key={i} canvas={p.canvas} style={{ marginBottom: i < pdfPages.length - 1 ? PDF_PAGE_GAP : 0 }} />
            ))}
          </div>
        )}
        <div className="page-updated-at">Bearbeitet {formatRelativeTime(updatedAt)}</div>
        <canvas
          ref={canvasRef}
          className="drawing-canvas"
          style={{ height: contentHeightStyle }}
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
        />
        <div ref={overlayRef} className="drawing-overlay" />
        {/* Liegt ueber .drawing-overlay (spaeter im DOM = oben in der Stapelreihenfolge) - ein
            Tap auf einen Task-Block trifft dadurch immer den Block selbst, nie das Zeichen-
            Overlay darunter, das DrawingCanvas' eigene Touch-/Zoom-Logik bleibt unberuehrt.
            Der Layer selbst ist nur im Aufgaben-Modus antippbar (pointer-events), einzelne
            Task-Bloecke bleiben aber immer bedienbar. */}
        <div
          ref={taskLayerRef}
          className={`task-layer${taskMode ? ' task-mode' : ''}${textBlockMode ? ' text-mode' : ''}`}
          style={{
            height: contentHeightStyle,
            transform: `translate(${viewRef.current.x}px, ${viewRef.current.y}px) scale(${viewRef.current.scale})`,
          }}
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
              onResizeWidth={(width) => onResizeTextBlockWidth?.(b.id, width)}
              onOpenPageLink={(pageId) => onOpenPageLink?.(pageId)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

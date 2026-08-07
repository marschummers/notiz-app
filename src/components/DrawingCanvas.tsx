import { useEffect, useRef, useState } from 'react'
import type { PageBackground, Point, Stroke } from '../db/types'
import { formatRelativeTime } from '../lib/format'
import './DrawingCanvas.css'

const COLORS = ['#08060d', '#d1263f', '#1d5fd6']

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

interface Props {
  initialStrokes: Stroke[]
  onChange: (strokes: Stroke[]) => void
  background: PageBackground
  title: string
  updatedAt: number
}

export default function DrawingCanvas({ initialStrokes, onChange, background, title, updatedAt }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  // Safari behandelt <canvas> mit gezeichnetem Inhalt wie ein Bild (Hover-Vorschau,
  // "Teilen"-Angebot per Pencil) - das faengt Touch-Sequenzen komplett ab, bevor sie unsere
  // Handler erreichen. Deshalb nimmt ein unsichtbares Overlay-Div die Eingabe entgegen, das
  // Canvas darunter ist rein zur Darstellung da (pointer-events: none).
  const overlayRef = useRef<HTMLDivElement>(null)
  const backgroundRef = useRef<HTMLDivElement>(null)
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
      onChangeRef.current(strokesRef.current)
    }
    currentStrokeRef.current = null
    activeTouchIdRef.current = null
  }

  useEffect(() => {
    const canvas = canvasRef.current
    const overlay = overlayRef.current
    const background = backgroundRef.current
    if (!canvas || !overlay || !background) return

    function resize() {
      const dpr = window.devicePixelRatio || 1
      const { clientWidth, clientHeight } = canvas!
      canvas!.width = clientWidth * dpr
      canvas!.height = clientHeight * dpr
      const ctx = canvas!.getContext('2d')
      if (!ctx) return
      ctx.scale(dpr, dpr)
      ctxRef.current = ctx
      redrawAll(ctx, clientWidth, clientHeight, strokesRef.current)
    }
    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('orientationchange', resize)

    // Zoom/Pan wird rein per CSS-Transform auf Hintergrund+Canvas dargestellt (das Overlay,
    // also die Touch-Zielflaeche, bleibt unveraendert auf voller Groesse) - die Striche selbst
    // bleiben in unskaliertem Koordinatenraum gespeichert, nur die Darstellung skaliert.
    function applyView(scale: number, x: number, y: number) {
      const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
      viewRef.current = { scale: clamped, x, y }
      const transform = `translate(${x}px, ${y}px) scale(${clamped})`
      canvas!.style.transform = transform
      background!.style.transform = transform
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

        // Zwei-Finger-Zoom: Fingerposition immer mitverfolgen (auch waehrend Palm Rejection -
        // ein bewusstes Auseinander-/Zusammenziehen zweier Finger ist etwas anderes als eine
        // ruhende Handflaeche). Bei genau zwei aktiven Fingern startet eine Pinch-Geste statt
        // zu zeichnen; ein dritter Finger wird ignoriert.
        if (touchType === 'direct') {
          fingersRef.current.set(t.identifier, { x: t.clientX, y: t.clientY })
          if (fingersRef.current.size === 2) {
            if (activeTouchIdRef.current !== null && !stylusDetectedRef.current) {
              // Ein laufender Finger-Strich (nur moeglich, solange noch nie ein Stift benutzt
              // wurde) wird verworfen statt committet, damit kein ungewollter Strich stehen bleibt.
              currentStrokeRef.current = null
              activeTouchIdRef.current = null
            }
            startPinch()
            continue
          }
          if (fingersRef.current.size > 2) continue
        }

        // Palm rejection: sobald einmal ein Stift erkannt wurde, zeichnet nur noch der Stift.
        if (touchType !== 'stylus' && stylusDetectedRef.current) continue

        if (activeTouchIdRef.current !== null && activeTouchIdRef.current !== t.identifier) {
          if (touchType !== 'stylus') continue
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
      window.removeEventListener('resize', resize)
      window.removeEventListener('orientationchange', resize)
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
    onChangeRef.current(strokesRef.current)
  }

  function clearAll() {
    if (!window.confirm('Zeichenfläche wirklich komplett leeren? Das kann nicht rückgängig gemacht werden.')) return
    strokesRef.current = []
    setStrokeCount(0)
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (canvas && ctx) redrawAll(ctx, canvas.clientWidth, canvas.clientHeight, strokesRef.current)
    onChangeRef.current(strokesRef.current)
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
        <button className={eraser ? 'active' : ''} onClick={() => setEraser((v) => !v)}>
          Radierer
        </button>
        <button onClick={undo} disabled={strokeCount === 0}>
          Rückgängig
        </button>
        <button onClick={clearAll} disabled={strokeCount === 0}>
          Leeren
        </button>
        {zoomPercent !== 100 && (
          <button onClick={() => resetZoomRef.current()}>Zoom {zoomPercent}% zurücksetzen</button>
        )}
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
      </div>
    </div>
  )
}

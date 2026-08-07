import { useEffect, useRef, useState } from 'react'
import type { PageBackground, Point, Stroke } from '../db/types'
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

interface Props {
  initialStrokes: Stroke[]
  onChange: (strokes: Stroke[]) => void
  background: PageBackground
}

export default function DrawingCanvas({ initialStrokes, onChange, background }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  // Safari behandelt <canvas> mit gezeichnetem Inhalt wie ein Bild (Hover-Vorschau,
  // "Teilen"-Angebot per Pencil) - das faengt Touch-Sequenzen komplett ab, bevor sie unsere
  // Handler erreichen. Deshalb nimmt ein unsichtbares Overlay-Div die Eingabe entgegen, das
  // Canvas darunter ist rein zur Darstellung da (pointer-events: none).
  const overlayRef = useRef<HTMLDivElement>(null)
  const statusRef = useRef<HTMLDivElement>(null)

  const strokesRef = useRef<Stroke[]>(initialStrokes)
  const currentStrokeRef = useRef<Stroke | null>(null)
  const activeTouchIdRef = useRef<number | null>(null)
  const stylusDetectedRef = useRef(false)

  const [color, setColor] = useState(COLORS[0])
  const [baseWidth, setBaseWidth] = useState(3)
  const [eraser, setEraser] = useState(false)
  const [strokeCount, setStrokeCount] = useState(initialStrokes.length)

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
    if (!canvas || !overlay) return

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

    function pointFrom(clientX: number, clientY: number, pressure: number): Point {
      const rect = overlay!.getBoundingClientRect()
      return { x: clientX - rect.left, y: clientY - rect.top, pressure }
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
        <div className="drawing-status" ref={statusRef}>
          Noch keine Eingabe
        </div>
      </div>
      <div className="drawing-canvas-wrap">
        {/* Eigenes Element statt CSS-Hintergrund direkt auf dem <canvas>: WebKit aktualisiert
            den Compositor-Layer eines Canvas-Elements beim Klassenwechsel manchmal nicht
            zuverlässig (Papiermuster blieb nach "Leer" -> "Liniert" bis zum Neuladen falsch). */}
        <div key={background} className={`drawing-background bg-${background}`} />
        <canvas ref={canvasRef} className="drawing-canvas" draggable={false} onDragStart={(e) => e.preventDefault()} />
        <div ref={overlayRef} className="drawing-overlay" />
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import './App.css'

interface Point {
  x: number
  y: number
  pressure: number
}

interface Stroke {
  points: Point[]
  color: string
  width: number
  eraser: boolean
}

const COLORS = ['#08060d', '#d1263f', '#1d5fd6']
const STORAGE_KEY = 'notiz-app-prototype-strokes'

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

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  // Safari behandelt <canvas> mit gezeichnetem Inhalt wie ein Bild (Hover-Vorschau,
  // "Teilen"-Angebot per Pencil) - das faengt Touch-Sequenzen komplett ab, bevor sie
  // unsere Handler erreichen. Deshalb nimmt ein unsichtbares Overlay-Div die Eingabe
  // entgegen, das Canvas darunter ist rein zur Darstellung da (pointer-events: none).
  const overlayRef = useRef<HTMLDivElement>(null)
  const statusRef = useRef<HTMLDivElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const logLinesRef = useRef<string[]>([])

  const strokesRef = useRef<Stroke[]>([])
  const currentStrokeRef = useRef<Stroke | null>(null)
  const activePointerIdRef = useRef<number | null>(null)
  const penDetectedRef = useRef(false)

  const [color, setColor] = useState(COLORS[0])
  const [baseWidth, setBaseWidth] = useState(3)
  const [eraser, setEraser] = useState(false)
  const [strokeCount, setStrokeCount] = useState(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) strokesRef.current = JSON.parse(saved) as Stroke[]
    } catch {
      // korrupte Daten ignorieren, mit leerer Zeichenflaeche starten
    }
    setStrokeCount(strokesRef.current.length)

    function resize() {
      if (!canvas) return
      const dpr = window.devicePixelRatio || 1
      const { clientWidth, clientHeight } = canvas
      canvas.width = clientWidth * dpr
      canvas.height = clientHeight * dpr
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.scale(dpr, dpr)
      ctxRef.current = ctx
      redrawAll(ctx, clientWidth, clientHeight, strokesRef.current)
    }

    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('orientationchange', resize)
    return () => {
      window.removeEventListener('resize', resize)
      window.removeEventListener('orientationchange', resize)
    }
  }, [])

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(strokesRef.current))
    } catch {
      // z.B. Speicher voll - Zeichnung bleibt trotzdem im Speicher erhalten
    }
  }

  function eventToPoint(e: PointerEvent, rect: DOMRect): Point {
    const pressure = e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, pressure }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const overlay = overlayRef.current
    const ctx = ctxRef.current
    if (!overlay || !ctx) return

    // Immer zuerst preventDefault, auch fuer Eingaben die wir gleich ignorieren -
    // sonst greift iOS Safari seine eigene Geste (Text markieren, Lupe, ...) und
    // der naechste Pointerdown wirkt "haengen geblieben".
    e.preventDefault()
    log(`↓ down id=${e.pointerId} type=${e.pointerType} buttons=${e.buttons} p=${e.pressure.toFixed(2)} activeWar=${activePointerIdRef.current}`)

    if (e.pointerType === 'pen') penDetectedRef.current = true
    // Palm rejection: sobald einmal ein Stift erkannt wurde, zeichnet nur noch der Stift.
    if (e.pointerType === 'touch' && penDetectedRef.current) return

    if (e.pointerType === 'pen') {
      // Der Stift ist immer autoritativ: falls durch ein verpasstes pointerup/-cancel
      // noch ein alter Strich als "aktiv" markiert ist, hier hart abschliessen statt
      // den neuen Tipp stillschweigend zu ignorieren (das war das "2x antippen"-Problem).
      if (activePointerIdRef.current !== null && activePointerIdRef.current !== e.pointerId) {
        finishCurrentStroke()
      }
    } else if (activePointerIdRef.current !== null) {
      return
    }

    overlay.setPointerCapture(e.pointerId)
    activePointerIdRef.current = e.pointerId

    const rect = overlay.getBoundingClientRect()
    const point = eventToPoint(e.nativeEvent, rect)
    currentStrokeRef.current = { points: [point], color, width: baseWidth, eraser }
    updateDebug(e.pointerType, point.pressure)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerId !== activePointerIdRef.current) return
    const overlay = overlayRef.current
    const ctx = ctxRef.current
    const stroke = currentStrokeRef.current
    if (!overlay || !ctx || !stroke) return
    e.preventDefault()

    const rect = overlay.getBoundingClientRect()
    const native = e.nativeEvent
    const events = native.getCoalescedEvents ? native.getCoalescedEvents() : [native]

    for (const ev of events) {
      const point = eventToPoint(ev, rect)
      const pts = stroke.points
      pts.push(point)
      const n = pts.length
      if (n >= 3) {
        const from = midPoint(pts[n - 3], pts[n - 2])
        const to = midPoint(pts[n - 2], pts[n - 1])
        drawSegment(ctx, from, pts[n - 2], to, stroke)
      } else if (n === 2) {
        drawSegment(ctx, pts[0], pts[0], pts[1], stroke)
      }
    }
    updateDebug(e.pointerType, stroke.points[stroke.points.length - 1].pressure)
  }

  function finishCurrentStroke() {
    const overlay = overlayRef.current
    if (overlay && activePointerIdRef.current !== null) {
      try {
        overlay.releasePointerCapture(activePointerIdRef.current)
      } catch {
        // war schon freigegeben, egal
      }
    }
    const stroke = currentStrokeRef.current
    if (stroke) {
      strokesRef.current.push(stroke)
      setStrokeCount(strokesRef.current.length)
      persist()
    }
    currentStrokeRef.current = null
    activePointerIdRef.current = null
  }

  function endStroke(e: React.PointerEvent<HTMLDivElement>) {
    log(`${labelFor(e.type)} id=${e.pointerId} type=${e.pointerType}`)
    if (e.pointerId !== activePointerIdRef.current) return
    finishCurrentStroke()
  }

  function updateDebug(pointerType: string, pressure: number) {
    if (!statusRef.current) return
    statusRef.current.textContent = `Typ: ${pointerType} | Pencil erkannt: ${penDetectedRef.current ? 'ja' : 'nein'} | Druck: ${pressure.toFixed(2)}`
  }

  function labelFor(type: string) {
    switch (type) {
      case 'pointerdown':
        return '↓ down'
      case 'pointerup':
        return '↑ up'
      case 'pointercancel':
        return '✕ cancel'
      case 'pointerleave':
        return '⇥ leave'
      case 'lostpointercapture':
        return '⊘ lostcapture'
      case 'pointerenter':
        return '⌁ enter'
      case 'pointerover':
        return '⌁ over'
      case 'pointerout':
        return '⌁ out'
      default:
        return type
    }
  }

  function log(msg: string) {
    if (!logRef.current) return
    const t = (performance.now() / 1000).toFixed(2)
    logLinesRef.current.push(`${t}s ${msg}`)
    if (logLinesRef.current.length > 30) logLinesRef.current.shift()
    logRef.current.textContent = logLinesRef.current.join('\n')
    logRef.current.scrollTop = logRef.current.scrollHeight
  }

  function handleHover(e: React.PointerEvent<HTMLDivElement>) {
    log(`${labelFor(e.type)} id=${e.pointerId} type=${e.pointerType} buttons=${e.buttons}`)
  }

  function undo() {
    strokesRef.current.pop()
    setStrokeCount(strokesRef.current.length)
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (canvas && ctx) redrawAll(ctx, canvas.clientWidth, canvas.clientHeight, strokesRef.current)
    persist()
  }

  function clearAll() {
    strokesRef.current = []
    setStrokeCount(0)
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (canvas && ctx) redrawAll(ctx, canvas.clientWidth, canvas.clientHeight, strokesRef.current)
    persist()
  }

  return (
    <div className="app">
      <div className="toolbar">
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
        <div className="status" ref={statusRef}>
          Noch keine Eingabe
        </div>
      </div>
      <div className="canvas-wrap">
        <canvas ref={canvasRef} className="canvas" draggable={false} onDragStart={(e) => e.preventDefault()} />
        <div
          ref={overlayRef}
          className="overlay"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={endStroke}
          onLostPointerCapture={endStroke}
          onPointerEnter={handleHover}
          onPointerOver={handleHover}
          onPointerOut={handleHover}
        />
      </div>
      <div className="log" ref={logRef} />
    </div>
  )
}

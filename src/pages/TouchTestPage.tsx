import { useEffect, useRef } from 'react'
import { TestHeader } from './TestHeader'
import { useEventLog } from '../lib/useEventLog'
import './tests.css'

function describeTouch(t: Touch) {
  // touchType ist eine nicht-standardisierte WebKit-Erweiterung des Touch-Interface,
  // die im DOM-Lib-Typing von TypeScript fehlt.
  const touchType = (t as unknown as { touchType?: string }).touchType ?? 'n/a'
  const force = typeof t.force === 'number' ? t.force.toFixed(2) : 'n/a'
  return `id=${t.identifier} touchType=${touchType} force=${force}`
}

/**
 * Testet die klassische Touch Events API (touchstart/move/end/cancel) statt
 * Pointer Events, ueber native addEventListener mit { passive: false } - laut
 * Entwickler-Hinweis der eigentlich interessante Test, da WebKit hier eventuell
 * anders (und zuverlaessiger) zwischen Pencil und Finger unterscheidet.
 */
export function TouchTestPage() {
  const areaRef = useRef<HTMLDivElement>(null)
  const dotRef = useRef<HTMLDivElement>(null)
  const lastMoveLogRef = useRef(0)
  const { logRef, log, clear } = useEventLog()

  useEffect(() => {
    const el = areaRef.current
    if (!el) return

    function setDot(x: number, y: number, visible: boolean) {
      const dot = dotRef.current
      if (!dot) return
      dot.style.display = visible ? 'block' : 'none'
      dot.style.left = `${x}px`
      dot.style.top = `${y}px`
    }

    function onStart(e: TouchEvent) {
      e.preventDefault()
      const rect = el!.getBoundingClientRect()
      for (const t of Array.from(e.changedTouches)) {
        log(`↓ touchstart ${describeTouch(t)}`)
        setDot(t.clientX - rect.left, t.clientY - rect.top, true)
      }
    }

    function onMove(e: TouchEvent) {
      e.preventDefault()
      const now = performance.now()
      if (now - lastMoveLogRef.current > 50) {
        for (const t of Array.from(e.changedTouches)) log(`⟲ touchmove ${describeTouch(t)}`)
        lastMoveLogRef.current = now
      }
      const rect = el!.getBoundingClientRect()
      const t0 = e.touches[0]
      if (t0) setDot(t0.clientX - rect.left, t0.clientY - rect.top, true)
    }

    function onEnd(e: TouchEvent) {
      e.preventDefault()
      for (const t of Array.from(e.changedTouches)) log(`↑ touchend ${describeTouch(t)}`)
      if (e.touches.length === 0) setDot(0, 0, false)
    }

    function onCancel(e: TouchEvent) {
      for (const t of Array.from(e.changedTouches)) log(`✕ touchcancel ${describeTouch(t)}`)
      if (e.touches.length === 0) setDot(0, 0, false)
    }

    el.addEventListener('touchstart', onStart, { passive: false })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: false })
    el.addEventListener('touchcancel', onCancel, { passive: false })

    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onCancel)
    }
  }, [log])

  return (
    <div className="test-page">
      <TestHeader title="Test 3: native Touch Events (touchstart/move/end/cancel)" onClear={clear} />
      <div className="test-area" ref={areaRef} style={{ touchAction: 'none' }}>
        <div className="test-dot" ref={dotRef} />
      </div>
      <div className="log" ref={logRef} />
    </div>
  )
}

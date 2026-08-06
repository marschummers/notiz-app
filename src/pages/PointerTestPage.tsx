import { useEffect, useRef } from 'react'
import { TestHeader } from './TestHeader'
import { useEventLog } from '../lib/useEventLog'
import './tests.css'

interface Props {
  title: string
  touchAction: 'none' | 'manipulation'
}

/**
 * Testet Pointer Events OHNE jegliche Pointer-Capture-Logik (kein setPointerCapture,
 * releasePointerCapture, lostpointercapture) - bewusst reduziert gegenueber dem
 * Haupt-Prototyp, um Pointer Capture als moeglichen Faktor zu isolieren.
 * touchAction ist der einzige Unterschied zwischen Test 1 (none) und Test 2 (manipulation).
 */
export function PointerTestPage({ title, touchAction }: Props) {
  const areaRef = useRef<HTMLDivElement>(null)
  const dotRef = useRef<HTMLDivElement>(null)
  const activeIdRef = useRef<number | null>(null)
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

    function onDown(e: PointerEvent) {
      e.preventDefault()
      log(`↓ down id=${e.pointerId} type=${e.pointerType} buttons=${e.buttons} p=${e.pressure.toFixed(2)}`)
      activeIdRef.current = e.pointerId
      const rect = el!.getBoundingClientRect()
      setDot(e.clientX - rect.left, e.clientY - rect.top, true)
    }

    function onMove(e: PointerEvent) {
      const now = performance.now()
      if (now - lastMoveLogRef.current > 50) {
        log(`⟲ move id=${e.pointerId} type=${e.pointerType} buttons=${e.buttons} p=${e.pressure.toFixed(2)}`)
        lastMoveLogRef.current = now
      }
      if (e.pointerId === activeIdRef.current) {
        e.preventDefault()
        const rect = el!.getBoundingClientRect()
        setDot(e.clientX - rect.left, e.clientY - rect.top, true)
      }
    }

    function onUp(e: PointerEvent) {
      log(`↑ up id=${e.pointerId} type=${e.pointerType}`)
      if (e.pointerId === activeIdRef.current) {
        activeIdRef.current = null
        setDot(0, 0, false)
      }
    }

    function onCancel(e: PointerEvent) {
      log(`✕ cancel id=${e.pointerId} type=${e.pointerType}`)
      if (e.pointerId === activeIdRef.current) {
        activeIdRef.current = null
        setDot(0, 0, false)
      }
    }

    function onEnter(e: PointerEvent) {
      log(`⌁ enter id=${e.pointerId} type=${e.pointerType} buttons=${e.buttons}`)
    }

    function onOut(e: PointerEvent) {
      log(`⌁ out id=${e.pointerId} type=${e.pointerType} buttons=${e.buttons}`)
    }

    // Pointerleave beendet den Strich hier bewusst NICHT (nur Logging) -
    // Vorgabe war, das nicht vorschnell als Stroke-Ende zu werten.
    function onLeave(e: PointerEvent) {
      log(`⇥ leave id=${e.pointerId} type=${e.pointerType} (Strich bleibt aktiv)`)
    }

    el.addEventListener('pointerdown', onDown, { passive: false })
    el.addEventListener('pointermove', onMove, { passive: false })
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onCancel)
    el.addEventListener('pointerenter', onEnter)
    el.addEventListener('pointerout', onOut)
    el.addEventListener('pointerleave', onLeave)

    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onCancel)
      el.removeEventListener('pointerenter', onEnter)
      el.removeEventListener('pointerout', onOut)
      el.removeEventListener('pointerleave', onLeave)
    }
  }, [log])

  return (
    <div className="test-page">
      <TestHeader title={title} onClear={clear} />
      <div className="test-area" ref={areaRef} style={{ touchAction }}>
        <div className="test-dot" ref={dotRef} />
      </div>
      <div className="log" ref={logRef} />
    </div>
  )
}

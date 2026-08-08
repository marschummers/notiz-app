import { useEffect, useRef, useState } from 'react'

interface ExternalDropOptions {
  // CSS-Selektor fuer gueltige Drop-Ziele AUSSERHALB der eigenen Liste (z.B. Ordner-Zeilen in
  // der Sidebar, per data-folder-drop-target markiert) - beim Ziehen darueber wird NICHT
  // innerhalb der eigenen Liste umsortiert, sondern beim Loslassen onDropOnExternal aufgerufen.
  selector: string
  attr: string
  onDropOnExternal: (id: string, targetKey: string) => void
}

// Wiederverwendbare Drag-to-Reorder-Logik fuer Listen mit einem sichtbaren Greif-Punkt pro
// Zeile/Kachel (gleiches ⋮⋮-Muster wie bei Tasks in DrawingCanvas.tsx) - funktioniert mit Maus
// UND Touch (Finger + Stift), da natives HTML5-Drag-and-Drop auf iPadOS/Safari mit Touch nicht
// funktioniert. Waehrend des Ziehens wird die Zielposition ueber die naechstgelegene Kachel/
// Zeile bestimmt (Mittelpunkt-Distanz zum Zeiger), die Liste wird live umsortiert angezeigt;
// persistiert (onDrop) wird erst beim Loslassen.
export function useDragReorder(onDrop: (orderedIds: string[]) => void, itemSelector = '[data-drag-id]', externalDrop?: ExternalDropOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [liveIds, setLiveIds] = useState<string[] | null>(null)
  const dragIdRef = useRef<string | null>(null)
  const liveIdsRef = useRef<string[] | null>(null)
  const mouseMoveRef = useRef<((e: MouseEvent) => void) | null>(null)
  const mouseUpRef = useRef<(() => void) | null>(null)
  const highlightedElRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    return () => {
      if (mouseMoveRef.current) window.removeEventListener('mousemove', mouseMoveRef.current)
      if (mouseUpRef.current) window.removeEventListener('mouseup', mouseUpRef.current)
      if (highlightedElRef.current) highlightedElRef.current.classList.remove('drop-target-active')
    }
  }, [])

  // Markiert (per DOM-Klasse statt React-State, da Sidebar/FolderTree ein anderer Komponenten-
  // Baum als PageList ist) das aktuell unter dem Zeiger liegende externe Drop-Ziel visuell.
  function updateExternalHighlight(el: HTMLElement | null) {
    if (highlightedElRef.current === el) return
    if (highlightedElRef.current) highlightedElRef.current.classList.remove('drop-target-active')
    highlightedElRef.current = el
    if (el) el.classList.add('drop-target-active')
  }

  function closestEl(clientX: number, clientY: number, excludeId: string): HTMLElement | null {
    const container = containerRef.current
    if (!container) return null
    const els = Array.from(container.querySelectorAll<HTMLElement>(itemSelector))
    let best: HTMLElement | null = null
    let bestDist = Infinity
    for (const el of els) {
      const id = el.dataset.dragId
      if (!id || id === excludeId) continue
      const rect = el.getBoundingClientRect()
      const dist = Math.hypot(clientX - (rect.left + rect.width / 2), clientY - (rect.top + rect.height / 2))
      if (dist < bestDist) {
        bestDist = dist
        best = el
      }
    }
    return best
  }

  // Ob die gezogene Kachel VOR das Ziel eingefuegt werden soll, rein anhand der aktuellen
  // Bildschirm-Geometrie (obere Haelfte der Ziel-Zeile = davor, untere Haelfte = danach; bei
  // gleicher Zeile in einem umbrechenden Grid zusaetzlich die X-Position). Bewusst NICHT anhand
  // des alten Index in der Liste, das fuehrte sonst bei jedem weiteren Move-Event zu einem
  // staendigen Hin-und-Her-Tauschen (unstabile Rueckkopplung), sobald Ziehende und Ziel einmal
  // die Plaetze getauscht hatten.
  function isBefore(clientX: number, clientY: number, rect: DOMRect): boolean {
    const midY = rect.top + rect.height / 2
    if (clientY < midY) return true
    if (clientY > midY) return false
    return clientX < rect.left + rect.width / 2
  }

  function moveTo(clientX: number, clientY: number) {
    const id = dragIdRef.current
    const cur = liveIdsRef.current
    if (!id || !cur) return

    if (externalDrop) {
      const hovered = document.elementFromPoint(clientX, clientY)
      const externalEl = hovered?.closest<HTMLElement>(externalDrop.selector) ?? null
      updateExternalHighlight(externalEl)
      if (externalEl) return
    }

    const targetEl = closestEl(clientX, clientY, id)
    if (!targetEl) return
    const targetId = targetEl.dataset.dragId
    if (!targetId) return
    const without = cur.filter((x) => x !== id)
    const targetIdx = without.indexOf(targetId)
    if (targetIdx === -1) return
    const tRect = targetEl.getBoundingClientRect()
    const before = isBefore(clientX, clientY, tRect)
    const insertAt = before ? targetIdx : targetIdx + 1
    const next = without.slice()
    next.splice(insertAt, 0, id)
    if (next.length === cur.length && next.every((x, i) => x === cur[i])) return
    liveIdsRef.current = next
    setLiveIds(next)
  }

  function finish() {
    const id = dragIdRef.current
    const result = liveIdsRef.current
    const externalEl = highlightedElRef.current
    updateExternalHighlight(null)
    dragIdRef.current = null
    liveIdsRef.current = null
    setDragId(null)
    setLiveIds(null)
    if (externalDrop && id && externalEl) {
      const targetKey = externalEl.dataset[externalDrop.attr]
      if (targetKey) {
        externalDrop.onDropOnExternal(id, targetKey)
        return
      }
    }
    if (result) onDrop(result)
  }

  function start(id: string, naturalIds: string[]) {
    dragIdRef.current = id
    liveIdsRef.current = naturalIds
    setDragId(id)
    setLiveIds(naturalIds)
  }

  function onHandleTouchStart(id: string, naturalIds: string[], e: React.TouchEvent) {
    e.stopPropagation()
    start(id, naturalIds)
  }

  function onHandleTouchMove(e: React.TouchEvent) {
    if (!dragIdRef.current) return
    const t = e.touches[0]
    if (!t) return
    e.stopPropagation()
    moveTo(t.clientX, t.clientY)
  }

  function onHandleTouchEnd() {
    if (!dragIdRef.current) return
    finish()
  }

  function onHandleMouseDown(id: string, naturalIds: string[], e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    start(id, naturalIds)
    const onMove = (ev: MouseEvent) => moveTo(ev.clientX, ev.clientY)
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      mouseMoveRef.current = null
      mouseUpRef.current = null
      finish()
    }
    mouseMoveRef.current = onMove
    mouseUpRef.current = onUp
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return {
    containerRef,
    dragId,
    liveIds,
    onHandleTouchStart,
    onHandleTouchMove,
    onHandleTouchEnd,
    onHandleMouseDown,
  }
}

export interface CanvasView {
  scale: number
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

// Begrenzt die Kamera auf das heute endliche Dokument. Die Funktion ist bewusst separat von
// DrawingCanvas testbar: Sie beschreibt den Ist-Zustand, der bei einem spaeteren Wechsel auf
// eine in alle Richtungen erweiterbare Welt ersetzt werden muss.
export function clampFiniteCanvasPan(view: CanvasView, viewport: Size, content: Size): Pick<CanvasView, 'x' | 'y'> {
  if (viewport.width <= 0 || viewport.height <= 0) return { x: view.x, y: view.y }

  const contentWidth = content.width * view.scale
  const contentHeight = content.height * view.scale
  const minX = contentWidth <= viewport.width ? 0 : viewport.width - contentWidth
  const maxX = contentWidth <= viewport.width ? viewport.width - contentWidth : 0
  const minY = contentHeight <= viewport.height ? 0 : viewport.height - contentHeight
  const maxY = contentHeight <= viewport.height ? viewport.height - contentHeight : 0

  return {
    x: Math.min(maxX, Math.max(minX, view.x)),
    y: Math.min(maxY, Math.max(minY, view.y)),
  }
}

export function visibleWorldBounds(view: CanvasView, viewport: Size) {
  return {
    left: -view.x / view.scale,
    top: -view.y / view.scale,
    right: (viewport.width - view.x) / view.scale,
    bottom: (viewport.height - view.y) / view.scale,
  }
}

// Eine freie Notizwelt hat keine Papierkante. Die Kamera darf deshalb in beiden Achsen positive
// und negative Translationen annehmen; sichtbar wird jeweils nur der passende Weltausschnitt.
export function panInfiniteCanvas(view: CanvasView): Pick<CanvasView, 'x' | 'y'> {
  return { x: view.x, y: view.y }
}

export function paperPatternViewportStyle(view: CanvasView, pattern: 'lined' | 'dotted') {
  const basePeriod = pattern === 'lined' ? 40 : 24
  const period = basePeriod * view.scale
  return {
    sizeX: pattern === 'lined' ? 0 : period,
    sizeY: period,
    positionX: pattern === 'lined' ? 0 : view.x,
    positionY: view.y,
    markSize: Math.max(0.7, (pattern === 'lined' ? 1 : 1.2) * view.scale),
  }
}

export function zoomAroundPoint(view: CanvasView, nextScale: number, point: { x: number; y: number }): CanvasView {
  const worldX = (point.x - view.x) / view.scale
  const worldY = (point.y - view.y) / view.scale
  return {
    scale: nextScale,
    x: point.x - worldX * nextScale,
    y: point.y - worldY * nextScale,
  }
}

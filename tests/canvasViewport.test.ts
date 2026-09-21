import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampFiniteCanvasPan,
  panInfiniteCanvas,
  paperPatternViewportStyle,
  visibleWorldBounds,
  zoomAroundPoint,
} from '../src/lib/canvasViewport.ts'

test('charakterisiert die musterlosen Raender beim Herauszoomen', () => {
  const viewport = { width: 1200, height: 800 }
  const content = { width: 1200, height: 1600 }
  const view = { scale: 0.5, x: 0, y: 0 }
  const pan = clampFiniteCanvasPan(view, viewport, content)

  // Das transformierte Papier ist nur 600 px breit. Der Clamp erlaubt seine Verschiebung
  // zwischen den beiden Kanten, kann die verbleibenden 600 px aber nicht mit Linien fuellen.
  assert.deepEqual(pan, { x: 0, y: 0 })
  assert.equal(content.width * view.scale, 600)
  assert.equal(viewport.width - content.width * view.scale, 600)
})

test('charakterisiert die harte obere Weltgrenze bei y = 0', () => {
  const viewport = { width: 1200, height: 800 }
  const content = { width: 1200, height: 2400 }
  const requested = { scale: 1, x: 0, y: 300 }
  const pan = clampFiniteCanvasPan(requested, viewport, content)
  const visible = visibleWorldBounds({ ...requested, ...pan }, viewport)

  assert.equal(pan.y, 0)
  assert.equal(Math.abs(visible.top), 0)
})

test('laesst bei vergroessertem endlichem Inhalt alle vorhandenen Bereiche erreichen', () => {
  const viewport = { width: 1000, height: 700 }
  const content = { width: 1000, height: 2100 }
  const pan = clampFiniteCanvasPan({ scale: 2, x: -5000, y: -9000 }, viewport, content)

  assert.deepEqual(pan, { x: -1000, y: -3500 })
})

test('Zoom um einen Zeigerpunkt haelt denselben Weltpunkt unter dem Zeiger', () => {
  const start = { scale: 1.25, x: -180, y: -320 }
  const point = { x: 420, y: 260 }
  const before = {
    x: (point.x - start.x) / start.scale,
    y: (point.y - start.y) / start.scale,
  }
  const zoomed = zoomAroundPoint(start, 2.5, point)
  const after = {
    x: (point.x - zoomed.x) / zoomed.scale,
    y: (point.y - zoomed.y) / zoomed.scale,
  }

  assert.deepEqual(after, before)
})

test('die unendliche Kamera erlaubt Weltbereiche oberhalb und links des Ursprungs', () => {
  const view = { scale: 1, x: 450, y: 300 }
  const pan = panInfiniteCanvas(view)
  const visible = visibleWorldBounds({ ...view, ...pan }, { width: 1200, height: 800 })

  assert.deepEqual(pan, { x: 450, y: 300 })
  assert.deepEqual(visible, { left: -450, top: -300, right: 750, bottom: 500 })
})

test('das Linienraster skaliert und folgt der Kamera ohne eine Papierkante', () => {
  assert.deepEqual(paperPatternViewportStyle({ scale: 0.5, x: 120, y: -35 }, 'lined'), {
    sizeX: 0,
    sizeY: 20,
    positionX: 0,
    positionY: -35,
    markSize: 0.7,
  })
  assert.deepEqual(paperPatternViewportStyle({ scale: 2, x: 17, y: 31 }, 'dotted'), {
    sizeX: 48,
    sizeY: 48,
    positionX: 17,
    positionY: 31,
    markSize: 2.4,
  })
})

import * as pdfjsLib from 'pdfjs-dist'
// ?url laesst Vite die Worker-Datei als eigenes, gehashtes Asset bauen und liefert deren
// finale URL - kein CDN-Zugriff zur Laufzeit noetig (passt zur GitHub-Pages-Bereitstellung
// und vermeidet eine zusaetzliche Netzwerkabhaengigkeit).
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export interface RenderedPdfPage {
  // Fertig gerendertes Canvas nur im Speicher (nie als Datei/DataURL gespeichert) - siehe
  // components/DrawingCanvas.tsx PdfPageHost, das dieses Canvas-Element direkt in den DOM
  // haengt statt es erneut zu kodieren.
  canvas: HTMLCanvasElement
  // Unskalierte PDF-Seitengroesse (bei scale 1) - liefert das Seitenverhaeltnis fuer die
  // responsive Darstellung (width:100%, height:auto) und die Hoehenberechnung der Notizflaeche.
  width: number
  height: number
}

// Obere Grenze fuer die Renderbreite, damit ein sehr breiter Bildschirm nicht zu einem riesigen
// (langsamen, speicherhungrigen) Canvas pro Seite fuehrt - reicht fuer scharfe Darstellung auch
// nach einem moderaten Resize (z.B. Sidebar ein-/ausklappen, Rotation).
const MAX_RENDER_WIDTH = 1600
const MIN_RENDER_WIDTH = 900

// Rendert alle Seiten eines PDFs zu Canvas-Elementen fuer die Anzeige - rein im Speicher fuer
// die aktuelle Sitzung, das Original-PDF wird an keiner Stelle dauerhaft gespeichert (siehe
// Anforderung "PDF als Dateiausdruck" v1: nur lokale Anzeige, kein Storage/Sync).
export async function renderPdfPages(file: File, noteWidthPx: number): Promise<RenderedPdfPage[]> {
  const data = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data }).promise
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const targetWidth = Math.min(Math.max(noteWidthPx, MIN_RENDER_WIDTH), MAX_RENDER_WIDTH)

  const pages: RenderedPdfPage[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const baseViewport = page.getViewport({ scale: 1 })
    const scale = (targetWidth * dpr) / baseViewport.width
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    // Darstellung ueberlaesst die tatsaechliche Breite dem umgebenden Layout (responsiv) -
    // height:auto erhaelt dabei automatisch das Seitenverhaeltnis des Canvas.
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = 'auto'

    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    await page.render({ canvasContext: ctx, canvas, viewport }).promise

    pages.push({ canvas, width: baseViewport.width, height: baseViewport.height })
  }
  return pages
}

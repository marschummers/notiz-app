import { useEffect, useRef, useState } from 'react'
import type { PageType } from '../db/types'
import { saveAsTemplate, updatePageCustomDate, updatePageType } from '../lib/actions'
import { InfoIcon } from './icons'
import './PageProperties.css'

const PAGE_TYPES: PageType[] = ['Allgemein', 'Meeting', 'Gesprächsnotiz', 'Idee', 'Konzept', 'Protokoll', 'Recherche']

// `<input type="date">` erwartet/liefert "YYYY-MM-DD" in LOKALER Zeit - ueber
// toISOString()/new Date(string) (beide UTC-basiert) wuerde das Datum je nach Zeitzone einen Tag
// verschieben. Deshalb ueber die lokalen Date-Komponenten selbst zusammensetzen/parsen.
function dateToInputValue(ms: number | undefined): string {
  if (!ms) return ''
  const d = new Date(ms)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function inputValueToDate(value: string): number | undefined {
  if (!value) return undefined
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

interface Props {
  pageId: string
  pageType: PageType | undefined
  customDate: number | undefined
}

// Kompaktes Popover statt eigenem Bereich auf der Seite - nimmt dauerhaft keinen Platz weg,
// nur der kleine Info-Button bleibt sichtbar (siehe page-editor-header in PageEditor.tsx).
export default function PageProperties({ pageId, pageType, customDate }: Props) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocPointerDown)
    return () => document.removeEventListener('mousedown', onDocPointerDown)
  }, [open])

  return (
    <div className="page-properties" ref={containerRef}>
      <button
        className={`properties-toggle${open ? ' active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="Eigenschaften"
        title="Eigenschaften"
      >
        <InfoIcon />
      </button>
      {open && (
        <div className="properties-popover">
          <label className="properties-field">
            <span className="properties-label">Typ</span>
            <select value={pageType ?? 'Allgemein'} onChange={(e) => updatePageType(pageId, e.target.value as PageType)}>
              {PAGE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="properties-field">
            <span className="properties-label">Datum</span>
            <div className="properties-date-row">
              <input
                type="date"
                value={dateToInputValue(customDate)}
                onChange={(e) => updatePageCustomDate(pageId, inputValueToDate(e.target.value))}
              />
              {!!customDate && (
                <button
                  className="properties-date-clear"
                  onClick={() => updatePageCustomDate(pageId, undefined)}
                  aria-label="Datum entfernen"
                  title="Datum entfernen"
                >
                  ✕
                </button>
              )}
            </div>
          </label>
          <div className="properties-divider" />
          <button
            className="properties-save-template"
            onClick={async () => {
              const name = window.prompt('Name der Vorlage:')
              if (!name || !name.trim()) return
              await saveAsTemplate(pageId, name.trim())
              setOpen(false)
            }}
          >
            Als Vorlage speichern
          </button>
        </div>
      )}
    </div>
  )
}

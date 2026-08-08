import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { PageType } from '../db/types'
import './AllNotesView.css'

const PAGE_TYPES: PageType[] = ['Allgemein', 'Meeting', 'Gesprächsnotiz', 'Idee', 'Konzept', 'Protokoll', 'Recherche']
const DATE_FILTERS = ['Alle', 'Heute', 'Letzte 7 Tage', 'Dieser Monat'] as const
type DateFilter = (typeof DATE_FILTERS)[number]

// Sentinel fuer "Nicht abgelegt" im Ordner-Filter - gleiches Muster wie schon fuer den Drop-
// Ziel-Sentinel in Sidebar.tsx/FolderTree.tsx (data-folder-drop-target="__root__").
const ROOT_FOLDER = '__root__'

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// Filtert rein auf dem gesetzten customDate (Properties-Panel) - eine Seite ohne Datum passt
// bei jedem Filter ausser "Alle" nicht, das entspricht der Erwartung "Datum, falls gesetzt".
function matchesDateFilter(customDate: number | undefined, filter: DateFilter): boolean {
  if (filter === 'Alle') return true
  if (!customDate) return false
  const d = new Date(customDate)
  const now = new Date()
  if (filter === 'Heute') return isSameLocalDay(d, now)
  if (filter === 'Letzte 7 Tage') {
    const start = new Date(now)
    start.setDate(now.getDate() - 6)
    start.setHours(0, 0, 0, 0)
    const end = new Date(now)
    end.setHours(23, 59, 59, 999)
    return d.getTime() >= start.getTime() && d.getTime() <= end.getTime()
  }
  // Dieser Monat
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

interface Props {
  onOpenPage: (pageId: string) => void
}

// Zeigt alle Seiten geraeteweit als kompakte, filterbare Liste - ergaenzt Ordner/Tags (dort
// sieht man je nur einen Ausschnitt), ersetzt sie nicht. Filterung rein lokal in JS ueber die
// ohnehin schon geladenen Dexie-Daten (kein Query-Sprache/Library), Filter sind kombinierbar
// (UND-Verknuepfung).
export default function AllNotesView({ onOpenPage }: Props) {
  const [typeFilter, setTypeFilter] = useState<'Alle' | PageType>('Alle')
  const [dateFilter, setDateFilter] = useState<DateFilter>('Alle')
  const [tagFilter, setTagFilter] = useState('Alle')
  const [folderFilter, setFolderFilter] = useState('Alle')
  const [afnFilter, setAfnFilter] = useState('')

  const pages = useLiveQuery(() => db.pages.filter((p) => !p.deletedAt).toArray(), [])
  const folders = useLiveQuery(() => db.folders.filter((f) => !f.deletedAt).toArray(), [])
  const tags = useLiveQuery(() => db.tags.filter((t) => !t.deletedAt).toArray(), [])
  const pageTags = useLiveQuery(() => db.pageTags.filter((pt) => !pt.deletedAt).toArray(), [])

  const folderById = new Map((folders ?? []).map((f) => [f.id, f]))
  const tagById = new Map((tags ?? []).map((t) => [t.id, t]))
  const tagIdsByPageId = new Map<string, string[]>()
  for (const link of pageTags ?? []) {
    const list = tagIdsByPageId.get(link.pageId) ?? []
    list.push(link.tagId)
    tagIdsByPageId.set(link.pageId, list)
  }

  const hasActiveFilters =
    typeFilter !== 'Alle' || dateFilter !== 'Alle' || tagFilter !== 'Alle' || folderFilter !== 'Alle' || afnFilter.trim() !== ''

  function resetFilters() {
    setTypeFilter('Alle')
    setDateFilter('Alle')
    setTagFilter('Alle')
    setFolderFilter('Alle')
    setAfnFilter('')
  }

  const filtered = (pages ?? [])
    .filter((p) => typeFilter === 'Alle' || (p.pageType ?? 'Allgemein') === typeFilter)
    .filter((p) => matchesDateFilter(p.customDate, dateFilter))
    .filter((p) => tagFilter === 'Alle' || (tagIdsByPageId.get(p.id) ?? []).includes(tagFilter))
    .filter((p) => {
      if (folderFilter === 'Alle') return true
      if (folderFilter === ROOT_FOLDER) return !p.folderId
      return p.folderId === folderFilter
    })
    // Exakter Treffer statt Teilstring - eine AFN identifiziert eindeutig, "1816" soll nicht
    // ungewollt auch "181657" mitliefern.
    .filter((p) => afnFilter.trim() === '' || (p.afns ?? []).some((afn) => String(afn) === afnFilter.trim()))
    // Zuletzt bearbeitet zuerst - am ehesten nuetzlich fuer eine geraeteweite Uebersichtsliste.
    .sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className="all-notes-view">
      <h1>Alle Notizen</h1>

      <div className="all-notes-filters">
        <div className="filter-field">
          <label>Typ</label>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as 'Alle' | PageType)}>
            <option value="Alle">Alle</option>
            {PAGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label>Datum</label>
          <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value as DateFilter)}>
            {DATE_FILTERS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label>Tag</label>
          <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
            <option value="Alle">Alle</option>
            {(tags ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                #{t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label>Ordner</label>
          <select value={folderFilter} onChange={(e) => setFolderFilter(e.target.value)}>
            <option value="Alle">Alle</option>
            <option value={ROOT_FOLDER}>Nicht abgelegt</option>
            {(folders ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label>AFN</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="z. B. 181657"
            value={afnFilter}
            onChange={(e) => setAfnFilter(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        </div>
        {hasActiveFilters && (
          <button className="all-notes-reset" onClick={resetFilters}>
            Filter zurücksetzen
          </button>
        )}
      </div>

      {filtered.length === 0 && <p className="all-notes-hint">Keine Seiten gefunden.</p>}

      <div className="all-notes-list">
        {filtered.map((p) => {
          const folder = p.folderId ? folderById.get(p.folderId) : undefined
          const pageTagNames = (tagIdsByPageId.get(p.id) ?? [])
            .map((tagId) => tagById.get(tagId)?.name)
            .filter((name): name is string => !!name)
          return (
            <div key={p.id} className="all-notes-row" onClick={() => onOpenPage(p.id)}>
              <div className="all-notes-row-main">
                <span className="all-notes-row-title">{p.title || 'Ohne Titel'}</span>
                <span className="all-notes-row-type">{p.pageType ?? 'Allgemein'}</span>
              </div>
              {(p.customDate || pageTagNames.length > 0 || folder || (p.afns && p.afns.length > 0)) && (
                <div className="all-notes-row-meta">
                  {!!p.customDate && <span className="all-notes-row-date">{formatDate(p.customDate)}</span>}
                  {(p.afns ?? []).map((afn) => (
                    <span key={afn} className="all-notes-row-afn">
                      AFN {afn}
                    </span>
                  ))}
                  {pageTagNames.map((name) => (
                    <span key={name} className="all-notes-row-tag">
                      #{name}
                    </span>
                  ))}
                  {folder && <span className="all-notes-row-folder">📁 {folder.name}</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

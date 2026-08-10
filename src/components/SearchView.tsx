import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import {
  filterPages,
  getDistinctPagePropertyValues,
  pageMatchesPropertyFilters,
  SEARCH_PROPERTY_KEYS,
  type PagePropertyFilters,
  type SearchPropertyKey,
} from '../lib/pageFilters'
import { getPageAfns, getPagePropertyValue, PAGE_PROPERTY_DEFINITIONS } from '../lib/propertyDefinitions'
import type { Folder, Page, Tag, Task } from '../db/types'
import './SearchView.css'

interface Props {
  onOpenPage: (pageId: string) => void
  onSelectFolder: (folderId: string | undefined) => void
  onSelectTag: (tagId: string) => void
}

// Relevanteste Treffer zuerst (Text beginnt mit der Suche), Rest alphabetisch - rein lokal,
// keine externe Suche/Library, arbeitet auf den ohnehin schon geladenen Dexie-Daten.
function sortByRelevance<T>(items: T[], getText: (item: T) => string, q: string): T[] {
  return [...items].sort((a, b) => {
    const at = getText(a).toLowerCase()
    const bt = getText(b).toLowerCase()
    const aStarts = at.startsWith(q) ? 0 : 1
    const bStarts = bt.startsWith(q) ? 0 : 1
    if (aStarts !== bStarts) return aStarts - bStarts
    return at.localeCompare(bt, 'de-DE')
  })
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function pageSearchMetadata(page: Page): string[] {
  const type = getPagePropertyValue(page, 'type') ?? 'Notiz'
  const customer = getPagePropertyValue(page, 'customer')
  const date = getPagePropertyValue(page, 'date')
  const status = getPagePropertyValue(page, 'status')
  const metadata = [
    typeof type === 'string' && type.trim() ? type.trim() : undefined,
    typeof customer === 'string' && customer.trim() ? customer.trim() : undefined,
    typeof date === 'number' ? formatDate(date) : undefined,
    typeof status === 'string' && status.trim() ? status.trim() : undefined,
  ].filter((value): value is string => !!value)
  return [...metadata, ...getPageAfns(page).map((afn) => `AFN ${afn}`)]
}

export default function SearchView({ onOpenPage, onSelectFolder, onSelectTag }: Props) {
  const [query, setQuery] = useState('')
  const [propertyFilters, setPropertyFilters] = useState<PagePropertyFilters>({})
  const trimmed = query.trim()
  const q = trimmed.toLowerCase()
  const textSearchActive = q.length >= 2
  const hasPropertyFilters = SEARCH_PROPERTY_KEYS.some((key) => !!propertyFilters[key])
  const active = textSearchActive || hasPropertyFilters

  const pages = useLiveQuery(() => db.pages.filter((p) => !p.deletedAt).toArray(), [])
  const tasks = useLiveQuery(() => db.tasks.filter((t) => !t.deletedAt).toArray(), [])
  const tags = useLiveQuery(() => db.tags.filter((t) => !t.deletedAt).toArray(), [])
  const folders = useLiveQuery(() => db.folders.filter((f) => !f.deletedAt).toArray(), [])

  const availablePropertyValues = useMemo(() => {
    const result = {} as Record<SearchPropertyKey, readonly string[]>
    for (const key of SEARCH_PROPERTY_KEYS) {
      const definition = PAGE_PROPERTY_DEFINITIONS[key]
      result[key] = definition.options ?? getDistinctPagePropertyValues(pages ?? [], key)
    }
    return result
  }, [pages])

  const pageTitleById = useMemo(() => new Map((pages ?? []).map((p) => [p.id, p.title || 'Ohne Titel'])), [pages])
  const propertyMatchedPageIds = useMemo(
    () => new Set((pages ?? []).filter((page) => pageMatchesPropertyFilters(page, propertyFilters)).map((page) => page.id)),
    [pages, propertyFilters],
  )

  const matchedPages = useMemo(
    () => active
      ? sortByRelevance(filterPages(pages ?? [], textSearchActive ? trimmed : '', propertyFilters), (page: Page) => page.title || '', textSearchActive ? q : '')
      : [],
    [active, pages, textSearchActive, trimmed, propertyFilters, q],
  )
  const matchedTasks = useMemo(
    () => textSearchActive
      ? sortByRelevance(
          (tasks ?? []).filter((task) => (task.text || '').toLowerCase().includes(q) && (!hasPropertyFilters || propertyMatchedPageIds.has(task.pageId))),
          (task: Task) => task.text || '',
          q,
        )
      : [],
    [tasks, textSearchActive, q, hasPropertyFilters, propertyMatchedPageIds],
  )
  // Tags und Ordner besitzen keine Seiten-Properties. Sobald ein Property-Filter aktiv ist,
  // bleiben die Treffer deshalb bewusst auf Seiten und deren Aufgaben beschraenkt.
  const matchedTags = useMemo(
    () => textSearchActive && !hasPropertyFilters
      ? sortByRelevance((tags ?? []).filter((tag) => tag.name.toLowerCase().includes(q)), (tag: Tag) => tag.name, q)
      : [],
    [tags, textSearchActive, hasPropertyFilters, q],
  )
  const matchedFolders = useMemo(
    () => textSearchActive && !hasPropertyFilters
      ? sortByRelevance((folders ?? []).filter((folder) => folder.name.toLowerCase().includes(q)), (folder: Folder) => folder.name, q)
      : [],
    [folders, textSearchActive, hasPropertyFilters, q],
  )

  const hasResults = matchedPages.length > 0 || matchedTasks.length > 0 || matchedTags.length > 0 || matchedFolders.length > 0

  function updatePropertyFilter(key: SearchPropertyKey, value: string) {
    setPropertyFilters((current) => {
      const next = { ...current }
      if (value) next[key] = value
      else delete next[key]
      return next
    })
  }

  return (
    <div className="search-view">
      <input
        autoFocus
        type="text"
        className="search-input"
        placeholder="Seiten, Aufgaben, Tags, Ordner durchsuchen …"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="search-property-filters" aria-label="Seiten nach Properties filtern">
        {SEARCH_PROPERTY_KEYS.map((key) => {
          const definition = PAGE_PROPERTY_DEFINITIONS[key]
          const selectedValue = propertyFilters[key] ?? ''
          const definedValues = availablePropertyValues[key]
          const values = selectedValue && !definedValues.includes(selectedValue) ? [selectedValue, ...definedValues] : definedValues
          return (
            <select
              key={key}
              className={selectedValue ? 'search-property-filter active' : 'search-property-filter'}
              aria-label={`${definition.label} filtern`}
              value={selectedValue}
              onChange={(e) => updatePropertyFilter(key, e.target.value)}
            >
              <option value="">{definition.label}</option>
              {values.map((value) => <option key={value} value={value}>{definition.label}: {value}</option>)}
            </select>
          )
        })}
        {hasPropertyFilters && (
          <button type="button" className="search-filters-reset" onClick={() => setPropertyFilters({})}>
            Alle zurücksetzen
          </button>
        )}
      </div>

      {!textSearchActive && trimmed.length > 0 && <p className="search-hint">Mindestens 2 Zeichen eingeben.</p>}

      {active && !hasResults && (
        <p className="search-hint">
          {textSearchActive ? `Keine Ergebnisse für „${trimmed}“.` : 'Keine Seiten für die ausgewählten Filter.'}
        </p>
      )}

      {matchedPages.length > 0 && (
        <div className="search-group">
          <h2>Seiten</h2>
          {matchedPages.map((p) => {
            const metadata = pageSearchMetadata(p)
            return (
              <div key={p.id} className="search-row" onClick={() => onOpenPage(p.id)}>
                <span className="search-row-icon">📄</span>
                <div className="search-row-text">
                  <div className="search-row-title">{p.title || 'Ohne Titel'}</div>
                  {metadata.length > 0 && <div className="search-row-sub">{metadata.join(' · ')}</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {matchedTasks.length > 0 && (
        <div className="search-group">
          <h2>Aufgaben</h2>
          {matchedTasks.map((t) => (
            <div key={t.id} className="search-row" onClick={() => onOpenPage(t.pageId)}>
              <span className="search-row-icon">☑</span>
              <div className="search-row-text">
                <div className={t.completed ? 'search-row-title completed' : 'search-row-title'}>{t.text || 'Ohne Text'}</div>
                <div className="search-row-sub">{pageTitleById.get(t.pageId) ?? '…'}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {matchedTags.length > 0 && (
        <div className="search-group">
          <h2>Tags</h2>
          {matchedTags.map((t) => (
            <div key={t.id} className="search-row" onClick={() => onSelectTag(t.id)}>
              <span className="search-row-icon">#</span>
              <span className="search-row-title">{t.name}</span>
            </div>
          ))}
        </div>
      )}

      {matchedFolders.length > 0 && (
        <div className="search-group">
          <h2>Ordner</h2>
          {matchedFolders.map((f) => (
            <div key={f.id} className="search-row" onClick={() => onSelectFolder(f.id)}>
              <span className="search-row-icon">📁</span>
              <span className="search-row-title">{f.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

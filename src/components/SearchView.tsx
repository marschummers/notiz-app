import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { getPageAfns } from '../lib/propertyDefinitions'
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
    return at.localeCompare(bt)
  })
}

export default function SearchView({ onOpenPage, onSelectFolder, onSelectTag }: Props) {
  const [query, setQuery] = useState('')
  const trimmed = query.trim()
  const q = trimmed.toLowerCase()
  const active = q.length >= 2

  const pages = useLiveQuery(() => db.pages.filter((p) => !p.deletedAt).toArray(), [])
  const tasks = useLiveQuery(() => db.tasks.filter((t) => !t.deletedAt).toArray(), [])
  const tags = useLiveQuery(() => db.tags.filter((t) => !t.deletedAt).toArray(), [])
  const folders = useLiveQuery(() => db.folders.filter((f) => !f.deletedAt).toArray(), [])

  const pageTitleById = new Map((pages ?? []).map((p) => [p.id, p.title || 'Ohne Titel']))

  const matchedPages = active
    ? sortByRelevance(
        (pages ?? []).filter((p) => (p.title || '').toLowerCase().includes(q) || getPageAfns(p).some((afn) => String(afn).includes(q))),
        (p: Page) => p.title || '',
        q,
      )
    : []
  const matchedTasks = active ? sortByRelevance((tasks ?? []).filter((t) => (t.text || '').toLowerCase().includes(q)), (t: Task) => t.text || '', q) : []
  const matchedTags = active ? sortByRelevance((tags ?? []).filter((t) => t.name.toLowerCase().includes(q)), (t: Tag) => t.name, q) : []
  const matchedFolders = active ? sortByRelevance((folders ?? []).filter((f) => f.name.toLowerCase().includes(q)), (f: Folder) => f.name, q) : []

  const hasResults = matchedPages.length > 0 || matchedTasks.length > 0 || matchedTags.length > 0 || matchedFolders.length > 0

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

      {!active && trimmed.length > 0 && <p className="search-hint">Mindestens 2 Zeichen eingeben.</p>}

      {active && !hasResults && <p className="search-hint">Keine Ergebnisse für „{trimmed}“.</p>}

      {matchedPages.length > 0 && (
        <div className="search-group">
          <h2>Seiten</h2>
          {matchedPages.map((p) => (
            <div key={p.id} className="search-row" onClick={() => onOpenPage(p.id)}>
              <span className="search-row-icon">📄</span>
              <div className="search-row-text">
                <div className="search-row-title">{p.title || 'Ohne Titel'}</div>
                {getPageAfns(p).length > 0 && (
                  <div className="search-row-sub">{getPageAfns(p).map((afn) => `AFN ${afn}`).join(', ')}</div>
                )}
              </div>
            </div>
          ))}
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


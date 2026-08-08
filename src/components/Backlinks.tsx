import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { extractLinkedPageIds } from '../lib/pageLinks'
import './Backlinks.css'

interface Props {
  pageId: string
  onOpenPage: (pageId: string) => void
}

// Zeigt an, welche anderen Seiten per [[-Link (siehe lib/pageLinks.ts) auf die aktuell offene
// Seite verweisen - durchsucht dafuer alle Textfelder ueber ALLE Seiten hinweg (keine eigene
// Link-Tabelle, die Verlinkung steckt ja schon strukturiert im Textfeld-Text). Blendet sich
// komplett aus, wenn es keine Backlinks gibt; aktualisiert sich automatisch ueber useLiveQuery,
// sobald irgendwo ein Link hinzugefuegt/entfernt wird.
export default function Backlinks({ pageId, onOpenPage }: Props) {
  const textBlocks = useLiveQuery(() => db.textBlocks.filter((t) => !t.deletedAt).toArray(), [])
  const pages = useLiveQuery(() => db.pages.filter((p) => !p.deletedAt).toArray(), [])

  if (!textBlocks || !pages) return null

  const pageById = new Map(pages.map((p) => [p.id, p]))

  // Quellseiten sammeln, die (mindestens) einen Link auf pageId enthalten - dedupliziert per
  // Set, damit mehrere Links derselben Quellseite (auch aus mehreren Textfeldern) nur einmal
  // erscheinen. Die Seite selbst zaehlt nicht als eigener Backlink.
  const sourcePageIds = new Set<string>()
  for (const block of textBlocks) {
    if (block.pageId === pageId) continue
    if (extractLinkedPageIds(block.text).has(pageId)) sourcePageIds.add(block.pageId)
  }

  const sources = Array.from(sourcePageIds)
    .map((id) => pageById.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .sort((a, b) => (a.title || 'Ohne Titel').localeCompare(b.title || 'Ohne Titel'))

  if (sources.length === 0) return null

  return (
    <div className="backlinks-bar">
      <span className="backlinks-label">Verlinkt von</span>
      <div className="backlinks-list">
        {sources.map((p) => (
          <button key={p.id} className="backlink-chip" onClick={() => onOpenPage(p.id)}>
            📄 {p.title || 'Ohne Titel'}
          </button>
        ))}
      </div>
    </div>
  )
}

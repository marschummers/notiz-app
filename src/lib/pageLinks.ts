// Seitenlinks im Text eines Textfelds werden als "[[pageId:Titel]]" im Plaintext codiert (siehe
// db/types.ts TextBlock) - kein eigenes Feld/Schema noetig, Sync bewegt einfach den String wie
// bisher. Der Titel wird mitgespeichert (nicht live nachgeschlagen), damit ein Link auch dann
// noch lesbar bleibt, wenn die Zielseite geloescht wurde; beim Anlegen ist er aber immer aktuell,
// und ein Umbenennen der Zielseite bricht den Link nicht (navigiert wird ueber die pageId).
//
// Zentral in lib/ statt in DrawingCanvas.tsx, damit sowohl das Rendern/Bearbeiten von Textfeldern
// (DrawingCanvas.tsx) als auch die Backlinks-Ermittlung (Backlinks.tsx) dieselbe Parsing-Logik
// nutzen, statt sie zweimal (potenziell abweichend) zu implementieren.
const LINK_PATTERN = /\[\[([^\]:]+):([^\]]+)\]\]/g

export type TextSegment = { type: 'text'; value: string } | { type: 'link'; pageId: string; title: string }

export function parseLinkedText(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  let lastIndex = 0
  LINK_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = LINK_PATTERN.exec(text))) {
    if (match.index > lastIndex) segments.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    segments.push({ type: 'link', pageId: match[1], title: match[2] })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) segments.push({ type: 'text', value: text.slice(lastIndex) })
  return segments
}

// Liefert die Menge aller Seiten-IDs, auf die ein Text verlinkt (dedupliziert) - genuegt fuer die
// Backlinks-Ermittlung, ohne den vollen Segment-Baum aufbauen zu muessen.
export function extractLinkedPageIds(text: string): Set<string> {
  const ids = new Set<string>()
  LINK_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = LINK_PATTERN.exec(text))) {
    ids.add(match[1])
  }
  return ids
}

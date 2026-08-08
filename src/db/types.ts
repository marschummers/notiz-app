// Ein Strich in einer Seite - identisch zur Struktur im Zeichen-Prototyp (siehe src/App.tsx).
export interface Point {
  x: number
  y: number
  pressure: number
}

export interface Stroke {
  points: Point[]
  color: string
  width: number
  eraser: boolean
}

// Ein Ordner ("Abschnitt" im OneNote-Sinn), beliebig tief verschachtelbar ueber parentId.
// parentId === undefined bedeutet: liegt auf der obersten Ebene.
// `deletedAt` markiert weiches Loeschen (siehe lib/sync.ts) statt die Zeile zu entfernen, damit
// eine Loeschung beim Sync wie jede andere Aenderung per Last-Write-Wins verteilt werden kann -
// beim Loeschen eines Ordners werden Unterordner/Seiten im UI mit weich geloescht.
export interface Folder {
  id: string
  parentId?: string
  name: string
  order: number
  updatedAt: number
  deletedAt?: number
}

// Papiermuster fuer den Seitenhintergrund. 'lined' ist der Standard (liniert mit
// grosszuegigem Zeilenabstand fuers Handschreiben), 'cornell' kombiniert das mit einer
// schmalen Stichwort-Spalte links und einer Zusammenfassungs-Zeile unten.
export type PageBackground = 'lined' | 'dotted' | 'cornell' | 'blank'

// Einfache, feste Property-Typen fuer den ersten Schritt (bewusst kein frei definierbares
// Property-System) - undefined/fehlend bedeutet "Allgemein", bestehende Seiten ohne das Feld
// brauchen dadurch keine Migration.
export type PageType = 'Allgemein' | 'Meeting' | 'Gesprächsnotiz' | 'Idee' | 'Konzept' | 'Protokoll' | 'Recherche'

// Eine Notizseite. `folderId` optional (undefined = unabgelegt, direkt in der Wurzel sichtbar).
// Die Striche liegen direkt auf der Seite (nicht in einer eigenen Tabelle) - fuer eine
// Handschrift-App mit Last-Write-Wins-Sync ist eine Seite als Ganzes die sinnvolle Einheit.
// `favoritedAt` folgt demselben Muster wie `deletedAt`: undefined = kein Favorit, Zeitstempel =
// wann favorisiert wurde. Liefert Status UND Sortierung ("zuletzt favorisiert zuerst") in einem
// Feld, ohne separates Boolean-Feld - kein Dexie-Schema-Update noetig, da kein Index darauf liegt.
// `customDate` ist ein frei waehlbares Datum (Properties-Panel), unabhaengig von `updatedAt` -
// undefined = nicht gesetzt.
// `afns` sind echte Seiten-Properties (keine Tags): rein numerische Referenznummern (1-999999),
// eine Seite kann mehrere haben, deshalb ein Array statt Einzelwert. undefined/fehlend bedeutet
// "keine AFN", bestehende Seiten ohne das Feld brauchen dadurch keine Migration.
export interface Page {
  id: string
  folderId?: string
  title: string
  strokes: Stroke[]
  background?: PageBackground
  order: number
  updatedAt: number
  deletedAt?: number
  favoritedAt?: number
  pageType?: PageType
  customDate?: number
  afns?: number[]
}

export interface Tag {
  id: string
  name: string
  updatedAt: number
  deletedAt?: number
}

// Verknuepfung Seite <-> Tag (m:n). Eigene id statt zusammengesetztem Schluessel, damit sich
// eine einzelne Verknuepfung wie jede andere Zeile per Last-Write-Wins synchronisieren laesst.
export interface PageTag {
  id: string
  pageId: string
  tagId: string
  updatedAt: number
  deletedAt?: number
}

// Ein To-do, eindeutig einer Seite zugeordnet (pageId) und dort an einer frei gewaehlten
// Position (x/y, unskalierter Canvas-Koordinatenraum wie bei Stroke-Punkten) platziert.
// Bewusst ein eigener strukturierter Datensatz statt aus dem Zeichentext geparst - siehe
// lib/actions.ts createTask/toggleTask/updateTaskText/deleteTask.
export interface Task {
  id: string
  pageId: string
  text: string
  completed: boolean
  x: number
  y: number
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

// Ein frei platziertes Textfeld auf einer Seite (per Tastatur beschrieben, kein Handschrift-
// Strich) - gleiche Platzierungs-/Koordinatenlogik wie Task (x/y, siehe lib/actions.ts), aber
// ohne Checkbox-Semantik. `text` kann Seitenverlinkungen im Format "[[pageId:Titel]]" enthalten
// (siehe components/DrawingCanvas.tsx parseLinkedText) - bewusst als Teil des Plaintexts codiert
// statt als eigenes Feld, damit Sync/Speicherung unveraendert bleiben (einfacher String).
export interface TextBlock {
  id: string
  pageId: string
  text: string
  x: number
  y: number
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

// Schnappschuss eines Textfelds/Tasks innerhalb einer Vorlage - bewusst nur Inhalt + Position,
// keine id/pageId/Zeitstempel: die werden beim Instanziieren (createPageFromTemplate) frisch
// vergeben, damit eine neu erstellte Seite nie mit der Vorlage verknuepft bleibt. x ist bereits
// im gespeicherten (relativen) Format, siehe DrawingCanvas.tsx toAbsoluteX/toStoredX - beim
// Kopieren unveraendert uebernommen, das nutzt automatisch die bestehende responsive
// Koordinatenlogik weiter, ohne eigene Umrechnung.
export interface TemplateTextBlock {
  text: string
  x: number
  y: number
}

export interface TemplateTask {
  text: string
  completed: boolean
  x: number
  y: number
}

// Vorlage fuer neue Seiten - Schnappschuss zum Speicherzeitpunkt, komplett unabhaengig von der
// Quellseite (kein pageId-Bezug). Tags werden als Namen statt IDs gespeichert, damit eine spaeter
// geloeschte Tag-Zeile eine Vorlage nicht kaputt macht - beim Instanziieren laeuft das ueber
// findOrCreateTag, genau wie beim manuellen Eintippen eines Tags.
export interface Template {
  id: string
  name: string
  background: PageBackground
  pageType?: PageType
  tagNames: string[]
  textBlocks: TemplateTextBlock[]
  tasks: TemplateTask[]
  updatedAt: number
  deletedAt?: number
}

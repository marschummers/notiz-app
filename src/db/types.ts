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

// Eine Notizseite. `folderId` optional (undefined = unabgelegt, direkt in der Wurzel sichtbar).
// Die Striche liegen direkt auf der Seite (nicht in einer eigenen Tabelle) - fuer eine
// Handschrift-App mit Last-Write-Wins-Sync ist eine Seite als Ganzes die sinnvolle Einheit.
export interface Page {
  id: string
  folderId?: string
  title: string
  strokes: Stroke[]
  background?: PageBackground
  order: number
  updatedAt: number
  deletedAt?: number
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

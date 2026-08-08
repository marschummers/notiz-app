import Dexie, { type EntityTable } from 'dexie'
import type { Folder, Page, Tag, PageTag, Task, TextBlock, Template } from './types'

export const db = new Dexie('notiz-app') as Dexie & {
  folders: EntityTable<Folder, 'id'>
  pages: EntityTable<Page, 'id'>
  tags: EntityTable<Tag, 'id'>
  pageTags: EntityTable<PageTag, 'id'>
  tasks: EntityTable<Task, 'id'>
  textBlocks: EntityTable<TextBlock, 'id'>
  templates: EntityTable<Template, 'id'>
}

db.version(1).stores({
  folders: 'id, parentId, order',
  pages: 'id, folderId, order',
  tags: 'id, name',
  pageTags: 'id, pageId, tagId',
})

// Neue Tabelle fuer die To-do-Funktion - eigener Versionsschritt statt version(1) nachtraeglich
// zu aendern, da Dexie ein einmal erreichtes Versions-Upgrade nie erneut ausfuehrt (siehe
// gleiches Muster in der Pferdeapp/db.ts).
db.version(2).stores({
  tasks: 'id, pageId, completed',
})

// Neue Tabelle fuer frei platzierte, per Tastatur beschriebene Textfelder (siehe TextBlock).
db.version(3).stores({
  textBlocks: 'id, pageId',
})

// Neue Tabelle fuer Seiten-Vorlagen (siehe Template) - keine Fremdschluessel-Indizes noetig,
// Vorlagen referenzieren keine Seite mehr, sobald sie gespeichert sind.
db.version(4).stores({
  templates: 'id',
})

export function newId(): string {
  return crypto.randomUUID()
}

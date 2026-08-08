import Dexie, { type EntityTable } from 'dexie'
import type { Folder, Page, Tag, PageTag, Task } from './types'

export const db = new Dexie('notiz-app') as Dexie & {
  folders: EntityTable<Folder, 'id'>
  pages: EntityTable<Page, 'id'>
  tags: EntityTable<Tag, 'id'>
  pageTags: EntityTable<PageTag, 'id'>
  tasks: EntityTable<Task, 'id'>
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

export function newId(): string {
  return crypto.randomUUID()
}

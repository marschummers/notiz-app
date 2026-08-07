import Dexie, { type EntityTable } from 'dexie'
import type { Folder, Page, Tag, PageTag } from './types'

export const db = new Dexie('notiz-app') as Dexie & {
  folders: EntityTable<Folder, 'id'>
  pages: EntityTable<Page, 'id'>
  tags: EntityTable<Tag, 'id'>
  pageTags: EntityTable<PageTag, 'id'>
}

db.version(1).stores({
  folders: 'id, parentId, order',
  pages: 'id, folderId, order',
  tags: 'id, name',
  pageTags: 'id, pageId, tagId',
})

export function newId(): string {
  return crypto.randomUUID()
}

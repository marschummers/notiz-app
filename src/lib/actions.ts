import { db, newId } from '../db/db'
import type { PageBackground, Stroke } from '../db/types'

export async function createFolder(parentId: string | undefined, name = 'Neuer Ordner'): Promise<string> {
  const id = newId()
  await db.folders.add({ id, parentId, name, order: Date.now(), updatedAt: Date.now() })
  return id
}

export async function renameFolder(id: string, name: string): Promise<void> {
  await db.folders.update(id, { name, updatedAt: Date.now() })
}

// Loescht einen Ordner weich und rekursiv alle Unterordner + darin liegenden Seiten (samt
// deren Tag-Verknuepfungen) - Dexie kennt keine Kaskaden, das muss hier manuell durchlaufen
// werden. Weiches Loeschen statt Entfernen, damit sich das per Sync wie jede andere Aenderung
// verteilt (siehe lib/sync.ts).
export async function deleteFolder(id: string): Promise<void> {
  const now = Date.now()
  const childFolders = await db.folders.where('parentId').equals(id).toArray()
  for (const child of childFolders) {
    await deleteFolder(child.id)
  }
  const pages = await db.pages.where('folderId').equals(id).toArray()
  for (const page of pages) {
    await deletePage(page.id)
  }
  await db.folders.update(id, { deletedAt: now, updatedAt: now })
}

export async function createPage(folderId: string | undefined, title = 'Neue Seite'): Promise<string> {
  const id = newId()
  const now = Date.now()
  await db.pages.add({ id, folderId, title, strokes: [], background: 'lined', order: now, updatedAt: now })
  return id
}

export async function renamePage(id: string, title: string): Promise<void> {
  await db.pages.update(id, { title, updatedAt: Date.now() })
}

export async function updatePageStrokes(id: string, strokes: Stroke[]): Promise<void> {
  await db.pages.update(id, { strokes, updatedAt: Date.now() })
}

export async function updatePageBackground(id: string, background: PageBackground): Promise<void> {
  await db.pages.update(id, { background, updatedAt: Date.now() })
}

export async function movePage(id: string, folderId: string | undefined): Promise<void> {
  await db.pages.update(id, { folderId, updatedAt: Date.now() })
}

export async function deletePage(id: string): Promise<void> {
  const now = Date.now()
  const links = await db.pageTags.where('pageId').equals(id).toArray()
  for (const link of links) {
    await db.pageTags.update(link.id, { deletedAt: now, updatedAt: now })
  }
  await db.pages.update(id, { deletedAt: now, updatedAt: now })
}

// Findet einen bestehenden Tag mit diesem Namen (case-insensitiv) oder legt einen neuen an -
// verhindert doppelte Tags wie "Arbeit"/"arbeit" beim freien Eintippen.
export async function findOrCreateTag(name: string): Promise<string> {
  const trimmed = name.trim()
  const existing = await db.tags
    .filter((t) => !t.deletedAt && t.name.toLowerCase() === trimmed.toLowerCase())
    .first()
  if (existing) return existing.id
  const id = newId()
  await db.tags.add({ id, name: trimmed, updatedAt: Date.now() })
  return id
}

export async function deleteTag(id: string): Promise<void> {
  const now = Date.now()
  const links = await db.pageTags.where('tagId').equals(id).toArray()
  for (const link of links) {
    await db.pageTags.update(link.id, { deletedAt: now, updatedAt: now })
  }
  await db.tags.update(id, { deletedAt: now, updatedAt: now })
}

export async function addTagToPage(pageId: string, tagId: string): Promise<void> {
  const now = Date.now()
  const existing = await db.pageTags
    .filter((pt) => pt.pageId === pageId && pt.tagId === tagId && !pt.deletedAt)
    .first()
  if (existing) return
  await db.pageTags.add({ id: newId(), pageId, tagId, updatedAt: now })
}

export async function removeTagFromPage(pageId: string, tagId: string): Promise<void> {
  const now = Date.now()
  const links = await db.pageTags.filter((pt) => pt.pageId === pageId && pt.tagId === tagId && !pt.deletedAt).toArray()
  for (const link of links) {
    await db.pageTags.update(link.id, { deletedAt: now, updatedAt: now })
  }
}

import { db, newId } from '../db/db'
import type { PageBackground, Stroke } from '../db/types'

export async function createFolder(parentId: string | undefined, name = 'Neuer Ordner'): Promise<string> {
  const id = newId()
  await db.folders.add({ id, parentId, name, order: Date.now(), updatedAt: Date.now() })
  return id
}

// Setzt `order` fuer eine Geschwister-Gruppe (gleicher parentId) neu anhand der uebergebenen
// Reihenfolge - kleine fortlaufende Zahlen, immer kleiner als ein per Date.now() vergebenes
// `order` eines neu angelegten Ordners, der dadurch automatisch ans Ende der Liste faellt statt
// die manuell sortierte Reihenfolge zu durcheinanderzubringen.
export async function reorderFolders(orderedIds: string[]): Promise<void> {
  const now = Date.now()
  for (let i = 0; i < orderedIds.length; i++) {
    await db.folders.update(orderedIds[i], { order: i, updatedAt: now })
  }
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

// Siehe reorderFolders - gleiches Prinzip fuer Seiten innerhalb eines Ordners.
export async function reorderPages(orderedIds: string[]): Promise<void> {
  const now = Date.now()
  for (let i = 0; i < orderedIds.length; i++) {
    await db.pages.update(orderedIds[i], { order: i, updatedAt: now })
  }
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

export async function toggleFavorite(id: string, favorite: boolean): Promise<void> {
  const now = Date.now()
  await db.pages.update(id, { favoritedAt: favorite ? now : undefined, updatedAt: now })
}

export async function deletePage(id: string): Promise<void> {
  const now = Date.now()
  const links = await db.pageTags.where('pageId').equals(id).toArray()
  for (const link of links) {
    await db.pageTags.update(link.id, { deletedAt: now, updatedAt: now })
  }
  const pageTasks = await db.tasks.where('pageId').equals(id).toArray()
  for (const task of pageTasks) {
    await db.tasks.update(task.id, { deletedAt: now, updatedAt: now })
  }
  const pageTextBlocks = await db.textBlocks.where('pageId').equals(id).toArray()
  for (const block of pageTextBlocks) {
    await db.textBlocks.update(block.id, { deletedAt: now, updatedAt: now })
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

// Legt ein To-do an gewaehlter Position auf einer Seite an (x/y im selben unskalierten
// Koordinatenraum wie Stroke-Punkte, siehe components/DrawingCanvas.tsx) und liefert die neue
// id zurueck, damit der Aufrufer direkt in den Bearbeitungsmodus fuer den Text wechseln kann.
export async function createTask(pageId: string, x: number, y: number, text = ''): Promise<string> {
  const id = newId()
  const now = Date.now()
  await db.tasks.add({ id, pageId, text, completed: false, x, y, createdAt: now, updatedAt: now })
  return id
}

export async function updateTaskText(id: string, text: string): Promise<void> {
  await db.tasks.update(id, { text, updatedAt: Date.now() })
}

export async function toggleTask(id: string, completed: boolean): Promise<void> {
  await db.tasks.update(id, { completed, updatedAt: Date.now() })
}

export async function moveTask(id: string, x: number, y: number): Promise<void> {
  await db.tasks.update(id, { x, y, updatedAt: Date.now() })
}

export async function deleteTask(id: string): Promise<void> {
  const now = Date.now()
  await db.tasks.update(id, { deletedAt: now, updatedAt: now })
}

// Legt ein frei platziertes Textfeld an - gleiche Koordinatenlogik wie createTask (x/y im
// unskalierten Content-Koordinatenraum, siehe components/DrawingCanvas.tsx).
export async function createTextBlock(pageId: string, x: number, y: number, text = ''): Promise<string> {
  const id = newId()
  const now = Date.now()
  await db.textBlocks.add({ id, pageId, text, x, y, createdAt: now, updatedAt: now })
  return id
}

export async function updateTextBlockText(id: string, text: string): Promise<void> {
  await db.textBlocks.update(id, { text, updatedAt: Date.now() })
}

export async function moveTextBlock(id: string, x: number, y: number): Promise<void> {
  await db.textBlocks.update(id, { x, y, updatedAt: Date.now() })
}

export async function deleteTextBlock(id: string): Promise<void> {
  const now = Date.now()
  await db.textBlocks.update(id, { deletedAt: now, updatedAt: now })
}

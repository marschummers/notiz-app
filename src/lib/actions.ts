import { db, newId } from '../db/db'
import type { PageBackground, PageProperties, PagePropertyKey, PagePropertyValue, PageType, PdfPrintout, Stroke } from '../db/types'
import { uploadPdf } from './pdfStorage'
import { PAGE_PROPERTY_DEFINITIONS } from './propertyDefinitions'
import { supabase } from './supabaseClient'

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
  await db.pages.add({
    id,
    folderId,
    title,
    strokes: [],
    background: 'lined',
    order: now,
    createdAt: now,
    updatedAt: now,
    pageType: 'Notiz',
    properties: { type: 'Notiz' },
  })
  return id
}

async function touchPage(pageId: string, now = Date.now()): Promise<void> {
  await db.pages.update(pageId, { updatedAt: now })
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

export async function updatePageType(id: string, pageType: PageType): Promise<void> {
  await updatePageProperty(id, 'type', pageType)
}

export async function updatePageCustomDate(id: string, customDate: number | undefined): Promise<void> {
  await updatePageProperty(id, 'date', customDate)
}

export async function updatePageProperty(
  id: string,
  key: PagePropertyKey,
  value: PagePropertyValue | undefined,
): Promise<void> {
  if (key === 'createdAt' || key === 'updatedAt') return
  const allowedOptions = PAGE_PROPERTY_DEFINITIONS[key].options
  if (allowedOptions && value !== '' && (typeof value !== 'string' || !allowedOptions.includes(value))) return
  const page = await db.pages.get(id)
  if (!page) return
  const properties: PageProperties = { ...(page.properties ?? {}) }
  if (value === undefined) delete properties[key]
  else properties[key] = value

  const changes: Partial<typeof page> = { properties, updatedAt: Date.now() }
  if (key === 'type') changes.pageType = value as PageType | undefined
  if (key === 'date') changes.customDate = typeof value === 'number' ? value : undefined
  if (key === 'afn') changes.afns = Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number') : undefined
  await db.pages.update(id, changes)
}

// Fuegt eine AFN (numerische Referenznummer) hinzu bzw. entfernt sie wieder - echtes Array-Feld
// auf der Seite selbst (kein Tag, keine eigene Tabelle), Duplikate werden stillschweigend
// ignoriert statt einen Fehler zu werfen.
export async function addAfnToPage(id: string, afn: number): Promise<void> {
  const page = await db.pages.get(id)
  if (!page) return
  const current = page.afns ?? []
  if (current.includes(afn)) return
  await updatePageProperty(id, 'afn', [...current, afn])
}

export async function removeAfnFromPage(id: string, afn: number): Promise<void> {
  const page = await db.pages.get(id)
  if (!page) return
  const current = page.afns ?? []
  const next = current.filter((a) => a !== afn)
  await updatePageProperty(id, 'afn', next.length > 0 ? next : undefined)
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
  const pdfPrintouts = await db.pdfPrintouts.where('pageId').equals(id).toArray()
  for (const printout of pdfPrintouts) {
    await db.pdfPrintouts.update(printout.id, { deletedAt: now, updatedAt: now })
    await db.pdfBlobs.delete(printout.id)
  }
  await db.pages.update(id, { deletedAt: now, updatedAt: now })
}

// Heftet ein PDF an eine Seite: laedt das Original zuerst in Supabase Storage hoch (siehe
// lib/pdfStorage.ts) und legt danach die synchronisierte Metadaten-Zeile an - in dieser
// Reihenfolge, damit nie eine Zeile existiert, deren storagePath noch gar nicht hochgeladen ist.
// Ein evtl. vorhandener aktiver PDF-Ausdruck derselben Seite wird weich geloescht (eine Seite
// traegt fuer diese erste Version genau einen aktiven Ausdruck) - die dazugehoerige Datei bleibt
// unangetastet in Storage liegen (gleiche "nie hart loeschen"-Haltung wie ueberall sonst).
export async function attachPdfToPage(pageId: string, file: File): Promise<PdfPrintout> {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert.')
  const { data: userData, error } = await supabase.auth.getUser()
  if (error || !userData.user) throw new Error('Nicht eingeloggt.')

  const now = Date.now()
  const id = newId()
  const storagePath = await uploadPdf(userData.user.id, id, file)

  const existing = await db.pdfPrintouts.filter((p) => p.pageId === pageId && !p.deletedAt).toArray()
  for (const p of existing) {
    await db.pdfPrintouts.update(p.id, { deletedAt: now, updatedAt: now })
  }

  const printout: PdfPrintout = { id, pageId, fileName: file.name, storagePath, createdAt: now, updatedAt: now }
  await db.pdfPrintouts.add(printout)
  await touchPage(pageId, now)
  return printout
}

// Entfernt einen PDF-Ausdruck weich (siehe lib/sync.ts) - die Datei bleibt in Storage liegen,
// nur der lokale Blob-Cache (siehe db/types.ts PdfBlobCache) wird sofort geleert, da der nie
// synchronisiert wird und ohne aktive Metadaten-Zeile ohnehin nicht mehr erreichbar waere.
export async function removePdfFromPage(id: string): Promise<void> {
  const now = Date.now()
  const printout = await db.pdfPrintouts.get(id)
  await db.pdfPrintouts.update(id, { deletedAt: now, updatedAt: now })
  await db.pdfBlobs.delete(id)
  if (printout) await touchPage(printout.pageId, now)
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
  for (const pageId of new Set(links.map((link) => link.pageId))) await touchPage(pageId, now)
}

export async function addTagToPage(pageId: string, tagId: string): Promise<void> {
  const now = Date.now()
  const existing = await db.pageTags
    .filter((pt) => pt.pageId === pageId && pt.tagId === tagId && !pt.deletedAt)
    .first()
  if (existing) return
  await db.pageTags.add({ id: newId(), pageId, tagId, updatedAt: now })
  await touchPage(pageId, now)
}

export async function removeTagFromPage(pageId: string, tagId: string): Promise<void> {
  const now = Date.now()
  const links = await db.pageTags.filter((pt) => pt.pageId === pageId && pt.tagId === tagId && !pt.deletedAt).toArray()
  for (const link of links) {
    await db.pageTags.update(link.id, { deletedAt: now, updatedAt: now })
  }
  if (links.length > 0) await touchPage(pageId, now)
}

// Legt ein To-do an gewaehlter Position auf einer Seite an (x/y im selben unskalierten
// Koordinatenraum wie Stroke-Punkte, siehe components/DrawingCanvas.tsx) und liefert die neue
// id zurueck, damit der Aufrufer direkt in den Bearbeitungsmodus fuer den Text wechseln kann.
export async function createTask(pageId: string, x: number, y: number, text = ''): Promise<string> {
  const id = newId()
  const now = Date.now()
  await db.tasks.add({ id, pageId, text, completed: false, x, y, createdAt: now, updatedAt: now })
  await touchPage(pageId, now)
  return id
}

export async function updateTaskText(id: string, text: string): Promise<void> {
  const task = await db.tasks.get(id)
  const now = Date.now()
  await db.tasks.update(id, { text, updatedAt: now })
  if (task) await touchPage(task.pageId, now)
}

export async function toggleTask(id: string, completed: boolean): Promise<void> {
  const task = await db.tasks.get(id)
  const now = Date.now()
  await db.tasks.update(id, { completed, updatedAt: now })
  if (task) await touchPage(task.pageId, now)
}

export async function moveTask(id: string, x: number, y: number): Promise<void> {
  const task = await db.tasks.get(id)
  const now = Date.now()
  await db.tasks.update(id, { x, y, updatedAt: now })
  if (task) await touchPage(task.pageId, now)
}

export async function deleteTask(id: string): Promise<void> {
  const now = Date.now()
  const task = await db.tasks.get(id)
  await db.tasks.update(id, { deletedAt: now, updatedAt: now })
  if (task) await touchPage(task.pageId, now)
}

// Legt ein frei platziertes Textfeld an - gleiche Koordinatenlogik wie createTask (x/y im
// unskalierten Content-Koordinatenraum, siehe components/DrawingCanvas.tsx).
export async function createTextBlock(pageId: string, x: number, y: number, text = ''): Promise<string> {
  const id = newId()
  const now = Date.now()
  await db.textBlocks.add({ id, pageId, text, x, y, createdAt: now, updatedAt: now })
  await touchPage(pageId, now)
  return id
}

export async function updateTextBlockText(id: string, text: string): Promise<void> {
  const block = await db.textBlocks.get(id)
  const now = Date.now()
  await db.textBlocks.update(id, { text, updatedAt: now })
  if (block) await touchPage(block.pageId, now)
}

export async function moveTextBlock(id: string, x: number, y: number): Promise<void> {
  const block = await db.textBlocks.get(id)
  const now = Date.now()
  await db.textBlocks.update(id, { x, y, updatedAt: now })
  if (block) await touchPage(block.pageId, now)
}

// Speichert die vom Nutzer per Ziehen gewaehlte Breite eines Textfelds (siehe db/types.ts
// TextBlock.width) - wird beim Verlassen des Bearbeitungsmodus aufgerufen, siehe
// components/DrawingCanvas.tsx TextBlockItem.
export async function updateTextBlockWidth(id: string, width: number): Promise<void> {
  const block = await db.textBlocks.get(id)
  const now = Date.now()
  await db.textBlocks.update(id, { width, updatedAt: now })
  if (block) await touchPage(block.pageId, now)
}

export async function deleteTextBlock(id: string): Promise<void> {
  const now = Date.now()
  const block = await db.textBlocks.get(id)
  await db.textBlocks.update(id, { deletedAt: now, updatedAt: now })
  if (block) await touchPage(block.pageId, now)
}

// Speichert einen Schnappschuss der aktuell sichtbaren Inhalte einer Seite als Vorlage (siehe
// db/types.ts Template) - liest die Seite frisch aus Dexie, keine Referenz auf die Quellseite
// wird gespeichert, spaetere Aenderungen an der Seite wirken sich also nie auf die Vorlage aus.
export async function saveAsTemplate(pageId: string, name: string): Promise<string> {
  const page = await db.pages.get(pageId)
  if (!page) throw new Error('Seite nicht gefunden')

  const tagLinks = await db.pageTags.filter((pt) => !pt.deletedAt && pt.pageId === pageId).toArray()
  const tagRows = await db.tags.bulkGet(tagLinks.map((l) => l.tagId))
  const tagNames = tagRows.filter((t): t is NonNullable<typeof t> => !!t && !t.deletedAt).map((t) => t.name)

  const textBlocks = await db.textBlocks.filter((t) => !t.deletedAt && t.pageId === pageId).toArray()
  const tasks = await db.tasks.filter((t) => !t.deletedAt && t.pageId === pageId).toArray()

  const id = newId()
  await db.templates.add({
    id,
    name,
    background: page.background ?? 'lined',
    pageType: page.pageType,
    properties: page.properties,
    tagNames,
    textBlocks: textBlocks.map((t) => ({ text: t.text, x: t.x, y: t.y })),
    tasks: tasks.map((t) => ({ text: t.text, completed: t.completed, x: t.x, y: t.y })),
    updatedAt: Date.now(),
  })
  return id
}

export async function deleteTemplate(id: string): Promise<void> {
  const now = Date.now()
  await db.templates.update(id, { deletedAt: now, updatedAt: now })
}

// Legt aus einer Vorlage eine komplett neue, unabhaengige Seite an - alles bekommt frische IDs
// (Seite, Textfelder, Tasks), es entsteht keine dauerhafte Verknuepfung zur Vorlage. x-Werte in
// der Vorlage sind bereits im gespeicherten (relativen) Format und werden unveraendert
// uebernommen - das nutzt automatisch die bestehende responsive Koordinatenlogik weiter.
export async function createPageFromTemplate(folderId: string | undefined, templateId: string): Promise<string> {
  const template = await db.templates.get(templateId)
  if (!template) throw new Error('Vorlage nicht gefunden')

  const now = Date.now()
  const pageId = newId()
  await db.pages.add({
    id: pageId,
    folderId,
    title: template.name,
    strokes: [],
    background: template.background,
    order: now,
    createdAt: now,
    updatedAt: now,
    pageType: template.pageType,
    properties: template.properties,
  })

  for (const name of template.tagNames) {
    const tagId = await findOrCreateTag(name)
    await addTagToPage(pageId, tagId)
  }
  for (const block of template.textBlocks) {
    await db.textBlocks.add({ id: newId(), pageId, text: block.text, x: block.x, y: block.y, createdAt: now, updatedAt: now })
  }
  for (const task of template.tasks) {
    await db.tasks.add({ id: newId(), pageId, text: task.text, completed: task.completed, x: task.x, y: task.y, createdAt: now, updatedAt: now })
  }

  return pageId
}


import type { EntityTable } from 'dexie'
import { db } from '../db/db'
import type { Folder, Page, PageBackground, PageProperties, PageType, Tag, PageTag, Task, TextBlock, Template, TemplateTextBlock, TemplateTask, Stroke, PdfPrintout, Project, ProjectTask, ProjectTaskAfn, ProjectStatus, ProjectTaskStatus, ProjectWaitingFor } from '../db/types'
import { supabase } from './supabaseClient'

// Faengt fehlende/kaputte Zeitstempel ab, statt dass new Date(...).toISOString() mit
// "Invalid time value" den kompletten Sync abbricht.
function iso(value: number): string {
  const safeValue = Number.isFinite(value) ? value : Date.now()
  return new Date(safeValue).toISOString()
}

function ms(isoStr: string): number {
  return new Date(isoStr).getTime()
}

// Fuehrt eine Tabelle lokal (Dexie) und remote (Supabase) zu einem gemeinsamen Stand zusammen:
// pro Zeile gewinnt bei Last-Write-Wins der jeweils neuere `updatedAt`-Zeitstempel. Voller
// Abgleich statt inkrementell seit dem letzten Sync - bei der Datenmenge einer persoenlichen
// Notiz-App (Ordner/Seiten/Tags eines einzelnen Accounts) unkritisch und robuster als eine
// Cursor-/Aenderungsprotokoll-Logik.
async function mergeTable<Local extends { id: string; updatedAt: number }, Remote extends { id: string; updated_at: string }>(
  localTable: EntityTable<Local, 'id'>,
  remoteTableName: string,
  toRemote: (local: Local) => Remote,
  fromRemote: (remote: Remote, existingLocal?: Local) => Local,
): Promise<void> {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert.')

  const localRows = await localTable.toArray()
  const { data: remoteRows, error } = await supabase.from(remoteTableName).select('*')
  if (error) throw new Error(`${remoteTableName}: ${error.message}`)

  const localById = new Map(localRows.map((r) => [r.id, r]))
  const remoteById = new Map(((remoteRows ?? []) as Remote[]).map((r) => [r.id, r]))

  const toPushRemote: Remote[] = []
  const toPutLocal: Local[] = []

  const allIds = new Set([...localById.keys(), ...remoteById.keys()])
  for (const id of allIds) {
    const local = localById.get(id)
    const remote = remoteById.get(id)
    if (local && !remote) {
      toPushRemote.push(toRemote(local))
    } else if (!local && remote) {
      toPutLocal.push(fromRemote(remote))
    } else if (local && remote) {
      const remoteUpdatedAt = ms(remote.updated_at)
      if (local.updatedAt > remoteUpdatedAt) {
        toPushRemote.push(toRemote(local))
      } else if (remoteUpdatedAt > local.updatedAt) {
        toPutLocal.push(fromRemote(remote, local))
      }
    }
  }

  // Erst herunterladen und lokal festschreiben, DANN erst hochladen: schlaegt der Push fehl,
  // sollen bereits erfolgreich vom Server geladene Daten trotzdem lokal ankommen.
  if (toPutLocal.length > 0) {
    await localTable.bulkPut(toPutLocal)
  }
  if (toPushRemote.length > 0) {
    const { error: upsertError } = await supabase.from(remoteTableName).upsert(toPushRemote)
    if (upsertError) throw new Error(`${remoteTableName}: ${upsertError.message}`)
  }
}

interface RemoteFolder {
  id: string
  user_id: string
  parent_id: string | null
  name: string
  order: number
  updated_at: string
  deleted_at: string | null
}

interface RemotePage {
  id: string
  user_id: string
  folder_id: string | null
  title: string
  strokes: Stroke[]
  background: string
  order: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  favorited_at: string | null
  page_type: string | null
  custom_date: string | null
  afns: number[]
  properties: PageProperties
}

interface RemoteTag {
  id: string
  user_id: string
  name: string
  updated_at: string
  deleted_at: string | null
}

interface RemotePageTag {
  id: string
  user_id: string
  page_id: string
  tag_id: string
  updated_at: string
  deleted_at: string | null
}

interface RemoteTask {
  id: string
  user_id: string
  page_id: string
  text: string
  completed: boolean
  x: number
  y: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

interface RemoteTextBlock {
  id: string
  user_id: string
  page_id: string
  text: string
  x: number
  y: number
  width: number | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

interface RemoteTemplate {
  id: string
  user_id: string
  name: string
  background: string
  page_type: string | null
  properties: PageProperties
  tag_names: string[]
  text_blocks: TemplateTextBlock[]
  tasks: TemplateTask[]
  updated_at: string
  deleted_at: string | null
}

// Nur Metadaten (siehe db/types.ts PdfPrintout) - die eigentliche Datei liegt in Supabase
// Storage (Bucket "notiz-pdfs", siehe lib/pdfStorage.ts) und wird von mergeTable NIE angefasst,
// nur diese kleine Zeile laeuft ueber den normalen Last-Write-Wins-Abgleich.
interface RemotePdfPrintout {
  id: string
  user_id: string
  page_id: string
  file_name: string
  storage_path: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

interface RemoteProject { id: string; user_id: string; name: string; customer_name: string | null; owner_user_id: string; status: string; start_date: string | null; target_date: string | null; description: string | null; created_at: string; updated_at: string; deleted_at: string | null }
interface RemoteProjectTask { id: string; user_id: string; project_id: string; title: string; description: string | null; assignee_user_id: string | null; status: string; due_date: string | null; waiting_for: string | null; sort_order: number; created_at: string; updated_at: string; deleted_at: string | null }
interface RemoteProjectTaskAfn { id: string; user_id: string; task_id: string; afn_number: number; updated_at: string; deleted_at: string | null }

// Zieht Ordner, Seiten, Tasks, Tags, PDF-Ausdruck-Metadaten und deren Verknuepfungen mit
// Supabase zusammen. Ordner zuerst: pages/tasks/page_tags/pdf_printouts referenzieren
// folder_id/page_id/tag_id als Fremdschluessel, die Zeile muss also dort existieren, bevor die
// anderen pushen.
export async function syncAll(): Promise<void> {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert.')
  const client = supabase
  const { data: userData, error: userError } = await client.auth.getUser()
  if (userError || !userData.user) throw new Error('Nicht eingeloggt.')
  const userId = userData.user.id

  // Minimales gemeinsames Benutzerverzeichnis fuer Verantwortliche. Auth bleibt die einzige
  // Identitaetsquelle; lokal werden nur Anzeigename/E-Mail fuer Offline-Darstellung gecacht.
  const profileNow = new Date().toISOString()
  const { error: profileError } = await client.from('notiz_profiles').upsert({
    id: userId,
    email: userData.user.email ?? '',
    display_name: userData.user.user_metadata?.full_name ?? null,
    updated_at: profileNow,
  })
  if (profileError) throw new Error(`notiz_profiles: ${profileError.message}`)
  const { data: profiles, error: profilesError } = await client.from('notiz_profiles').select('*')
  if (profilesError) throw new Error(`notiz_profiles: ${profilesError.message}`)
  await db.userProfiles.bulkPut((profiles ?? []).map((profile) => ({
    id: profile.id as string,
    email: profile.email as string,
    displayName: (profile.display_name as string | null) ?? undefined,
    updatedAt: ms(profile.updated_at as string),
  })))

  await mergeTable<Folder, RemoteFolder>(
    db.folders,
    'notiz_folders',
    (f) => ({
      id: f.id,
      user_id: userId,
      parent_id: f.parentId ?? null,
      name: f.name,
      order: f.order,
      updated_at: iso(f.updatedAt),
      deleted_at: f.deletedAt ? iso(f.deletedAt) : null,
    }),
    (r) => ({
      id: r.id,
      parentId: r.parent_id ?? undefined,
      name: r.name,
      order: r.order,
      updatedAt: ms(r.updated_at),
      deletedAt: r.deleted_at ? ms(r.deleted_at) : undefined,
    }),
  )

  await mergeTable<Page, RemotePage>(
    db.pages,
    'notiz_pages',
    (p) => ({
      id: p.id,
      user_id: userId,
      folder_id: p.folderId ?? null,
      title: p.title,
      strokes: p.strokes,
      background: p.background ?? 'lined',
      order: p.order,
      created_at: iso(p.createdAt ?? p.order),
      updated_at: iso(p.updatedAt),
      deleted_at: p.deletedAt ? iso(p.deletedAt) : null,
      favorited_at: p.favoritedAt ? iso(p.favoritedAt) : null,
      page_type: p.pageType ?? null,
      custom_date: p.customDate ? iso(p.customDate) : null,
      afns: p.afns ?? [],
      properties: p.properties ?? {},
    }),
    (r) => ({
      id: r.id,
      folderId: r.folder_id ?? undefined,
      title: r.title,
      strokes: r.strokes,
      background: (r.background as Page['background']) ?? 'lined',
      order: r.order,
      createdAt: ms(r.created_at),
      updatedAt: ms(r.updated_at),
      deletedAt: r.deleted_at ? ms(r.deleted_at) : undefined,
      favoritedAt: r.favorited_at ? ms(r.favorited_at) : undefined,
      pageType: (r.page_type as PageType) || undefined,
      customDate: r.custom_date ? ms(r.custom_date) : undefined,
      afns: r.afns && r.afns.length > 0 ? r.afns : undefined,
      properties: r.properties ?? undefined,
    }),
  )

  // Referenziert page_id als Fremdschluessel, deshalb nach Pages.
  await mergeTable<PdfPrintout, RemotePdfPrintout>(
    db.pdfPrintouts,
    'notiz_pdf_printouts',
    (p) => ({
      id: p.id,
      user_id: userId,
      page_id: p.pageId,
      file_name: p.fileName,
      storage_path: p.storagePath,
      created_at: iso(p.createdAt),
      updated_at: iso(p.updatedAt),
      deleted_at: p.deletedAt ? iso(p.deletedAt) : null,
    }),
    (r) => ({
      id: r.id,
      pageId: r.page_id,
      fileName: r.file_name,
      storagePath: r.storage_path,
      createdAt: ms(r.created_at),
      updatedAt: ms(r.updated_at),
      deletedAt: r.deleted_at ? ms(r.deleted_at) : undefined,
    }),
  )

  // Tasks referenzieren page_id als Fremdschluessel, deshalb nach Pages und vor
  // Tags/PageTags (unabhaengig davon).
  await mergeTable<Task, RemoteTask>(
    db.tasks,
    'notiz_tasks',
    (t) => ({
      id: t.id,
      user_id: userId,
      page_id: t.pageId,
      text: t.text,
      completed: t.completed,
      x: t.x,
      y: t.y,
      created_at: iso(t.createdAt),
      updated_at: iso(t.updatedAt),
      deleted_at: t.deletedAt ? iso(t.deletedAt) : null,
    }),
    (r) => ({
      id: r.id,
      pageId: r.page_id,
      text: r.text,
      completed: r.completed,
      x: r.x,
      y: r.y,
      createdAt: ms(r.created_at),
      updatedAt: ms(r.updated_at),
      deletedAt: r.deleted_at ? ms(r.deleted_at) : undefined,
    }),
  )

  // Textfelder referenzieren ebenfalls page_id, deshalb wie Tasks nach Pages.
  await mergeTable<TextBlock, RemoteTextBlock>(
    db.textBlocks,
    'notiz_text_blocks',
    (t) => ({
      id: t.id,
      user_id: userId,
      page_id: t.pageId,
      text: t.text,
      x: t.x,
      y: t.y,
      width: t.width ?? null,
      created_at: iso(t.createdAt),
      updated_at: iso(t.updatedAt),
      deleted_at: t.deletedAt ? iso(t.deletedAt) : null,
    }),
    (r) => ({
      id: r.id,
      pageId: r.page_id,
      text: r.text,
      x: r.x,
      y: r.y,
      width: r.width ?? undefined,
      createdAt: ms(r.created_at),
      updatedAt: ms(r.updated_at),
      deletedAt: r.deleted_at ? ms(r.deleted_at) : undefined,
    }),
  )

  // Vorlagen referenzieren keine Seite mehr (Schnappschuss, siehe db/types.ts Template) -
  // Reihenfolge relativ zu den anderen Tabellen daher unkritisch.
  await mergeTable<Template, RemoteTemplate>(
    db.templates,
    'notiz_templates',
    (t) => ({
      id: t.id,
      user_id: userId,
      name: t.name,
      background: t.background,
      page_type: t.pageType ?? null,
      properties: t.properties ?? {},
      tag_names: t.tagNames,
      text_blocks: t.textBlocks,
      tasks: t.tasks,
      updated_at: iso(t.updatedAt),
      deleted_at: t.deletedAt ? iso(t.deletedAt) : null,
    }),
    (r) => ({
      id: r.id,
      name: r.name,
      background: (r.background as PageBackground) ?? 'lined',
      pageType: (r.page_type as PageType) || undefined,
      properties: r.properties ?? undefined,
      tagNames: r.tag_names ?? [],
      textBlocks: r.text_blocks ?? [],
      tasks: r.tasks ?? [],
      updatedAt: ms(r.updated_at),
      deletedAt: r.deleted_at ? ms(r.deleted_at) : undefined,
    }),
  )

  await mergeTable<Tag, RemoteTag>(
    db.tags,
    'notiz_tags',
    (t) => ({
      id: t.id,
      user_id: userId,
      name: t.name,
      updated_at: iso(t.updatedAt),
      deleted_at: t.deletedAt ? iso(t.deletedAt) : null,
    }),
    (r) => ({
      id: r.id,
      name: r.name,
      updatedAt: ms(r.updated_at),
      deletedAt: r.deleted_at ? ms(r.deleted_at) : undefined,
    }),
  )

  await mergeTable<PageTag, RemotePageTag>(
    db.pageTags,
    'notiz_page_tags',
    (pt) => ({
      id: pt.id,
      user_id: userId,
      page_id: pt.pageId,
      tag_id: pt.tagId,
      updated_at: iso(pt.updatedAt),
      deleted_at: pt.deletedAt ? iso(pt.deletedAt) : null,
    }),
    (r) => ({
      id: r.id,
      pageId: r.page_id,
      tagId: r.tag_id,
      updatedAt: ms(r.updated_at),
      deletedAt: r.deleted_at ? ms(r.deleted_at) : undefined,
    }),
  )

  await mergeTable<Project, RemoteProject>(db.projects, 'notiz_projects', (p) => ({
    id: p.id, user_id: userId, name: p.name, customer_name: p.customerName ?? null,
    owner_user_id: p.ownerUserId, status: p.status, start_date: p.startDate ? iso(p.startDate) : null,
    target_date: p.targetDate ? iso(p.targetDate) : null, description: p.description ?? null,
    created_at: iso(p.createdAt), updated_at: iso(p.updatedAt), deleted_at: p.deletedAt ? iso(p.deletedAt) : null,
  }), (r) => ({ id: r.id, name: r.name, customerName: r.customer_name ?? undefined, ownerUserId: r.owner_user_id,
    status: r.status as ProjectStatus, startDate: r.start_date ? ms(r.start_date) : undefined,
    targetDate: r.target_date ? ms(r.target_date) : undefined, description: r.description ?? undefined,
    createdAt: ms(r.created_at), updatedAt: ms(r.updated_at), deletedAt: r.deleted_at ? ms(r.deleted_at) : undefined }))

  await mergeTable<ProjectTask, RemoteProjectTask>(db.projectTasks, 'notiz_project_tasks', (t) => ({
    id: t.id, user_id: userId, project_id: t.projectId, title: t.title, description: t.description ?? null,
    assignee_user_id: t.assigneeUserId ?? null, status: t.status, due_date: t.dueDate ? iso(t.dueDate) : null,
    waiting_for: t.waitingFor ?? null, sort_order: t.sortOrder, created_at: iso(t.createdAt),
    updated_at: iso(t.updatedAt), deleted_at: t.deletedAt ? iso(t.deletedAt) : null,
  }), (r) => ({ id: r.id, projectId: r.project_id, title: r.title, description: r.description ?? undefined,
    assigneeUserId: r.assignee_user_id ?? undefined, status: r.status as ProjectTaskStatus,
    dueDate: r.due_date ? ms(r.due_date) : undefined, waitingFor: (r.waiting_for as ProjectWaitingFor) || undefined,
    sortOrder: r.sort_order, createdAt: ms(r.created_at), updatedAt: ms(r.updated_at), deletedAt: r.deleted_at ? ms(r.deleted_at) : undefined }))

  await mergeTable<ProjectTaskAfn, RemoteProjectTaskAfn>(db.projectTaskAfns, 'notiz_project_task_afns', (a) => ({
    id: a.id, user_id: userId, task_id: a.taskId, afn_number: a.afnNumber,
    updated_at: iso(a.updatedAt), deleted_at: a.deletedAt ? iso(a.deletedAt) : null,
  }), (r) => ({ id: r.id, taskId: r.task_id, afnNumber: r.afn_number,
    updatedAt: ms(r.updated_at), deletedAt: r.deleted_at ? ms(r.deleted_at) : undefined }))
}



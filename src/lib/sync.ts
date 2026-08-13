import type { EntityTable } from 'dexie'
import { db } from '../db/db'
import type { Folder, Page, PageBackground, PageProperties, PageType, Tag, PageTag, Task, QuickTask, TextBlock, Template, TemplateTextBlock, TemplateTask, Stroke, PdfPrintout, Project, ProjectTask, ProjectTaskAfn, ProjectTaskComment, ProjectMilestone, ProjectSection, ProjectStatus, ProjectTaskStatus, ProjectWaitingFor, ProjectMilestoneStatus, ProjectMember, ProjectMemberRole, ProjectTemplate, ProjectTemplateMilestone, ProjectTemplateSection, ProjectTemplateTask, ProjectTemplateVisibility } from '../db/types'
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
    // Ein RLS-Fehler bricht den gesamten Bulk-Upsert ab, ohne zu verraten, welche Zeile
    // schuld war (Postgres nennt aus Sicherheitsgruenden keine Row-Details) - und da syncAll()
    // alle Tabellen sequenziell abarbeitet, blockiert ein einziger fauler Datensatz sonst
    // stillschweigend JEDEN weiteren Sync-Versuch, auch fuer alle spaeteren Tabellen. Die
    // betroffenen IDs (max. 5) im Fehlertext machen das Problem selbst diagnostizierbar, ohne
    // Datenbankzugriff.
    if (upsertError) {
      const ids = toPushRemote.slice(0, 5).map((row) => row.id).join(', ')
      const more = toPushRemote.length > 5 ? ` (+${toPushRemote.length - 5} weitere)` : ''
      throw new Error(`${remoteTableName}: ${upsertError.message} [betroffene Zeilen: ${ids}${more}]`)
    }
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

interface RemoteQuickTask {
  id: string
  user_id: string
  text: string
  completed: boolean
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

interface RemoteProject { id: string; user_id: string; name: string; customer_name: string | null; owner_user_id: string; status: string; start_date: string | null; target_date: string | null; description: string | null; custom_field_1_label: string | null; custom_field_2_label: string | null; created_at: string; updated_at: string; deleted_at: string | null }
interface RemoteProjectTask { id: string; user_id: string; project_id: string; milestone_id: string | null; section_id: string | null; title: string; description: string | null; assignee_user_id: string | null; status: string; due_date: string | null; waiting_for: string | null; custom_field_1_value: string | null; custom_field_2_value: string | null; sort_order: number; created_at: string; updated_at: string; deleted_at: string | null }
interface RemoteProjectMilestone { id: string; user_id: string; project_id: string; title: string; description: string | null; due_date: string | null; status: string; sort_order: number; created_at: string; updated_at: string; deleted_at: string | null }
interface RemoteProjectSection { id: string; user_id: string; project_id: string; milestone_id: string; title: string; sort_order: number; created_at: string; updated_at: string; deleted_at: string | null }
interface RemoteProjectTaskAfn { id: string; user_id: string; task_id: string; afn_number: number; updated_at: string; deleted_at: string | null }
interface RemoteProjectTaskComment { id: string; task_id: string; author_user_id: string; body: string; created_at: string; updated_at: string; deleted_at: string | null }
interface RemoteProjectMember { id: string; project_id: string; user_id: string; role: string; created_at: string; updated_at: string; deleted_at: string | null }

interface RemoteProjectTemplate { id: string; user_id: string; created_by_user_id: string; name: string; description: string | null; visibility: string; created_at: string; updated_at: string; deleted_at: string | null }
interface RemoteProjectTemplateMilestone { id: string; user_id: string; template_id: string; title: string; description: string | null; relative_due_days: number | null; sort_order: number; created_at: string; updated_at: string; deleted_at: string | null }
interface RemoteProjectTemplateSection { id: string; user_id: string; template_id: string; milestone_template_id: string; title: string; sort_order: number; created_at: string; updated_at: string; deleted_at: string | null }
interface RemoteProjectTemplateTask { id: string; user_id: string; template_id: string; milestone_template_id: string | null; section_template_id: string | null; title: string; description: string | null; relative_due_days: number | null; sort_order: number; created_at: string; updated_at: string; deleted_at: string | null }

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
  const metadataDisplayName = typeof userData.user.user_metadata?.full_name === 'string'
    ? userData.user.user_metadata.full_name.trim()
    : ''
  let { error: profileError } = await client.rpc('notiz_update_own_profile', {
    p_email: userData.user.email ?? '',
    p_display_name: metadataDisplayName,
  })
  // Sicheres Zwischenstadium, falls Frontend-Deploy und SQL-Migration nicht exakt gleichzeitig
  // aktiv werden. Nach der Migration existiert die RPC immer und nur dieser Pfad wird genutzt.
  if (profileError?.code === 'PGRST202') {
    const fallback = await client.from('notiz_profiles').upsert({
      id: userId,
      email: userData.user.email ?? '',
      ...(metadataDisplayName ? { display_name: metadataDisplayName } : {}),
      updated_at: new Date().toISOString(),
    })
    profileError = fallback.error
  }
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

  await mergeTable<QuickTask, RemoteQuickTask>(
    db.quickTasks,
    'notiz_quick_tasks',
    (task) => ({
      id: task.id,
      user_id: userId,
      text: task.text,
      completed: task.completed,
      created_at: iso(task.createdAt),
      updated_at: iso(task.updatedAt),
      deleted_at: task.deletedAt ? iso(task.deletedAt) : null,
    }),
    (remote) => ({
      id: remote.id,
      text: remote.text,
      completed: remote.completed,
      createdAt: ms(remote.created_at),
      updatedAt: ms(remote.updated_at),
      deletedAt: remote.deleted_at ? ms(remote.deleted_at) : undefined,
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

  // RLS liefert nur Projekte, die dem Benutzer gehoeren oder in deren aktivem Team er ist.
  // Alte App-Versionen konnten jedoch bereits fremde Projekte in Dexie zwischenspeichern. Ohne
  // Bereinigung wuerde mergeTable diese nicht mehr sichtbaren Zeilen als "nur lokal" einstufen
  // und per Upsert erneut hochladen - Supabase lehnt das korrekt mit einem RLS-Fehler ab.
  const { data: accessibleProjectRows, error: accessibleProjectsError } = await client
    .from('notiz_projects')
    .select('id')
  if (accessibleProjectsError) throw new Error(`notiz_projects: ${accessibleProjectsError.message}`)
  const accessibleProjectIds = new Set((accessibleProjectRows ?? []).map((row) => row.id as string))
  const cachedProjects = await db.projects.toArray()
  const inaccessibleProjectIds = new Set(
    cachedProjects
      .filter((project) => project.ownerUserId !== userId && !accessibleProjectIds.has(project.id))
      .map((project) => project.id),
  )

  if (inaccessibleProjectIds.size > 0) {
    const cachedProjectTasks = await db.projectTasks
      .filter((task) => inaccessibleProjectIds.has(task.projectId))
      .toArray()
    const inaccessibleTaskIds = new Set(cachedProjectTasks.map((task) => task.id))
    const [cachedAfns, cachedComments, cachedMilestones, cachedSections, cachedMembers] = await Promise.all([
      db.projectTaskAfns.filter((afn) => inaccessibleTaskIds.has(afn.taskId)).toArray(),
      db.projectTaskComments.filter((comment) => inaccessibleTaskIds.has(comment.taskId)).toArray(),
      db.projectMilestones.filter((milestone) => inaccessibleProjectIds.has(milestone.projectId)).toArray(),
      db.projectSections.filter((section) => inaccessibleProjectIds.has(section.projectId)).toArray(),
      db.projectMembers.filter((member) => inaccessibleProjectIds.has(member.projectId)).toArray(),
    ])
    await db.transaction(
      'rw',
      [db.projects, db.projectTasks, db.projectTaskAfns, db.projectTaskComments, db.projectMilestones, db.projectSections, db.projectMembers],
      async () => {
        await db.projectTaskAfns.bulkDelete(cachedAfns.map((row) => row.id))
        await db.projectTaskComments.bulkDelete(cachedComments.map((row) => row.id))
        await db.projectTasks.bulkDelete(cachedProjectTasks.map((row) => row.id))
        await db.projectMilestones.bulkDelete(cachedMilestones.map((row) => row.id))
        await db.projectSections.bulkDelete(cachedSections.map((row) => row.id))
        await db.projectMembers.bulkDelete(cachedMembers.map((row) => row.id))
        await db.projects.bulkDelete([...inaccessibleProjectIds])
      },
    )
  }

  await mergeTable<Project, RemoteProject>(db.projects, 'notiz_projects', (p) => ({
    id: p.id, user_id: userId, name: p.name, customer_name: p.customerName ?? null,
    owner_user_id: p.ownerUserId, status: p.status, start_date: p.startDate ? iso(p.startDate) : null,
    target_date: p.targetDate ? iso(p.targetDate) : null, description: p.description ?? null,
    custom_field_1_label: p.customField1Label ?? null, custom_field_2_label: p.customField2Label ?? null,
    created_at: iso(p.createdAt), updated_at: iso(p.updatedAt), deleted_at: p.deletedAt ? iso(p.deletedAt) : null,
  }), (r) => ({ id: r.id, name: r.name, customerName: r.customer_name ?? undefined, ownerUserId: r.owner_user_id,
    status: r.status as ProjectStatus, startDate: r.start_date ? ms(r.start_date) : undefined,
    targetDate: r.target_date ? ms(r.target_date) : undefined, description: r.description ?? undefined,
    customField1Label: r.custom_field_1_label ?? undefined, customField2Label: r.custom_field_2_label ?? undefined,
    createdAt: ms(r.created_at), updatedAt: ms(r.updated_at), deletedAt: r.deleted_at ? ms(r.deleted_at) : undefined }))

  await mergeTable<ProjectMember, RemoteProjectMember>(db.projectMembers, 'notiz_project_members', (m) => ({
    id: m.id, project_id: m.projectId, user_id: m.userId, role: m.role,
    created_at: iso(m.createdAt), updated_at: iso(m.updatedAt), deleted_at: m.deletedAt ? iso(m.deletedAt) : null,
  }), (r) => ({ id: r.id, projectId: r.project_id, userId: r.user_id, role: r.role as ProjectMemberRole,
    createdAt: ms(r.created_at), updatedAt: ms(r.updated_at), deletedAt: r.deleted_at ? ms(r.deleted_at) : undefined }))

  // Meilensteine vor Aufgaben synchronisieren, damit milestone_id auf neuen GerÃ¤ten nie auf
  // eine noch nicht hochgeladene FremdschlÃ¼ssel-Zeile zeigt.
  await mergeTable<ProjectMilestone, RemoteProjectMilestone>(db.projectMilestones, 'notiz_project_milestones', (m) => ({
    id: m.id, user_id: userId, project_id: m.projectId, title: m.title, description: m.description ?? null,
    due_date: m.dueDate ? iso(m.dueDate) : null, status: m.status, sort_order: m.sortOrder,
    created_at: iso(m.createdAt), updated_at: iso(m.updatedAt), deleted_at: m.deletedAt ? iso(m.deletedAt) : null,
  }), (r) => ({ id: r.id, projectId: r.project_id, title: r.title, description: r.description ?? undefined,
    dueDate: r.due_date ? ms(r.due_date) : undefined, status: r.status as ProjectMilestoneStatus, sortOrder: r.sort_order,
    createdAt: ms(r.created_at), updatedAt: ms(r.updated_at), deletedAt: r.deleted_at ? ms(r.deleted_at) : undefined }))

  await mergeTable<ProjectSection, RemoteProjectSection>(db.projectSections, 'notiz_project_sections', (section) => ({
    id: section.id, user_id: userId, project_id: section.projectId, milestone_id: section.milestoneId,
    title: section.title, sort_order: section.sortOrder, created_at: iso(section.createdAt),
    updated_at: iso(section.updatedAt), deleted_at: section.deletedAt ? iso(section.deletedAt) : null,
  }), (remote) => ({
    id: remote.id, projectId: remote.project_id, milestoneId: remote.milestone_id, title: remote.title,
    sortOrder: remote.sort_order, createdAt: ms(remote.created_at), updatedAt: ms(remote.updated_at),
    deletedAt: remote.deleted_at ? ms(remote.deleted_at) : undefined,
  }))

  await mergeTable<ProjectTask, RemoteProjectTask>(db.projectTasks, 'notiz_project_tasks', (t) => ({
    id: t.id, user_id: userId, project_id: t.projectId, milestone_id: t.milestoneId ?? null, section_id: t.sectionId ?? null, title: t.title, description: t.description ?? null,
    assignee_user_id: t.assigneeUserId ?? null, status: t.status, due_date: t.dueDate ? iso(t.dueDate) : null,
    waiting_for: t.waitingFor ?? null, custom_field_1_value: t.customField1Value ?? null, custom_field_2_value: t.customField2Value ?? null,
    sort_order: t.sortOrder, created_at: iso(t.createdAt),
    updated_at: iso(t.updatedAt), deleted_at: t.deletedAt ? iso(t.deletedAt) : null,
  }), (r) => ({ id: r.id, projectId: r.project_id, milestoneId: r.milestone_id ?? undefined, sectionId: r.section_id ?? undefined, title: r.title, description: r.description ?? undefined,
    assigneeUserId: r.assignee_user_id ?? undefined, status: r.status as ProjectTaskStatus,
    dueDate: r.due_date ? ms(r.due_date) : undefined, waitingFor: (r.waiting_for as ProjectWaitingFor) || undefined,
    customField1Value: r.custom_field_1_value ?? undefined, customField2Value: r.custom_field_2_value ?? undefined,
    sortOrder: r.sort_order, createdAt: ms(r.created_at), updatedAt: ms(r.updated_at), deletedAt: r.deleted_at ? ms(r.deleted_at) : undefined }))

  await mergeTable<ProjectTaskAfn, RemoteProjectTaskAfn>(db.projectTaskAfns, 'notiz_project_task_afns', (a) => ({
    id: a.id, user_id: userId, task_id: a.taskId, afn_number: a.afnNumber,
    updated_at: iso(a.updatedAt), deleted_at: a.deletedAt ? iso(a.deletedAt) : null,
  }), (r) => ({ id: r.id, taskId: r.task_id, afnNumber: r.afn_number,
    updatedAt: ms(r.updated_at), deletedAt: r.deleted_at ? ms(r.deleted_at) : undefined }))

  await mergeTable<ProjectTaskComment, RemoteProjectTaskComment>(db.projectTaskComments, 'notiz_project_task_comments', (comment) => ({
    id: comment.id, task_id: comment.taskId, author_user_id: comment.authorUserId, body: comment.body,
    created_at: iso(comment.createdAt), updated_at: iso(comment.updatedAt), deleted_at: comment.deletedAt ? iso(comment.deletedAt) : null,
  }), (r) => ({ id: r.id, taskId: r.task_id, authorUserId: r.author_user_id, body: r.body,
    createdAt: ms(r.created_at), updatedAt: ms(r.updated_at), deletedAt: r.deleted_at ? ms(r.deleted_at) : undefined }))

  // RLS liefert nur Vorlagen, die dem Benutzer gehoeren oder oeffentlich sind (visibility =
  // 'public', siehe Migration 0021). Wechselt eine fremde Vorlage von oeffentlich auf privat,
  // muss die lokale Kopie verschwinden - sonst wuerde mergeTable sie faelschlich als "nur lokal"
  // einstufen und per Upsert erneut hochladen (von Supabase korrekt per RLS abgelehnt). Exakt
  // dieselbe Bereinigung wie oben bei notiz_projects.
  const { data: accessibleTemplateRows, error: accessibleTemplatesError } = await client
    .from('notiz_project_templates')
    .select('id')
  if (accessibleTemplatesError) throw new Error(`notiz_project_templates: ${accessibleTemplatesError.message}`)
  const accessibleTemplateIds = new Set((accessibleTemplateRows ?? []).map((row) => row.id as string))
  const cachedTemplates = await db.projectTemplates.toArray()
  const inaccessibleTemplateIds = new Set(
    cachedTemplates
      .filter((template) => template.createdByUserId !== userId && !accessibleTemplateIds.has(template.id))
      .map((template) => template.id),
  )

  if (inaccessibleTemplateIds.size > 0) {
    const [cachedTemplateMilestones, cachedTemplateSections, cachedTemplateTasks] = await Promise.all([
      db.projectTemplateMilestones.filter((m) => inaccessibleTemplateIds.has(m.templateId)).toArray(),
      db.projectTemplateSections.filter((s) => inaccessibleTemplateIds.has(s.templateId)).toArray(),
      db.projectTemplateTasks.filter((t) => inaccessibleTemplateIds.has(t.templateId)).toArray(),
    ])
    await db.transaction(
      'rw',
      [db.projectTemplates, db.projectTemplateMilestones, db.projectTemplateSections, db.projectTemplateTasks],
      async () => {
        await db.projectTemplateTasks.bulkDelete(cachedTemplateTasks.map((row) => row.id))
        await db.projectTemplateSections.bulkDelete(cachedTemplateSections.map((row) => row.id))
        await db.projectTemplateMilestones.bulkDelete(cachedTemplateMilestones.map((row) => row.id))
        await db.projectTemplates.bulkDelete([...inaccessibleTemplateIds])
      },
    )
  }

  await mergeTable<ProjectTemplate, RemoteProjectTemplate>(db.projectTemplates, 'notiz_project_templates', (t) => ({
    id: t.id, user_id: userId, created_by_user_id: t.createdByUserId, name: t.name, description: t.description ?? null,
    visibility: t.visibility, created_at: iso(t.createdAt), updated_at: iso(t.updatedAt), deleted_at: t.deletedAt ? iso(t.deletedAt) : null,
  }), (r) => ({ id: r.id, name: r.name, description: r.description ?? undefined, createdByUserId: r.created_by_user_id,
    visibility: r.visibility as ProjectTemplateVisibility,
    createdAt: ms(r.created_at), updatedAt: ms(r.updated_at), deletedAt: r.deleted_at ? ms(r.deleted_at) : undefined }))

  // Meilensteine vor Themenbereichen/Aufgaben, gleiche FK-Reihenfolge-Logik wie bei Projekten.
  await mergeTable<ProjectTemplateMilestone, RemoteProjectTemplateMilestone>(db.projectTemplateMilestones, 'notiz_project_template_milestones', (m) => ({
    id: m.id, user_id: userId, template_id: m.templateId, title: m.title, description: m.description ?? null,
    relative_due_days: m.relativeDueDays ?? null, sort_order: m.sortOrder,
    created_at: iso(m.createdAt), updated_at: iso(m.updatedAt), deleted_at: m.deletedAt ? iso(m.deletedAt) : null,
  }), (r) => ({ id: r.id, templateId: r.template_id, title: r.title, description: r.description ?? undefined,
    relativeDueDays: r.relative_due_days ?? undefined, sortOrder: r.sort_order,
    createdAt: ms(r.created_at), updatedAt: ms(r.updated_at), deletedAt: r.deleted_at ? ms(r.deleted_at) : undefined }))

  await mergeTable<ProjectTemplateSection, RemoteProjectTemplateSection>(db.projectTemplateSections, 'notiz_project_template_sections', (s) => ({
    id: s.id, user_id: userId, template_id: s.templateId, milestone_template_id: s.milestoneTemplateId, title: s.title,
    sort_order: s.sortOrder, created_at: iso(s.createdAt), updated_at: iso(s.updatedAt), deleted_at: s.deletedAt ? iso(s.deletedAt) : null,
  }), (r) => ({ id: r.id, templateId: r.template_id, milestoneTemplateId: r.milestone_template_id, title: r.title,
    sortOrder: r.sort_order, createdAt: ms(r.created_at), updatedAt: ms(r.updated_at), deletedAt: r.deleted_at ? ms(r.deleted_at) : undefined }))

  await mergeTable<ProjectTemplateTask, RemoteProjectTemplateTask>(db.projectTemplateTasks, 'notiz_project_template_tasks', (t) => ({
    id: t.id, user_id: userId, template_id: t.templateId, milestone_template_id: t.milestoneTemplateId ?? null,
    section_template_id: t.sectionTemplateId ?? null, title: t.title, description: t.description ?? null,
    relative_due_days: t.relativeDueDays ?? null, sort_order: t.sortOrder,
    created_at: iso(t.createdAt), updated_at: iso(t.updatedAt), deleted_at: t.deletedAt ? iso(t.deletedAt) : null,
  }), (r) => ({ id: r.id, templateId: r.template_id, milestoneTemplateId: r.milestone_template_id ?? undefined,
    sectionTemplateId: r.section_template_id ?? undefined, title: r.title, description: r.description ?? undefined,
    relativeDueDays: r.relative_due_days ?? undefined, sortOrder: r.sort_order,
    createdAt: ms(r.created_at), updatedAt: ms(r.updated_at), deletedAt: r.deleted_at ? ms(r.deleted_at) : undefined }))
}

export async function updateOwnDisplayName(displayName: string): Promise<void> {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert.')
  const trimmed = displayName.trim()
  if (!trimmed) throw new Error('Bitte einen Namen eingeben.')

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw new Error('Nicht eingeloggt.')

  const { error: metadataError } = await supabase.auth.updateUser({ data: { full_name: trimmed } })
  if (metadataError) throw new Error(`Benutzername: ${metadataError.message}`)

  const updatedAt = Date.now()
  let { error: profileError } = await supabase.rpc('notiz_update_own_profile', {
    p_email: userData.user.email ?? '',
    p_display_name: trimmed,
  })
  if (profileError?.code === 'PGRST202') {
    const fallback = await supabase.from('notiz_profiles').upsert({
      id: userData.user.id,
      email: userData.user.email ?? '',
      display_name: trimmed,
      updated_at: new Date(updatedAt).toISOString(),
    })
    profileError = fallback.error
  }
  if (profileError) throw new Error(`notiz_profiles: ${profileError.message}`)

  await db.userProfiles.put({
    id: userData.user.id,
    email: userData.user.email ?? '',
    displayName: trimmed,
    updatedAt,
  })
}



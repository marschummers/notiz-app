import Dexie, { type EntityTable } from 'dexie'
import type { Folder, Page, Tag, PageTag, Task, QuickTask, TextBlock, Template, PdfPrintout, PdfBlobCache, Project, ProjectTask, ProjectTaskAfn, ProjectTaskComment, ProjectMilestone, ProjectSection, ProjectMember, UserProfile } from './types'

export const db = new Dexie('notiz-app') as Dexie & {
  folders: EntityTable<Folder, 'id'>
  pages: EntityTable<Page, 'id'>
  tags: EntityTable<Tag, 'id'>
  pageTags: EntityTable<PageTag, 'id'>
  tasks: EntityTable<Task, 'id'>
  quickTasks: EntityTable<QuickTask, 'id'>
  textBlocks: EntityTable<TextBlock, 'id'>
  templates: EntityTable<Template, 'id'>
  pdfPrintouts: EntityTable<PdfPrintout, 'id'>
  pdfBlobs: EntityTable<PdfBlobCache, 'id'>
  projects: EntityTable<Project, 'id'>
  projectTasks: EntityTable<ProjectTask, 'id'>
  projectMilestones: EntityTable<ProjectMilestone, 'id'>
  projectSections: EntityTable<ProjectSection, 'id'>
  projectTaskAfns: EntityTable<ProjectTaskAfn, 'id'>
  projectTaskComments: EntityTable<ProjectTaskComment, 'id'>
  projectMembers: EntityTable<ProjectMember, 'id'>
  userProfiles: EntityTable<UserProfile, 'id'>
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

// Neue Tabellen fuer den dauerhaften PDF-Dateiausdruck (siehe db/types.ts PdfPrintout/
// PdfBlobCache): pdfPrintouts ist die synchronisierte Metadaten-Tabelle (analog zu allen
// anderen), pdfBlobs der rein lokale, nie synchronisierte Cache der Original-PDF-Bytes - beide
// in einem Versionsschritt, da beide brandneu sind.
db.version(5).stores({
  pdfPrintouts: 'id, pageId',
  pdfBlobs: 'id',
})

db.version(6).stores({
  projects: 'id, status, ownerUserId, updatedAt',
  projectTasks: 'id, projectId, assigneeUserId, status, dueDate, sortOrder, updatedAt',
  projectTaskAfns: 'id, taskId, afnNumber, updatedAt',
  userProfiles: 'id, email, updatedAt',
})

db.version(7).stores({
  projectTasks: 'id, projectId, milestoneId, assigneeUserId, status, dueDate, sortOrder, updatedAt',
  projectMilestones: 'id, projectId, status, dueDate, sortOrder, updatedAt',
})

db.version(8).stores({
  projectMembers: 'id, projectId, userId, [projectId+userId], role, updatedAt',
})

db.version(9).stores({
  projectTaskComments: 'id, taskId, authorUserId, createdAt, updatedAt',
})

db.version(10).stores({
  quickTasks: 'id, completed, updatedAt',
})

db.version(11).stores({
  projectTasks: 'id, projectId, milestoneId, sectionId, assigneeUserId, status, dueDate, sortOrder, updatedAt',
  projectSections: 'id, projectId, milestoneId, sortOrder, updatedAt',
})

export function newId(): string {
  return crypto.randomUUID()
}


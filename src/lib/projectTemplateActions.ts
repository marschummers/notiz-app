import { db, newId } from '../db/db'
import type {
  Project,
  ProjectMember,
  ProjectMilestone,
  ProjectSection,
  ProjectTask,
  ProjectTemplate,
  ProjectTemplateMilestone,
  ProjectTemplateSection,
  ProjectTemplateTask,
  ProjectTemplateVisibility,
} from '../db/types'

const MS_PER_DAY = 86400000

// Ganztaegige Differenz in Kalendertagen zwischen zwei Zeitpunkten - keine Zeitzonen-Feinarbeit,
// "volle Kalendertage reichen" (siehe Anforderung). Wird nur hier gebraucht, deshalb kein
// eigenes Shared-Modul.
function daysBetween(fromMs: number, toMs: number): number {
  return Math.round((toMs - fromMs) / MS_PER_DAY)
}

function addDays(baseMs: number, days: number): number {
  return baseMs + days * MS_PER_DAY
}

// Speichert ein bestehendes Projekt als unabhaengige Vorlage: Meilensteine, Themenbereiche und
// Aufgaben werden geklont (neue IDs, Fremdschluessel ueber Map umgebogen), aber OHNE Kunde, AFNs,
// Projektmitglieder, tatsaechlichen Status/Bearbeitungszustand oder Sync-Metadaten - eine Vorlage
// ist ein reiner Struktur-Schnappschuss. relativeDueDays wird nur abgeleitet, wenn das Projekt
// ein Startdatum UND der jeweilige Eintrag ein dueDate besitzt; sonst bleibt es undefined statt
// einen falschen Termin zu erfinden.
export async function createProjectTemplateFromProject(
  project: Project,
  milestones: ProjectMilestone[],
  sections: ProjectSection[],
  tasks: ProjectTask[],
  name: string,
  description: string | undefined,
  visibility: ProjectTemplateVisibility,
  createdByUserId: string,
): Promise<string> {
  const now = Date.now()
  const templateId = newId()

  // Pass 1: Meilensteine, Map alte ProjectMilestone.id -> neue ProjectTemplateMilestone.id.
  const milestoneIdMap = new Map<string, string>()
  const templateMilestones: ProjectTemplateMilestone[] = milestones
    .filter((m) => !m.deletedAt)
    .map((m) => {
      const id = newId()
      milestoneIdMap.set(m.id, id)
      return {
        id,
        templateId,
        title: m.title,
        description: m.description,
        relativeDueDays: project.startDate && m.dueDate ? daysBetween(project.startDate, m.dueDate) : undefined,
        sortOrder: m.sortOrder,
        createdAt: now,
        updatedAt: now,
      }
    })

  // Pass 2: Themenbereiche loesen milestoneId ueber milestoneIdMap auf.
  const sectionIdMap = new Map<string, string>()
  const templateSections: ProjectTemplateSection[] = sections
    .filter((s) => !s.deletedAt && milestoneIdMap.has(s.milestoneId))
    .map((s) => {
      const id = newId()
      sectionIdMap.set(s.id, id)
      return {
        id,
        templateId,
        milestoneTemplateId: milestoneIdMap.get(s.milestoneId)!,
        title: s.title,
        sortOrder: s.sortOrder,
        createdAt: now,
        updatedAt: now,
      }
    })

  // Pass 3: Aufgaben loesen beide Maps auf. milestoneTemplateId/sectionTemplateId bleiben
  // undefined, wenn die Aufgabe im Ursprungsprojekt keinen Meilenstein/Themenbereich hatte -
  // keine kuenstlichen Gruppen wie "Allgemein".
  const templateTasks: ProjectTemplateTask[] = tasks
    .filter((t) => !t.deletedAt)
    .map((t) => ({
      id: newId(),
      templateId,
      milestoneTemplateId: t.milestoneId ? milestoneIdMap.get(t.milestoneId) : undefined,
      sectionTemplateId: t.sectionId ? sectionIdMap.get(t.sectionId) : undefined,
      title: t.title,
      description: t.description,
      relativeDueDays: project.startDate && t.dueDate ? daysBetween(project.startDate, t.dueDate) : undefined,
      sortOrder: t.sortOrder,
      createdAt: now,
      updatedAt: now,
    }))

  const template: ProjectTemplate = {
    id: templateId,
    name: name.trim() || 'Neue Vorlage',
    description: description?.trim() || undefined,
    visibility,
    createdByUserId,
    createdAt: now,
    updatedAt: now,
  }

  await db.transaction(
    'rw',
    [db.projectTemplates, db.projectTemplateMilestones, db.projectTemplateSections, db.projectTemplateTasks],
    async () => {
      await db.projectTemplates.add(template)
      if (templateMilestones.length) await db.projectTemplateMilestones.bulkAdd(templateMilestones)
      if (templateSections.length) await db.projectTemplateSections.bulkAdd(templateSections)
      if (templateTasks.length) await db.projectTemplateTasks.bulkAdd(templateTasks)
    },
  )
  return templateId
}

export async function updateProjectTemplate(
  id: string,
  changes: Partial<Pick<ProjectTemplate, 'name' | 'description' | 'visibility'>>,
): Promise<void> {
  await db.projectTemplates.update(id, { ...changes, updatedAt: Date.now() })
}

export async function deleteProjectTemplate(id: string): Promise<void> {
  const now = Date.now()
  await db.transaction(
    'rw',
    [db.projectTemplates, db.projectTemplateMilestones, db.projectTemplateSections, db.projectTemplateTasks],
    async () => {
      const tasks = await db.projectTemplateTasks.where('templateId').equals(id).toArray()
      await Promise.all(tasks.map((t) => db.projectTemplateTasks.update(t.id, { deletedAt: now, updatedAt: now })))
      const sections = await db.projectTemplateSections.where('templateId').equals(id).toArray()
      await Promise.all(sections.map((s) => db.projectTemplateSections.update(s.id, { deletedAt: now, updatedAt: now })))
      const milestones = await db.projectTemplateMilestones.where('templateId').equals(id).toArray()
      await Promise.all(milestones.map((m) => db.projectTemplateMilestones.update(m.id, { deletedAt: now, updatedAt: now })))
      await db.projectTemplates.update(id, { deletedAt: now, updatedAt: now })
    },
  )
}

export interface CreateProjectFromTemplateInput {
  templateId: string
  customerName: string
  name?: string
  startDate?: number
  targetDate?: number
  ownerUserId: string
}

// Erzeugt ein vollstaendig unabhaengiges neues Projekt aus einer Vorlage: alle Meilensteine/
// Themenbereiche/Aufgaben werden mit frischen IDs geklont, keine Vorlagen-ID bleibt als
// Fremdschluessel erhalten. Der anlegende Benutzer wird Owner, Projektmitglied UND
// Standard-Verantwortlicher jeder erzeugten Aufgabe (siehe Anforderung: keine Rollenlogik,
// in der Praxis betreut ein Berater das Projekt meist allein - Umverteilung passiert spaeter
// manuell ueber die bestehende Team-/Verantwortlich-Funktion). Aufgaben/Meilensteine starten
// immer im normalen Anfangsstatus, nie in einem aus der Vorlage uebernommenen Zustand.
export async function createProjectFromTemplate(input: CreateProjectFromTemplateInput): Promise<string> {
  const { templateId, customerName, name, startDate, targetDate, ownerUserId } = input
  const now = Date.now()
  const projectId = newId()

  const template = await db.projectTemplates.get(templateId)
  const [templateMilestones, templateSections, templateTasks] = await Promise.all([
    db.projectTemplateMilestones
      .where('templateId')
      .equals(templateId)
      .filter((m) => !m.deletedAt)
      .toArray(),
    db.projectTemplateSections
      .where('templateId')
      .equals(templateId)
      .filter((s) => !s.deletedAt)
      .toArray(),
    db.projectTemplateTasks
      .where('templateId')
      .equals(templateId)
      .filter((t) => !t.deletedAt)
      .toArray(),
  ])

  // Pass 1: neue Meilenstein-IDs, Map alte ProjectTemplateMilestone.id -> neue ProjectMilestone.id.
  const milestoneIdMap = new Map<string, string>()
  const newMilestones: ProjectMilestone[] = templateMilestones.map((m) => {
    const id = newId()
    milestoneIdMap.set(m.id, id)
    return {
      id,
      projectId,
      title: m.title,
      description: m.description,
      dueDate: m.relativeDueDays !== undefined && startDate !== undefined ? addDays(startDate, m.relativeDueDays) : undefined,
      status: 'planned',
      sortOrder: m.sortOrder,
      createdAt: now,
      updatedAt: now,
    }
  })

  // Pass 2: Themenbereiche loesen milestoneTemplateId ueber milestoneIdMap auf.
  const sectionIdMap = new Map<string, string>()
  const newSections: ProjectSection[] = templateSections
    .filter((s) => milestoneIdMap.has(s.milestoneTemplateId))
    .map((s) => {
      const id = newId()
      sectionIdMap.set(s.id, id)
      return {
        id,
        projectId,
        milestoneId: milestoneIdMap.get(s.milestoneTemplateId)!,
        title: s.title,
        sortOrder: s.sortOrder,
        createdAt: now,
        updatedAt: now,
      }
    })

  // Pass 3: Aufgaben loesen beide Maps auf, Zuweisung immer an den anlegenden Benutzer.
  const newTasks: ProjectTask[] = templateTasks.map((t) => ({
    id: newId(),
    projectId,
    milestoneId: t.milestoneTemplateId ? milestoneIdMap.get(t.milestoneTemplateId) : undefined,
    sectionId: t.sectionTemplateId ? sectionIdMap.get(t.sectionTemplateId) : undefined,
    title: t.title,
    description: t.description,
    assigneeUserId: ownerUserId,
    status: 'open',
    dueDate: t.relativeDueDays !== undefined && startDate !== undefined ? addDays(startDate, t.relativeDueDays) : undefined,
    sortOrder: t.sortOrder,
    createdAt: now,
    updatedAt: now,
  }))

  const project: Project = {
    id: projectId,
    name: name?.trim() || template?.name || 'Neues Projekt',
    customerName: customerName.trim() || undefined,
    ownerUserId,
    status: 'active',
    startDate,
    targetDate,
    createdAt: now,
    updatedAt: now,
  }
  const ownerMember: ProjectMember = { id: newId(), projectId, userId: ownerUserId, role: 'owner', createdAt: now, updatedAt: now }

  await db.transaction(
    'rw',
    [db.projects, db.projectMembers, db.projectMilestones, db.projectSections, db.projectTasks],
    async () => {
      await db.projects.add(project)
      await db.projectMembers.add(ownerMember)
      if (newMilestones.length) await db.projectMilestones.bulkAdd(newMilestones)
      if (newSections.length) await db.projectSections.bulkAdd(newSections)
      if (newTasks.length) await db.projectTasks.bulkAdd(newTasks)
    },
  )
  return projectId
}

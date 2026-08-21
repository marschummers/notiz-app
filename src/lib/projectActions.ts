import { db, newId } from '../db/db'
import type { Project, ProjectTask, ProjectTaskAfn, ProjectTaskComment, ProjectMilestone, ProjectSection, ProjectMember, ProjectSectionDocument, ProjectSectionDocumentRevision } from '../db/types'

export async function createProject(input: Pick<Project, 'name' | 'ownerUserId'> & Partial<Project>): Promise<string> {
  const now = Date.now()
  const id = newId()
  await db.transaction('rw', db.projects, db.projectMembers, async () => {
    await db.projects.add({ ...input, id, name: input.name.trim() || 'Neues Projekt', status: input.status ?? 'active', createdAt: now, updatedAt: now })
    await db.projectMembers.add({ id: newId(), projectId: id, userId: input.ownerUserId, role: 'owner', createdAt: now, updatedAt: now })
  })
  return id
}

export async function updateProject(id: string, changes: Partial<Omit<Project, 'id' | 'createdAt'>>): Promise<void> {
  await db.projects.update(id, { ...changes, updatedAt: Date.now() })
}

export async function deleteProject(id: string): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', [db.projects, db.projectTasks, db.projectTaskAfns, db.projectTaskComments, db.projectMilestones, db.projectSections, db.projectSectionDocuments, db.projectSectionDocumentRevisions, db.projectMembers], async () => {
    const tasks = await db.projectTasks.where('projectId').equals(id).toArray()
    for (const task of tasks) {
      const afns = await db.projectTaskAfns.where('taskId').equals(task.id).toArray()
      const comments = await db.projectTaskComments.where('taskId').equals(task.id).toArray()
      await Promise.all(afns.map((afn) => db.projectTaskAfns.update(afn.id, { deletedAt: now, updatedAt: now })))
      await Promise.all(comments.map((comment) => db.projectTaskComments.update(comment.id, { deletedAt: now, updatedAt: now })))
      await db.projectTasks.update(task.id, { deletedAt: now, updatedAt: now })
    }
    const milestones = await db.projectMilestones.where('projectId').equals(id).toArray()
    await Promise.all(milestones.map((milestone) => db.projectMilestones.update(milestone.id, { deletedAt: now, updatedAt: now })))
    const sections = await db.projectSections.where('projectId').equals(id).toArray()
    await Promise.all(sections.map((section) => db.projectSections.update(section.id, { deletedAt: now, updatedAt: now })))
    const documents = await db.projectSectionDocuments.where('projectId').equals(id).toArray()
    await Promise.all(documents.map((document) => db.projectSectionDocuments.update(document.id, { deletedAt: now, updatedAt: now })))
    const revisions = await db.projectSectionDocumentRevisions.where('projectId').equals(id).toArray()
    await Promise.all(revisions.map((revision) => db.projectSectionDocumentRevisions.update(revision.id, { deletedAt: now, updatedAt: now })))
    const members = await db.projectMembers.where('projectId').equals(id).toArray()
    await Promise.all(members.map((member) => db.projectMembers.update(member.id, { deletedAt: now, updatedAt: now })))
    await db.projects.update(id, { deletedAt: now, updatedAt: now })
  })
}

export async function createProjectMilestone(projectId: string, title: string): Promise<string> {
  const now = Date.now()
  const id = newId()
  const last = await db.projectMilestones.where('projectId').equals(projectId).sortBy('sortOrder')
  await db.projectMilestones.add({ id, projectId, title: title.trim() || 'Neuer Meilenstein', status: 'planned', sortOrder: (last.at(-1)?.sortOrder ?? 0) + 1, createdAt: now, updatedAt: now })
  return id
}

export async function updateProjectMilestone(id: string, changes: Partial<Omit<ProjectMilestone, 'id' | 'projectId' | 'createdAt'>>): Promise<void> {
  await db.projectMilestones.update(id, { ...changes, updatedAt: Date.now() })
}

export async function deleteProjectMilestone(id: string): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.projectMilestones, db.projectSections, db.projectSectionDocuments, db.projectSectionDocumentRevisions, db.projectTasks, async () => {
    const tasks = await db.projectTasks.where('milestoneId').equals(id).toArray()
    await Promise.all(tasks.map((task) => db.projectTasks.update(task.id, { milestoneId: undefined, sectionId: undefined, updatedAt: now })))
    const sections = await db.projectSections.where('milestoneId').equals(id).toArray()
    await Promise.all(sections.map((section) => db.projectSections.update(section.id, { deletedAt: now, updatedAt: now })))
    const sectionIds = new Set(sections.map((section) => section.id))
    const documents = await db.projectSectionDocuments.filter((document) => sectionIds.has(document.sectionId)).toArray()
    const revisions = await db.projectSectionDocumentRevisions.filter((revision) => sectionIds.has(revision.sectionId)).toArray()
    await Promise.all(documents.map((document) => db.projectSectionDocuments.update(document.id, { deletedAt: now, updatedAt: now })))
    await Promise.all(revisions.map((revision) => db.projectSectionDocumentRevisions.update(revision.id, { deletedAt: now, updatedAt: now })))
    await db.projectMilestones.update(id, { deletedAt: now, updatedAt: now })
  })
}

export async function moveProjectMilestone(id: string, direction: -1 | 1): Promise<void> {
  const current = await db.projectMilestones.get(id)
  if (!current) return
  const siblings = (await db.projectMilestones.where('projectId').equals(current.projectId).toArray()).filter((item) => !item.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder)
  const index = siblings.findIndex((item) => item.id === id)
  const other = siblings[index + direction]
  if (!other) return
  const now = Date.now()
  await db.transaction('rw', db.projectMilestones, async () => {
    await db.projectMilestones.update(current.id, { sortOrder: other.sortOrder, updatedAt: now })
    await db.projectMilestones.update(other.id, { sortOrder: current.sortOrder, updatedAt: now })
  })
}

export async function createProjectSection(projectId: string, milestoneId: string, title: string): Promise<string> {
  const now = Date.now()
  const id = newId()
  const siblings = await db.projectSections.where('milestoneId').equals(milestoneId).toArray()
  const section: ProjectSection = {
    id,
    projectId,
    milestoneId,
    title: title.trim() || 'Neuer Themenbereich',
    sortOrder: Math.max(0, ...siblings.map((item) => item.sortOrder)) + 1,
    createdAt: now,
    updatedAt: now,
  }
  await db.projectSections.add(section)
  return id
}

export async function updateProjectSection(id: string, title: string): Promise<void> {
  await db.projectSections.update(id, { title: title.trim() || 'Themenbereich', updatedAt: Date.now() })
}

export async function deleteProjectSection(id: string): Promise<void> {
  const now = Date.now()
  const tasks = await db.projectTasks.where('sectionId').equals(id).toArray()
  const documents = await db.projectSectionDocuments.where('sectionId').equals(id).toArray()
  const revisions = await db.projectSectionDocumentRevisions.where('sectionId').equals(id).toArray()
  await db.transaction('rw', db.projectSections, db.projectTasks, db.projectSectionDocuments, db.projectSectionDocumentRevisions, async () => {
    await Promise.all(tasks.map((task) => db.projectTasks.update(task.id, { sectionId: undefined, updatedAt: now })))
    await Promise.all(documents.map((document) => db.projectSectionDocuments.update(document.id, { deletedAt: now, updatedAt: now })))
    await Promise.all(revisions.map((revision) => db.projectSectionDocumentRevisions.update(revision.id, { deletedAt: now, updatedAt: now })))
    await db.projectSections.update(id, { deletedAt: now, updatedAt: now })
  })
}

export async function saveProjectSectionDocument(input: {
  projectId: string
  sectionId: string
  content: string
  userId: string
  documentChange: boolean
  reason?: string
}): Promise<void> {
  const content = input.content.trim()
  const now = Date.now()
  const existing = (await db.projectSectionDocuments.where('sectionId').equals(input.sectionId).toArray())
    .find((document) => !document.deletedAt)
  if (existing?.content === content) return

  await db.transaction('rw', db.projectSectionDocuments, db.projectSectionDocumentRevisions, async () => {
    const documentId = existing?.id ?? newId()
    if (existing) {
      await db.projectSectionDocuments.update(existing.id, {
        content,
        updatedByUserId: input.userId,
        updatedAt: now,
      })
    } else {
      const document: ProjectSectionDocument = {
        id: documentId,
        projectId: input.projectId,
        sectionId: input.sectionId,
        content,
        updatedByUserId: input.userId,
        createdAt: now,
        updatedAt: now,
      }
      await db.projectSectionDocuments.add(document)
    }

    if (input.documentChange) {
      const revision: ProjectSectionDocumentRevision = {
        id: newId(),
        documentId,
        projectId: input.projectId,
        sectionId: input.sectionId,
        previousContent: existing?.content ?? '',
        content,
        reason: input.reason?.trim() || undefined,
        changedByUserId: input.userId,
        createdAt: now,
        updatedAt: now,
      }
      await db.projectSectionDocumentRevisions.add(revision)
    }
  })
}

export async function createProjectTask(projectId: string, title: string, assigneeUserId?: string): Promise<string> {
  const now = Date.now()
  const id = newId()
  await db.projectTasks.add({ id, projectId, title: title.trim() || 'Neue Aufgabe', assigneeUserId, status: 'open', sortOrder: now, createdAt: now, updatedAt: now })
  return id
}

export async function updateProjectTask(id: string, changes: Partial<Omit<ProjectTask, 'id' | 'projectId' | 'createdAt'>>): Promise<void> {
  const normalized = changes.status && changes.status !== 'waiting' ? { ...changes, waitingFor: undefined } : changes
  await db.projectTasks.update(id, { ...normalized, updatedAt: Date.now() })
}

export async function moveProjectTask(id: string, milestoneId?: string, sectionId?: string, beforeTaskId?: string): Promise<void> {
  if (beforeTaskId === id) return
  const current = await db.projectTasks.get(id)
  if (!current || current.deletedAt) return
  const siblings = (await db.projectTasks.where('projectId').equals(current.projectId).toArray())
    .filter((task) => task.id !== id && !task.deletedAt && task.milestoneId === milestoneId && task.sectionId === sectionId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const requestedIndex = beforeTaskId ? siblings.findIndex((task) => task.id === beforeTaskId) : siblings.length
  const targetIndex = requestedIndex < 0 ? siblings.length : requestedIndex
  const ordered = [...siblings]
  ordered.splice(targetIndex, 0, current)
  const now = Date.now()

  await db.transaction('rw', db.projectTasks, async () => {
    for (let index = 0; index < ordered.length; index += 1) {
      const task = ordered[index]
      const groupChanged = task.id === id && (task.milestoneId !== milestoneId || task.sectionId !== sectionId)
      if (task.sortOrder !== index + 1 || groupChanged) {
        await db.projectTasks.update(task.id, {
          sortOrder: index + 1,
          milestoneId: task.id === id ? milestoneId : task.milestoneId,
          sectionId: task.id === id ? sectionId : task.sectionId,
          updatedAt: now,
        })
      }
    }
  })
}

export async function deleteProjectTask(id: string): Promise<void> {
  const now = Date.now()
  const afns = await db.projectTaskAfns.where('taskId').equals(id).toArray()
  const comments = await db.projectTaskComments.where('taskId').equals(id).toArray()
  await Promise.all(afns.map((afn) => db.projectTaskAfns.update(afn.id, { deletedAt: now, updatedAt: now })))
  await Promise.all(comments.map((comment) => db.projectTaskComments.update(comment.id, { deletedAt: now, updatedAt: now })))
  await db.projectTasks.update(id, { deletedAt: now, updatedAt: now })
}

export async function replaceProjectTaskAfns(taskId: string, numbers: number[]): Promise<void> {
  const now = Date.now()
  const valid = [...new Set(numbers.filter((n) => Number.isInteger(n) && n > 0))]
  const existing = await db.projectTaskAfns.where('taskId').equals(taskId).toArray()
  for (const row of existing) await db.projectTaskAfns.update(row.id, { deletedAt: valid.includes(row.afnNumber) ? undefined : now, updatedAt: now })
  for (const afnNumber of valid) {
    const row = existing.find((item) => item.afnNumber === afnNumber)
    if (row) await db.projectTaskAfns.update(row.id, { deletedAt: undefined, updatedAt: now })
    else {
      const value: ProjectTaskAfn = { id: newId(), taskId, afnNumber, updatedAt: now }
      await db.projectTaskAfns.add(value)
    }
  }
}

export async function createProjectTaskComment(taskId: string, authorUserId: string, body: string): Promise<string> {
  const text = body.trim()
  if (!text) throw new Error('Der Kommentar darf nicht leer sein.')
  const now = Date.now()
  const comment: ProjectTaskComment = { id: newId(), taskId, authorUserId, body: text, createdAt: now, updatedAt: now }
  await db.projectTaskComments.add(comment)
  return comment.id
}

export async function setProjectTeam(projectId: string, ownerUserId: string, userIds: string[]): Promise<void> {
  const now = Date.now()
  const wanted = new Set([ownerUserId, ...userIds])
  const existing = await db.projectMembers.where('projectId').equals(projectId).toArray()
  await db.transaction('rw', db.projects, db.projectMembers, async () => {
    await db.projects.update(projectId, { ownerUserId, updatedAt: now })
    for (const row of existing) {
      if (!wanted.has(row.userId)) await db.projectMembers.update(row.id, { deletedAt: now, updatedAt: now })
      else await db.projectMembers.update(row.id, { role: row.userId === ownerUserId ? 'owner' : 'member', deletedAt: undefined, updatedAt: now })
    }
    for (const userId of wanted) {
      if (!existing.some((row) => row.userId === userId)) {
        const row: ProjectMember = { id: newId(), projectId, userId, role: userId === ownerUserId ? 'owner' : 'member', createdAt: now, updatedAt: now }
        await db.projectMembers.add(row)
      }
    }
  })
}


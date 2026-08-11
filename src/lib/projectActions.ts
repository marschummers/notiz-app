import { db, newId } from '../db/db'
import type { Project, ProjectTask, ProjectTaskAfn, ProjectMilestone } from '../db/types'

export async function createProject(input: Pick<Project, 'name' | 'ownerUserId'> & Partial<Project>): Promise<string> {
  const now = Date.now()
  const id = newId()
  await db.projects.add({ ...input, id, name: input.name.trim() || 'Neues Projekt', status: input.status ?? 'active', createdAt: now, updatedAt: now })
  return id
}

export async function updateProject(id: string, changes: Partial<Omit<Project, 'id' | 'createdAt'>>): Promise<void> {
  await db.projects.update(id, { ...changes, updatedAt: Date.now() })
}

export async function deleteProject(id: string): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.projects, db.projectTasks, db.projectTaskAfns, db.projectMilestones, async () => {
    const tasks = await db.projectTasks.where('projectId').equals(id).toArray()
    for (const task of tasks) {
      const afns = await db.projectTaskAfns.where('taskId').equals(task.id).toArray()
      await Promise.all(afns.map((afn) => db.projectTaskAfns.update(afn.id, { deletedAt: now, updatedAt: now })))
      await db.projectTasks.update(task.id, { deletedAt: now, updatedAt: now })
    }
    const milestones = await db.projectMilestones.where('projectId').equals(id).toArray()
    await Promise.all(milestones.map((milestone) => db.projectMilestones.update(milestone.id, { deletedAt: now, updatedAt: now })))
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
  await db.transaction('rw', db.projectMilestones, db.projectTasks, async () => {
    const tasks = await db.projectTasks.where('milestoneId').equals(id).toArray()
    await Promise.all(tasks.map((task) => db.projectTasks.update(task.id, { milestoneId: undefined, updatedAt: now })))
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

export async function deleteProjectTask(id: string): Promise<void> {
  const now = Date.now()
  const afns = await db.projectTaskAfns.where('taskId').equals(id).toArray()
  await Promise.all(afns.map((afn) => db.projectTaskAfns.update(afn.id, { deletedAt: now, updatedAt: now })))
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


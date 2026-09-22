import { db, newId } from '../db/db'

export async function createQuickTask(text: string): Promise<string | undefined> {
  const trimmed = text.trim()
  if (!trimmed) return undefined

  const id = newId()
  const now = Date.now()
  await db.quickTasks.add({
    id,
    text: trimmed,
    completed: false,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

export async function toggleQuickTask(id: string, completed: boolean): Promise<void> {
  await db.quickTasks.update(id, { completed, updatedAt: Date.now() })
}

export async function updateQuickTaskText(id: string, text: string): Promise<boolean> {
  const trimmed = text.trim()
  if (!trimmed) return false
  await db.quickTasks.update(id, { text: trimmed, updatedAt: Date.now() })
  return true
}

export async function deleteExpiredCompletedQuickTasks(now = Date.now()): Promise<void> {
  const cutoff = new Date(now)
  cutoff.setMonth(cutoff.getMonth() - 1)
  const expired = await db.quickTasks
    .filter((task) => !task.deletedAt && task.completed && task.updatedAt < cutoff.getTime())
    .toArray()

  if (expired.length === 0) return
  await db.quickTasks.bulkUpdate(expired.map((task) => ({
    key: task.id,
    changes: { deletedAt: now, updatedAt: now },
  })))
}

export async function deleteQuickTask(id: string): Promise<void> {
  const now = Date.now()
  await db.quickTasks.update(id, { deletedAt: now, updatedAt: now })
}

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

export async function deleteQuickTask(id: string): Promise<void> {
  const now = Date.now()
  await db.quickTasks.update(id, { deletedAt: now, updatedAt: now })
}

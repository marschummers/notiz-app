import { db } from '../db/db'
import type { ProjectMemberRole, ProjectMilestoneStatus, ProjectStatus, ProjectTaskStatus, ProjectWaitingFor } from '../db/types'
import { supabase } from './supabaseClient'

type Row = Record<string, unknown>
const time = (value: unknown) => value ? new Date(String(value)).getTime() : undefined

async function applyProjectRow(table: string, row: Row) {
  if (!row.id) return
  if (table === 'notiz_projects') await db.projects.put({
    id: String(row.id), name: String(row.name ?? ''), customerName: row.customer_name ? String(row.customer_name) : undefined,
    ownerUserId: String(row.owner_user_id), status: row.status as ProjectStatus,
    startDate: time(row.start_date), targetDate: time(row.target_date), description: row.description ? String(row.description) : undefined,
    createdAt: time(row.created_at) ?? Date.now(), updatedAt: time(row.updated_at) ?? Date.now(), deletedAt: time(row.deleted_at),
  })
  if (table === 'notiz_project_members') await db.projectMembers.put({
    id: String(row.id), projectId: String(row.project_id), userId: String(row.user_id), role: row.role as ProjectMemberRole,
    createdAt: time(row.created_at) ?? Date.now(), updatedAt: time(row.updated_at) ?? Date.now(), deletedAt: time(row.deleted_at),
  })
  if (table === 'notiz_project_milestones') await db.projectMilestones.put({
    id: String(row.id), projectId: String(row.project_id), title: String(row.title ?? ''), description: row.description ? String(row.description) : undefined,
    dueDate: time(row.due_date), status: row.status as ProjectMilestoneStatus, sortOrder: Number(row.sort_order),
    createdAt: time(row.created_at) ?? Date.now(), updatedAt: time(row.updated_at) ?? Date.now(), deletedAt: time(row.deleted_at),
  })
  if (table === 'notiz_project_tasks') await db.projectTasks.put({
    id: String(row.id), projectId: String(row.project_id), milestoneId: row.milestone_id ? String(row.milestone_id) : undefined,
    title: String(row.title ?? ''), description: row.description ? String(row.description) : undefined,
    assigneeUserId: row.assignee_user_id ? String(row.assignee_user_id) : undefined, status: row.status as ProjectTaskStatus,
    dueDate: time(row.due_date), waitingFor: (row.waiting_for || undefined) as ProjectWaitingFor | undefined,
    sortOrder: Number(row.sort_order), createdAt: time(row.created_at) ?? Date.now(), updatedAt: time(row.updated_at) ?? Date.now(), deletedAt: time(row.deleted_at),
  })
  if (table === 'notiz_project_task_afns') await db.projectTaskAfns.put({
    id: String(row.id), taskId: String(row.task_id), afnNumber: Number(row.afn_number),
    updatedAt: time(row.updated_at) ?? Date.now(), deletedAt: time(row.deleted_at),
  })
  if (table === 'notiz_project_task_comments') await db.projectTaskComments.put({
    id: String(row.id), taskId: String(row.task_id), authorUserId: String(row.author_user_id), body: String(row.body ?? ''),
    createdAt: time(row.created_at) ?? Date.now(), updatedAt: time(row.updated_at) ?? Date.now(), deletedAt: time(row.deleted_at),
  })
}

export function subscribeProjectRealtime() {
  if (!supabase) return () => undefined
  const client = supabase
  const tables = ['notiz_projects', 'notiz_project_members', 'notiz_project_tasks', 'notiz_project_milestones', 'notiz_project_task_afns', 'notiz_project_task_comments']
  let channel = client.channel('notiz-project-realtime')
  for (const table of tables) {
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      const row = (payload.new && Object.keys(payload.new).length ? payload.new : payload.old) as Row
      void applyProjectRow(table, row)
    })
  }
  channel.subscribe()
  return () => { void client.removeChannel(channel) }
}

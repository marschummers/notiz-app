import type { ProjectStatus } from '../db/types'

export type ProjectNavigation =
  | { type: 'overview' }
  | { type: 'project'; id: string }
  | { type: 'customer'; name: string }
  | { type: 'status'; status: Extract<ProjectStatus, 'completed' | 'archived'> }

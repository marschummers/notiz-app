import type { KeyboardEvent, MouseEvent } from 'react'
import type { ProjectTask } from '../db/types'
import { updateProjectTask } from '../lib/projectActions'
import './ProjectTaskStatus.css'

const labels = {
  open: 'Offen',
  in_progress: 'In Arbeit',
  waiting: 'Wartet',
  completed: 'Erledigt',
} as const

function nextStatus(status: ProjectTask['status']): ProjectTask['status'] {
  if (status === 'open') return 'in_progress'
  if (status === 'in_progress') return 'completed'
  return status === 'completed' ? 'open' : 'in_progress'
}

async function advanceTaskStatus(task: ProjectTask): Promise<void> {
  const next = nextStatus(task.status)
  if (task.status === 'waiting' && !window.confirm(
    `„${task.title}“ wartet aktuell auf „${task.waitingFor ?? 'eine Rückmeldung'}“.\n\nStatus wirklich auf „In Arbeit“ setzen? Die Angabe „Wartet auf“ wird dabei entfernt.`,
  )) return
  await updateProjectTask(task.id, { status: next })
}

export default function ProjectTaskStatus({ task, compact = false }: { task: ProjectTask; compact?: boolean }) {
  const next = nextStatus(task.status)
  const activate = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault()
    event.stopPropagation()
    void advanceTaskStatus(task)
  }

  return <span
    className={`project-status-badge project-task-status status-${task.status}${compact ? ' compact' : ''}`}
    role="button"
    tabIndex={0}
    title={`Status ändern: ${labels[task.status]} → ${labels[next]}`}
    aria-label={`${task.title}: Status ${labels[task.status]}. Auf ${labels[next]} setzen`}
    onClick={activate}
    onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') activate(event)
    }}
  >{labels[task.status]}</span>
}

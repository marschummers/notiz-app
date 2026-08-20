import { useState, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { toggleTask } from '../lib/actions'
import { createQuickTask, deleteQuickTask, toggleQuickTask } from '../lib/quickTaskActions'
import { updateProjectTask } from '../lib/projectActions'
import { projectDisplayName } from '../lib/projectDisplay'
import type { ProjectTask, QuickTask, Task } from '../db/types'
import './TasksView.css'

interface Props {
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onOpenPage: (pageId: string) => void
  onOpenProject: (projectId: string, taskId: string) => void
}

export default function TasksView({ sidebarOpen, onToggleSidebar, onOpenPage, onOpenProject }: Props) {
  const [draft, setDraft] = useState('')
  const tasks = useLiveQuery(() => db.tasks.filter((task) => !task.deletedAt).toArray(), [])
  const quickTasks = useLiveQuery(() => db.quickTasks.filter((task) => !task.deletedAt).toArray(), [])
  const projectTasks = useLiveQuery(() => db.projectTasks.filter((task) => !task.deletedAt && !task.milestoneId).toArray(), [])
  const projects = useLiveQuery(() => db.projects.filter((project) => !project.deletedAt).toArray(), [])
  const pages = useLiveQuery(() => db.pages.toArray(), [])

  const pageTitleById = new Map((pages ?? []).map((page) => [page.id, page.title || 'Ohne Titel']))
  const projectById = new Map((projects ?? []).map((project) => [project.id, project]))
  const allTasks = [
    ...(tasks ?? []).map((task) => ({ kind: 'page' as const, task })),
    ...(quickTasks ?? []).map((task) => ({ kind: 'quick' as const, task })),
    ...(projectTasks ?? []).map((task) => ({ kind: 'project' as const, task })),
  ]
  const isCompleted = (item: (typeof allTasks)[number]) => item.kind === 'project' ? item.task.status === 'completed' : item.task.completed
  const open = allTasks.filter((item) => !isCompleted(item)).sort((a, b) => b.task.updatedAt - a.task.updatedAt)
  const done = allTasks.filter(isCompleted).sort((a, b) => b.task.updatedAt - a.task.updatedAt)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (await createQuickTask(draft)) setDraft('')
  }

  function renderPageTask(task: Task) {
    return (
      <div key={'page-' + task.id} className="central-task-row" onClick={() => onOpenPage(task.pageId)}>
        <input
          type="checkbox"
          checked={task.completed}
          onClick={(event) => event.stopPropagation()}
          onChange={() => toggleTask(task.id, !task.completed)}
          aria-label={task.completed ? 'Aufgabe wieder öffnen' : 'Aufgabe erledigen'}
        />
        <div className="central-task-text">
          <div className={task.completed ? 'central-task-title completed' : 'central-task-title'}>{task.text || 'Ohne Text'}</div>
          <div className="central-task-source">Notiz · {pageTitleById.get(task.pageId) ?? '…'}</div>
        </div>
      </div>
    )
  }

  function renderQuickTask(task: QuickTask) {
    return (
      <div key={'quick-' + task.id} className="central-task-row quick-task-row">
        <input
          type="checkbox"
          checked={task.completed}
          onChange={() => toggleQuickTask(task.id, !task.completed)}
          aria-label={task.completed ? 'Aufgabe wieder öffnen' : 'Aufgabe erledigen'}
        />
        <div className="central-task-text">
          <div className={task.completed ? 'central-task-title completed' : 'central-task-title'}>{task.text}</div>
          <div className="central-task-source">Spontan</div>
        </div>
        <button
          type="button"
          className="quick-task-delete"
          onClick={() => deleteQuickTask(task.id)}
          aria-label={'Aufgabe „' + task.text + '“ löschen'}
          title="Aufgabe löschen"
        >
          ×
        </button>
      </div>
    )
  }

  function renderProjectTask(task: ProjectTask) {
    const completed = task.status === 'completed'
    const project = projectById.get(task.projectId)
    return (
      <div key={'project-' + task.id} className="central-task-row" onClick={() => onOpenProject(task.projectId, task.id)}>
        <input
          type="checkbox"
          checked={completed}
          onClick={(event) => event.stopPropagation()}
          onChange={() => updateProjectTask(task.id, { status: completed ? 'open' : 'completed' })}
          aria-label={completed ? 'Aufgabe wieder öffnen' : 'Aufgabe erledigen'}
        />
        <div className="central-task-text">
          <div className={completed ? 'central-task-title completed' : 'central-task-title'}>{task.title}</div>
          <div className="central-task-source">Projekt · {project ? projectDisplayName(project) : 'Unbekanntes Projekt'}</div>
        </div>
      </div>
    )
  }

  const renderTask = ({ kind, task }: (typeof allTasks)[number]) =>
    kind === 'page' ? renderPageTask(task) : kind === 'quick' ? renderQuickTask(task) : renderProjectTask(task)

  return (
    <div className="tasks-view">
      <div className="mobile-header-row">
        {!sidebarOpen && <button className="dashboard-sidebar-toggle" onClick={onToggleSidebar} aria-label="Seitenleiste öffnen">☰</button>}
        <h1>Aufgaben</h1>
      </div>
      <form className="quick-task-form" onSubmit={handleSubmit}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Spontane Aufgabe eingeben …"
          aria-label="Neue spontane Aufgabe"
        />
        <button type="submit" disabled={!draft.trim()}>Hinzufügen</button>
      </form>
      <h2>Offen</h2>
      {open.length === 0 && <p className="tasks-hint">Keine offenen Aufgaben.</p>}
      <div className="task-list">{open.map(renderTask)}</div>
      <h2>Erledigt</h2>
      {done.length === 0 && <p className="tasks-hint">Noch nichts erledigt.</p>}
      <div className="task-list">{done.map(renderTask)}</div>
    </div>
  )
}

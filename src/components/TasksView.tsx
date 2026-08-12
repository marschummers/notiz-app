import { useState, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { toggleTask } from '../lib/actions'
import { createQuickTask, deleteQuickTask, toggleQuickTask } from '../lib/quickTaskActions'
import type { QuickTask, Task } from '../db/types'
import './TasksView.css'

interface Props {
  onOpenPage: (pageId: string) => void
}

export default function TasksView({ onOpenPage }: Props) {
  const [draft, setDraft] = useState('')
  const tasks = useLiveQuery(() => db.tasks.filter((task) => !task.deletedAt).toArray(), [])
  const quickTasks = useLiveQuery(() => db.quickTasks.filter((task) => !task.deletedAt).toArray(), [])
  const pages = useLiveQuery(() => db.pages.toArray(), [])

  const pageTitleById = new Map((pages ?? []).map((page) => [page.id, page.title || 'Ohne Titel']))
  const allTasks = [
    ...(tasks ?? []).map((task) => ({ kind: 'page' as const, task })),
    ...(quickTasks ?? []).map((task) => ({ kind: 'quick' as const, task })),
  ]
  const open = allTasks.filter(({ task }) => !task.completed).sort((a, b) => b.task.updatedAt - a.task.updatedAt)
  const done = allTasks.filter(({ task }) => task.completed).sort((a, b) => b.task.updatedAt - a.task.updatedAt)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (await createQuickTask(draft)) setDraft('')
  }

  function renderPageTask(task: Task) {
    return (
      <div key={'page-' + task.id} className="task-row" onClick={() => onOpenPage(task.pageId)}>
        <input
          type="checkbox"
          checked={task.completed}
          onClick={(event) => event.stopPropagation()}
          onChange={() => toggleTask(task.id, !task.completed)}
          aria-label={task.completed ? 'Aufgabe wieder öffnen' : 'Aufgabe erledigen'}
        />
        <div className="task-row-text">
          <div className={task.completed ? 'task-row-title completed' : 'task-row-title'}>{task.text || 'Ohne Text'}</div>
          <div className="task-row-page">{pageTitleById.get(task.pageId) ?? '…'}</div>
        </div>
      </div>
    )
  }

  function renderQuickTask(task: QuickTask) {
    return (
      <div key={'quick-' + task.id} className="task-row quick-task-row">
        <input
          type="checkbox"
          checked={task.completed}
          onChange={() => toggleQuickTask(task.id, !task.completed)}
          aria-label={task.completed ? 'Aufgabe wieder öffnen' : 'Aufgabe erledigen'}
        />
        <div className="task-row-text">
          <div className={task.completed ? 'task-row-title completed' : 'task-row-title'}>{task.text}</div>
          <div className="task-row-page">Spontan</div>
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

  const renderTask = ({ kind, task }: (typeof allTasks)[number]) =>
    kind === 'page' ? renderPageTask(task) : renderQuickTask(task)

  return (
    <div className="tasks-view">
      <h1>Aufgaben</h1>
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

import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { toggleTask } from '../lib/actions'
import type { Task } from '../db/types'
import './TasksView.css'

interface Props {
  onOpenPage: (pageId: string) => void
}

export default function TasksView({ onOpenPage }: Props) {
  const tasks = useLiveQuery(() => db.tasks.filter((t) => !t.deletedAt).toArray(), [])
  const pages = useLiveQuery(() => db.pages.toArray(), [])

  const pageTitleById = new Map((pages ?? []).map((p) => [p.id, p.title || 'Ohne Titel']))
  const open = (tasks ?? []).filter((t) => !t.completed).sort((a, b) => b.updatedAt - a.updatedAt)
  const done = (tasks ?? []).filter((t) => t.completed).sort((a, b) => b.updatedAt - a.updatedAt)

  function renderTask(t: Task) {
    return (
      <div key={t.id} className="task-row" onClick={() => onOpenPage(t.pageId)}>
        <input
          type="checkbox"
          checked={t.completed}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            e.stopPropagation()
            toggleTask(t.id, !t.completed)
          }}
        />
        <div className="task-row-text">
          <div className={t.completed ? 'task-row-title completed' : 'task-row-title'}>{t.text || 'Ohne Text'}</div>
          <div className="task-row-page">{pageTitleById.get(t.pageId) ?? '…'}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="tasks-view">
      <h1>Aufgaben</h1>
      <h2>Offen</h2>
      {open.length === 0 && <p className="tasks-hint">Keine offenen Aufgaben.</p>}
      <div className="task-list">{open.map(renderTask)}</div>
      <h2>Erledigt</h2>
      {done.length === 0 && <p className="tasks-hint">Noch nichts erledigt.</p>}
      <div className="task-list">{done.map(renderTask)}</div>
    </div>
  )
}

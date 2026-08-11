import { useLiveQuery } from 'dexie-react-hooks'
import type { ReactNode } from 'react'
import { db } from '../db/db'
import type { Page, Project, ProjectTask, Task } from '../db/types'
import { createPage, toggleTask } from '../lib/actions'
import { formatRelativeTime } from '../lib/format'
import { getPagePropertyValue } from '../lib/propertyDefinitions'
import './Dashboard.css'

interface Props {
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onOpenPage: (pageId: string) => void
  onOpenSearch: () => void
  onOpenAllNotes: () => void
  onOpenTasks: () => void
  onOpenProjects: () => void
  userId: string
}

function DashboardSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="dashboard-section">
      <div className="dashboard-section-heading">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function QuickActions({ onNewPage, onSearch, onAllNotes, onTasks, onProjects }: {
  onNewPage: () => void
  onSearch: () => void
  onAllNotes: () => void
  onTasks: () => void
  onProjects: () => void
}) {
  return (
    <div className="dashboard-quick-actions" aria-label="Schnellaktionen">
      <button className="primary" onClick={onNewPage}>＋ Neue Seite</button>
      <button onClick={onSearch}>⌕ Suche</button>
      <button onClick={onAllNotes}>Alle Notizen</button>
      <button onClick={onTasks}>Aufgaben</button>
      <button onClick={onProjects}>Projekte</button>
    </div>
  )
}

function ProjectSection({ projects, tasks, userId, onOpenProjects }: { projects: Project[]; tasks: ProjectTask[]; userId: string; onOpenProjects: () => void }) {
  const activeProjects = projects.filter((project) => project.status === 'active' || project.status === 'waiting')
  const myTasks = tasks.filter((task) => task.assigneeUserId === userId && task.status !== 'completed')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const visibleTasks = [...myTasks].sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity)).slice(0, 5)
  const projectById = new Map(projects.map((project) => [project.id, project]))

  return <DashboardSection title="Projekte" action={<button className="dashboard-text-action" onClick={onOpenProjects}>Projektbereich öffnen</button>}>
    <div className="dashboard-project-metrics">
      <DashboardMetric value={activeProjects.length} label="Aktiv" />
      <DashboardMetric value={myTasks.length} label="Meine Aufgaben" />
      <DashboardMetric value={myTasks.filter((task) => task.status === 'waiting').length} label="Wartet" />
      <DashboardMetric value={myTasks.filter((task) => task.dueDate && task.dueDate < today.getTime()).length} label="Überfällig" />
    </div>
    <div className="dashboard-project-columns">
      <div><h3>Meine Projektaufgaben</h3>{visibleTasks.length === 0 ? <p className="dashboard-empty">Keine offenen Projektaufgaben.</p> : visibleTasks.map((task) => {
        const project = projectById.get(task.projectId)
        return <button className="dashboard-project-task" key={task.id} onClick={onOpenProjects}>
          <span className="dashboard-project-task-main">{project?.customerName && <small>[{project.customerName}]</small>}<strong>{task.title}</strong></span>
          <span className="dashboard-project-task-meta">{project?.name || 'Unbekanntes Projekt'} · {task.dueDate ? new Date(task.dueDate).toLocaleDateString('de-DE') : 'ohne Termin'}</span>
        </button>
      })}</div>
      <div><h3>Aktive Projekte</h3>{activeProjects.length === 0 ? <p className="dashboard-empty">Keine aktiven Projekte.</p> : activeProjects.slice(0, 5).map((project) => <button className="dashboard-active-project" key={project.id} onClick={onOpenProjects}><span><strong>{project.name}</strong>{project.customerName && <small>{project.customerName}</small>}</span><span>{project.status === 'waiting' ? 'Wartet' : 'Aktiv'}</span></button>)}</div>
    </div>
  </DashboardSection>
}

function DashboardMetric({ value, label }: { value: number; label: string }) {
  return <div><strong>{value}</strong><span>{label}</span></div>
}

function OpenTasksSection({ tasks, pageById, onOpenPage, onOpenTasks }: {
  tasks: Task[]
  pageById: Map<string, Page>
  onOpenPage: (pageId: string) => void
  onOpenTasks: () => void
}) {
  const visibleTasks = tasks
    .filter((task) => !task.deletedAt && !task.completed && pageById.has(task.pageId))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8)

  return (
    <DashboardSection title="Offene Aufgaben" action={<button className="dashboard-text-action" onClick={onOpenTasks}>Alle Aufgaben</button>}>
      {visibleTasks.length === 0 ? <p className="dashboard-empty">Keine offenen Aufgaben.</p> : (
        <div className="dashboard-task-list">
          {visibleTasks.map((task) => (
            <div className="dashboard-task" key={task.id}>
              <input
                type="checkbox"
                checked={false}
                aria-label={`Aufgabe „${task.text || 'Ohne Text'}“ erledigen`}
                onChange={() => toggleTask(task.id, true)}
              />
              <button className="dashboard-task-content" onClick={() => onOpenPage(task.pageId)}>
                <span className="dashboard-item-title">{task.text || 'Ohne Text'}</span>
                <span className="dashboard-item-meta">{pageById.get(task.pageId)?.title || 'Ohne Titel'}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </DashboardSection>
  )
}

function RecentPagesSection({ pages, folderById, onOpenPage }: {
  pages: Page[]
  folderById: Map<string, { name: string }>
  onOpenPage: (pageId: string) => void
}) {
  const recentPages = [...pages].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8)
  return (
    <DashboardSection title="Zuletzt bearbeitet">
      {recentPages.length === 0 ? <p className="dashboard-empty">Noch keine Seiten vorhanden.</p> : (
        <div className="dashboard-page-list">
          {recentPages.map((page) => {
            const type = getPagePropertyValue(page, 'type')
            const folder = page.folderId ? folderById.get(page.folderId) : undefined
            return (
              <button className="dashboard-page-row" key={page.id} onClick={() => onOpenPage(page.id)}>
                <span className="dashboard-page-main">
                  <span className="dashboard-item-title">{page.title || 'Ohne Titel'}</span>
                  {(folder || typeof type === 'string') && (
                    <span className="dashboard-item-meta">{[folder?.name, typeof type === 'string' ? type : null].filter(Boolean).join(' · ')}</span>
                  )}
                </span>
                <span className="dashboard-time">{formatRelativeTime(page.updatedAt)}</span>
              </button>
            )
          })}
        </div>
      )}
    </DashboardSection>
  )
}

function FavoritesSection({ pages, onOpenPage }: { pages: Page[]; onOpenPage: (pageId: string) => void }) {
  const favorites = pages
    .filter((page) => !!page.favoritedAt)
    .sort((a, b) => (b.favoritedAt ?? 0) - (a.favoritedAt ?? 0))
  return (
    <DashboardSection title="Favoriten">
      {favorites.length === 0 ? <p className="dashboard-empty">Noch keine Seiten als Favorit markiert.</p> : (
        <div className="dashboard-favorite-list">
          {favorites.map((page) => (
            <button key={page.id} onClick={() => onOpenPage(page.id)}>★ <span>{page.title || 'Ohne Titel'}</span></button>
          ))}
        </div>
      )}
    </DashboardSection>
  )
}

export default function Dashboard({
  sidebarOpen,
  onToggleSidebar,
  onOpenPage,
  onOpenSearch,
  onOpenAllNotes,
  onOpenTasks,
  onOpenProjects,
  userId,
}: Props) {
  const pages = useLiveQuery(() => db.pages.filter((page) => !page.deletedAt).toArray(), []) ?? []
  const tasks = useLiveQuery(() => db.tasks.filter((task) => !task.deletedAt).toArray(), []) ?? []
  const folders = useLiveQuery(() => db.folders.filter((folder) => !folder.deletedAt).toArray(), []) ?? []
  const projects = useLiveQuery(() => db.projects.filter((project) => !project.deletedAt).toArray(), []) ?? []
  const projectTasks = useLiveQuery(() => db.projectTasks.filter((task) => !task.deletedAt).toArray(), []) ?? []
  const pageById = new Map(pages.map((page) => [page.id, page]))
  const folderById = new Map(folders.map((folder) => [folder.id, folder]))

  async function createNewPage() {
    const id = await createPage(undefined)
    onOpenPage(id)
  }

  return (
    <main className="dashboard-view">
      <header className="dashboard-header">
        {!sidebarOpen && <button className="dashboard-sidebar-toggle" onClick={onToggleSidebar} aria-label="Seitenleiste öffnen">☰</button>}
        <div>
          <h1>Start</h1>
          <p>Deine persönliche Arbeitszentrale</p>
        </div>
      </header>
      <QuickActions onNewPage={createNewPage} onSearch={onOpenSearch} onAllNotes={onOpenAllNotes} onTasks={onOpenTasks} onProjects={onOpenProjects} />
      <div className="dashboard-grid">
        {projects.length > 0 && (
          <div className="dashboard-wide-section">
            <ProjectSection projects={projects} tasks={projectTasks} userId={userId} onOpenProjects={onOpenProjects} />
          </div>
        )}
        <OpenTasksSection tasks={tasks} pageById={pageById} onOpenPage={onOpenPage} onOpenTasks={onOpenTasks} />
        <RecentPagesSection pages={pages} folderById={folderById} onOpenPage={onOpenPage} />
        <div className="dashboard-wide-section">
          <FavoritesSection pages={pages} onOpenPage={onOpenPage} />
        </div>
      </div>
    </main>
  )
}


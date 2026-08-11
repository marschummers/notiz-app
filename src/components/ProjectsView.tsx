import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Project, ProjectStatus, ProjectTask, ProjectTaskStatus, ProjectWaitingFor, UserProfile } from '../db/types'
import { createProject, createProjectTask, deleteProject, deleteProjectTask, replaceProjectTaskAfns, updateProject, updateProjectTask } from '../lib/projectActions'
import BufferedDateInput from './BufferedDateInput'
import './ProjectsView.css'

const projectStatus: Record<ProjectStatus, string> = { active: 'Aktiv', waiting: 'Wartet', completed: 'Abgeschlossen', archived: 'Archiviert' }
const taskStatus: Record<ProjectTaskStatus, string> = { open: 'Offen', in_progress: 'In Arbeit', waiting: 'Wartet', completed: 'Erledigt' }
const waitingOptions: ProjectWaitingFor[] = ['Kunde', 'Entwicklung', 'Support', 'Vertrieb', 'Extern', 'Sonstige']
const taskFilters = ['all', 'open', 'in_progress', 'waiting', 'completed'] as const

interface Props { userId: string; userEmail?: string }
type TaskFilter = typeof taskFilters[number]

export default function ProjectsView({ userId, userEmail }: Props) {
  const projects = useLiveQuery(() => db.projects.filter((project) => !project.deletedAt).toArray(), []) ?? []
  const tasks = useLiveQuery(() => db.projectTasks.filter((task) => !task.deletedAt).toArray(), []) ?? []
  const afns = useLiveQuery(() => db.projectTaskAfns.filter((afn) => !afn.deletedAt).toArray(), []) ?? []
  const profiles = useLiveQuery(() => db.userProfiles.toArray(), []) ?? []
  const [section, setSection] = useState<'dashboard' | 'projects'>('dashboard')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all')
  const selected = projects.find((project) => project.id === projectId)
  const activeProjects = projects.filter((project) => project.status === 'active' || project.status === 'waiting')
  const mine = tasks.filter((task) => task.assigneeUserId === userId && task.status !== 'completed')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const sortedMine = [...mine].sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity))

  if (selected) {
    return <ProjectDetail project={selected} tasks={tasks.filter((task) => task.projectId === selected.id)} afns={afns}
      profiles={profiles} userId={userId} userEmail={userEmail} filter={taskFilter} setFilter={setTaskFilter}
      onBack={() => setProjectId(null)} />
  }

  return <main className="projects-view">
    <header className="projects-header"><div><p className="projects-eyebrow">Arbeitsbereich</p><h1>Projekte</h1></div><button className="primary" onClick={async () => setProjectId(await createProject({ name: 'Neues Projekt', ownerUserId: userId }))}>+ Neues Projekt</button></header>
    <nav className="project-tabs"><button className={section === 'dashboard' ? 'active' : ''} onClick={() => setSection('dashboard')}>Übersicht</button><button className={section === 'projects' ? 'active' : ''} onClick={() => setSection('projects')}>Projekte</button></nav>
    {section === 'dashboard' ? <>
      <div className="project-metrics"><Metric label="Aktive Projekte" value={activeProjects.length}/><Metric label="Meine offenen Aufgaben" value={mine.length}/><Metric label="Wartet auf andere" value={mine.filter((task) => task.status === 'waiting').length}/><Metric label="Überfällig" value={mine.filter((task) => task.dueDate && task.dueDate < today.getTime()).length}/></div>
      <TaskOverview title="Meine offenen Aufgaben" tasks={sortedMine} projects={projects} afns={afns} onOpen={setProjectId}/>
      <TaskOverview title="Wartet auf andere" tasks={sortedMine.filter((task) => task.status === 'waiting')} projects={projects} afns={afns} onOpen={setProjectId}/>
    </> : <>
      <div className="project-list-tools"><input className="project-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Projekte durchsuchen…" /><button onClick={() => setShowClosed((value) => !value)}>{showClosed ? 'Nur laufende' : 'Abgeschlossene & Archiv'}</button></div>
      <div className="project-list">{(showClosed ? projects : activeProjects).filter((project) => `${project.name} ${project.customerName ?? ''}`.toLowerCase().includes(search.toLowerCase())).map((project) => <button key={project.id} className="project-card" onClick={() => setProjectId(project.id)}><span><strong>{project.name}</strong><small>{project.customerName || 'Kein Kunde hinterlegt'}</small></span><StatusBadge status={project.status} label={projectStatus[project.status]}/></button>)}</div>
    </>}
  </main>
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="project-metric"><strong>{value}</strong><span>{label}</span></div> }

function StatusBadge({ status, label }: { status: string; label: string }) {
  return <span className={`project-status-badge status-${status}`}>{label}</span>
}

function TaskOverview({ title, tasks, projects, afns, onOpen }: { title: string; tasks: ProjectTask[]; projects: Project[]; afns: { taskId: string; afnNumber: number }[]; onOpen: (id: string) => void }) {
  return <section className="project-section overview-task-section"><h2>{title}</h2>{tasks.length === 0 ? <p className="empty">Hier ist gerade nichts offen.</p> : <div className="overview-task-list">{tasks.map((task) => {
    const project = projects.find((item) => item.id === task.projectId)
    const taskAfns = afns.filter((afn) => afn.taskId === task.id)
    return <div className="overview-task-row" key={task.id}>
      <button className="overview-task-main" onClick={() => onOpen(task.projectId)}>
        {project?.customerName && <span className="overview-customer">[{project.customerName}]</span>}
        <span className="overview-project">{project?.name || 'Unbekanntes Projekt'}</span>
        <span className="overview-task-title">{task.title}</span>
        {taskAfns.length > 0 && <span className="overview-afns">{taskAfns.map((afn) => `AFN ${afn.afnNumber}`).join(', ')}</span>}
      </button>
      <label className="overview-due-date" aria-label={`Termin für ${task.title}`}>
        <BufferedDateInput value={task.dueDate} onSave={(dueDate) => updateProjectTask(task.id, { dueDate })}/>
      </label>
      <StatusBadge status={task.status} label={taskStatus[task.status]}/>
    </div>
  })}</div>}</section>
}

function ProjectDetail({ project, tasks, afns, profiles, userId, userEmail, filter, setFilter, onBack }: { project: Project; tasks: ProjectTask[]; afns: { taskId: string; afnNumber: number }[]; profiles: UserProfile[]; userId: string; userEmail?: string; filter: TaskFilter; setFilter: (value: TaskFilter) => void; onBack: () => void }) {
  const [editingProject, setEditingProject] = useState(false)
  const [editingTask, setEditingTask] = useState<ProjectTask | 'new' | null>(null)
  const visibleTasks = useMemo(() => [...tasks].filter((task) => filter === 'all' || task.status === filter).sort((a, b) => a.sortOrder - b.sortOrder), [tasks, filter])
  const counts = Object.fromEntries(taskFilters.map((value) => [value, value === 'all' ? tasks.length : tasks.filter((task) => task.status === value).length]))
  const ownerName = profileName(project.ownerUserId, profiles, userId, userEmail)

  return <main className="projects-view project-detail-view">
    <div className="project-detail-content">
      <button className="back-link" onClick={onBack}>← Projekte</button>
      <header className="project-read-header">
        <div className="project-read-title"><h1>{project.name || 'Ohne Projektnamen'}</h1><p>{project.customerName || 'Kein Kunde hinterlegt'}</p></div>
        <StatusBadge status={project.status} label={projectStatus[project.status]}/>
      </header>
      <div className="project-meta-grid">
        <MetaItem label="Verantwortlich">{ownerName}</MetaItem>
        <MetaItem label="Zeitraum">{formatRange(project.startDate, project.targetDate)}</MetaItem>
      </div>
      <section className="project-read-description"><span>Beschreibung</span><p>{project.description || 'Noch keine Beschreibung hinterlegt.'}</p></section>
      <button className="secondary-action" onClick={() => setEditingProject(true)}>Projekt bearbeiten</button>

      <section className="project-tasks-section">
        <div className="project-tasks-heading"><div><p className="projects-eyebrow">Projektarbeit</p><h2>Aufgaben</h2></div><button className="primary compact" onClick={() => setEditingTask('new')}>+ Aufgabe</button></div>
        <div className="task-filter-bar" aria-label="Aufgaben filtern">{taskFilters.map((value) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}><span>{value === 'all' ? 'Alle' : taskStatus[value]}</span><strong>{counts[value]}</strong></button>)}</div>
        <div className="compact-task-list">{visibleTasks.length === 0 ? <div className="project-empty-state"><strong>Keine Aufgaben in diesem Filter</strong><span>Über „+ Aufgabe“ kannst du eine neue Projektaufgabe anlegen.</span></div> : visibleTasks.map((task) => <TaskRow key={task.id} task={task} profiles={profiles} userId={userId} userEmail={userEmail} afns={afns.filter((afn) => afn.taskId === task.id).map((afn) => afn.afnNumber)} onClick={() => setEditingTask(task)}/>)}</div>
      </section>
    </div>
    {editingProject && (
      <ProjectEditDialog project={project} profiles={profiles} userId={userId} userEmail={userEmail}
        onClose={() => setEditingProject(false)} onDeleted={onBack}/>
    )}
    {editingTask && (
      <TaskEditDialog projectId={project.id} task={editingTask === 'new' ? undefined : editingTask}
        profiles={profiles} userId={userId} userEmail={userEmail}
        afns={editingTask === 'new' ? [] : afns.filter((afn) => afn.taskId === editingTask.id).map((afn) => afn.afnNumber)}
        onClose={() => setEditingTask(null)}/>
    )}
  </main>
}

function MetaItem({ label, children }: { label: string; children: ReactNode }) {
  return <div className="project-meta-item"><span>{label}</span><strong>{children}</strong></div>
}

function TaskRow({ task, afns, profiles, userId, userEmail, onClick }: { task: ProjectTask; afns: number[]; profiles: UserProfile[]; userId: string; userEmail?: string; onClick: () => void }) {
  return <button className={`compact-task-row task-${task.status}`} onClick={onClick}>
    <div className="task-row-main"><strong>{task.title || 'Ohne Titel'}</strong><div className="task-row-meta"><span>{profileName(task.assigneeUserId, profiles, userId, userEmail)}</span><span>{task.dueDate ? formatDate(task.dueDate) : 'Ohne Termin'}</span>{task.status === 'waiting' && task.waitingFor && <span className="waiting-copy">Wartet auf: {task.waitingFor}</span>}</div>{afns.length > 0 && <div className="afn-chip-list">{afns.map((afn) => <span key={afn}>AFN {afn}</span>)}</div>}</div>
    <StatusBadge status={task.status} label={taskStatus[task.status]}/>
  </button>
}

function DialogShell({ title, subtitle, children, onClose }: { title: string; subtitle: string; children: ReactNode; onClose: () => void }) {
  return <div className="project-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="project-dialog" role="dialog" aria-modal="true" aria-label={title}>
      <header><div><p className="projects-eyebrow">{subtitle}</p><h2>{title}</h2></div><button className="dialog-close" onClick={onClose} aria-label="Dialog schließen">×</button></header>
      {children}
    </section>
  </div>
}

function ProjectEditDialog({ project, profiles, userId, userEmail, onClose, onDeleted }: { project: Project; profiles: UserProfile[]; userId: string; userEmail?: string; onClose: () => void; onDeleted: () => void }) {
  const [draft, setDraft] = useState(project)
  async function save(event: FormEvent) {
    event.preventDefault()
    await updateProject(project.id, {
      name: draft.name,
      customerName: draft.customerName,
      ownerUserId: draft.ownerUserId,
      status: draft.status,
      startDate: draft.startDate,
      targetDate: draft.targetDate,
      description: draft.description,
    })
    onClose()
  }
  return <DialogShell title="Projekt bearbeiten" subtitle={project.name} onClose={onClose}>
    <form className="project-dialog-form" onSubmit={save}>
      <div className="dialog-form-grid">
        <FormField label="Projektname" wide><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} autoFocus /></FormField>
        <FormField label="Kunde" wide><input value={draft.customerName ?? ''} onChange={(event) => setDraft({ ...draft, customerName: event.target.value || undefined })} placeholder="Optional" /></FormField>
        <FormField label="Status"><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ProjectStatus })}>{Object.entries(projectStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
        <FormField label="Verantwortlich"><select value={draft.ownerUserId} onChange={(event) => setDraft({ ...draft, ownerUserId: event.target.value })}>{profileOptions(profiles, userId, userEmail)}</select></FormField>
        <FormField label="Startdatum"><BufferedDateInput value={draft.startDate} onSave={(value) => setDraft({ ...draft, startDate: value })}/></FormField>
        <FormField label="Zieltermin"><BufferedDateInput value={draft.targetDate} onSave={(value) => setDraft({ ...draft, targetDate: value })}/></FormField>
        <FormField label="Beschreibung" wide><textarea value={draft.description ?? ''} onChange={(event) => setDraft({ ...draft, description: event.target.value || undefined })} rows={4}/></FormField>
      </div>
      <div className="dialog-actions"><button type="button" className="danger-action" onClick={async () => { if (confirm(`Projekt „${project.name}“ löschen?`)) { await deleteProject(project.id); onDeleted() } }}>Projekt löschen</button><span/><button type="button" className="secondary-action" onClick={onClose}>Abbrechen</button><button className="primary">Speichern</button></div>
    </form>
  </DialogShell>
}

function TaskEditDialog({ projectId, task, afns, profiles, userId, userEmail, onClose }: { projectId: string; task?: ProjectTask; afns: number[]; profiles: UserProfile[]; userId: string; userEmail?: string; onClose: () => void }) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [status, setStatus] = useState<ProjectTaskStatus>(task?.status ?? 'open')
  const [dueDate, setDueDate] = useState(task?.dueDate)
  const [assigneeUserId, setAssigneeUserId] = useState(task ? (task.assigneeUserId ?? '') : userId)
  const [waitingFor, setWaitingFor] = useState<ProjectWaitingFor | undefined>(task?.waitingFor)
  const [afnText, setAfnText] = useState(afns.join(', '))

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    const id = task?.id ?? await createProjectTask(projectId, title, assigneeUserId || undefined)
    await updateProjectTask(id, { title: title.trim(), description: description.trim() || undefined, status, dueDate, assigneeUserId: assigneeUserId || undefined, waitingFor: status === 'waiting' ? waitingFor : undefined })
    await replaceProjectTaskAfns(id, parseAfns(afnText))
    onClose()
  }

  return <DialogShell title={task ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'} subtitle="Projektaufgabe" onClose={onClose}>
    <form className="project-dialog-form" onSubmit={save}>
      <div className="dialog-form-grid">
        <FormField label="Titel" wide><input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus required /></FormField>
        <FormField label="Beschreibung" wide><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} placeholder="Optional" /></FormField>
        <FormField label="Status"><select value={status} onChange={(event) => setStatus(event.target.value as ProjectTaskStatus)}>{Object.entries(taskStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
        <FormField label="Termin"><BufferedDateInput value={dueDate} onSave={setDueDate}/></FormField>
        <FormField label="Verantwortlich"><select value={assigneeUserId} onChange={(event) => setAssigneeUserId(event.target.value)}><option value="">Nicht zugewiesen</option>{profileOptions(profiles, userId, userEmail)}</select></FormField>
        {status === 'waiting' && <FormField label="Wartet auf"><select value={waitingFor ?? ''} onChange={(event) => setWaitingFor((event.target.value || undefined) as ProjectWaitingFor | undefined)}><option value="">Bitte wählen</option>{waitingOptions.map((value) => <option key={value}>{value}</option>)}</select></FormField>}
        <FormField label="AFN-Nummern" wide><input value={afnText} onChange={(event) => setAfnText(event.target.value)} inputMode="numeric" placeholder="181657, 181658"/><small>Mehrere Nummern mit Komma trennen.</small></FormField>
      </div>
      <div className="dialog-actions">{task ? <button type="button" className="danger-action" onClick={async () => { if (confirm('Aufgabe löschen?')) { await deleteProjectTask(task.id); onClose() } }}>Aufgabe löschen</button> : <span/>}<span/><button type="button" className="secondary-action" onClick={onClose}>Abbrechen</button><button className="primary" disabled={!title.trim()}>Speichern</button></div>
    </form>
  </DialogShell>
}

function FormField({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <label className={`dialog-form-field${wide ? ' wide' : ''}`}><span>{label}</span>{children}</label>
}

function profileOptions(profiles: UserProfile[], userId: string, userEmail?: string) {
  const values = profiles.length ? profiles : [{ id: userId, email: userEmail ?? 'Ich', updatedAt: 0 }]
  return values.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName || profile.email}</option>)
}

function profileName(id: string | undefined, profiles: UserProfile[], userId: string, userEmail?: string) {
  if (!id) return 'Nicht zugewiesen'
  const profile = profiles.find((value) => value.id === id)
  if (profile) return profile.displayName || profile.email
  if (id === userId) return userEmail || 'Ich'
  return 'Unbekannter Benutzer'
}

function formatDate(value: number) { return new Date(value).toLocaleDateString('de-DE') }
function formatRange(start?: number, target?: number) {
  if (!start && !target) return 'Noch nicht festgelegt'
  return `${start ? formatDate(start) : 'Offen'} → ${target ? formatDate(target) : 'Offen'}`
}
function parseAfns(value: string) { return value.split(/[,;\s]+/).map(Number).filter((number) => Number.isInteger(number) && number > 0) }


import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Project, ProjectStatus, ProjectTask, ProjectTaskStatus, ProjectWaitingFor, UserProfile } from '../db/types'
import { createProject, createProjectTask, deleteProject, deleteProjectTask, replaceProjectTaskAfns, updateProject, updateProjectTask } from '../lib/projectActions'
import './ProjectsView.css'

const projectStatus: Record<ProjectStatus, string> = { active: 'Aktiv', waiting: 'Wartet', completed: 'Abgeschlossen', archived: 'Archiviert' }
const taskStatus: Record<ProjectTaskStatus, string> = { open: 'Offen', in_progress: 'In Arbeit', waiting: 'Wartet', completed: 'Erledigt' }
const waitingOptions: ProjectWaitingFor[] = ['Kunde', 'Entwicklung', 'Support', 'Vertrieb', 'Extern', 'Sonstige']
const dateValue = (value?: number) => value ? new Date(value).toISOString().slice(0, 10) : ''
const fromDate = (value: string) => value ? new Date(`${value}T12:00:00`).getTime() : undefined

interface Props { userId: string; userEmail?: string }

export default function ProjectsView({ userId, userEmail }: Props) {
  const projects = useLiveQuery(() => db.projects.filter((p) => !p.deletedAt).toArray(), []) ?? []
  const tasks = useLiveQuery(() => db.projectTasks.filter((t) => !t.deletedAt).toArray(), []) ?? []
  const afns = useLiveQuery(() => db.projectTaskAfns.filter((a) => !a.deletedAt).toArray(), []) ?? []
  const profiles = useLiveQuery(() => db.userProfiles.toArray(), []) ?? []
  const [section, setSection] = useState<'dashboard' | 'projects'>('dashboard')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const [taskFilter, setTaskFilter] = useState<'all' | ProjectTaskStatus>('all')
  const selected = projects.find((p) => p.id === projectId)
  const activeProjects = projects.filter((p) => p.status === 'active' || p.status === 'waiting')
  const mine = tasks.filter((t) => t.assigneeUserId === userId && t.status !== 'completed')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const sortedMine = [...mine].sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity))

  if (selected) return <ProjectDetail project={selected} tasks={tasks.filter((t) => t.projectId === selected.id)} afns={afns} profiles={profiles} userId={userId} userEmail={userEmail} filter={taskFilter} setFilter={setTaskFilter} onBack={() => setProjectId(null)} />

  return <main className="projects-view">
    <header className="projects-header"><div><p className="projects-eyebrow">Arbeitsbereich</p><h1>Projekte</h1></div><button className="primary" onClick={async () => setProjectId(await createProject({ name: 'Neues Projekt', ownerUserId: userId }))}>+ Neues Projekt</button></header>
    <nav className="project-tabs"><button className={section === 'dashboard' ? 'active' : ''} onClick={() => setSection('dashboard')}>Übersicht</button><button className={section === 'projects' ? 'active' : ''} onClick={() => setSection('projects')}>Projekte</button></nav>
    {section === 'dashboard' ? <>
      <div className="project-metrics"><Metric label="Aktive Projekte" value={activeProjects.length}/><Metric label="Meine offenen Aufgaben" value={mine.length}/><Metric label="Wartet auf andere" value={mine.filter((t) => t.status === 'waiting').length}/><Metric label="Überfällig" value={mine.filter((t) => t.dueDate && t.dueDate < today.getTime()).length}/></div>
      <TaskOverview title="Meine offenen Aufgaben" tasks={sortedMine} projects={projects} afns={afns} onOpen={setProjectId}/>
      <TaskOverview title="Wartet auf andere" tasks={sortedMine.filter((t) => t.status === 'waiting')} projects={projects} afns={afns} onOpen={setProjectId}/>
    </> : <>
      <div className="project-list-tools"><input className="project-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Projekte durchsuchen…" /><button onClick={() => setShowClosed((value) => !value)}>{showClosed ? 'Nur laufende' : 'Abgeschlossene & Archiv'}</button></div>
      <div className="project-list">{(showClosed ? projects : activeProjects).filter((p) => `${p.name} ${p.customerName ?? ''}`.toLowerCase().includes(search.toLowerCase())).map((p) => <button key={p.id} className="project-card" onClick={() => setProjectId(p.id)}><span><strong>{p.name}</strong><small>{p.customerName || 'Kein Kunde hinterlegt'}</small></span><span className={`status ${p.status}`}>{projectStatus[p.status]}</span></button>)}</div>
    </>}
  </main>
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="project-metric"><strong>{value}</strong><span>{label}</span></div> }

function TaskOverview({ title, tasks, projects, afns, onOpen }: { title: string; tasks: ProjectTask[]; projects: Project[]; afns: { taskId: string; afnNumber: number }[]; onOpen: (id: string) => void }) {
  return <section className="project-section"><h2>{title}</h2>{tasks.length === 0 ? <p className="empty">Hier ist gerade nichts offen.</p> : tasks.map((task) => <button className="overview-task" key={task.id} onClick={() => onOpen(task.projectId)}><span><strong>{task.title}</strong><small>{projects.find((p) => p.id === task.projectId)?.name}</small></span><span>{task.dueDate ? new Date(task.dueDate).toLocaleDateString('de-DE') : 'Ohne Termin'}{afns.filter((a) => a.taskId === task.id).map((a) => <small key={a.afnNumber}>AFN {a.afnNumber}</small>)}</span></button>)}</section>
}

function ProjectDetail({ project, tasks, afns, profiles, userId, userEmail, filter, setFilter, onBack }: { project: Project; tasks: ProjectTask[]; afns: { taskId: string; afnNumber: number }[]; profiles: UserProfile[]; userId: string; userEmail?: string; filter: 'all' | ProjectTaskStatus; setFilter: (v: 'all' | ProjectTaskStatus) => void; onBack: () => void }) {
  const [newTask, setNewTask] = useState('')
  const visible = useMemo(() => [...tasks].filter((t) => filter === 'all' || t.status === filter).sort((a,b) => a.sortOrder-b.sortOrder), [tasks, filter])
  return <main className="projects-view"><button className="back-link" onClick={onBack}>← Alle Projekte</button>
    <header className="project-detail-header"><div><input className="project-title-input" value={project.name} onChange={(e) => updateProject(project.id, { name: e.target.value })}/><input value={project.customerName ?? ''} onChange={(e) => updateProject(project.id, { customerName: e.target.value || undefined })} placeholder="Kunde (optional)" /></div><select value={project.status} onChange={(e) => updateProject(project.id, { status: e.target.value as ProjectStatus })}>{Object.entries(projectStatus).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></header>
    <div className="project-fields"><label>Verantwortlich<select value={project.ownerUserId} onChange={(e) => updateProject(project.id, { ownerUserId: e.target.value })}>{profileOptions(profiles, userId, userEmail)}</select></label><label>Start<input type="date" value={dateValue(project.startDate)} onChange={(e) => updateProject(project.id, { startDate: fromDate(e.target.value) })}/></label><label>Zieltermin<input type="date" value={dateValue(project.targetDate)} onChange={(e) => updateProject(project.id, { targetDate: fromDate(e.target.value) })}/></label></div>
    <textarea className="project-description" value={project.description ?? ''} onChange={(e) => updateProject(project.id, { description: e.target.value || undefined })} placeholder="Projektbeschreibung…" />
    <div className="task-toolbar"><h2>Aufgaben</h2><div>{(['all','open','in_progress','waiting','completed'] as const).map((v) => <button className={filter === v ? 'active' : ''} key={v} onClick={() => setFilter(v)}>{v === 'all' ? 'Alle' : taskStatus[v]}</button>)}</div></div>
    <form className="new-project-task" onSubmit={async (e) => { e.preventDefault(); if (!newTask.trim()) return; await createProjectTask(project.id, newTask, userId); setNewTask('') }}><input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="Neue Aufgabe…"/><button className="primary">Hinzufügen</button></form>
    <div className="project-task-list">{visible.map((task) => <ProjectTaskRow key={task.id} task={task} afns={afns.filter((a) => a.taskId === task.id).map((a) => a.afnNumber)} profiles={profiles} userId={userId} userEmail={userEmail}/>)}</div>
    <button className="danger-link" onClick={async () => { if (confirm(`Projekt „${project.name}“ löschen?`)) { await deleteProject(project.id); onBack() } }}>Projekt löschen</button>
  </main>
}

function profileOptions(profiles: UserProfile[], userId: string, userEmail?: string) {
  const values = profiles.length ? profiles : [{ id: userId, email: userEmail ?? 'Ich', updatedAt: 0 }]
  return values.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName || profile.email}</option>)
}

function ProjectTaskRow({ task, afns, profiles, userId, userEmail }: { task: ProjectTask; afns: number[]; profiles: UserProfile[]; userId: string; userEmail?: string }) {
  const [afnText, setAfnText] = useState(afns.join(', '))
  return <article className={`project-task ${task.status}`}><input className="task-title-input" value={task.title} onChange={(e) => updateProjectTask(task.id, { title: e.target.value })}/><textarea value={task.description ?? ''} onChange={(e) => updateProjectTask(task.id, { description: e.target.value || undefined })} placeholder="Beschreibung (optional)"/><div className="task-fields"><label>Status<select value={task.status} onChange={(e) => updateProjectTask(task.id, { status: e.target.value as ProjectTaskStatus })}>{Object.entries(taskStatus).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label><label>Termin<input type="date" value={dateValue(task.dueDate)} onChange={(e) => updateProjectTask(task.id, { dueDate: fromDate(e.target.value) })}/></label><label>Verantwortlich<select value={task.assigneeUserId ?? ''} onChange={(e) => updateProjectTask(task.id, { assigneeUserId: e.target.value || undefined })}><option value="">Nicht zugewiesen</option>{profileOptions(profiles, userId, userEmail)}</select></label>{task.status === 'waiting' && <label>Wartet auf<select value={task.waitingFor ?? ''} onChange={(e) => updateProjectTask(task.id, { waitingFor: e.target.value as ProjectWaitingFor })}><option value="">Bitte wählen</option>{waitingOptions.map((v) => <option key={v}>{v}</option>)}</select></label>}<label>AFN<input value={afnText} onChange={(e) => setAfnText(e.target.value)} onBlur={() => replaceProjectTaskAfns(task.id, afnText.split(/[,;\s]+/).map(Number))} placeholder="181657, 181658"/></label></div><button className="danger-link" onClick={() => confirm('Aufgabe löschen?') && deleteProjectTask(task.id)}>Löschen</button></article>
}


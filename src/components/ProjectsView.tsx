import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Page, Project, ProjectMember, ProjectMilestone, ProjectMilestoneStatus, ProjectSection, ProjectStatus, ProjectTask, ProjectTaskComment, ProjectTaskStatus, UserProfile } from '../db/types'
import { createProjectMilestone, createProjectSection, createProjectTask, createProjectTaskComment, deleteProject, deleteProjectMilestone, deleteProjectSection, deleteProjectTask, moveProjectMilestone, moveProjectTask, replaceProjectTaskAfns, setProjectTeam, updateProject, updateProjectMilestone, updateProjectSection, updateProjectTask } from '../lib/projectActions'
import BufferedDateInput from './BufferedDateInput'
import type { ProjectNavigation } from '../lib/projectNavigation'
import { projectCustomer, projectDisplayName, projectShortName } from '../lib/projectDisplay'
import { syncAll } from '../lib/sync'
import { createPage, updatePageProperty } from '../lib/actions'
import { getPagePropertyValue } from '../lib/propertyDefinitions'
import { authenticateWwapi, disconnectWwapi, isWwapiConnected, readRequirementPreview, type WwapiRequirementPreview } from '../lib/wwapi'
import ProjectTaskStatusControl from './ProjectTaskStatus'
import { NewProjectMenu, SaveAsTemplateDialog, TemplateListView } from './ProjectTemplates'
import './ProjectsView.css'

const projectStatus: Record<ProjectStatus, string> = { active: 'Aktiv', waiting: 'Wartet', completed: 'Abgeschlossen', archived: 'Archiviert' }
const taskStatus: Record<ProjectTaskStatus, string> = { open: 'Offen', in_progress: 'In Arbeit', waiting: 'Wartet', completed: 'Erledigt' }
const milestoneStatus: Record<ProjectMilestoneStatus, string> = { planned: 'Geplant', in_progress: 'In Arbeit', completed: 'Abgeschlossen' }
const taskFilters = ['all', 'open', 'in_progress', 'waiting', 'completed'] as const
const statusRank: Record<ProjectTaskStatus, number> = { open: 0, in_progress: 1, waiting: 2, completed: 3 }

interface Props { userId: string; userEmail?: string; navigation: ProjectNavigation; onNavigate: (navigation: ProjectNavigation) => void; onOpenPage: (id: string) => void }
type TaskFilter = typeof taskFilters[number]
type SortColumn = 'title' | 'customField1' | 'customField2' | 'assignee' | 'dueDate' | 'status'

// Sortiert nur innerhalb einer Meilenstein-/Themenbereich-Gruppe (siehe OrganizedProjectTasks) -
// fehlende Werte (kein Termin, kein Verantwortlicher, kein Modul-/Prio-Wert) landen unabhaengig
// von der Richtung immer am Ende statt die Sortierung zu verfaelschen.
function compareProjectTasks(column: SortColumn, direction: 'asc' | 'desc', context: { profiles: UserProfile[]; userId: string; userEmail?: string }) {
  const factor = direction === 'asc' ? 1 : -1
  function key(task: ProjectTask): string | number | undefined {
    switch (column) {
      case 'title': return task.title.toLocaleLowerCase('de')
      case 'customField1': return task.customField1Value?.toLocaleLowerCase('de')
      case 'customField2': return task.customField2Value?.toLocaleLowerCase('de')
      case 'assignee': return task.assigneeUserId ? profileName(task.assigneeUserId, context.profiles, context.userId, context.userEmail).toLocaleLowerCase('de') : undefined
      case 'dueDate': return task.dueDate
      case 'status': return statusRank[task.status]
    }
  }
  return (a: ProjectTask, b: ProjectTask) => {
    const aKey = key(a)
    const bKey = key(b)
    if (aKey === undefined && bKey === undefined) return 0
    if (aKey === undefined) return 1
    if (bKey === undefined) return -1
    if (aKey < bKey) return -1 * factor
    if (aKey > bKey) return 1 * factor
    return 0
  }
}

export default function ProjectsView({ userId, userEmail, navigation, onNavigate, onOpenPage }: Props) {
  const allProjects = useLiveQuery(() => db.projects.filter((project) => !project.deletedAt).toArray(), []) ?? []
  const allTasks = useLiveQuery(() => db.projectTasks.filter((task) => !task.deletedAt).toArray(), []) ?? []
  const allMilestones = useLiveQuery(() => db.projectMilestones.filter((milestone) => !milestone.deletedAt).toArray(), []) ?? []
  const allSections = useLiveQuery(() => db.projectSections.filter((section) => !section.deletedAt).toArray(), []) ?? []
  const allAfns = useLiveQuery(() => db.projectTaskAfns.filter((afn) => !afn.deletedAt).toArray(), []) ?? []
  const pages = useLiveQuery(() => db.pages.filter((page) => !page.deletedAt).toArray(), []) ?? []
  const profiles = useLiveQuery(() => db.userProfiles.toArray(), []) ?? []
  const allMembers = useLiveQuery(() => db.projectMembers.filter((member) => !member.deletedAt).toArray(), []) ?? []
  const allComments = useLiveQuery(() => db.projectTaskComments.filter((comment) => !comment.deletedAt).toArray(), []) ?? []
  const memberProjectIds = useMemo(
    () => new Set(allMembers.filter((member) => member.userId === userId).map((member) => member.projectId)),
    [allMembers, userId],
  )
  const projects = useMemo(
    () => allProjects.filter((project) => project.ownerUserId === userId || memberProjectIds.has(project.id)),
    [allProjects, memberProjectIds, userId],
  )
  const projectIds = useMemo(() => new Set(projects.map((project) => project.id)), [projects])
  const tasks = useMemo(() => allTasks.filter((task) => projectIds.has(task.projectId)), [allTasks, projectIds])
  const taskIds = useMemo(() => new Set(tasks.map((task) => task.id)), [tasks])
  const milestones = useMemo(() => allMilestones.filter((milestone) => projectIds.has(milestone.projectId)), [allMilestones, projectIds])
  const sections = useMemo(() => allSections.filter((section) => projectIds.has(section.projectId)), [allSections, projectIds])
  const afns = useMemo(() => allAfns.filter((afn) => taskIds.has(afn.taskId)), [allAfns, taskIds])
  const members = useMemo(() => allMembers.filter((member) => projectIds.has(member.projectId)), [allMembers, projectIds])
  const comments = useMemo(() => allComments.filter((comment) => taskIds.has(comment.taskId)), [allComments, taskIds])
  const [section, setSection] = useState<'dashboard' | 'projects'>('dashboard')
  const [search, setSearch] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all')
  const [showOtherDueTasks, setShowOtherDueTasks] = useState(false)
  const selected = navigation.type === 'project' ? projects.find((project) => project.id === navigation.id) : undefined
  const selectedTaskId = navigation.type === 'project' ? navigation.taskId : undefined
  const activeProjects = projects.filter((project) => project.status === 'active' || project.status === 'waiting')
  const mine = tasks.filter((task) => task.assigneeUserId === userId && task.status !== 'completed')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = today.getTime() + 86400000
  const sortedMine = [...mine].sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity))
  const waitingTasks = sortedMine.filter((task) => task.status === 'waiting')
  const actionableTasks = sortedMine.filter((task) => task.status !== 'waiting')
  const dueToday = actionableTasks.filter((task) => task.dueDate && task.dueDate >= today.getTime() && task.dueDate < tomorrow)
  const withoutDueDate = actionableTasks.filter((task) => !task.dueDate)
  const otherDueTasks = actionableTasks.filter((task) => task.dueDate && (task.dueDate < today.getTime() || task.dueDate >= tomorrow))

  if (selected) {
    return <ProjectDetail key={`${selected.id}:${selectedTaskId ?? ''}`} project={selected} tasks={tasks.filter((task) => task.projectId === selected.id)} milestones={milestones.filter((milestone) => milestone.projectId === selected.id)} sections={sections.filter((section) => section.projectId === selected.id)} afns={afns} comments={comments}
      profiles={profiles} members={members.filter((member) => member.projectId === selected.id)} userId={userId} userEmail={userEmail} filter={taskFilter} setFilter={setTaskFilter}
      pages={pages} onOpenPage={onOpenPage} initialTaskId={selectedTaskId} onBack={() => onNavigate({ type: 'overview' })} />
  }

  if (navigation.type === 'customer') return <CustomerOverview customerName={navigation.name} projects={projects} tasks={tasks} milestones={milestones} afns={afns} profiles={profiles} userId={userId} userEmail={userEmail} onOpenProject={(id) => onNavigate({ type: 'project', id })} onBack={() => onNavigate({ type: 'overview' })}/>

  if (navigation.type === 'templates') return <TemplateListView userId={userId} onNavigate={onNavigate}/>

  const effectiveSection = navigation.type === 'status' ? 'projects' : section
  const listProjects = navigation.type === 'status' ? projects.filter((project) => project.status === navigation.status) : (showClosed ? projects : activeProjects)

  return <main className="projects-view"><div className="project-page-content">
    <header className="projects-header"><div><p className="projects-eyebrow">Arbeitsbereich</p><h1>{navigation.type === 'status' ? projectStatus[navigation.status] : 'Projekte'}</h1></div><NewProjectMenu userId={userId} onCreated={(id) => onNavigate({ type: 'project', id })}/></header>
    <nav className="project-tabs"><button className={effectiveSection === 'dashboard' ? 'active' : ''} onClick={() => { setSection('dashboard'); onNavigate({ type: 'overview' }) }}>Übersicht</button><button className={effectiveSection === 'projects' ? 'active' : ''} onClick={() => { setSection('projects'); onNavigate({ type: 'overview' }) }}>Projekte</button></nav>
    {effectiveSection === 'dashboard' ? <>
      <div className="project-metrics"><Metric label="Aktive Projekte" value={activeProjects.length}/><Metric label="Meine offenen Aufgaben" value={mine.length}/><Metric label="Wartet auf andere" value={waitingTasks.length}/><Metric label="Meilensteine in 30 Tagen" value={milestones.filter((m) => m.status !== 'completed' && m.dueDate && m.dueDate >= today.getTime() && m.dueDate <= today.getTime() + 30 * 86400000).length}/></div>
      <UpcomingMilestones milestones={milestones} tasks={tasks} projects={projects} onOpen={(id) => onNavigate({ type: 'project', id })}/>
      <TaskOverview title="Heute fällig" tasks={dueToday} projects={projects} afns={afns} comments={comments} profiles={profiles} userId={userId} userEmail={userEmail} onOpen={(projectId, taskId) => onNavigate({ type: 'project', id: projectId, taskId })}/>
      <TaskOverview title="Ohne Fälligkeitsdatum" tasks={withoutDueDate} projects={projects} afns={afns} comments={comments} profiles={profiles} userId={userId} userEmail={userEmail} onOpen={(projectId, taskId) => onNavigate({ type: 'project', id: projectId, taskId })}/>
      <TaskOverview title="Wartet auf andere" tasks={waitingTasks} projects={projects} afns={afns} comments={comments} profiles={profiles} userId={userId} userEmail={userEmail} onOpen={(projectId, taskId) => onNavigate({ type: 'project', id: projectId, taskId })}/>
      {otherDueTasks.length > 0 && <div className="task-overview-toolbar"><button className="secondary-action other-tasks-toggle" onClick={() => setShowOtherDueTasks((value) => !value)}>{showOtherDueTasks ? 'Andere Termine ausblenden' : `Andere Termine anzeigen (${otherDueTasks.length})`}</button></div>}
      {showOtherDueTasks && <TaskOverview title="Andere Termine" tasks={otherDueTasks} projects={projects} afns={afns} comments={comments} profiles={profiles} userId={userId} userEmail={userEmail} onOpen={(projectId, taskId) => onNavigate({ type: 'project', id: projectId, taskId })}/>}
    </> : <>
      <div className="project-list-tools"><input className="project-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Projekte durchsuchen…" />{navigation.type !== 'status' && <button onClick={() => setShowClosed((value) => !value)}>{showClosed ? 'Nur laufende' : 'Abgeschlossene & Archiv'}</button>}</div>
      <div className="project-list">{listProjects.filter((project) => projectDisplayName(project).toLowerCase().includes(search.toLowerCase())).map((project) => <button key={project.id} className="project-card" onClick={() => onNavigate({ type: 'project', id: project.id })}><strong>{projectDisplayName(project)}</strong><StatusBadge status={project.status} label={projectStatus[project.status]}/></button>)}</div>
    </>}
  </div></main>
}

function CustomerOverview({ customerName, projects, tasks, milestones, afns, profiles, userId, userEmail, onOpenProject, onBack }: { customerName: string; projects: Project[]; tasks: ProjectTask[]; milestones: ProjectMilestone[]; afns: { taskId: string; afnNumber: number }[]; profiles: UserProfile[]; userId: string; userEmail?: string; onOpenProject: (id: string) => void; onBack: () => void }) {
  const customerProjects = projects.filter((project) => projectCustomer(project).toLocaleLowerCase('de') === customerName.trim().toLocaleLowerCase('de'))
  const active = customerProjects.filter((project) => project.status === 'active' || project.status === 'waiting')
  const projectIds = new Set(customerProjects.map((project) => project.id))
  const openTasks = tasks.filter((task) => projectIds.has(task.projectId) && task.status !== 'completed').sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity))
  const upcoming = milestones.filter((milestone) => projectIds.has(milestone.projectId) && milestone.status !== 'completed' && milestone.dueDate).sort(milestoneSort)

  return <main className="projects-view"><div className="project-page-content customer-overview">
    <button className="back-link" onClick={onBack}>← Projekte</button>
    <header className="project-read-header"><div className="project-read-title"><p className="projects-eyebrow">Kunde</p><h1>{customerName}</h1></div></header>
    <CustomerSection title="Projekte" empty="Keine aktiven Projekte für diesen Kunden.">{active.map((project) => <button className="customer-row" key={project.id} onClick={() => onOpenProject(project.id)}><span><strong>{projectShortName(project) || projectCustomer(project)}</strong><small>{profileName(project.ownerUserId, profiles, userId, userEmail)}</small></span><span>{project.targetDate ? formatDate(project.targetDate) : 'Ohne Zieltermin'}</span><StatusBadge status={project.status} label={projectStatus[project.status]}/></button>)}</CustomerSection>
    <CustomerSection title="Offene Aufgaben" empty="Keine offenen Aufgaben.">{openTasks.map((task) => { const project = customerProjects.find((item) => item.id === task.projectId); const taskAfns = afns.filter((afn) => afn.taskId === task.id); return <button className="customer-row customer-task-row" key={task.id} onClick={() => onOpenProject(task.projectId)}><span><small>{project ? (projectShortName(project) || 'Allgemeines Projekt') : 'Unbekanntes Projekt'}</small><strong>{task.title}</strong>{taskAfns.length > 0 && <small>{taskAfns.map((afn) => `AFN ${afn.afnNumber}`).join(', ')}</small>}</span><span>{profileName(task.assigneeUserId, profiles, userId, userEmail)}</span><span>{task.dueDate ? formatDate(task.dueDate) : 'Ohne Termin'}</span><ProjectTaskStatusControl task={task}/></button>})}</CustomerSection>
    <CustomerSection title="Nächste Meilensteine" empty="Keine offenen Meilensteine mit Termin.">{upcoming.map((milestone) => { const project = customerProjects.find((item) => item.id === milestone.projectId); const assigned = tasks.filter((task) => task.milestoneId === milestone.id); const done = assigned.filter((task) => task.status === 'completed').length; return <button className="customer-row" key={milestone.id} onClick={() => onOpenProject(milestone.projectId)}><span><small>{project ? (projectShortName(project) || 'Allgemeines Projekt') : 'Unbekanntes Projekt'}</small><strong>{milestone.title}</strong></span><span className={isOverdue(milestone) ? 'milestone-overdue' : ''}>{formatDate(milestone.dueDate!)}</span><span>{assigned.length ? `${done} / ${assigned.length} erledigt` : 'Noch keine Aufgaben'}</span></button>})}</CustomerSection>
  </div></main>
}

function CustomerSection({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const rows = Array.isArray(children) ? children : [children]
  return <section className="project-section customer-section"><h2>{title}</h2><div className="customer-list">{rows.length ? children : <p className="empty">{empty}</p>}</div></section>
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="project-metric"><strong>{value}</strong><span>{label}</span></div> }

function UpcomingMilestones({ milestones, tasks, projects, onOpen }: { milestones: ProjectMilestone[]; tasks: ProjectTask[]; projects: Project[]; onOpen: (id: string) => void }) {
  const rows = milestones.filter((m) => m.status !== 'completed' && m.dueDate).sort((a,b) => milestoneSort(a,b)).slice(0, 8)
  if (!rows.length) return null
  return <section className="project-section upcoming-milestones"><h2>Nächste Meilensteine</h2>{rows.map((m) => { const project = projects.find((p) => p.id === m.projectId); const assigned = tasks.filter((t) => t.milestoneId === m.id); const done = assigned.filter((t) => t.status === 'completed').length; return <button key={m.id} onClick={() => onOpen(m.projectId)}><span className={isOverdue(m) ? 'milestone-overdue' : ''}>{formatDate(m.dueDate!)}</span><strong>{project ? projectDisplayName(project) : 'Unbekanntes Projekt'}</strong><span>{m.title}</span><small>{assigned.length ? `${done} / ${assigned.length} erledigt` : 'Noch keine Aufgaben'}</small></button>})}</section>
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  return <span className={`project-status-badge status-${status}`}>{label}</span>
}

function NextMilestone({ milestone, tasks, onOpen }: { milestone: ProjectMilestone; tasks: ProjectTask[]; onOpen: () => void }) {
  const assigned = tasks.filter((task) => task.milestoneId === milestone.id)
  const done = assigned.filter((task) => task.status === 'completed').length
  return <button className="next-milestone" onClick={onOpen}><span className="projects-eyebrow">Nächster Meilenstein</span><strong>{milestone.title}</strong><span>{milestone.dueDate ? formatDate(milestone.dueDate) : 'Ohne Termin'}</span><small>{assigned.length ? `${done} von ${assigned.length} Aufgaben erledigt · ${assigned.length - done} offen` : 'Noch keine Aufgaben'}{isOverdue(milestone) ? ' · Überfällig' : milestoneTiming(milestone, assigned.length - done)}</small>{assigned.length > 0 && <i style={{width: `${done / assigned.length * 100}%`}}/>}</button>
}

function MilestoneRow({ milestone, tasks, onOpen, onEdit, onMove, canUp, canDown }: { milestone: ProjectMilestone; tasks: ProjectTask[]; onOpen: () => void; onEdit: () => void; onMove: (direction: -1 | 1) => void; canUp: boolean; canDown: boolean }) {
  const done = tasks.filter((task) => task.status === 'completed').length
  return <div className="milestone-row"><button className="milestone-main" onClick={onOpen}><span><strong>{milestone.title}</strong><small>{milestone.dueDate ? formatDate(milestone.dueDate) : 'Ohne Termin'}{isOverdue(milestone) ? ' · Überfällig' : milestoneTiming(milestone, tasks.length - done)}</small></span><span>{tasks.length ? `${done} / ${tasks.length} Aufgaben erledigt` : 'Noch keine Aufgaben'}</span></button><StatusBadge status={milestone.status} label={milestoneStatus[milestone.status]}/><div className="milestone-actions"><button disabled={!canUp} onClick={() => onMove(-1)} aria-label="Nach oben">↑</button><button disabled={!canDown} onClick={() => onMove(1)} aria-label="Nach unten">↓</button><button onClick={onEdit}>Bearbeiten</button></div></div>
}

function TaskOverview({ title, tasks, projects, afns, comments, profiles, userId, userEmail, onOpen }: { title: string; tasks: ProjectTask[]; projects: Project[]; afns: { taskId: string; afnNumber: number }[]; comments: ProjectTaskComment[]; profiles: UserProfile[]; userId: string; userEmail?: string; onOpen: (projectId: string, taskId: string) => void }) {
  return <section className="project-section overview-task-section"><h2>{title}</h2>{tasks.length === 0 ? <p className="empty">Hier ist gerade nichts offen.</p> : <div className="overview-task-list">{tasks.map((task) => {
    const project = projects.find((item) => item.id === task.projectId)
    const taskAfns = afns.filter((afn) => afn.taskId === task.id)
    return <ProjectTaskRow key={task.id} task={task} project={project} afns={taskAfns.map((afn) => afn.afnNumber)} comments={comments.filter((comment) => comment.taskId === task.id)} profiles={profiles} userId={userId} userEmail={userEmail} onOpen={() => onOpen(task.projectId, task.id)}/>
  })}</div>}</section>
}

function ProjectTaskRow({ task, project, afns, comments, profiles, userId, userEmail, onOpen }: { task: ProjectTask; project?: Project; afns: number[]; comments: ProjectTaskComment[]; profiles: UserProfile[]; userId: string; userEmail?: string; onOpen: () => void }) {
  const assignee = task.assigneeUserId ? profileName(task.assigneeUserId, profiles, userId, userEmail) : 'Nicht zugewiesen'
  const orderedComments = [...comments].sort((a, b) => b.createdAt - a.createdAt)
  return <div className="overview-task-row">
    <button className="overview-task-main" onClick={onOpen}>
      {project && <span className="overview-customer">[{projectCustomer(project)}]</span>}
      {project && projectShortName(project) && <span className="overview-project">{projectShortName(project)}</span>}
      <span className="overview-task-title">{task.title}</span>
      {afns.length > 0 && <span className="overview-afns">{afns.map((afn) => `AFN ${afn}`).join(', ')}</span>}
      {project?.customField1Label && task.customField1Value && <span className="overview-custom-field" title={project.customField1Label}>{task.customField1Value}</span>}
      {project?.customField2Label && task.customField2Value && <span className="overview-custom-field" title={project.customField2Label}>{task.customField2Value}</span>}
      {task.status === 'waiting' && <span className="overview-waiting-for">Wartet auf: {task.waitingFor ?? 'nicht angegeben'}</span>}
    </button>
    <span className="overview-assignee" title={assignee}>{task.assigneeUserId ? personInitials(assignee) : '–'}</span>
    {comments.length > 0 ? <details className="comment-preview"><summary aria-label={`${comments.length} Kommentare`} title={`${comments.length} Kommentare`}>▤ <span>{comments.length}</span></summary><div className="comment-preview-popover">{orderedComments.map((comment) => { const author = profileName(comment.authorUserId, profiles, userId, userEmail); return <article key={comment.id}><header><strong>{personInitials(author)}</strong><span>{author}</span><time>{formatDateTime(comment.createdAt)}</time></header><p>{comment.body}</p></article> })}</div></details> : <span className="comment-preview-empty" aria-label="Keine Kommentare">▤</span>}
    <label className="overview-due-date" aria-label={`Termin für ${task.title}`}><BufferedDateInput value={task.dueDate} onSave={(dueDate) => updateProjectTask(task.id, { dueDate })}/></label>
    <ProjectTaskStatusControl task={task}/>
  </div>
}

// Kompakte, einzeilige Aufgabenzeile NUR fuer die Projekt-Detailansicht (siehe ProjectDetail) -
// bewusst eine eigene Komponente statt ProjectTaskRow zu aendern, damit Dashboard-Uebersicht und
// Kundenuebersicht (nutzen weiterhin ProjectTaskRow) unveraendert bleiben. Kein Kunde-/Projekt-
// Praefix (man ist ja schon im Projekt) - dafuer feste Spalten fuer Modul/Prio/Verantwortlich/
// Termin/Status, ausgerichtet an .task-column-header (siehe TaskColumnHeader).
function TaskRow({ task, afns, comments, profiles, userId, userEmail, onOpen }: { task: ProjectTask; afns: number[]; comments: ProjectTaskComment[]; profiles: UserProfile[]; userId: string; userEmail?: string; onOpen: () => void }) {
  const assignee = task.assigneeUserId ? profileName(task.assigneeUserId, profiles, userId, userEmail) : 'Nicht zugewiesen'
  const orderedComments = [...comments].sort((a, b) => b.createdAt - a.createdAt)
  return <div className="task-row">
    <div className="task-row-main task-col-title">
      <button className="task-row-title-button" onClick={onOpen}>
        <span className="task-row-title">{task.title}</span>
        {afns.length > 0 && <span className="overview-afns">{afns.map((afn) => `AFN ${afn}`).join(', ')}</span>}
        {task.status === 'waiting' && <span className="overview-waiting-for" title={`Wartet auf: ${task.waitingFor ?? 'nicht angegeben'}`}>Wartet auf: {task.waitingFor ?? 'nicht angegeben'}</span>}
      </button>
      {comments.length > 0 && <details className="comment-preview"><summary aria-label={`${comments.length} Kommentare`} title={`${comments.length} Kommentare`}>▤ <span>{comments.length}</span></summary><div className="comment-preview-popover">{orderedComments.map((comment) => { const author = profileName(comment.authorUserId, profiles, userId, userEmail); return <article key={comment.id}><header><strong>{personInitials(author)}</strong><span>{author}</span><time>{formatDateTime(comment.createdAt)}</time></header><p>{comment.body}</p></article> })}</div></details>}
    </div>
    <span className="task-row-cell task-col-module">{task.customField1Value ?? ''}</span>
    <span className="task-row-cell task-col-prio">{task.customField2Value ?? ''}</span>
    <span className="task-row-cell task-col-assignee" title={assignee}>{task.assigneeUserId ? personInitials(assignee) : '–'}</span>
    <label className="task-row-cell task-row-due task-col-due" aria-label={`Termin für ${task.title}`}><BufferedDateInput value={task.dueDate} onSave={(dueDate) => updateProjectTask(task.id, { dueDate })}/></label>
    <span className="task-row-cell task-col-status"><ProjectTaskStatusControl task={task}/></span>
  </div>
}

function TaskColumnHeader({ project, sortColumn, sortDirection, onSort }: { project: Project; sortColumn: SortColumn | null; sortDirection: 'asc' | 'desc'; onSort: (column: SortColumn) => void }) {
  function Header({ column, className, label }: { column: SortColumn; className: string; label: string }) {
    const active = sortColumn === column
    return <button type="button" className={`task-column-sort ${className}${active ? ' active' : ''}`} onClick={() => onSort(column)}>{label}{active ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}</button>
  }
  return <div className="task-column-header">
    <Header column="title" className="task-col-title" label="Aufgabe"/>
    <Header column="customField1" className="task-col-module" label={project.customField1Label ?? ''}/>
    <Header column="customField2" className="task-col-prio" label={project.customField2Label ?? ''}/>
    <Header column="assignee" className="task-col-assignee" label="Verantwortlich"/>
    <Header column="dueDate" className="task-col-due" label="Termin"/>
    <Header column="status" className="task-col-status" label="Status"/>
  </div>
}

// Kleines, wiederverwendbares Popover-Menu (gleiches Muster wie NewPageMenu/NewProjectMenu -
// outside-mousedown schliesst). preventDefault+stopPropagation im Trigger UND je Eintrag sind
// noetig, weil der Button innerhalb eines <summary> liegt (siehe OrganizedProjectTasks) - ohne
// das wuerde jeder Klick zusaetzlich die native <details>-Auf/Zu-Logik ausloesen.
function KebabMenu({ label, items }: { label: string; items: { label: string; onClick: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDocPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocPointerDown)
    return () => document.removeEventListener('mousedown', onDocPointerDown)
  }, [open])

  return <div className="kebab-menu" ref={containerRef}>
    <button type="button" className="kebab-menu-trigger" aria-label={label} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen((value) => !value) }}>⋯</button>
    {open && <div className="new-page-popover kebab-menu-popover">
      {items.map((item) => (
        <div
          key={item.label}
          className={`new-page-option${item.danger ? ' danger-text' : ''}`}
          onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen(false); item.onClick() }}
        >
          <span>{item.label}</span>
        </div>
      ))}
    </div>}
  </div>
}

// Buendelt die drei bisher einzeln untereinander stehenden Zusatzfilter (Verantwortlich/Modul/
// Prio) in ein Popover neben der Status-Chip-Leiste (siehe ProjectDetail) - Werte/States bleiben
// unveraendert, nur die Darstellung aendert sich.
function TaskFilterMenu({
  assigneeFilter, setAssigneeFilter, userId, teamProfiles,
  customField1Label, customField1Filter, setCustomField1Filter, customField1Options,
  customField2Label, customField2Filter, setCustomField2Filter, customField2Options,
}: {
  assigneeFilter: string
  setAssigneeFilter: (value: string) => void
  userId: string
  teamProfiles: UserProfile[]
  customField1Label?: string
  customField1Filter: string
  setCustomField1Filter: (value: string) => void
  customField1Options: string[]
  customField2Label?: string
  customField2Filter: string
  setCustomField2Filter: (value: string) => void
  customField2Options: string[]
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const activeCount = [assigneeFilter, customField1Filter, customField2Filter].filter((value) => value !== 'all').length

  useEffect(() => {
    if (!open) return
    function onDocPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocPointerDown)
    return () => document.removeEventListener('mousedown', onDocPointerDown)
  }, [open])

  return <div className="task-filter-menu" ref={containerRef}>
    <button type="button" className={`secondary-action compact${activeCount ? ' active' : ''}`} onClick={() => setOpen((value) => !value)}>Filter{activeCount ? ` · ${activeCount}` : ''}</button>
    {open && <div className="new-page-popover task-filter-popover">
      <label className="assignee-filter">Verantwortlich<select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}><option value="all">Alle</option><option value={userId}>Meine</option>{teamProfiles.filter((profile) => profile.id !== userId).map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName || profile.email}</option>)}</select></label>
      {customField1Label && customField1Options.length > 0 && <label className="assignee-filter">{customField1Label}<select value={customField1Filter} onChange={(event) => setCustomField1Filter(event.target.value)}><option value="all">Alle</option>{customField1Options.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}
      {customField2Label && customField2Options.length > 0 && <label className="assignee-filter">{customField2Label}<select value={customField2Filter} onChange={(event) => setCustomField2Filter(event.target.value)}><option value="all">Alle</option>{customField2Options.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}
    </div>}
  </div>
}

function OrganizedProjectTasks({ tasks, milestones, sections, renderTask, onAddTask, onAddSection, onMoveTask, onEditMilestone, sortTasks, sortActive }: {
  tasks: ProjectTask[]
  milestones: ProjectMilestone[]
  sections: ProjectSection[]
  renderTask: (task: ProjectTask) => ReactNode
  onAddTask: (milestoneId?: string, sectionId?: string) => void
  onAddSection: (milestoneId: string) => void
  onMoveTask: (taskId: string, milestoneId?: string, sectionId?: string, beforeTaskId?: string) => Promise<void>
  onEditMilestone: (milestone: ProjectMilestone) => void
  sortTasks: (tasks: ProjectTask[]) => ProjectTask[]
  sortActive: boolean
}) {
  const [draggedTaskId, setDraggedTaskId] = useState<string>()
  const [dropTarget, setDropTarget] = useState<{ groupKey: string; beforeTaskId?: string; markerTaskId?: string; edge?: 'before' | 'after' }>()

  if (tasks.length === 0 && milestones.length === 0) {
    return <div className="project-empty-state"><strong>Keine Aufgaben in diesem Filter</strong><span>Über „+ Aufgabe“ kannst du eine neue Projektaufgabe anlegen.</span></div>
  }

  const orderedMilestones = [...milestones].sort((a, b) => a.sortOrder - b.sortOrder)
  const withoutMilestone = tasks.filter((task) => !task.milestoneId)
  const knownMilestoneIds = new Set(milestones.map((milestone) => milestone.id))
  const orphaned = tasks.filter((task) => task.milestoneId && !knownMilestoneIds.has(task.milestoneId))
  const standalone = [...withoutMilestone, ...orphaned]

  const renderTaskList = (groupTasks: ProjectTask[], milestoneId?: string, sectionId?: string, emptyLabel?: string) => {
    const groupKey = `${milestoneId ?? 'none'}:${sectionId ?? 'none'}`
    // Bei aktiver Spaltensortierung kommt groupTasks bereits sortiert von sortTasks() - hier
    // NICHT zusaetzlich nach sortOrder ueberschreiben, sonst geht die Spaltensortierung wieder
    // verloren. Ohne aktive Sortierung (sortTasks ist Identitaet) bleibt das bisherige Verhalten.
    const orderedTasks = sortActive ? [...groupTasks] : [...groupTasks].sort((a, b) => a.sortOrder - b.sortOrder)
    const finishDrop = async (event: DragEvent<HTMLDivElement>, beforeTaskId?: string) => {
      event.preventDefault()
      event.stopPropagation()
      if (!draggedTaskId) return
      const taskId = draggedTaskId
      setDraggedTaskId(undefined)
      setDropTarget(undefined)
      await onMoveTask(taskId, milestoneId, sectionId, beforeTaskId)
    }

    return <div
      className={`overview-task-list project-detail-task-list task-drop-list${dropTarget?.groupKey === groupKey && !dropTarget.markerTaskId ? ' drop-at-end' : ''}`}
      onDragOver={(event) => {
        if (!draggedTaskId) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setDropTarget({ groupKey })
      }}
      onDrop={(event) => finishDrop(event)}
    >
      {orderedTasks.map((task, index) => {
        const isMarker = dropTarget?.groupKey === groupKey && dropTarget.markerTaskId === task.id
        return <div
          className={`project-task-drag-item${draggedTaskId === task.id ? ' dragging' : ''}${isMarker ? ` drop-${dropTarget.edge}` : ''}`}
          key={task.id}
          onDragStart={(event) => {
            if (!(event.target instanceof Element) || !event.target.closest('.task-drag-handle')) {
              event.preventDefault()
              return
            }
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', task.id)
            setDraggedTaskId(task.id)
          }}
          onDragEnd={() => { setDraggedTaskId(undefined); setDropTarget(undefined) }}
          onDragOver={(event) => {
            if (!draggedTaskId) return
            event.preventDefault()
            event.stopPropagation()
            event.dataTransfer.dropEffect = 'move'
            const rect = event.currentTarget.getBoundingClientRect()
            const after = event.clientY >= rect.top + rect.height / 2
            setDropTarget({
              groupKey,
              beforeTaskId: after ? orderedTasks[index + 1]?.id : task.id,
              markerTaskId: task.id,
              edge: after ? 'after' : 'before',
            })
          }}
          onDrop={(event) => finishDrop(event, dropTarget?.groupKey === groupKey ? dropTarget.beforeTaskId : task.id)}
        >
          {!sortActive && <span className="task-drag-handle" title="Aufgabe verschieben" aria-hidden="true" draggable>⋮⋮</span>}
          {renderTask(task)}
        </div>
      })}
      {orderedTasks.length === 0 && emptyLabel && <p className="task-section-empty">{emptyLabel}</p>}
    </div>
  }

  return <div className="organized-task-list">
    {standalone.length > 0 && <details className="task-milestone-group general-project-tasks" open>
      <summary><span>Allgemeine Aufgaben</span><small>{standalone.filter((task) => task.status === 'completed').length} / {standalone.length} erledigt</small></summary>
      {renderTaskList(sortTasks(standalone))}
    </details>}
    {orderedMilestones.map((milestone) => {
      const milestoneTasks = tasks.filter((task) => task.milestoneId === milestone.id)
      const milestoneSections = sections.filter((section) => section.milestoneId === milestone.id).sort((a, b) => a.sortOrder - b.sortOrder)
      const sectionIds = new Set(milestoneSections.map((section) => section.id))
      const ungrouped = milestoneTasks.filter((task) => !task.sectionId || !sectionIds.has(task.sectionId))
      const done = milestoneTasks.filter((task) => task.status === 'completed').length
      return <details className="task-milestone-group" key={milestone.id} open>
        <summary>
          <span>{milestone.title}</span>
          <small>{done} / {milestoneTasks.length} erledigt</small>
          <KebabMenu
            label={`Aktionen für Meilenstein ${milestone.title}`}
            items={[
              { label: 'Aufgabe hinzufügen', onClick: () => onAddTask(milestone.id) },
              { label: 'Themenbereich hinzufügen', onClick: () => onAddSection(milestone.id) },
              { label: 'Meilenstein bearbeiten', onClick: () => onEditMilestone(milestone) },
            ]}
          />
        </summary>
        {(ungrouped.length > 0 || milestoneSections.length > 0) && renderTaskList(sortTasks(ungrouped), milestone.id)}
        {milestoneSections.map((section) => {
          const sectionTasks = milestoneTasks.filter((task) => task.sectionId === section.id)
          const sectionDone = sectionTasks.filter((task) => task.status === 'completed').length
          return <details className="task-section-group" key={section.id} open>
            <summary>
              <span>{section.title}</span>
              <small>{sectionDone} / {sectionTasks.length}</small>
              <KebabMenu
                label={`Aktionen für Themenbereich ${section.title}`}
                items={[
                  { label: 'Aufgabe hinzufügen', onClick: () => onAddTask(milestone.id, section.id) },
                  { label: 'Umbenennen', onClick: async () => { const title = prompt('Themenbereich umbenennen', section.title); if (title?.trim()) await updateProjectSection(section.id, title) } },
                  { label: 'Löschen', danger: true, onClick: async () => { if (confirm(`Themenbereich „${section.title}“ löschen? Die Aufgaben bleiben erhalten.`)) await deleteProjectSection(section.id) } },
                ]}
              />
            </summary>
            {renderTaskList(sortTasks(sectionTasks), milestone.id, section.id, 'Noch keine Aufgaben. Hierher ziehen oder über „+ Aufgabe“ anlegen.')}
          </details>
        })}

      </details>
    })}
  </div>
}
function ProjectDetail({ project, tasks, milestones, sections, afns, comments, profiles, members, pages, userId, userEmail, filter, setFilter, onOpenPage, initialTaskId, onBack }: { project: Project; tasks: ProjectTask[]; milestones: ProjectMilestone[]; sections: ProjectSection[]; afns: { taskId: string; afnNumber: number }[]; comments: ProjectTaskComment[]; profiles: UserProfile[]; members: ProjectMember[]; pages: Page[]; userId: string; userEmail?: string; filter: TaskFilter; setFilter: (value: TaskFilter) => void; onOpenPage: (id: string) => void; initialTaskId?: string; onBack: () => void }) {
  const [editingProject, setEditingProject] = useState(false)
  const [editingTask, setEditingTask] = useState<ProjectTask | 'new' | null>(() => tasks.find((task) => task.id === initialTaskId) ?? null)
  const [editingMilestone, setEditingMilestone] = useState<ProjectMilestone | 'new' | null>(null)
  const [openedMilestoneId, setOpenedMilestoneId] = useState<string | null>(null)
  const [taskMilestonePreset, setTaskMilestonePreset] = useState<string | undefined>()
  const [taskSectionPreset, setTaskSectionPreset] = useState<string | undefined>()
  const [editingTeam, setEditingTeam] = useState(false)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [customField1Filter, setCustomField1Filter] = useState('all')
  const [customField2Filter, setCustomField2Filter] = useState('all')
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [quickTaskTitle, setQuickTaskTitle] = useState('')
  function handleSort(column: SortColumn) {
    if (sortColumn === column) setSortDirection((value) => (value === 'asc' ? 'desc' : 'asc'))
    else { setSortColumn(column); setSortDirection('asc') }
  }
  const sortTasks = useMemo(() => {
    if (!sortColumn) return (list: ProjectTask[]) => list
    const comparator = compareProjectTasks(sortColumn, sortDirection, { profiles, userId, userEmail })
    return (list: ProjectTask[]) => [...list].sort(comparator)
  }, [sortColumn, sortDirection, profiles, userId, userEmail])
  const customField1Options = useMemo(() => [...new Set(tasks.map((task) => task.customField1Value).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b, 'de')), [tasks])
  const customField2Options = useMemo(() => [...new Set(tasks.map((task) => task.customField2Value).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b, 'de')), [tasks])
  const visibleTasks = useMemo(() => [...tasks].filter((task) =>
    (filter === 'all' || task.status === filter) &&
    (assigneeFilter === 'all' || task.assigneeUserId === assigneeFilter) &&
    (customField1Filter === 'all' || task.customField1Value === customField1Filter) &&
    (customField2Filter === 'all' || task.customField2Value === customField2Filter)
  ).sort((a, b) => a.sortOrder - b.sortOrder), [tasks, filter, assigneeFilter, customField1Filter, customField2Filter])
  const counts = Object.fromEntries(taskFilters.map((value) => [value, value === 'all' ? tasks.length : tasks.filter((task) => task.status === value).length]))
  const ownerName = profileName(project.ownerUserId, profiles, userId, userEmail)
  const teamIds = [...new Set([project.ownerUserId, ...members.map((member) => member.userId)])]
  const teamProfiles = teamIds.map((id) => profiles.find((profile) => profile.id === id)).filter((profile): profile is UserProfile => Boolean(profile))
  const nextMilestone = getNextMilestone(milestones)
  const noteCustomer = projectCustomer(project)
  const noteProject = projectShortName(project) ?? 'Allgemeines Projekt'
  const normalizeProperty = (value: unknown) => typeof value === 'string' ? value.trim().toLocaleLowerCase('de') : ''
  const projectNotes = pages.filter((page) =>
    normalizeProperty(getPagePropertyValue(page, 'customer')) === normalizeProperty(noteCustomer) &&
    normalizeProperty(getPagePropertyValue(page, 'project')) === normalizeProperty(noteProject)
  ).sort((a, b) => b.updatedAt - a.updatedAt)

  async function createProjectNote() {
    const id = await createPage(undefined, `Notiz – ${projectDisplayName(project)}`)
    await updatePageProperty(id, 'customer', noteCustomer)
    await updatePageProperty(id, 'project', noteProject)
    onOpenPage(id)
  }

  async function createGeneralTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = quickTaskTitle.trim()
    if (!title) return
    await createProjectTask(project.id, title, userId)
    setQuickTaskTitle('')
  }

  return <main className="projects-view project-detail-view">
    <div className="project-detail-content">
      <button className="back-link" onClick={onBack}>← Projekte</button>
      <header className="project-read-header">
        <div className="project-read-title">
          <h1><span>{projectCustomer(project)}</span>{projectShortName(project) && <><i> | </i>{projectShortName(project)}</>}</h1>
          <p><span>Verantwortlich: {personInitials(ownerName)}</span><span>Team: {teamIds.map((id) => personInitials(profileName(id, profiles, userId, userEmail))).join(', ')}</span><span>Zeitraum: {formatRange(project.startDate, project.targetDate)}</span></p>
        </div>
        <div className="project-header-actions"><button className="secondary-action compact" onClick={() => setEditingProject(true)}>Projekt bearbeiten</button><button className="secondary-action compact" onClick={() => setEditingTeam(true)}>Team bearbeiten</button><button className="secondary-action compact" onClick={() => setSavingTemplate(true)}>Als Vorlage speichern</button><StatusBadge status={project.status} label={projectStatus[project.status]}/></div>
      </header>

      {nextMilestone && <NextMilestone milestone={nextMilestone} tasks={tasks} onOpen={() => setOpenedMilestoneId(nextMilestone.id)}/>}

      <section className="project-tasks-section">
        <div className="project-tasks-heading"><div><p className="projects-eyebrow">Projektarbeit</p><h2>Aufgaben</h2></div><button className="primary compact" onClick={() => { setTaskMilestonePreset(undefined); setTaskSectionPreset(undefined); setEditingTask('new') }}>+ Aufgabe</button></div>
        <form className="project-quick-task-form" onSubmit={createGeneralTask}>
          <input value={quickTaskTitle} onChange={(event) => setQuickTaskTitle(event.target.value)} placeholder="Allgemeine Aufgabe schnell erfassen …" aria-label="Neue allgemeine Projektaufgabe" />
          <button type="submit" disabled={!quickTaskTitle.trim()}>Hinzufügen</button>
        </form>
        <div className="task-filter-row">
          <div className="task-filter-bar" aria-label="Aufgaben filtern">{taskFilters.map((value) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}><span>{value === 'all' ? 'Alle' : taskStatus[value]}</span><strong>{counts[value]}</strong></button>)}</div>
          <TaskFilterMenu
            assigneeFilter={assigneeFilter} setAssigneeFilter={setAssigneeFilter} userId={userId} teamProfiles={teamProfiles}
            customField1Label={project.customField1Label} customField1Filter={customField1Filter} setCustomField1Filter={setCustomField1Filter} customField1Options={customField1Options}
            customField2Label={project.customField2Label} customField2Filter={customField2Filter} setCustomField2Filter={setCustomField2Filter} customField2Options={customField2Options}
          />
        </div>
        <TaskColumnHeader project={project} sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort}/>
        <OrganizedProjectTasks
          tasks={visibleTasks}
          milestones={milestones}
          sections={sections}
          renderTask={(task) => <TaskRow key={task.id} task={task} afns={afns.filter((afn) => afn.taskId === task.id).map((afn) => afn.afnNumber)} comments={comments.filter((comment) => comment.taskId === task.id)} profiles={profiles} userId={userId} userEmail={userEmail} onOpen={() => setEditingTask(task)}/>}
          onAddTask={(milestoneId, sectionId) => { setTaskMilestonePreset(milestoneId); setTaskSectionPreset(sectionId); setEditingTask('new') }}
          onAddSection={async (milestoneId) => { const title = prompt('Name des Themenbereichs'); if (title?.trim()) await createProjectSection(project.id, milestoneId, title) }}
          onMoveTask={moveProjectTask}
          onEditMilestone={(milestone) => setEditingMilestone(milestone)}
          sortTasks={sortTasks}
          sortActive={sortColumn !== null}
        />
      </section>

      <section className="project-notes-section">
        <div className="project-tasks-heading"><div><p className="projects-eyebrow">Privat</p><h2>Meine Notizen</h2></div><button className="primary compact" onClick={createProjectNote}>+ Projektnotiz</button></div>
        {projectNotes.length === 0 ? <p className="project-notes-empty">Noch keine privaten Notizen mit diesem Projekt verknüpft.</p> : <div className="project-note-list">{projectNotes.map((page) => <button key={page.id} onClick={() => onOpenPage(page.id)}><span><strong>{page.title || 'Ohne Titel'}</strong><small>{String(getPagePropertyValue(page, 'type') ?? 'Notiz')}</small></span><time>{new Date(page.updatedAt).toLocaleDateString('de-DE')}</time></button>)}</div>}
      </section>

      <section className="project-milestones-section">
        <div className="project-tasks-heading"><div><p className="projects-eyebrow">Planung</p><h2>Meilensteine</h2></div><button className="primary compact" onClick={() => setEditingMilestone('new')}>+ Meilenstein</button></div>
        <div className="milestone-list">{milestones.length === 0 ? <div className="project-empty-state"><strong>Noch keine Meilensteine</strong><span>Lege den ersten wichtigen Projekttermin an.</span></div> : [...milestones].sort((a,b) => a.sortOrder - b.sortOrder).map((milestone, index, ordered) => <MilestoneRow key={milestone.id} milestone={milestone} tasks={tasks.filter((task) => task.milestoneId === milestone.id)} onOpen={() => setOpenedMilestoneId(milestone.id)} onEdit={() => setEditingMilestone(milestone)} onMove={(direction) => moveProjectMilestone(milestone.id, direction)} canUp={index > 0} canDown={index < ordered.length - 1}/>)}</div>
      </section>
    </div>
    {editingProject && (
      <ProjectEditDialog project={project} onClose={() => setEditingProject(false)} onDeleted={onBack}/>
    )}
    {editingTask && (
      <TaskEditDialog projectId={project.id} project={project} tasks={tasks} task={editingTask === 'new' ? undefined : editingTask} milestones={milestones} sections={sections} milestonePreset={taskMilestonePreset} sectionPreset={taskSectionPreset}
        profiles={profiles} memberIds={teamIds} userId={userId} userEmail={userEmail}
        afns={editingTask === 'new' ? [] : afns.filter((afn) => afn.taskId === editingTask.id).map((afn) => afn.afnNumber)}
        comments={editingTask === 'new' ? [] : comments.filter((comment) => comment.taskId === editingTask.id)}
        onClose={() => setEditingTask(null)}/>
    )}
    {editingMilestone && <MilestoneEditDialog projectId={project.id} milestone={editingMilestone === 'new' ? undefined : editingMilestone} onClose={() => setEditingMilestone(null)}/>}
    {editingTeam && <TeamEditDialog project={project} members={members} profiles={profiles} userId={userId} userEmail={userEmail} onClose={() => setEditingTeam(false)}/>}
    {savingTemplate && <SaveAsTemplateDialog project={project} milestones={milestones} sections={sections} tasks={tasks} userId={userId} onClose={() => setSavingTemplate(false)}/>}
    {openedMilestoneId && milestones.find((m) => m.id === openedMilestoneId) && <MilestoneDetailDialog milestone={milestones.find((m) => m.id === openedMilestoneId)!} tasks={tasks.filter((task) => task.milestoneId === openedMilestoneId)} onTask={(task) => { setOpenedMilestoneId(null); setEditingTask(task) }} onAddTask={() => { setTaskMilestonePreset(openedMilestoneId); setTaskSectionPreset(undefined); setOpenedMilestoneId(null); setEditingTask('new') }} onClose={() => setOpenedMilestoneId(null)}/>}
  </main>
}

export function DialogShell({ title, subtitle, children, onClose }: { title: string; subtitle: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return <div className="project-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="project-dialog" role="dialog" aria-modal="true" aria-label={title}>
      <header><div><p className="projects-eyebrow">{subtitle}</p><h2>{title}</h2></div><button className="dialog-close" onClick={onClose} aria-label="Dialog schließen">×</button></header>
      {children}
    </section>
  </div>
}

function ProjectEditDialog({ project, onClose, onDeleted }: { project: Project; onClose: () => void; onDeleted: () => void }) {
  const [draft, setDraft] = useState(() => ({ ...project, name: projectShortName(project) ?? '', customerName: projectCustomer(project) }))
  async function persist() {
    if (!draft.customerName?.trim()) return false
    await updateProject(project.id, {
      name: draft.name.trim(),
      customerName: draft.customerName.trim(),
      ownerUserId: draft.ownerUserId,
      status: draft.status,
      startDate: draft.startDate,
      targetDate: draft.targetDate,
      description: draft.description,
      customField1Label: draft.customField1Label?.trim() || undefined,
      customField2Label: draft.customField2Label?.trim() || undefined,
    })
    return true
  }
  async function closeAndSave() {
    if (await persist()) onClose()
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    await closeAndSave()
  }
  return <DialogShell title="Projekt bearbeiten" subtitle={projectDisplayName(project)} onClose={closeAndSave}>
    <form className="project-dialog-form" onSubmit={submit}>
      <div className="dialog-form-grid">
        <FormField label="Kunde" wide><input value={draft.customerName ?? ''} onChange={(event) => setDraft({ ...draft, customerName: event.target.value })} autoFocus required /></FormField>
        <FormField label="Projektname" wide><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Optional, z. B. Supermarkt" /></FormField>
        <FormField label="Status"><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ProjectStatus })}>{Object.entries(projectStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
        <FormField label="Startdatum"><BufferedDateInput value={draft.startDate} onSave={(value) => setDraft({ ...draft, startDate: value })}/></FormField>
        <FormField label="Zieltermin"><BufferedDateInput value={draft.targetDate} onSave={(value) => setDraft({ ...draft, targetDate: value })}/></FormField>
        <FormField label="Beschreibung" wide><textarea value={draft.description ?? ''} onChange={(event) => setDraft({ ...draft, description: event.target.value || undefined })} rows={4}/></FormField>
        <FormField label="Zusatzfeld 1 Bezeichnung"><input value={draft.customField1Label ?? ''} onChange={(event) => setDraft({ ...draft, customField1Label: event.target.value })} placeholder="z. B. Modul (leer = ausgeblendet)"/></FormField>
        <FormField label="Zusatzfeld 2 Bezeichnung"><input value={draft.customField2Label ?? ''} onChange={(event) => setDraft({ ...draft, customField2Label: event.target.value })} placeholder="z. B. Modul (leer = ausgeblendet)"/></FormField>
      </div>
      <div className="dialog-actions"><button type="button" className="danger-action" onClick={async () => { if (confirm(`Projekt „${projectDisplayName(project)}“ löschen?`)) { await deleteProject(project.id); onDeleted() } }}>Projekt löschen</button><span/><span/><button type="button" className="primary" disabled={!draft.customerName?.trim()} onClick={closeAndSave}>Schließen</button></div>
    </form>
  </DialogShell>
}

function MilestoneEditDialog({ projectId, milestone, onClose }: { projectId: string; milestone?: ProjectMilestone; onClose: () => void }) {
  const [title, setTitle] = useState(milestone?.title ?? '')
  const [description, setDescription] = useState(milestone?.description ?? '')
  const [dueDate, setDueDate] = useState(milestone?.dueDate)
  const [status, setStatus] = useState<ProjectMilestoneStatus>(milestone?.status ?? 'planned')
  async function save(event: FormEvent) { event.preventDefault(); if (!title.trim()) return; const id = milestone?.id ?? await createProjectMilestone(projectId, title); await updateProjectMilestone(id, { title: title.trim(), description: description.trim() || undefined, dueDate, status }); onClose() }
  return <DialogShell title={milestone ? 'Meilenstein bearbeiten' : 'Neuer Meilenstein'} subtitle="Projektplanung" onClose={onClose}><form className="project-dialog-form" onSubmit={save}><div className="dialog-form-grid"><FormField label="Titel" wide><input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required/></FormField><FormField label="Beschreibung" wide><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Optional"/></FormField><FormField label="Datum"><BufferedDateInput value={dueDate} onSave={setDueDate}/></FormField><FormField label="Status"><select value={status} onChange={(e) => setStatus(e.target.value as ProjectMilestoneStatus)}>{Object.entries(milestoneStatus).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></FormField></div><div className="dialog-actions">{milestone ? <button type="button" className="danger-action" onClick={async () => { if (confirm('Meilenstein löschen? Die Aufgaben bleiben erhalten.')) { await deleteProjectMilestone(milestone.id); onClose() } }}>Meilenstein löschen</button> : <span/>}<span/><button type="button" className="secondary-action" onClick={onClose}>Abbrechen</button><button className="primary" disabled={!title.trim()}>Speichern</button></div></form></DialogShell>
}

function MilestoneDetailDialog({ milestone, tasks, onTask, onAddTask, onClose }: { milestone: ProjectMilestone; tasks: ProjectTask[]; onTask: (task: ProjectTask) => void; onAddTask: () => void; onClose: () => void }) {
  const done = tasks.filter((task) => task.status === 'completed').length
  return <DialogShell title={milestone.title} subtitle="Meilenstein" onClose={onClose}><div className="milestone-detail"><p>{milestone.description || 'Keine Beschreibung hinterlegt.'}</p><div className="milestone-detail-meta"><span>{milestone.dueDate ? formatDate(milestone.dueDate) : 'Ohne Datum'}</span><StatusBadge status={milestone.status} label={milestoneStatus[milestone.status]}/></div><strong>{tasks.length ? `${done} von ${tasks.length} Aufgaben erledigt` : 'Noch keine Aufgaben'}</strong>{tasks.length > 0 && <div className="milestone-progress"><i style={{width: `${done / tasks.length * 100}%`}}/></div>}<div className="milestone-task-list">{tasks.map((task) => <button key={task.id} onClick={() => onTask(task)}><ProjectTaskStatusControl task={task} compact/>{task.title}</button>)}</div><button className="primary compact" onClick={onAddTask}>+ Aufgabe</button></div></DialogShell>
}

function TaskEditDialog({ projectId, project, tasks, task, milestones, sections, milestonePreset, sectionPreset, afns, comments, profiles, memberIds, userId, userEmail, onClose }: { projectId: string; project: Project; tasks: ProjectTask[]; task?: ProjectTask; milestones: ProjectMilestone[]; sections: ProjectSection[]; milestonePreset?: string; sectionPreset?: string; afns: number[]; comments: ProjectTaskComment[]; profiles: UserProfile[]; memberIds: string[]; userId: string; userEmail?: string; onClose: () => void }) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [status, setStatus] = useState<ProjectTaskStatus>(task?.status ?? 'open')
  const [dueDate, setDueDate] = useState(task?.dueDate)
  const [assigneeUserId, setAssigneeUserId] = useState(task ? (task.assigneeUserId ?? '') : userId)
  const [waitingFor, setWaitingFor] = useState(task?.waitingFor ?? '')
  const [milestoneId, setMilestoneId] = useState(task?.milestoneId ?? milestonePreset ?? '')
  const [sectionId, setSectionId] = useState(task?.sectionId ?? sectionPreset ?? '')
  const [customField1Value, setCustomField1Value] = useState(task?.customField1Value ?? '')
  const [customField2Value, setCustomField2Value] = useState(task?.customField2Value ?? '')
  const availableSections = useMemo(() => sections.filter((section) => section.milestoneId === milestoneId).sort((a, b) => a.sortOrder - b.sortOrder), [milestoneId, sections])
  const [afnText, setAfnText] = useState(afns.join(', '))
  const [commentText, setCommentText] = useState('')
  const [commentSaving, setCommentSaving] = useState(false)
  const [commentError, setCommentError] = useState('')
  const [afnPreviews, setAfnPreviews] = useState<WwapiRequirementPreview[]>([])
  const [afnLoading, setAfnLoading] = useState(false)
  const [afnError, setAfnError] = useState('')
  const [wwapiConnected, setWwapiConnected] = useState(isWwapiConnected)
  const [wwapiUsername, setWwapiUsername] = useState('')
  const [wwapiPassword, setWwapiPassword] = useState('')
  const [wwapiConnecting, setWwapiConnecting] = useState(false)
  const customField1Options = useMemo(() => [...new Set(tasks.map((item) => item.customField1Value).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b, 'de')), [tasks])
  const customField2Options = useMemo(() => [...new Set(tasks.map((item) => item.customField2Value).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b, 'de')), [tasks])
  const taskId = task?.id
  const existingCustomField1Value = task?.customField1Value
  const existingCustomField2Value = task?.customField2Value

  async function persist() {
    if (!title.trim()) return false
    const id = taskId ?? await createProjectTask(projectId, title, assigneeUserId || undefined)
    await updateProjectTask(id, { title: title.trim(), description: description.trim() || undefined, status, dueDate, milestoneId: milestoneId || undefined, sectionId: milestoneId && availableSections.some((section) => section.id === sectionId) ? sectionId : undefined, assigneeUserId: assigneeUserId || undefined, waitingFor: status === 'waiting' ? (waitingFor.trim() || undefined) : undefined, customField1Value: project.customField1Label ? (customField1Value.trim() || undefined) : existingCustomField1Value, customField2Value: project.customField2Label ? (customField2Value.trim() || undefined) : existingCustomField2Value })
    await replaceProjectTaskAfns(id, parseAfns(afnText))
    return true
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (await persist()) onClose()
  }

  async function closeAndSave() {
    if (!taskId || await persist()) onClose()
  }

  async function addComment() {
    if (!task || !commentText.trim() || commentSaving) return
    setCommentSaving(true)
    setCommentError('')
    try {
      await createProjectTaskComment(task.id, userId, commentText)
      await syncAll()
      setCommentText('')
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : 'Kommentar konnte nicht synchronisiert werden.')
    } finally {
      setCommentSaving(false)
    }
  }

  async function loadAfnPreviews() {
    const numbers = parseAfns(afnText).slice(0, 10)
    if (!numbers.length || afnLoading) return
    setAfnLoading(true)
    setAfnError('')
    try {
      setAfnPreviews(await Promise.all(numbers.map(readRequirementPreview)))
    } catch (error) {
      setAfnPreviews([])
      setAfnError(error instanceof Error ? error.message : 'AFN konnte nicht geladen werden.')
    } finally {
      setAfnLoading(false)
    }
  }

  async function connectWwapi() {
    if (wwapiConnecting) return
    setWwapiConnecting(true)
    setAfnError('')
    try {
      await authenticateWwapi(wwapiUsername, wwapiPassword)
      setWwapiConnected(true)
    } catch (error) {
      setAfnError(error instanceof Error ? error.message : 'Winweb-Anmeldung fehlgeschlagen.')
    } finally {
      setWwapiPassword('')
      setWwapiConnecting(false)
    }
  }

  return <DialogShell title={task ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'} subtitle="Projektaufgabe" onClose={closeAndSave}>
    <form className="project-dialog-form" onSubmit={save}>
      <div className="dialog-form-grid">
        <FormField label="Titel" wide><input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus required /></FormField>
        <FormField label="Beschreibung" wide><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} placeholder="Optional" /></FormField>
        <FormField label="Status"><select value={status} onChange={(event) => setStatus(event.target.value as ProjectTaskStatus)}>{Object.entries(taskStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
        <FormField label="Termin"><BufferedDateInput value={dueDate} onSave={setDueDate}/></FormField>
        <FormField label="Verantwortlich"><select value={assigneeUserId} onChange={(event) => setAssigneeUserId(event.target.value)}><option value="">Nicht zugewiesen</option>{profileOptions(profiles, userId, userEmail, memberIds)}</select></FormField>
        <FormField label="Meilenstein"><select value={milestoneId} onChange={(event) => { setMilestoneId(event.target.value); setSectionId('') }}><option value="">Kein Meilenstein</option>{milestones.filter((m) => m.status !== 'completed' || m.id === task?.milestoneId).sort((a,b) => a.sortOrder - b.sortOrder).map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select></FormField>
        <FormField label="Themenbereich"><select value={sectionId} disabled={!milestoneId || availableSections.length === 0} onChange={(event) => setSectionId(event.target.value)}><option value="">{!milestoneId ? 'Zuerst Meilenstein wählen' : 'Nur Meilenstein (kein Themenbereich)'}</option>{availableSections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}</select></FormField>
        {status === 'waiting' && <FormField label="Wartet auf"><input value={waitingFor} onChange={(event) => setWaitingFor(event.target.value)} placeholder="z. B. Rückmeldung von Frau Müller" /></FormField>}
        {project.customField1Label && <FormField label={project.customField1Label}><input value={customField1Value} onChange={(event) => setCustomField1Value(event.target.value)} list="custom-field-1-suggestions"/><datalist id="custom-field-1-suggestions">{customField1Options.map((value) => <option key={value} value={value}/>)}</datalist></FormField>}
        {project.customField2Label && <FormField label={project.customField2Label}><input value={customField2Value} onChange={(event) => setCustomField2Value(event.target.value)} list="custom-field-2-suggestions"/><datalist id="custom-field-2-suggestions">{customField2Options.map((value) => <option key={value} value={value}/>)}</datalist></FormField>}
        <FormField label="AFN-Nummern" wide><div className="afn-preview-input"><input value={afnText} onChange={(event) => { setAfnText(event.target.value); setAfnPreviews([]); setAfnError('') }} inputMode="numeric" placeholder="181657, 181658"/><button type="button" className="secondary-action" disabled={!wwapiConnected || parseAfns(afnText).length === 0 || afnLoading} onClick={loadAfnPreviews}>{afnLoading ? 'Wird geladen …' : 'AFN lesen'}</button></div><small>Kurztext, Zuständigkeit und Texteinträge direkt aus Winweb laden.</small></FormField>
      </div>
      {afnError && <p className="afn-preview-error">{afnError}</p>}
      {!wwapiConnected && parseAfns(afnText).length > 0 && <section className="wwapi-login"><h3>Mit Winweb verbinden</h3><p>Persönliche Winweb-Anmeldung zum Lesen der AFN. Das Passwort wird nicht gespeichert.</p><div><input value={wwapiUsername} onChange={(event) => setWwapiUsername(event.target.value)} autoComplete="username" placeholder="Winweb-Benutzer"/><input type="password" value={wwapiPassword} onChange={(event) => setWwapiPassword(event.target.value)} autoComplete="current-password" placeholder="Winweb-Passwort"/><button type="button" className="secondary-action" disabled={!wwapiUsername.trim() || !wwapiPassword || wwapiConnecting} onClick={connectWwapi}>{wwapiConnecting ? 'Verbindet …' : 'Verbinden'}</button></div></section>}
      {wwapiConnected && <div className="wwapi-connected"><span>Winweb verbunden · nur Lesen</span><button type="button" onClick={() => { disconnectWwapi(); setWwapiConnected(false); setAfnPreviews([]) }}>Trennen</button></div>}
      {afnPreviews.length > 0 && <section className="afn-previews"><h3>Winweb AFN</h3>{afnPreviews.map(({ requirement, entries }) => {
        const responsible = [requirement.user_1, requirement.user_2, requirement.user_selection, requirement.kanban_team].filter(Boolean).join(' · ')
        return <article className="afn-preview" key={requirement.gen}><header><strong>AFN {requirement.gen}</strong><span>{requirement.short_text || 'Ohne Kurztext'}</span></header><p className="afn-preview-responsible">Zuständig: {responsible || 'Nicht angegeben'}{requirement.kanban_state ? ` · ${requirement.kanban_state}` : ''}</p><div className="afn-preview-entries">{entries.length === 0 ? <p>Keine Texteinträge vorhanden.</p> : [...entries].sort((a, b) => String(a.date_insert ?? '').localeCompare(String(b.date_insert ?? ''))).map((entry) => <div key={entry.gen}><p>{entry.text || 'Ohne Text'}</p><small>{[entry.user_update || entry.user_insert, entry.date_update || entry.date_insert ? formatDateTime(new Date(entry.date_update || entry.date_insert!).getTime()) : ''].filter(Boolean).join(' · ')}</small></div>)}</div></article>
      })}</section>}
      {task && <section className="task-comments">
        <h3>Kommentare</h3>
        <div className="task-comment-list">{comments.length === 0 ? <p className="empty">Noch keine Kommentare.</p> : [...comments].sort((a, b) => a.createdAt - b.createdAt).map((comment) => {
          const author = profileName(comment.authorUserId, profiles, userId, userEmail)
          return <article key={comment.id} className="task-comment"><header><strong>{personInitials(author)}</strong><span>{author}</span><time>{formatDateTime(comment.createdAt)}</time></header><p>{comment.body}</p></article>
        })}</div>
        <div className="task-comment-compose"><textarea value={commentText} onChange={(event) => setCommentText(event.target.value)} rows={2} placeholder="Kommentar schreiben…"/><button type="button" className="primary" disabled={!commentText.trim() || commentSaving} onClick={addComment}>{commentSaving ? 'Wird gesendet…' : 'Abschicken'}</button></div>
        {commentError && <p className="task-comment-error">{commentError}</p>}
      </section>}
      <div className="dialog-actions">{task ? <button type="button" className="danger-action" onClick={async () => { if (confirm('Aufgabe löschen?')) { await deleteProjectTask(task.id); onClose() } }}>Aufgabe löschen</button> : <span/>}<span/>{task ? <><span/><button type="button" className="primary" disabled={!title.trim()} onClick={closeAndSave}>Schließen</button></> : <><button type="button" className="secondary-action" onClick={onClose}>Abbrechen</button><button className="primary" disabled={!title.trim()}>Speichern</button></>}</div>
    </form>
  </DialogShell>
}

function TeamEditDialog({ project, members, profiles, userId, userEmail, onClose }: { project: Project; members: ProjectMember[]; profiles: UserProfile[]; userId: string; userEmail?: string; onClose: () => void }) {
  const initialIds = new Set([project.ownerUserId, ...members.map((member) => member.userId)])
  const [ownerId, setOwnerId] = useState(project.ownerUserId)
  const [selected, setSelected] = useState(initialIds)
  const values = profiles.length ? profiles : [{ id: userId, email: userEmail ?? 'Ich', updatedAt: 0 }]
  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id) && id !== ownerId) next.delete(id)
    else next.add(id)
    setSelected(next)
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    await setProjectTeam(project.id, ownerId, [...selected, ownerId])
    onClose()
  }
  return <DialogShell title="Team bearbeiten" subtitle={projectDisplayName(project)} onClose={onClose}><form className="project-dialog-form" onSubmit={save}>
    <div className="dialog-form-grid"><FormField label="Hauptverantwortlich" wide><select value={ownerId} onChange={(event) => { setOwnerId(event.target.value); setSelected(new Set([...selected, event.target.value])) }}>{profileOptions(values, userId, userEmail)}</select></FormField></div>
    <div className="team-member-list">{values.map((profile) => <label key={profile.id}><input type="checkbox" checked={selected.has(profile.id)} disabled={profile.id === ownerId} onChange={() => toggle(profile.id)}/><span>{profile.displayName || profile.email}</span>{profile.id === ownerId && <small>Verantwortlich</small>}</label>)}</div>
    <div className="dialog-actions"><span/><span/><button type="button" className="secondary-action" onClick={onClose}>Abbrechen</button><button className="primary">Speichern</button></div>
  </form></DialogShell>
}

export function FormField({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <label className={`dialog-form-field${wide ? ' wide' : ''}`}><span>{label}</span>{children}</label>
}

function profileOptions(profiles: UserProfile[], userId: string, userEmail?: string, preferredIds?: string[]) {
  const values = profiles.length ? profiles : [{ id: userId, email: userEmail ?? 'Ich', updatedAt: 0 }]
  const preferred = new Set(preferredIds ?? [])
  const ordered = preferredIds ? [...values].sort((a, b) => Number(preferred.has(b.id)) - Number(preferred.has(a.id))) : values
  return ordered.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName || profile.email}{preferredIds && preferred.has(profile.id) ? ' · Team' : ''}</option>)
}

function profileName(id: string | undefined, profiles: UserProfile[], userId: string, userEmail?: string) {
  if (!id) return 'Nicht zugewiesen'
  const profile = profiles.find((value) => value.id === id)
  if (profile) return profile.displayName || profile.email
  if (id === userId) return userEmail || 'Ich'
  return 'Unbekannter Benutzer'
}

function personInitials(name: string) {
  if (name === 'Nicht zugewiesen') return '–'
  const parts = name.trim().split(/[\s.@_-]+/).filter(Boolean)
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)![0]}` : parts[0]?.slice(0, 2) || '?').toLocaleUpperCase('de')
}

function formatDate(value: number) { return new Date(value).toLocaleDateString('de-DE') }
function formatDateTime(value: number) { return new Date(value).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) }
function formatRange(start?: number, target?: number) {
  if (!start && !target) return 'Noch nicht festgelegt'
  return `${start ? formatDate(start) : 'Offen'} → ${target ? formatDate(target) : 'Offen'}`
}
function parseAfns(value: string) { return value.split(/[,;\s]+/).map(Number).filter((number) => Number.isInteger(number) && number > 0) }

function startOfToday() { const value = new Date(); value.setHours(0, 0, 0, 0); return value.getTime() }
function isOverdue(milestone: ProjectMilestone) { return !!milestone.dueDate && milestone.dueDate < startOfToday() && milestone.status !== 'completed' }
function milestoneSort(a: ProjectMilestone, b: ProjectMilestone) {
  const now = startOfToday()
  const aOverdue = !!a.dueDate && a.dueDate < now
  const bOverdue = !!b.dueDate && b.dueDate < now
  if (aOverdue !== bOverdue) return aOverdue ? -1 : 1
  return (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity)
}
function getNextMilestone(milestones: ProjectMilestone[]) {
  const open = milestones.filter((m) => m.status !== 'completed')
  const today = startOfToday()
  const upcoming = open.filter((m) => m.dueDate && m.dueDate >= today).sort((a,b) => a.dueDate! - b.dueDate!)
  if (upcoming.length) return upcoming[0]
  const overdue = open.filter((m) => m.dueDate && m.dueDate < today).sort((a,b) => a.dueDate! - b.dueDate!)
  return overdue[0] ?? open.filter((m) => !m.dueDate).sort((a,b) => a.sortOrder - b.sortOrder)[0]
}
function milestoneTiming(milestone: ProjectMilestone, open: number) {
  if (!milestone.dueDate || milestone.status === 'completed') return ''
  const days = Math.ceil((milestone.dueDate - startOfToday()) / 86400000)
  return days >= 0 && days <= 7 && open > 0 ? ` · ${days === 0 ? 'heute' : `in ${days} Tagen`} · ${open} offen` : ''
}

import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Project, ProjectMember, ProjectMilestone, ProjectMilestoneStatus, ProjectStatus, ProjectTask, ProjectTaskComment, ProjectTaskStatus, ProjectWaitingFor, UserProfile } from '../db/types'
import { createProject, createProjectMilestone, createProjectTask, createProjectTaskComment, deleteProject, deleteProjectMilestone, deleteProjectTask, moveProjectMilestone, replaceProjectTaskAfns, setProjectTeam, updateProject, updateProjectMilestone, updateProjectTask } from '../lib/projectActions'
import BufferedDateInput from './BufferedDateInput'
import type { ProjectNavigation } from '../lib/projectNavigation'
import { projectCustomer, projectDisplayName, projectShortName } from '../lib/projectDisplay'
import { syncAll } from '../lib/sync'
import './ProjectsView.css'

const projectStatus: Record<ProjectStatus, string> = { active: 'Aktiv', waiting: 'Wartet', completed: 'Abgeschlossen', archived: 'Archiviert' }
const taskStatus: Record<ProjectTaskStatus, string> = { open: 'Offen', in_progress: 'In Arbeit', waiting: 'Wartet', completed: 'Erledigt' }
const milestoneStatus: Record<ProjectMilestoneStatus, string> = { planned: 'Geplant', in_progress: 'In Arbeit', completed: 'Abgeschlossen' }
const waitingOptions: ProjectWaitingFor[] = ['Kunde', 'Entwicklung', 'Support', 'Vertrieb', 'Extern', 'Sonstige']
const taskFilters = ['all', 'open', 'in_progress', 'waiting', 'completed'] as const

interface Props { userId: string; userEmail?: string; navigation: ProjectNavigation; onNavigate: (navigation: ProjectNavigation) => void }
type TaskFilter = typeof taskFilters[number]

export default function ProjectsView({ userId, userEmail, navigation, onNavigate }: Props) {
  const projects = useLiveQuery(() => db.projects.filter((project) => !project.deletedAt).toArray(), []) ?? []
  const tasks = useLiveQuery(() => db.projectTasks.filter((task) => !task.deletedAt).toArray(), []) ?? []
  const milestones = useLiveQuery(() => db.projectMilestones.filter((milestone) => !milestone.deletedAt).toArray(), []) ?? []
  const afns = useLiveQuery(() => db.projectTaskAfns.filter((afn) => !afn.deletedAt).toArray(), []) ?? []
  const profiles = useLiveQuery(() => db.userProfiles.toArray(), []) ?? []
  const members = useLiveQuery(() => db.projectMembers.filter((member) => !member.deletedAt).toArray(), []) ?? []
  const comments = useLiveQuery(() => db.projectTaskComments.filter((comment) => !comment.deletedAt).toArray(), []) ?? []
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
  const dueToday = sortedMine.filter((task) => task.dueDate && task.dueDate >= today.getTime() && task.dueDate < tomorrow)
  const withoutDueDate = sortedMine.filter((task) => !task.dueDate)
  const otherDueTasks = sortedMine.filter((task) => task.dueDate && (task.dueDate < today.getTime() || task.dueDate >= tomorrow))

  if (selected) {
    return <ProjectDetail key={`${selected.id}:${selectedTaskId ?? ''}`} project={selected} tasks={tasks.filter((task) => task.projectId === selected.id)} milestones={milestones.filter((milestone) => milestone.projectId === selected.id)} afns={afns} comments={comments}
      profiles={profiles} members={members.filter((member) => member.projectId === selected.id)} userId={userId} userEmail={userEmail} filter={taskFilter} setFilter={setTaskFilter}
      initialTaskId={selectedTaskId} onBack={() => onNavigate({ type: 'overview' })} />
  }

  if (navigation.type === 'customer') return <CustomerOverview customerName={navigation.name} projects={projects} tasks={tasks} milestones={milestones} afns={afns} profiles={profiles} userId={userId} userEmail={userEmail} onOpenProject={(id) => onNavigate({ type: 'project', id })} onBack={() => onNavigate({ type: 'overview' })}/>

  const effectiveSection = navigation.type === 'status' ? 'projects' : section
  const listProjects = navigation.type === 'status' ? projects.filter((project) => project.status === navigation.status) : (showClosed ? projects : activeProjects)

  return <main className="projects-view"><div className="project-page-content">
    <header className="projects-header"><div><p className="projects-eyebrow">Arbeitsbereich</p><h1>{navigation.type === 'status' ? projectStatus[navigation.status] : 'Projekte'}</h1></div><button className="primary" onClick={async () => onNavigate({ type: 'project', id: await createProject({ name: 'Neues Projekt', ownerUserId: userId }) })}>+ Neues Projekt</button></header>
    <nav className="project-tabs"><button className={effectiveSection === 'dashboard' ? 'active' : ''} onClick={() => { setSection('dashboard'); onNavigate({ type: 'overview' }) }}>Übersicht</button><button className={effectiveSection === 'projects' ? 'active' : ''} onClick={() => { setSection('projects'); onNavigate({ type: 'overview' }) }}>Projekte</button></nav>
    {effectiveSection === 'dashboard' ? <>
      <div className="project-metrics"><Metric label="Aktive Projekte" value={activeProjects.length}/><Metric label="Meine offenen Aufgaben" value={mine.length}/><Metric label="Wartet auf andere" value={mine.filter((task) => task.status === 'waiting').length}/><Metric label="Meilensteine in 30 Tagen" value={milestones.filter((m) => m.status !== 'completed' && m.dueDate && m.dueDate >= today.getTime() && m.dueDate <= today.getTime() + 30 * 86400000).length}/></div>
      <UpcomingMilestones milestones={milestones} tasks={tasks} projects={projects} onOpen={(id) => onNavigate({ type: 'project', id })}/>
      <TaskOverview title="Heute fällig" tasks={dueToday} projects={projects} afns={afns} onOpen={(projectId, taskId) => onNavigate({ type: 'project', id: projectId, taskId })}/>
      <TaskOverview title="Ohne Fälligkeitsdatum" tasks={withoutDueDate} projects={projects} afns={afns} onOpen={(projectId, taskId) => onNavigate({ type: 'project', id: projectId, taskId })}/>
      {otherDueTasks.length > 0 && <div className="task-overview-toolbar"><button className="secondary-action other-tasks-toggle" onClick={() => setShowOtherDueTasks((value) => !value)}>{showOtherDueTasks ? 'Andere Termine ausblenden' : `Andere Termine anzeigen (${otherDueTasks.length})`}</button></div>}
      {showOtherDueTasks && <TaskOverview title="Andere Termine" tasks={otherDueTasks} projects={projects} afns={afns} onOpen={(projectId, taskId) => onNavigate({ type: 'project', id: projectId, taskId })}/>}
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
    <CustomerSection title="Offene Aufgaben" empty="Keine offenen Aufgaben.">{openTasks.map((task) => { const project = customerProjects.find((item) => item.id === task.projectId); const taskAfns = afns.filter((afn) => afn.taskId === task.id); return <button className="customer-row customer-task-row" key={task.id} onClick={() => onOpenProject(task.projectId)}><span><small>{project ? (projectShortName(project) || 'Allgemeines Projekt') : 'Unbekanntes Projekt'}</small><strong>{task.title}</strong>{taskAfns.length > 0 && <small>{taskAfns.map((afn) => `AFN ${afn.afnNumber}`).join(', ')}</small>}</span><span>{profileName(task.assigneeUserId, profiles, userId, userEmail)}</span><span>{task.dueDate ? formatDate(task.dueDate) : 'Ohne Termin'}</span><StatusBadge status={task.status} label={taskStatus[task.status]}/></button>})}</CustomerSection>
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

function TaskOverview({ title, tasks, projects, afns, onOpen }: { title: string; tasks: ProjectTask[]; projects: Project[]; afns: { taskId: string; afnNumber: number }[]; onOpen: (projectId: string, taskId: string) => void }) {
  return <section className="project-section overview-task-section"><h2>{title}</h2>{tasks.length === 0 ? <p className="empty">Hier ist gerade nichts offen.</p> : <div className="overview-task-list">{tasks.map((task) => {
    const project = projects.find((item) => item.id === task.projectId)
    const taskAfns = afns.filter((afn) => afn.taskId === task.id)
    return <ProjectTaskRow key={task.id} task={task} project={project} afns={taskAfns.map((afn) => afn.afnNumber)} onOpen={() => onOpen(task.projectId, task.id)}/>
  })}</div>}</section>
}

function ProjectTaskRow({ task, project, afns, onOpen }: { task: ProjectTask; project?: Project; afns: number[]; onOpen: () => void }) {
  return <div className="overview-task-row">
    <button className="overview-task-main" onClick={onOpen}>
      {project && <span className="overview-customer">[{projectCustomer(project)}]</span>}
      {project && projectShortName(project) && <span className="overview-project">{projectShortName(project)}</span>}
      <span className="overview-task-title">{task.title}</span>
      {afns.length > 0 && <span className="overview-afns">{afns.map((afn) => `AFN ${afn}`).join(', ')}</span>}
    </button>
    <label className="overview-due-date" aria-label={`Termin für ${task.title}`}><BufferedDateInput value={task.dueDate} onSave={(dueDate) => updateProjectTask(task.id, { dueDate })}/></label>
    <StatusBadge status={task.status} label={taskStatus[task.status]}/>
  </div>
}

function ProjectDetail({ project, tasks, milestones, afns, comments, profiles, members, userId, userEmail, filter, setFilter, initialTaskId, onBack }: { project: Project; tasks: ProjectTask[]; milestones: ProjectMilestone[]; afns: { taskId: string; afnNumber: number }[]; comments: ProjectTaskComment[]; profiles: UserProfile[]; members: ProjectMember[]; userId: string; userEmail?: string; filter: TaskFilter; setFilter: (value: TaskFilter) => void; initialTaskId?: string; onBack: () => void }) {
  const [editingProject, setEditingProject] = useState(false)
  const [editingTask, setEditingTask] = useState<ProjectTask | 'new' | null>(() => tasks.find((task) => task.id === initialTaskId) ?? null)
  const [editingMilestone, setEditingMilestone] = useState<ProjectMilestone | 'new' | null>(null)
  const [openedMilestoneId, setOpenedMilestoneId] = useState<string | null>(null)
  const [taskMilestonePreset, setTaskMilestonePreset] = useState<string | undefined>()
  const [editingTeam, setEditingTeam] = useState(false)
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const visibleTasks = useMemo(() => [...tasks].filter((task) => (filter === 'all' || task.status === filter) && (assigneeFilter === 'all' || task.assigneeUserId === assigneeFilter)).sort((a, b) => a.sortOrder - b.sortOrder), [tasks, filter, assigneeFilter])
  const counts = Object.fromEntries(taskFilters.map((value) => [value, value === 'all' ? tasks.length : tasks.filter((task) => task.status === value).length]))
  const ownerName = profileName(project.ownerUserId, profiles, userId, userEmail)
  const teamIds = [...new Set([project.ownerUserId, ...members.map((member) => member.userId)])]
  const teamProfiles = teamIds.map((id) => profiles.find((profile) => profile.id === id)).filter((profile): profile is UserProfile => Boolean(profile))
  const nextMilestone = getNextMilestone(milestones)

  return <main className="projects-view project-detail-view">
    <div className="project-detail-content">
      <button className="back-link" onClick={onBack}>← Projekte</button>
      <header className="project-read-header">
        <div className="project-read-title">
          <h1><span>{projectCustomer(project)}</span>{projectShortName(project) && <><i> | </i>{projectShortName(project)}</>}</h1>
          <p><span>Verantwortlich: {personInitials(ownerName)}</span><span>Team: {teamIds.map((id) => personInitials(profileName(id, profiles, userId, userEmail))).join(', ')}</span><span>Zeitraum: {formatRange(project.startDate, project.targetDate)}</span></p>
        </div>
        <div className="project-header-actions"><button className="secondary-action compact" onClick={() => setEditingProject(true)}>Projekt bearbeiten</button><button className="secondary-action compact" onClick={() => setEditingTeam(true)}>Team bearbeiten</button><StatusBadge status={project.status} label={projectStatus[project.status]}/></div>
      </header>

      {nextMilestone && <NextMilestone milestone={nextMilestone} tasks={tasks} onOpen={() => setOpenedMilestoneId(nextMilestone.id)}/>}

      <section className="project-tasks-section">
        <div className="project-tasks-heading"><div><p className="projects-eyebrow">Projektarbeit</p><h2>Aufgaben</h2></div><button className="primary compact" onClick={() => { setTaskMilestonePreset(undefined); setEditingTask('new') }}>+ Aufgabe</button></div>
        <div className="task-filter-bar" aria-label="Aufgaben filtern">{taskFilters.map((value) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}><span>{value === 'all' ? 'Alle' : taskStatus[value]}</span><strong>{counts[value]}</strong></button>)}</div>
        <label className="assignee-filter">Verantwortlich<select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}><option value="all">Alle</option><option value={userId}>Meine</option>{teamProfiles.filter((profile) => profile.id !== userId).map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName || profile.email}</option>)}</select></label>
        <div className="overview-task-list project-detail-task-list">{visibleTasks.length === 0 ? <div className="project-empty-state"><strong>Keine Aufgaben in diesem Filter</strong><span>Über „+ Aufgabe“ kannst du eine neue Projektaufgabe anlegen.</span></div> : visibleTasks.map((task) => <ProjectTaskRow key={task.id} project={project} task={task} afns={afns.filter((afn) => afn.taskId === task.id).map((afn) => afn.afnNumber)} onOpen={() => setEditingTask(task)}/>)}</div>
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
      <TaskEditDialog projectId={project.id} task={editingTask === 'new' ? undefined : editingTask} milestones={milestones} milestonePreset={taskMilestonePreset}
        profiles={profiles} memberIds={teamIds} userId={userId} userEmail={userEmail}
        afns={editingTask === 'new' ? [] : afns.filter((afn) => afn.taskId === editingTask.id).map((afn) => afn.afnNumber)}
        comments={editingTask === 'new' ? [] : comments.filter((comment) => comment.taskId === editingTask.id)}
        onClose={() => setEditingTask(null)}/>
    )}
    {editingMilestone && <MilestoneEditDialog projectId={project.id} milestone={editingMilestone === 'new' ? undefined : editingMilestone} onClose={() => setEditingMilestone(null)}/>}
    {editingTeam && <TeamEditDialog project={project} members={members} profiles={profiles} userId={userId} userEmail={userEmail} onClose={() => setEditingTeam(false)}/>}
    {openedMilestoneId && milestones.find((m) => m.id === openedMilestoneId) && <MilestoneDetailDialog milestone={milestones.find((m) => m.id === openedMilestoneId)!} tasks={tasks.filter((task) => task.milestoneId === openedMilestoneId)} onTask={(task) => { setOpenedMilestoneId(null); setEditingTask(task) }} onAddTask={() => { setTaskMilestonePreset(openedMilestoneId); setOpenedMilestoneId(null); setEditingTask('new') }} onClose={() => setOpenedMilestoneId(null)}/>}
  </main>
}

function DialogShell({ title, subtitle, children, onClose }: { title: string; subtitle: string; children: ReactNode; onClose: () => void }) {
  return <div className="project-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="project-dialog" role="dialog" aria-modal="true" aria-label={title}>
      <header><div><p className="projects-eyebrow">{subtitle}</p><h2>{title}</h2></div><button className="dialog-close" onClick={onClose} aria-label="Dialog schließen">×</button></header>
      {children}
    </section>
  </div>
}

function ProjectEditDialog({ project, onClose, onDeleted }: { project: Project; onClose: () => void; onDeleted: () => void }) {
  const [draft, setDraft] = useState(() => ({ ...project, name: projectShortName(project) ?? '', customerName: projectCustomer(project) }))
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.customerName?.trim()) return
    await updateProject(project.id, {
      name: draft.name.trim(),
      customerName: draft.customerName.trim(),
      ownerUserId: draft.ownerUserId,
      status: draft.status,
      startDate: draft.startDate,
      targetDate: draft.targetDate,
      description: draft.description,
    })
    onClose()
  }
  return <DialogShell title="Projekt bearbeiten" subtitle={projectDisplayName(project)} onClose={onClose}>
    <form className="project-dialog-form" onSubmit={save}>
      <div className="dialog-form-grid">
        <FormField label="Kunde" wide><input value={draft.customerName ?? ''} onChange={(event) => setDraft({ ...draft, customerName: event.target.value })} autoFocus required /></FormField>
        <FormField label="Projektname" wide><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Optional, z. B. Supermarkt" /></FormField>
        <FormField label="Status"><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ProjectStatus })}>{Object.entries(projectStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
        <FormField label="Startdatum"><BufferedDateInput value={draft.startDate} onSave={(value) => setDraft({ ...draft, startDate: value })}/></FormField>
        <FormField label="Zieltermin"><BufferedDateInput value={draft.targetDate} onSave={(value) => setDraft({ ...draft, targetDate: value })}/></FormField>
        <FormField label="Beschreibung" wide><textarea value={draft.description ?? ''} onChange={(event) => setDraft({ ...draft, description: event.target.value || undefined })} rows={4}/></FormField>
      </div>
      <div className="dialog-actions"><button type="button" className="danger-action" onClick={async () => { if (confirm(`Projekt „${projectDisplayName(project)}“ löschen?`)) { await deleteProject(project.id); onDeleted() } }}>Projekt löschen</button><span/><button type="button" className="secondary-action" onClick={onClose}>Abbrechen</button><button className="primary" disabled={!draft.customerName?.trim()}>Speichern</button></div>
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
  return <DialogShell title={milestone.title} subtitle="Meilenstein" onClose={onClose}><div className="milestone-detail"><p>{milestone.description || 'Keine Beschreibung hinterlegt.'}</p><div className="milestone-detail-meta"><span>{milestone.dueDate ? formatDate(milestone.dueDate) : 'Ohne Datum'}</span><StatusBadge status={milestone.status} label={milestoneStatus[milestone.status]}/></div><strong>{tasks.length ? `${done} von ${tasks.length} Aufgaben erledigt` : 'Noch keine Aufgaben'}</strong>{tasks.length > 0 && <div className="milestone-progress"><i style={{width: `${done / tasks.length * 100}%`}}/></div>}<div className="milestone-task-list">{tasks.map((task) => <button key={task.id} onClick={() => onTask(task)}><span>{task.status === 'completed' ? '✓' : '○'}</span>{task.title}</button>)}</div><button className="primary compact" onClick={onAddTask}>+ Aufgabe</button></div></DialogShell>
}

function TaskEditDialog({ projectId, task, milestones, milestonePreset, afns, comments, profiles, memberIds, userId, userEmail, onClose }: { projectId: string; task?: ProjectTask; milestones: ProjectMilestone[]; milestonePreset?: string; afns: number[]; comments: ProjectTaskComment[]; profiles: UserProfile[]; memberIds: string[]; userId: string; userEmail?: string; onClose: () => void }) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [status, setStatus] = useState<ProjectTaskStatus>(task?.status ?? 'open')
  const [dueDate, setDueDate] = useState(task?.dueDate)
  const [assigneeUserId, setAssigneeUserId] = useState(task ? (task.assigneeUserId ?? '') : userId)
  const [waitingFor, setWaitingFor] = useState<ProjectWaitingFor | undefined>(task?.waitingFor)
  const [milestoneId, setMilestoneId] = useState(task?.milestoneId ?? milestonePreset ?? '')
  const [afnText, setAfnText] = useState(afns.join(', '))
  const [commentText, setCommentText] = useState('')
  const [commentSaving, setCommentSaving] = useState(false)
  const [commentError, setCommentError] = useState('')

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    const id = task?.id ?? await createProjectTask(projectId, title, assigneeUserId || undefined)
    await updateProjectTask(id, { title: title.trim(), description: description.trim() || undefined, status, dueDate, milestoneId: milestoneId || undefined, assigneeUserId: assigneeUserId || undefined, waitingFor: status === 'waiting' ? waitingFor : undefined })
    await replaceProjectTaskAfns(id, parseAfns(afnText))
    onClose()
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

  return <DialogShell title={task ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'} subtitle="Projektaufgabe" onClose={onClose}>
    <form className="project-dialog-form" onSubmit={save}>
      <div className="dialog-form-grid">
        <FormField label="Titel" wide><input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus required /></FormField>
        <FormField label="Beschreibung" wide><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} placeholder="Optional" /></FormField>
        <FormField label="Status"><select value={status} onChange={(event) => setStatus(event.target.value as ProjectTaskStatus)}>{Object.entries(taskStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
        <FormField label="Termin"><BufferedDateInput value={dueDate} onSave={setDueDate}/></FormField>
        <FormField label="Verantwortlich"><select value={assigneeUserId} onChange={(event) => setAssigneeUserId(event.target.value)}><option value="">Nicht zugewiesen</option>{profileOptions(profiles, userId, userEmail, memberIds)}</select></FormField>
        <FormField label="Meilenstein"><select value={milestoneId} onChange={(event) => setMilestoneId(event.target.value)}><option value="">Kein Meilenstein</option>{milestones.filter((m) => m.status !== 'completed' || m.id === task?.milestoneId).sort((a,b) => a.sortOrder - b.sortOrder).map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select></FormField>
        {status === 'waiting' && <FormField label="Wartet auf"><select value={waitingFor ?? ''} onChange={(event) => setWaitingFor((event.target.value || undefined) as ProjectWaitingFor | undefined)}><option value="">Bitte wählen</option>{waitingOptions.map((value) => <option key={value}>{value}</option>)}</select></FormField>}
        <FormField label="AFN-Nummern" wide><input value={afnText} onChange={(event) => setAfnText(event.target.value)} inputMode="numeric" placeholder="181657, 181658"/><small>Mehrere Nummern mit Komma trennen.</small></FormField>
      </div>
      {task && <section className="task-comments">
        <h3>Kommentare</h3>
        <div className="task-comment-list">{comments.length === 0 ? <p className="empty">Noch keine Kommentare.</p> : [...comments].sort((a, b) => a.createdAt - b.createdAt).map((comment) => {
          const author = profileName(comment.authorUserId, profiles, userId, userEmail)
          return <article key={comment.id} className="task-comment"><header><strong>{personInitials(author)}</strong><span>{author}</span><time>{formatDateTime(comment.createdAt)}</time></header><p>{comment.body}</p></article>
        })}</div>
        <div className="task-comment-compose"><textarea value={commentText} onChange={(event) => setCommentText(event.target.value)} rows={2} placeholder="Kommentar schreiben…"/><button type="button" className="primary" disabled={!commentText.trim() || commentSaving} onClick={addComment}>{commentSaving ? 'Wird gesendet…' : 'Abschicken'}</button></div>
        {commentError && <p className="task-comment-error">{commentError}</p>}
      </section>}
      <div className="dialog-actions">{task ? <button type="button" className="danger-action" onClick={async () => { if (confirm('Aufgabe löschen?')) { await deleteProjectTask(task.id); onClose() } }}>Aufgabe löschen</button> : <span/>}<span/><button type="button" className="secondary-action" onClick={onClose}>Abbrechen</button><button className="primary" disabled={!title.trim()}>Speichern</button></div>
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

function FormField({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
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

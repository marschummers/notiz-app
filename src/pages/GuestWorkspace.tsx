import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { projectDisplayName } from '../lib/projectDisplay'
import { supabase } from '../lib/supabaseClient'
import type { Project, ProjectMilestone, ProjectSection, ProjectTask, ProjectTaskComment, UserProfile } from '../db/types'
import './GuestWorkspace.css'

const taskStatus = { open: 'Offen', in_progress: 'In Arbeit', waiting: 'Wartet', completed: 'Erledigt' }
const ms = (value: string) => new Date(value).getTime()

export default function GuestWorkspace() {
  const { session, signOut } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<ProjectTask[]>([])
  const [milestones, setMilestones] = useState<ProjectMilestone[]>([])
  const [sections, setSections] = useState<ProjectSection[]>([])
  const [comments, setComments] = useState<ProjectTaskComment[]>([])
  const [profiles, setProfiles] = useState<UserProfile[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string>()
  const [selectedTask, setSelectedTask] = useState<ProjectTask | null>(null)
  const [comment, setComment] = useState('')
  const [syncing, setSyncing] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [guestName, setGuestName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)

  async function refresh() {
    if (!supabase) return
    setSyncing(true)
    setError(null)
    try {
      const [projectResult, taskResult, milestoneResult, sectionResult, commentResult, profileResult] = await Promise.all([
        supabase.from('notiz_projects').select('*').is('deleted_at', null),
        supabase.from('notiz_project_tasks').select('*').is('deleted_at', null),
        supabase.from('notiz_project_milestones').select('*').is('deleted_at', null),
        supabase.from('notiz_project_sections').select('*').is('deleted_at', null),
        supabase.from('notiz_project_task_comments').select('*').is('deleted_at', null),
        supabase.from('notiz_profiles').select('id,email,display_name,is_guest,updated_at'),
      ])
      const firstError = [projectResult.error, taskResult.error, milestoneResult.error, sectionResult.error, commentResult.error, profileResult.error].find(Boolean)
      if (firstError) throw firstError
      setProjects((projectResult.data ?? []).map((row) => ({ id: row.id, name: row.name, customerName: row.customer_name ?? undefined, ownerUserId: row.owner_user_id, status: row.status, startDate: row.start_date ? ms(row.start_date) : undefined, targetDate: row.target_date ? ms(row.target_date) : undefined, description: row.description ?? undefined, customField1Label: row.custom_field_1_label ?? undefined, customField2Label: row.custom_field_2_label ?? undefined, createdAt: ms(row.created_at), updatedAt: ms(row.updated_at) })))
      setTasks((taskResult.data ?? []).map((row) => ({ id: row.id, projectId: row.project_id, milestoneId: row.milestone_id ?? undefined, sectionId: row.section_id ?? undefined, title: row.title, description: row.description ?? undefined, assigneeUserId: row.assignee_user_id ?? undefined, status: row.status, dueDate: row.due_date ? ms(row.due_date) : undefined, waitingFor: row.waiting_for ?? undefined, customField1Value: row.custom_field_1_value ?? undefined, customField2Value: row.custom_field_2_value ?? undefined, sortOrder: row.sort_order, createdAt: ms(row.created_at), updatedAt: ms(row.updated_at) })))
      setMilestones((milestoneResult.data ?? []).map((row) => ({ id: row.id, projectId: row.project_id, title: row.title, description: row.description ?? undefined, dueDate: row.due_date ? ms(row.due_date) : undefined, status: row.status, sortOrder: row.sort_order, createdAt: ms(row.created_at), updatedAt: ms(row.updated_at) })))
      setSections((sectionResult.data ?? []).map((row) => ({ id: row.id, projectId: row.project_id, milestoneId: row.milestone_id, title: row.title, sortOrder: row.sort_order, createdAt: ms(row.created_at), updatedAt: ms(row.updated_at) })))
      setComments((commentResult.data ?? []).map((row) => ({ id: row.id, taskId: row.task_id, authorUserId: row.author_user_id, body: row.body, createdAt: ms(row.created_at), updatedAt: ms(row.updated_at) })))
      setProfiles((profileResult.data ?? []).map((row) => ({ id: row.id, email: row.email, displayName: row.display_name ?? undefined, isGuest: row.is_guest ?? false, updatedAt: ms(row.updated_at) })))
    } catch (value) { setError(value instanceof Error ? value.message : String(value)) }
    finally { setSyncing(false) }
  }
  useEffect(() => { void refresh() }, [])
  useEffect(() => { if (!selectedProjectId && projects[0]) setSelectedProjectId(projects[0].id) }, [projects, selectedProjectId])

  const project = projects.find((row) => row.id === selectedProjectId) ?? projects[0]
  const projectTasks = useMemo(() => tasks.filter((row) => row.projectId === project?.id).sort((a, b) => a.sortOrder - b.sortOrder), [tasks, project?.id])
  const projectMilestones = milestones.filter((row) => row.projectId === project?.id).sort((a, b) => a.sortOrder - b.sortOrder)
  const projectSections = sections.filter((row) => row.projectId === project?.id).sort((a, b) => a.sortOrder - b.sortOrder)
  const taskComments = comments.filter((row) => row.taskId === selectedTask?.id).sort((a, b) => a.createdAt - b.createdAt)
  const ownProfile = profiles.find((row) => row.id === session?.user.id)
  const profileLabel = (id?: string) => {
    if (!id) return 'Nicht zugewiesen'
    const profile = profiles.find((row) => row.id === id)
    return profile?.displayName || profile?.email || 'Projektmitglied'
  }

  async function submitComment(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !selectedTask || !session?.user.id || !comment.trim()) return
    setError(null)
    const now = new Date().toISOString()
    const { error: insertError } = await supabase.from('notiz_project_task_comments').insert({ id: crypto.randomUUID(), task_id: selectedTask.id, author_user_id: session.user.id, body: comment.trim(), created_at: now, updated_at: now })
    if (insertError) { setError(insertError.message); return }
    setComment('')
    await refresh()
  }

  async function saveGuestName(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !guestName.trim()) return
    setSavingName(true)
    const { error: nameError } = await supabase.rpc('notiz_update_own_profile', { p_email: session?.user.email ?? '', p_display_name: guestName.trim() })
    if (nameError) setError(nameError.message)
    else await refresh()
    setSavingName(false)
  }

  async function updateOwnTaskStatus(task: ProjectTask, status: ProjectTask['status']) {
    if (!supabase || task.assigneeUserId !== session?.user.id) return
    let waitingFor: string | null = null
    if (status === 'waiting') {
      const value = prompt('Auf wen oder was wartet die Aufgabe?', task.waitingFor ?? '')
      if (value === null) return
      waitingFor = value.trim() || null
    }
    setUpdatingStatus(true)
    setError(null)
    const { error: statusError } = await supabase.rpc('notiz_guest_update_own_task_status', {
      p_task_id: task.id,
      p_status: status,
      p_waiting_for: waitingFor,
    })
    if (statusError) setError(statusError.message)
    else {
      setSelectedTask({ ...task, status, waitingFor: status === 'waiting' ? waitingFor ?? undefined : undefined })
      await refresh()
    }
    setUpdatingStatus(false)
  }

  function renderTaskRows(rows: ProjectTask[]) {
    return rows.map((task) => <button key={task.id} onClick={() => setSelectedTask(task)}>
      <span className="guest-task-title"><strong>{task.title}</strong>{task.waitingFor && <small>Wartet auf: {task.waitingFor}</small>}</span>
      <span data-label={project?.customField1Label || 'Phase'}>{task.customField1Value || '–'}</span>
      <span data-label={project?.customField2Label || 'Priorität'}>{task.customField2Value || '–'}</span>
      <span data-label="Verantwortlich">{profileLabel(task.assigneeUserId)}</span>
      <span data-label="Termin">{task.dueDate ? new Date(task.dueDate).toLocaleDateString('de-DE') : '–'}</span>
      <em data-label="Status">{taskStatus[task.status]}</em>
    </button>)
  }

  return <div className="guest-workspace">
    <header className="guest-header"><div><small>Gastzugang</small><h1>Freigegebene Projekte</h1></div><div><span>{session?.user.email}</span><button onClick={refresh} disabled={syncing}>{syncing ? 'Synchronisiert…' : 'Aktualisieren'}</button><button onClick={signOut}>Abmelden</button></div></header>
    {error && <p className="guest-error">{error}</p>}
    {!syncing && projects.length === 0 ? <main className="guest-empty"><h2>Keine Projektfreigabe gefunden</h2><p>Bitte prüfe, ob die Einladung angenommen oder der Zugang widerrufen wurde.</p></main> : project && <main className="guest-content">
      {projects.length > 1 && <nav className="guest-project-tabs">{projects.map((row) => <button className={row.id === project.id ? 'active' : ''} onClick={() => { setSelectedProjectId(row.id); setSelectedTask(null) }} key={row.id}>{projectDisplayName(row)}</button>)}</nav>}
      <section className="guest-project-card"><small>Projekt</small><h2>{projectDisplayName(project)}</h2>{project.description && <p>{project.description}</p>}</section>
      <section className="guest-task-section"><h2>Aufgaben</h2>{projectTasks.length === 0 ? <p>Noch keine Aufgaben.</p> : <div className="guest-task-table">
        <div className="guest-task-columns"><span>Aufgabe</span><span>{project.customField1Label || 'Phase'}</span><span>{project.customField2Label || 'Priorität'}</span><span>Verantwortlich</span><span>Termin</span><span>Status</span></div>
        <div className="guest-task-groups">
          {projectTasks.filter((task) => !task.milestoneId).length > 0 && <section className="guest-task-group"><h3>Allgemeine Aufgaben</h3><div className="guest-task-list">{renderTaskRows(projectTasks.filter((task) => !task.milestoneId))}</div></section>}
          {projectMilestones.map((milestone) => {
            const milestoneTasks = projectTasks.filter((task) => task.milestoneId === milestone.id)
            const completed = milestoneTasks.filter((task) => task.status === 'completed').length
            const milestoneSections = projectSections.filter((section) => section.milestoneId === milestone.id)
            return <details className="guest-milestone" open key={milestone.id}><summary><strong>{milestone.title}</strong><span>{milestone.dueDate ? new Date(milestone.dueDate).toLocaleDateString('de-DE') : ''}</span><em>{completed} / {milestoneTasks.length} erledigt</em></summary>
              {milestoneTasks.filter((task) => !task.sectionId).length > 0 && <div className="guest-task-list">{renderTaskRows(milestoneTasks.filter((task) => !task.sectionId))}</div>}
              {milestoneSections.map((section) => <details className="guest-section" open key={section.id}><summary><strong>{section.title}</strong><span>{milestoneTasks.filter((task) => task.sectionId === section.id).length} Aufgaben</span></summary><div className="guest-task-list">{renderTaskRows(milestoneTasks.filter((task) => task.sectionId === section.id))}</div></details>)}
            </details>
          })}
        </div>
      </div>}</section>
    </main>}
    {!syncing && ownProfile && !ownProfile.displayName?.trim() && <div className="guest-name-backdrop"><form className="guest-name-dialog" onSubmit={saveGuestName}><small>Gastprofil</small><h2>Wie sollen wir dich anzeigen?</h2><p>Dein Name wird im Projekt bei Verantwortlichkeiten und Kommentaren angezeigt.</p><label><span>Vor- und Nachname</span><input value={guestName} onChange={(event) => setGuestName(event.target.value)} autoFocus autoComplete="name"/></label><button disabled={!guestName.trim() || savingName}>{savingName ? 'Wird gespeichert …' : 'Namen speichern'}</button></form></div>}
    {selectedTask && <div className="guest-task-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedTask(null) }}><section className="guest-task-dialog" role="dialog" aria-modal="true">
      <header><div><small>Aufgabe</small><h2>{selectedTask.title}</h2></div><button onClick={() => setSelectedTask(null)} aria-label="Schließen">×</button></header>
      {selectedTask.description && <p>{selectedTask.description}</p>}
      <dl className="guest-task-details">
        <div><dt>{project?.customField1Label || 'Phase'}</dt><dd>{selectedTask.customField1Value || '–'}</dd></div>
        <div><dt>{project?.customField2Label || 'Priorität'}</dt><dd>{selectedTask.customField2Value || '–'}</dd></div>
        <div><dt>Verantwortlich</dt><dd>{profileLabel(selectedTask.assigneeUserId)}</dd></div>
        <div><dt>Termin</dt><dd>{selectedTask.dueDate ? new Date(selectedTask.dueDate).toLocaleDateString('de-DE') : '–'}</dd></div>
        <div><dt>Status</dt><dd>{taskStatus[selectedTask.status]}</dd></div>
        {selectedTask.waitingFor && <div><dt>Wartet auf</dt><dd>{selectedTask.waitingFor}</dd></div>}
      </dl>
      {selectedTask.assigneeUserId === session?.user.id && <section className="guest-own-task-status"><div><strong>Meine Aufgabe</strong><small>Du kannst den Bearbeitungsstatus dieser Aufgabe ändern.</small></div><div>{(['open', 'in_progress', 'waiting', 'completed'] as const).map((status) => <button key={status} className={selectedTask.status === status ? 'active' : ''} disabled={updatingStatus || selectedTask.status === status} onClick={() => updateOwnTaskStatus(selectedTask, status)}>{taskStatus[status]}</button>)}</div></section>}
      <h3>Kommentare</h3><div className="guest-comments">{taskComments.length === 0 ? <p>Noch keine Kommentare.</p> : taskComments.map((entry) => { const author = profiles.find((profile) => profile.id === entry.authorUserId); return <article key={entry.id}><strong>{author?.displayName || author?.email || 'Projektmitglied'}</strong><time>{new Date(entry.createdAt).toLocaleString('de-DE')}</time><p>{entry.body}</p></article> })}</div>
      <form onSubmit={submitComment}><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Kommentar schreiben …" rows={3}/><button disabled={!comment.trim()}>Kommentieren</button></form>
    </section></div>}
  </div>
}

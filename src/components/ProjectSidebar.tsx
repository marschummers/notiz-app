import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { createProject } from '../lib/projectActions'
import type { ProjectNavigation } from '../lib/projectNavigation'
import { projectCustomer, projectDisplayName } from '../lib/projectDisplay'

export default function ProjectSidebar({ userId, navigation, onNavigate }: { userId: string; navigation: ProjectNavigation; onNavigate: (navigation: ProjectNavigation) => void }) {
  const [search, setSearch] = useState('')
  const projects = useLiveQuery(() => db.projects.filter((project) => !project.deletedAt).toArray(), []) ?? []
  const query = search.trim().toLocaleLowerCase('de')
  const results = query ? projects.filter((project) => projectDisplayName(project).toLocaleLowerCase('de').includes(query)).slice(0, 8) : []
  const mine = projects.filter((project) => project.ownerUserId === userId && (project.status === 'active' || project.status === 'waiting')).sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const customerNames = new Map<string, string>()
  for (const project of projects) {
    const name = projectCustomer(project)
    if (name && !customerNames.has(name.toLocaleLowerCase('de'))) customerNames.set(name.toLocaleLowerCase('de'), name)
  }
  const customers = [...customerNames.values()].sort((a, b) => a.localeCompare(b, 'de'))

  async function addProject() {
    const id = await createProject({ name: 'Neues Projekt', ownerUserId: userId })
    onNavigate({ type: 'project', id })
  }

  return <div className="project-sidebar-content">
    <div className="sidebar-section project-sidebar-tools">
      <div className="sidebar-heading"><span>Projekte</span></div>
      <input className="project-sidebar-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Projekte durchsuchen…" aria-label="Projekte durchsuchen" />
      {query && <div className="project-sidebar-results">{results.length ? results.map((project) => <SidebarLink key={project.id} label={projectDisplayName(project)} active={navigation.type === 'project' && navigation.id === project.id} onClick={() => onNavigate({ type: 'project', id: project.id })}/>) : <p className="sidebar-hint">Keine Projekte gefunden.</p>}</div>}
      <button className="project-sidebar-create" onClick={addProject}>+ Neues Projekt</button>
    </div>

    <SidebarGroup title="Meine Projekte" className="project-sidebar-scroll">
      {mine.length ? mine.map((project) => <SidebarLink key={project.id} label={projectDisplayName(project)} active={navigation.type === 'project' && navigation.id === project.id} onClick={() => onNavigate({ type: 'project', id: project.id })}/>) : <p className="sidebar-hint">Keine aktiven Projekte.</p>}
    </SidebarGroup>

    <SidebarGroup title="Kunden" className="project-sidebar-scroll customers">
      {customers.length ? customers.map((customer) => <SidebarLink key={customer} label={customer} active={navigation.type === 'customer' && navigation.name === customer} onClick={() => onNavigate({ type: 'customer', name: customer })}/>) : <p className="sidebar-hint">Noch keine Kunden hinterlegt.</p>}
    </SidebarGroup>

    <SidebarGroup title="Weitere">
      <SidebarLink label="Abgeschlossen" active={navigation.type === 'status' && navigation.status === 'completed'} onClick={() => onNavigate({ type: 'status', status: 'completed' })}/>
      <SidebarLink label="Archiv" active={navigation.type === 'status' && navigation.status === 'archived'} onClick={() => onNavigate({ type: 'status', status: 'archived' })}/>
    </SidebarGroup>
  </div>
}

function SidebarGroup({ title, className = '', children }: { title: string; className?: string; children: React.ReactNode }) {
  return <div className={`sidebar-section ${className}`}><div className="sidebar-heading"><span>{title}</span></div>{children}</div>
}

function SidebarLink({ label, detail, active, onClick }: { label: string; detail?: string; active: boolean; onClick: () => void }) {
  return <button className={`project-sidebar-link${active ? ' selected' : ''}`} onClick={onClick}><span>{label}</span>{detail && <small>{detail}</small>}</button>
}

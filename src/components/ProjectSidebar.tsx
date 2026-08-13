import { useEffect, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { ProjectNavigation } from '../lib/projectNavigation'
import { projectDisplayName, projectShortName } from '../lib/projectDisplay'

export default function ProjectSidebar({ userId, navigation, onNavigate }: { userId: string; navigation: ProjectNavigation; onNavigate: (navigation: ProjectNavigation) => void }) {
  const [search, setSearch] = useState('')
  const collapsedStorageKey = `notiz-project-sidebar-collapsed:${userId}`
  const [collapsedCustomers, setCollapsedCustomers] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(collapsedStorageKey) ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })
  const allProjects = useLiveQuery(() => db.projects.filter((project) => !project.deletedAt).toArray(), []) ?? []
  const memberships = useLiveQuery(() => db.projectMembers.where('userId').equals(userId).filter((member) => !member.deletedAt).toArray(), [userId]) ?? []
  const memberProjectIds = new Set(memberships.map((member) => member.projectId))
  const projects = allProjects.filter((project) => project.ownerUserId === userId || memberProjectIds.has(project.id))
  const query = search.trim().toLocaleLowerCase('de')
  const results = query ? projects.filter((project) => projectDisplayName(project).toLocaleLowerCase('de').includes(query)).slice(0, 8) : []
  const activeProjects = projects.filter((project) => project.status === 'active' || project.status === 'waiting')
  const grouped = new Map<string, { label: string; projects: typeof activeProjects }>()
  for (const project of activeProjects) {
    const label = project.customerName?.trim() || 'Ohne Kunde'
    const key = label.toLocaleLowerCase('de')
    const group = grouped.get(key) ?? { label, projects: [] }
    group.projects.push(project)
    grouped.set(key, group)
  }
  const customerGroups = [...grouped.entries()]
    .map(([key, group]) => ({ key, ...group, projects: group.projects.sort((a, b) => a.name.localeCompare(b.name, 'de')) }))
    .sort((a, b) => a.label === 'Ohne Kunde' ? 1 : b.label === 'Ohne Kunde' ? -1 : a.label.localeCompare(b.label, 'de'))
  const selectedProject = navigation.type === 'project' ? projects.find((project) => project.id === navigation.id) : undefined
  const selectedCustomerKey = navigation.type === 'customer'
    ? navigation.name.toLocaleLowerCase('de')
    : selectedProject?.customerName?.trim().toLocaleLowerCase('de') ?? (selectedProject ? 'ohne kunde' : undefined)

  useEffect(() => {
    if (!selectedCustomerKey || !collapsedCustomers.has(selectedCustomerKey)) return
    setCollapsedCustomers((current) => {
      const next = new Set(current)
      next.delete(selectedCustomerKey)
      localStorage.setItem(collapsedStorageKey, JSON.stringify([...next]))
      return next
    })
  }, [collapsedStorageKey, collapsedCustomers, selectedCustomerKey])

  function toggleCustomer(key: string) {
    setCollapsedCustomers((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      localStorage.setItem(collapsedStorageKey, JSON.stringify([...next]))
      return next
    })
  }

  return <div className="project-sidebar-content">
    <div className="sidebar-section project-sidebar-tools">
      <div className="sidebar-heading"><span>Projekte</span></div>
      <input className="project-sidebar-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Projekte durchsuchen…" aria-label="Projekte durchsuchen" />
      {query && <div className="project-sidebar-results">{results.length ? results.map((project) => <SidebarLink key={project.id} label={projectDisplayName(project)} active={navigation.type === 'project' && navigation.id === project.id} onClick={() => onNavigate({ type: 'project', id: project.id })}/>) : <p className="sidebar-hint">Keine Projekte gefunden.</p>}</div>}
    </div>

    <SidebarGroup title="Kunden & Projekte" className="project-sidebar-scroll project-customer-tree">
      {customerGroups.length ? customerGroups.map((group) => {
        const collapsed = collapsedCustomers.has(group.key)
        const customerActive = selectedCustomerKey === group.key && navigation.type === 'customer'
        return <div className="project-tree-group" key={group.key}>
          <div className={`project-tree-customer${customerActive ? ' selected' : ''}`}>
            <button className="project-tree-toggle" onClick={() => toggleCustomer(group.key)} aria-label={`${group.label} ${collapsed ? 'aufklappen' : 'einklappen'}`} aria-expanded={!collapsed}>{collapsed ? '▸' : '▾'}</button>
            <button className="project-tree-customer-link" onClick={() => group.label !== 'Ohne Kunde' ? onNavigate({ type: 'customer', name: group.label }) : toggleCustomer(group.key)}>{group.label}</button>
          </div>
          {!collapsed && <div className="project-tree-projects">{group.projects.map((project) => <SidebarLink key={project.id} label={projectShortName(project) ?? project.name} active={navigation.type === 'project' && navigation.id === project.id} onClick={() => onNavigate({ type: 'project', id: project.id })}/>)}</div>}
        </div>
      }) : <p className="sidebar-hint">Keine aktiven Projekte.</p>}
    </SidebarGroup>

    <SidebarGroup title="Weitere">
      <SidebarLink label="Vorlagen" active={navigation.type === 'templates'} onClick={() => onNavigate({ type: 'templates' })}/>
      <SidebarLink label="Abgeschlossen" active={navigation.type === 'status' && navigation.status === 'completed'} onClick={() => onNavigate({ type: 'status', status: 'completed' })}/>
      <SidebarLink label="Archiv" active={navigation.type === 'status' && navigation.status === 'archived'} onClick={() => onNavigate({ type: 'status', status: 'archived' })}/>
    </SidebarGroup>
  </div>
}

function SidebarGroup({ title, className = '', children }: { title: string; className?: string; children: ReactNode }) {
  return <div className={`sidebar-section ${className}`}><div className="sidebar-heading"><span>{title}</span></div>{children}</div>
}

function SidebarLink({ label, detail, active, onClick }: { label: string; detail?: string; active: boolean; onClick: () => void }) {
  return <button className={`project-sidebar-link${active ? ' selected' : ''}`} onClick={onClick}><span>{label}</span>{detail && <small>{detail}</small>}</button>
}

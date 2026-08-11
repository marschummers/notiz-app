import type { Project } from '../db/types'

export function projectCustomer(project: Pick<Project, 'name' | 'customerName'>): string {
  return project.customerName?.trim() || project.name.trim() || 'Ohne Kunde'
}

export function projectShortName(project: Pick<Project, 'name' | 'customerName'>): string | undefined {
  const name = project.name.trim()
  const customer = projectCustomer(project)
  return name && name.localeCompare(customer, 'de', { sensitivity: 'base' }) !== 0 ? name : undefined
}

export function projectDisplayName(project: Pick<Project, 'name' | 'customerName'>): string {
  const customer = projectCustomer(project)
  const shortName = projectShortName(project)
  return shortName ? `${customer} · ${shortName}` : customer
}

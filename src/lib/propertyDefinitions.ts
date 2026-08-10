import type { Page, PagePropertyKey, PagePropertyValue, PageType } from '../db/types'

export const PAGE_TYPE_OPTIONS = [
  'Notiz', 'Meeting', 'Vor-Ort-Termin', 'Kunde', 'Projekt', 'Wissen', 'Idee',
  'Entscheidung', 'Prozess', 'Person', 'Anforderung', 'Dokumentation',
] as const satisfies readonly PageType[]

export const PAGE_STATUS_OPTIONS = ['Neu', 'Offen', 'Aktiv', 'Warten', 'Erledigt', 'Archiviert'] as const
export const PAGE_PRIORITY_OPTIONS = ['Niedrig', 'Mittel', 'Hoch', 'Kritisch'] as const

export interface PagePropertyDefinition {
  key: PagePropertyKey
  label: string
  kind: 'select' | 'text' | 'date' | 'number-list' | 'system-date'
  options?: readonly string[]
  removable?: boolean
}

export const PAGE_PROPERTY_DEFINITIONS: Record<PagePropertyKey, PagePropertyDefinition> = {
  type: { key: 'type', label: 'Typ', kind: 'select', options: PAGE_TYPE_OPTIONS },
  status: { key: 'status', label: 'Status', kind: 'select', options: PAGE_STATUS_OPTIONS, removable: true },
  createdAt: { key: 'createdAt', label: 'Erstellt', kind: 'system-date' },
  updatedAt: { key: 'updatedAt', label: 'Aktualisiert', kind: 'system-date' },
  date: { key: 'date', label: 'Datum', kind: 'date', removable: true },
  customer: { key: 'customer', label: 'Kunde', kind: 'text', removable: true },
  project: { key: 'project', label: 'Projekt', kind: 'text', removable: true },
  responsible: { key: 'responsible', label: 'Verantwortlich', kind: 'text', removable: true },
  participants: { key: 'participants', label: 'Teilnehmer', kind: 'text', removable: true },
  area: { key: 'area', label: 'Bereich', kind: 'text', removable: true },
  priority: { key: 'priority', label: 'Priorität', kind: 'select', options: PAGE_PRIORITY_OPTIONS, removable: true },
  source: { key: 'source', label: 'Quelle', kind: 'text', removable: true },
  afn: { key: 'afn', label: 'AFN', kind: 'number-list', removable: true },
}

export const PAGE_PROPERTY_ORDER = Object.keys(PAGE_PROPERTY_DEFINITIONS) as PagePropertyKey[]

export const RECOMMENDED_PROPERTIES_BY_TYPE: Record<PageType, PagePropertyKey[]> = {
  Notiz: [],
  Meeting: ['date', 'customer', 'project', 'participants'],
  'Vor-Ort-Termin': ['date', 'customer', 'project', 'participants'],
  Kunde: ['status', 'responsible', 'area'],
  Projekt: ['status', 'customer', 'responsible', 'priority'],
  Wissen: ['area', 'source', 'customer'],
  Idee: ['status', 'area', 'priority', 'source'],
  Entscheidung: ['date', 'area', 'status', 'customer', 'project'],
  Prozess: ['status', 'area', 'responsible'],
  Person: ['customer', 'area'],
  Anforderung: ['status', 'customer', 'project', 'priority', 'afn'],
  Dokumentation: ['status', 'area', 'source', 'project'],
}

export function isPageType(value: unknown): value is PageType {
  return typeof value === 'string' && (PAGE_TYPE_OPTIONS as readonly string[]).includes(value)
}

export function getPagePropertyValue(page: Page, key: PagePropertyKey): PagePropertyValue | undefined {
  const stored = page.properties?.[key]
  if (stored !== undefined) return stored
  if (key === 'type') return page.pageType
  if (key === 'date') return page.customDate
  if (key === 'afn') return page.afns
  if (key === 'createdAt') return page.createdAt ?? page.order
  if (key === 'updatedAt') return page.updatedAt
  return undefined
}

export function getPageAfns(page: Page): number[] {
  const value = getPagePropertyValue(page, 'afn')
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number') : []
}


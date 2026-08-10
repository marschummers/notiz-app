import type { Page, PagePropertyKey, PagePropertyValue } from '../db/types'
import { getPageAfns, getPagePropertyValue } from './propertyDefinitions'

export const SEARCH_PROPERTY_KEYS = ['type', 'customer', 'status', 'project', 'priority'] as const satisfies readonly PagePropertyKey[]

export type SearchPropertyKey = (typeof SEARCH_PROPERTY_KEYS)[number]
export type PagePropertyFilters = Partial<Record<SearchPropertyKey, string>>

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('de-DE')
}

function comparablePropertyValue(page: Page, key: SearchPropertyKey): string | undefined {
  const value = getPagePropertyValue(page, key) ?? (key === 'type' ? 'Notiz' : undefined)
  return typeof value === 'string' ? normalize(value) : undefined
}

export function pageMatchesPropertyFilters(page: Page, filters: PagePropertyFilters): boolean {
  return SEARCH_PROPERTY_KEYS.every((key) => {
    const selectedValue = filters[key]
    if (!selectedValue) return true
    return comparablePropertyValue(page, key) === normalize(selectedValue)
  })
}

export function pageMatchesSearchText(page: Page, searchText: string): boolean {
  const query = normalize(searchText)
  if (!query) return true
  return normalize(page.title || '').includes(query) || getPageAfns(page).some((afn) => String(afn).includes(query))
}

export function filterPages(pages: Page[], searchText: string, filters: PagePropertyFilters): Page[] {
  return pages.filter((page) => pageMatchesSearchText(page, searchText) && pageMatchesPropertyFilters(page, filters))
}

export function getDistinctPagePropertyValues(pages: Page[], key: SearchPropertyKey): string[] {
  const values = new Map<string, string>()
  for (const page of pages) {
    const value: PagePropertyValue | undefined = getPagePropertyValue(page, key)
    if (typeof value !== 'string' || !value.trim()) continue
    const trimmed = value.trim()
    values.set(normalize(trimmed), trimmed)
  }
  return [...values.values()].sort((a, b) => a.localeCompare(b, 'de-DE'))
}

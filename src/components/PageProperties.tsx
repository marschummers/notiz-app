import { useEffect, useRef, useState } from 'react'
import type { Page, PagePropertyKey, PagePropertyValue, PageType } from '../db/types'
import {
  addAfnToPage,
  removeAfnFromPage,
  saveAsTemplate,
  updatePageProperty,
  updatePageType,
} from '../lib/actions'
import {
  isPageType,
  getPagePropertyValue,
  PAGE_PROPERTY_DEFINITIONS,
  PAGE_PROPERTY_ORDER,
  PAGE_TYPE_OPTIONS,
  RECOMMENDED_PROPERTIES_BY_TYPE,
} from '../lib/propertyDefinitions'
import { InfoIcon } from './icons'
import './PageProperties.css'

function isValidAfnInput(value: string): boolean {
  if (!/^\d+$/.test(value)) return false
  const n = Number(value)
  return n >= 1 && n <= 999999
}

function dateToInputValue(value: PagePropertyValue | undefined): string {
  if (typeof value !== 'number' || !value) return ''
  const d = new Date(value)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function inputValueToDate(value: string): number | undefined {
  if (!value) return undefined
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

function PropertyTextInput({ value, onSave }: { value: string; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onSave(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

function hasProperty(page: Page, key: PagePropertyKey): boolean {
  if (key === 'type' || key === 'createdAt' || key === 'updatedAt') return true
  return getPagePropertyValue(page, key) !== undefined || Object.prototype.hasOwnProperty.call(page.properties ?? {}, key)
}

export default function PageProperties({ page }: { page: Page }) {
  const [open, setOpen] = useState(false)
  const [afnInput, setAfnInput] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const currentTypeValue = getPagePropertyValue(page, 'type')
  const currentType = typeof currentTypeValue === 'string' ? currentTypeValue : 'Notiz'
  const afnsValue = getPagePropertyValue(page, 'afn')
  const afns = Array.isArray(afnsValue) ? afnsValue.filter((value): value is number => typeof value === 'number') : []

  function handleAddAfn() {
    if (!isValidAfnInput(afnInput)) return
    addAfnToPage(page.id, Number(afnInput))
    setAfnInput('')
  }

  useEffect(() => {
    if (!open) return
    function onDocPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocPointerDown)
    return () => document.removeEventListener('mousedown', onDocPointerDown)
  }, [open])

  const visibleKeys = PAGE_PROPERTY_ORDER.filter((key) => hasProperty(page, key))
  const recommendedKeys = isPageType(currentType)
    ? RECOMMENDED_PROPERTIES_BY_TYPE[currentType].filter((key) => !hasProperty(page, key))
    : []

  function addProperty(key: PagePropertyKey) {
    const definition = PAGE_PROPERTY_DEFINITIONS[key]
    const initialValue: PagePropertyValue = definition.kind === 'number-list' ? [] : ''
    updatePageProperty(page.id, key, initialValue)
  }

  function renderProperty(key: PagePropertyKey) {
    const definition = PAGE_PROPERTY_DEFINITIONS[key]
    const value = getPagePropertyValue(page, key)
    const removeButton = definition.removable ? (
      <button
        type="button"
        className="properties-remove"
        onClick={() => updatePageProperty(page.id, key, undefined)}
        aria-label={`${definition.label} entfernen`}
        title="Property entfernen"
      >
        ×
      </button>
    ) : null

    if (definition.kind === 'system-date') {
      return (
        <div className="properties-field" key={key}>
          <span className="properties-label">{definition.label}</span>
          <span className="properties-system-value">
            {typeof value === 'number' ? new Date(value).toLocaleString('de-DE') : '–'}
          </span>
        </div>
      )
    }

    if (key === 'type') {
      const legacyType = !PAGE_TYPE_OPTIONS.includes(currentType as PageType) ? currentType : null
      return (
        <label className="properties-field" key={key}>
          <span className="properties-label">Typ</span>
          <select value={currentType} onChange={(e) => updatePageType(page.id, e.target.value as PageType)}>
            {legacyType && <option value={legacyType}>{legacyType} (bisheriger Wert)</option>}
            {PAGE_TYPE_OPTIONS.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
      )
    }

    if (definition.kind === 'select') {
      return (
        <label className="properties-field" key={key}>
          <span className="properties-label-row"><span className="properties-label">{definition.label}</span>{removeButton}</span>
          <select value={typeof value === 'string' ? value : ''} onChange={(e) => updatePageProperty(page.id, key, e.target.value)}>
            <option value="">Auswählen …</option>
            {definition.options?.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
      )
    }

    if (definition.kind === 'date') {
      return (
        <label className="properties-field" key={key}>
          <span className="properties-label-row"><span className="properties-label">{definition.label}</span>{removeButton}</span>
          <input type="date" value={dateToInputValue(value)} onChange={(e) => updatePageProperty(page.id, key, inputValueToDate(e.target.value) ?? '')} />
        </label>
      )
    }

    if (definition.kind === 'number-list') {
      return (
        <div className="properties-field" key={key}>
          <span className="properties-label-row"><span className="properties-label">AFN</span>{removeButton}</span>
          {afns.length > 0 && <div className="properties-afn-list">{afns.map((afn) => (
            <span key={afn} className="properties-afn-chip">AFN {afn}<button onClick={() => removeAfnFromPage(page.id, afn)}>×</button></span>
          ))}</div>}
          <div className="properties-afn-add">
            <input type="text" inputMode="numeric" placeholder="z. B. 181657" value={afnInput}
              onChange={(e) => setAfnInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddAfn() } }} />
            <button onClick={handleAddAfn} disabled={!isValidAfnInput(afnInput)}>+</button>
          </div>
        </div>
      )
    }

    return (
      <label className="properties-field" key={key}>
        <span className="properties-label-row"><span className="properties-label">{definition.label}</span>{removeButton}</span>
        <PropertyTextInput value={typeof value === 'string' ? value : ''} onSave={(next) => updatePageProperty(page.id, key, next)} />
      </label>
    )
  }

  return (
    <div className="page-properties" ref={containerRef}>
      <button className={`properties-toggle${open ? ' active' : ''}`} onClick={() => setOpen((value) => !value)} aria-label="Eigenschaften" title="Eigenschaften">
        <InfoIcon />
      </button>
      {open && (
        <div className="properties-popover">
          <div className="properties-heading">Properties</div>
          {visibleKeys.map(renderProperty)}
          {recommendedKeys.length > 0 && (
            <div className="properties-suggestions">
              <span className="properties-label">Für {currentType} empfohlen</span>
              <div className="properties-suggestion-list">
                {recommendedKeys.map((key) => (
                  <button key={key} onClick={() => addProperty(key)}>+ {PAGE_PROPERTY_DEFINITIONS[key].label}</button>
                ))}
              </div>
            </div>
          )}
          <details className="properties-more">
            <summary>Weitere Property hinzufügen</summary>
            <div className="properties-suggestion-list">
              {PAGE_PROPERTY_ORDER.filter((key) => PAGE_PROPERTY_DEFINITIONS[key].removable && !hasProperty(page, key)).map((key) => (
                <button key={key} onClick={() => addProperty(key)}>+ {PAGE_PROPERTY_DEFINITIONS[key].label}</button>
              ))}
            </div>
          </details>
          <div className="properties-divider" />
          <button className="properties-save-template" onClick={async () => {
            const name = window.prompt('Name der Vorlage:')
            if (!name?.trim()) return
            await saveAsTemplate(page.id, name.trim())
            setOpen(false)
          }}>Als Vorlage speichern</button>
        </div>
      )}
    </div>
  )
}


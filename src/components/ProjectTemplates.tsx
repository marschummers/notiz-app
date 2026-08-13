import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Project, ProjectMilestone, ProjectSection, ProjectTask, ProjectTemplate, ProjectTemplateVisibility } from '../db/types'
import { createProject } from '../lib/projectActions'
import {
  createProjectFromTemplate,
  createProjectTemplateFromProject,
  deleteProjectTemplate,
  updateProjectTemplate,
} from '../lib/projectTemplateActions'
import type { ProjectNavigation } from '../lib/projectNavigation'
import { projectDisplayName } from '../lib/projectDisplay'
import { formatRelativeTime } from '../lib/format'
import { DialogShell, FormField } from './ProjectsView'
import BufferedDateInput from './BufferedDateInput'
import './ProjectsView.css'

const visibilityLabel: Record<ProjectTemplateVisibility, string> = { private: 'Privat', public: 'Öffentlich' }

function useTemplates() {
  return useLiveQuery(() => db.projectTemplates.filter((t) => !t.deletedAt).toArray(), []) ?? []
}

// "Vorlagen"-Verwaltung: Liste aller sichtbaren Vorlagen (eigene + oeffentliche - die lokale
// Dexie-Kopie enthaelt dank RLS ohnehin nur das, siehe sync.ts). Bearbeiten/Loeschen nur fuer
// eigene Vorlagen, "Verwenden" fuer alle sichtbaren.
export function TemplateListView({ userId, onNavigate }: { userId: string; onNavigate: (navigation: ProjectNavigation) => void }) {
  const templates = useTemplates()
  const milestones = useLiveQuery(() => db.projectTemplateMilestones.filter((m) => !m.deletedAt).toArray(), []) ?? []
  const sections = useLiveQuery(() => db.projectTemplateSections.filter((s) => !s.deletedAt).toArray(), []) ?? []
  const tasks = useLiveQuery(() => db.projectTemplateTasks.filter((t) => !t.deletedAt).toArray(), []) ?? []
  const [creatingFrom, setCreatingFrom] = useState<ProjectTemplate | null>(null)
  const [editing, setEditing] = useState<ProjectTemplate | null>(null)

  const counts = useMemo(() => {
    const byTemplate = new Map<string, { milestones: number; sections: number; tasks: number }>()
    for (const template of templates) byTemplate.set(template.id, { milestones: 0, sections: 0, tasks: 0 })
    for (const milestone of milestones) { const entry = byTemplate.get(milestone.templateId); if (entry) entry.milestones += 1 }
    for (const section of sections) { const entry = byTemplate.get(section.templateId); if (entry) entry.sections += 1 }
    for (const task of tasks) { const entry = byTemplate.get(task.templateId); if (entry) entry.tasks += 1 }
    return byTemplate
  }, [templates, milestones, sections, tasks])

  const sorted = useMemo(() => [...templates].sort((a, b) => b.updatedAt - a.updatedAt), [templates])

  return <main className="projects-view">
    <div className="project-page-content">
      <button className="back-link" onClick={() => onNavigate({ type: 'overview' })}>← Projekte</button>
      <header className="projects-header"><div><p className="projects-eyebrow">Arbeitsbereich</p><h1>Vorlagen</h1></div></header>
      {sorted.length === 0
        ? <div className="project-empty-state"><strong>Noch keine Vorlagen</strong><span>Speichere ein bestehendes Projekt über „Als Vorlage speichern“, um es hier wiederzuverwenden.</span></div>
        : <div className="template-grid">
          {sorted.map((template) => {
            const c = counts.get(template.id) ?? { milestones: 0, sections: 0, tasks: 0 }
            const own = template.createdByUserId === userId
            return <div className="template-card" key={template.id}>
              <div className="template-card-head">
                <strong>{template.name}</strong>
                <span className={`template-visibility template-visibility-${template.visibility}`}>{visibilityLabel[template.visibility]}</span>
              </div>
              {template.description && <p className="template-card-description">{template.description}</p>}
              <p className="template-card-meta">{c.milestones} Meilensteine · {c.sections} Themenbereiche · {c.tasks} Aufgaben</p>
              <p className="template-card-meta">Geändert {formatRelativeTime(template.updatedAt)}</p>
              <div className="template-card-actions">
                <button className="primary compact" onClick={() => setCreatingFrom(template)}>Verwenden</button>
                {own && <button className="secondary-action compact" onClick={() => setEditing(template)}>Bearbeiten</button>}
              </div>
            </div>
          })}
        </div>}
    </div>
    {creatingFrom && (
      <CreateFromTemplateDialog
        template={creatingFrom}
        userId={userId}
        onClose={() => setCreatingFrom(null)}
        onCreated={(id) => { setCreatingFrom(null); onNavigate({ type: 'project', id }) }}
      />
    )}
    {editing && <TemplateEditDialog template={editing} onClose={() => setEditing(null)} />}
  </main>
}

function TemplateEditDialog({ template, onClose }: { template: ProjectTemplate; onClose: () => void }) {
  const [draft, setDraft] = useState({ name: template.name, description: template.description ?? '', visibility: template.visibility })

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.name.trim()) return
    await updateProjectTemplate(template.id, {
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      visibility: draft.visibility,
    })
    onClose()
  }

  return <DialogShell title="Vorlage bearbeiten" subtitle={template.name} onClose={onClose}>
    <form className="project-dialog-form" onSubmit={save}>
      <div className="dialog-form-grid">
        <FormField label="Name" wide><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} autoFocus required /></FormField>
        <FormField label="Beschreibung" wide><textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={3} /></FormField>
        <FormField label="Sichtbarkeit"><select value={draft.visibility} onChange={(event) => setDraft({ ...draft, visibility: event.target.value as ProjectTemplateVisibility })}><option value="private">Privat (nur ich)</option><option value="public">Öffentlich (alle Nutzer)</option></select></FormField>
      </div>
      <div className="dialog-actions">
        <button type="button" className="danger-action" onClick={async () => { if (confirm(`Vorlage „${template.name}“ löschen?`)) { await deleteProjectTemplate(template.id); onClose() } }}>Vorlage löschen</button>
        <span />
        <button type="button" className="secondary-action" onClick={onClose}>Abbrechen</button>
        <button className="primary" disabled={!draft.name.trim()}>Speichern</button>
      </div>
    </form>
  </DialogShell>
}

export function CreateFromTemplateDialog({
  template,
  userId,
  onClose,
  onCreated,
}: {
  template: ProjectTemplate
  userId: string
  onClose: () => void
  onCreated: (projectId: string) => void
}) {
  const [draft, setDraft] = useState<{ customerName: string; name: string; startDate?: number; targetDate?: number }>({ customerName: '', name: '' })
  const [saving, setSaving] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.customerName.trim() || saving) return
    setSaving(true)
    try {
      const id = await createProjectFromTemplate({
        templateId: template.id,
        customerName: draft.customerName.trim(),
        name: draft.name.trim() || undefined,
        startDate: draft.startDate,
        targetDate: draft.targetDate,
        ownerUserId: userId,
      })
      onCreated(id)
    } finally {
      setSaving(false)
    }
  }

  return <DialogShell title="Projekt aus Vorlage" subtitle={template.name} onClose={onClose}>
    <form className="project-dialog-form" onSubmit={save}>
      <div className="dialog-form-grid">
        <FormField label="Kunde" wide><input value={draft.customerName} onChange={(event) => setDraft({ ...draft, customerName: event.target.value })} autoFocus required /></FormField>
        <FormField label="Projektname" wide><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder={`Optional, sonst „${template.name}“`} /></FormField>
        <FormField label="Startdatum"><BufferedDateInput value={draft.startDate} onSave={(value) => setDraft({ ...draft, startDate: value })} /></FormField>
        <FormField label="Zieltermin"><BufferedDateInput value={draft.targetDate} onSave={(value) => setDraft({ ...draft, targetDate: value })} /></FormField>
        <p className="template-hint">Relative Termine aus der Vorlage werden nur berechnet, wenn ein Startdatum gesetzt ist.</p>
      </div>
      <div className="dialog-actions">
        <span /><span />
        <button type="button" className="secondary-action" onClick={onClose}>Abbrechen</button>
        <button className="primary" disabled={!draft.customerName.trim() || saving}>Projekt anlegen</button>
      </div>
    </form>
  </DialogShell>
}

export function SaveAsTemplateDialog({
  project,
  milestones,
  sections,
  tasks,
  userId,
  onClose,
}: {
  project: Project
  milestones: ProjectMilestone[]
  sections: ProjectSection[]
  tasks: ProjectTask[]
  userId: string
  onClose: () => void
}) {
  const [draft, setDraft] = useState({ name: projectDisplayName(project), description: '', visibility: 'private' as ProjectTemplateVisibility })
  const [saving, setSaving] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.name.trim() || saving) return
    setSaving(true)
    try {
      await createProjectTemplateFromProject(project, milestones, sections, tasks, draft.name.trim(), draft.description.trim() || undefined, draft.visibility, userId)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return <DialogShell title="Als Vorlage speichern" subtitle={projectDisplayName(project)} onClose={onClose}>
    <form className="project-dialog-form" onSubmit={save}>
      <div className="dialog-form-grid">
        <FormField label="Vorlagenname" wide><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} autoFocus required /></FormField>
        <FormField label="Beschreibung" wide><textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={3} placeholder="Optional" /></FormField>
        <FormField label="Sichtbarkeit"><select value={draft.visibility} onChange={(event) => setDraft({ ...draft, visibility: event.target.value as ProjectTemplateVisibility })}><option value="private">Privat (nur ich)</option><option value="public">Öffentlich (alle Nutzer)</option></select></FormField>
        <p className="template-hint">Kunde, AFN-Nummern, Team und der aktuelle Bearbeitungsstand werden nicht übernommen.</p>
      </div>
      <div className="dialog-actions">
        <span /><span />
        <button type="button" className="secondary-action" onClick={onClose}>Abbrechen</button>
        <button className="primary" disabled={!draft.name.trim() || saving}>Speichern</button>
      </div>
    </form>
  </DialogShell>
}

// Ersetzt die bisherigen Sofort-Erstellen-Buttons ("+ Neues Projekt"): erste Ebene "Leer
// starten" / "Aus Vorlage…", zweite Ebene listet sichtbare Vorlagen. Popover-Muster kopiert von
// NewPageMenu (siehe PageList.tsx) - outside-mousedown schliesst das Popover wieder.
export function NewProjectMenu({
  userId,
  triggerClassName = 'primary',
  onCreated,
}: {
  userId: string
  triggerClassName?: string
  onCreated: (projectId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'root' | 'templates'>('root')
  const [selectedTemplate, setSelectedTemplate] = useState<ProjectTemplate | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const templates = useTemplates()

  useEffect(() => {
    if (!open) return
    function onDocPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocPointerDown)
    return () => document.removeEventListener('mousedown', onDocPointerDown)
  }, [open])

  function close() {
    setOpen(false)
    setMode('root')
  }

  async function createEmpty() {
    const id = await createProject({ name: 'Neues Projekt', ownerUserId: userId })
    close()
    onCreated(id)
  }

  return <div className="new-project-menu" ref={containerRef}>
    <button className={triggerClassName} onClick={() => setOpen((v) => !v)}>+ Neues Projekt</button>
    {open && (
      <div className="new-page-popover">
        {mode === 'root' ? <>
          <div className="new-page-option" onClick={createEmpty}><span>Leer starten</span></div>
          <div className="new-page-option" onClick={() => setMode('templates')}><span>Aus Vorlage…</span></div>
        </> : <>
          <div className="new-page-option" onClick={() => setMode('root')}><span>← Zurück</span></div>
          {templates.length === 0
            ? <p className="template-hint template-hint-menu">Noch keine Vorlagen vorhanden.</p>
            : templates.map((template) => (
              <div key={template.id} className="new-page-option" onClick={() => { setSelectedTemplate(template); setOpen(false) }}>
                <span>{template.name}</span>
              </div>
            ))}
        </>}
      </div>
    )}
    {selectedTemplate && (
      <CreateFromTemplateDialog
        template={selectedTemplate}
        userId={userId}
        onClose={() => setSelectedTemplate(null)}
        onCreated={(id) => { setSelectedTemplate(null); onCreated(id) }}
      />
    )}
  </div>
}

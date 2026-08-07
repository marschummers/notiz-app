import type { EntityTable } from 'dexie'
import { db } from '../db/db'
import type { Folder, Page, Tag, PageTag, Stroke } from '../db/types'
import { supabase } from './supabaseClient'

// Faengt fehlende/kaputte Zeitstempel ab, statt dass new Date(...).toISOString() mit
// "Invalid time value" den kompletten Sync abbricht.
function iso(value: number): string {
  const safeValue = Number.isFinite(value) ? value : Date.now()
  return new Date(safeValue).toISOString()
}

function ms(isoStr: string): number {
  return new Date(isoStr).getTime()
}

// Fuehrt eine Tabelle lokal (Dexie) und remote (Supabase) zu einem gemeinsamen Stand zusammen:
// pro Zeile gewinnt bei Last-Write-Wins der jeweils neuere `updatedAt`-Zeitstempel. Voller
// Abgleich statt inkrementell seit dem letzten Sync - bei der Datenmenge einer persoenlichen
// Notiz-App (Ordner/Seiten/Tags eines einzelnen Accounts) unkritisch und robuster als eine
// Cursor-/Aenderungsprotokoll-Logik.
async function mergeTable<Local extends { id: string; updatedAt: number }, Remote extends { id: string; updated_at: string }>(
  localTable: EntityTable<Local, 'id'>,
  remoteTableName: string,
  toRemote: (local: Local) => Remote,
  fromRemote: (remote: Remote, existingLocal?: Local) => Local,
): Promise<void> {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert.')

  const localRows = await localTable.toArray()
  const { data: remoteRows, error } = await supabase.from(remoteTableName).select('*')
  if (error) throw new Error(`${remoteTableName}: ${error.message}`)

  const localById = new Map(localRows.map((r) => [r.id, r]))
  const remoteById = new Map(((remoteRows ?? []) as Remote[]).map((r) => [r.id, r]))

  const toPushRemote: Remote[] = []
  const toPutLocal: Local[] = []

  const allIds = new Set([...localById.keys(), ...remoteById.keys()])
  for (const id of allIds) {
    const local = localById.get(id)
    const remote = remoteById.get(id)
    if (local && !remote) {
      toPushRemote.push(toRemote(local))
    } else if (!local && remote) {
      toPutLocal.push(fromRemote(remote))
    } else if (local && remote) {
      const remoteUpdatedAt = ms(remote.updated_at)
      if (local.updatedAt > remoteUpdatedAt) {
        toPushRemote.push(toRemote(local))
      } else if (remoteUpdatedAt > local.updatedAt) {
        toPutLocal.push(fromRemote(remote, local))
      }
    }
  }

  // Erst herunterladen und lokal festschreiben, DANN erst hochladen: schlaegt der Push fehl,
  // sollen bereits erfolgreich vom Server geladene Daten trotzdem lokal ankommen.
  if (toPutLocal.length > 0) {
    await localTable.bulkPut(toPutLocal)
  }
  if (toPushRemote.length > 0) {
    const { error: upsertError } = await supabase.from(remoteTableName).upsert(toPushRemote)
    if (upsertError) throw new Error(`${remoteTableName}: ${upsertError.message}`)
  }
}

interface RemoteFolder {
  id: string
  user_id: string
  parent_id: string | null
  name: string
  order: number
  updated_at: string
  deleted_at: string | null
}

interface RemotePage {
  id: string
  user_id: string
  folder_id: string | null
  title: string
  strokes: Stroke[]
  order: number
  updated_at: string
  deleted_at: string | null
}

interface RemoteTag {
  id: string
  user_id: string
  name: string
  updated_at: string
  deleted_at: string | null
}

interface RemotePageTag {
  id: string
  user_id: string
  page_id: string
  tag_id: string
  updated_at: string
  deleted_at: string | null
}

// Zieht Ordner, Seiten, Tags und deren Verknuepfungen mit Supabase zusammen. Ordner zuerst:
// pages/page_tags referenzieren folder_id/tag_id als Fremdschluessel, die Zeile muss also dort
// existieren, bevor die anderen pushen.
export async function syncAll(): Promise<void> {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert.')
  const client = supabase
  const { data: userData, error: userError } = await client.auth.getUser()
  if (userError || !userData.user) throw new Error('Nicht eingeloggt.')
  const userId = userData.user.id

  await mergeTable<Folder, RemoteFolder>(
    db.folders,
    'notiz_folders',
    (f) => ({
      id: f.id,
      user_id: userId,
      parent_id: f.parentId ?? null,
      name: f.name,
      order: f.order,
      updated_at: iso(f.updatedAt),
      deleted_at: f.deletedAt ? iso(f.deletedAt) : null,
    }),
    (r) => ({
      id: r.id,
      parentId: r.parent_id ?? undefined,
      name: r.name,
      order: r.order,
      updatedAt: ms(r.updated_at),
      deletedAt: r.deleted_at ? ms(r.deleted_at) : undefined,
    }),
  )

  await mergeTable<Page, RemotePage>(
    db.pages,
    'notiz_pages',
    (p) => ({
      id: p.id,
      user_id: userId,
      folder_id: p.folderId ?? null,
      title: p.title,
      strokes: p.strokes,
      order: p.order,
      updated_at: iso(p.updatedAt),
      deleted_at: p.deletedAt ? iso(p.deletedAt) : null,
    }),
    (r) => ({
      id: r.id,
      folderId: r.folder_id ?? undefined,
      title: r.title,
      strokes: r.strokes,
      order: r.order,
      updatedAt: ms(r.updated_at),
      deletedAt: r.deleted_at ? ms(r.deleted_at) : undefined,
    }),
  )

  await mergeTable<Tag, RemoteTag>(
    db.tags,
    'notiz_tags',
    (t) => ({
      id: t.id,
      user_id: userId,
      name: t.name,
      updated_at: iso(t.updatedAt),
      deleted_at: t.deletedAt ? iso(t.deletedAt) : null,
    }),
    (r) => ({
      id: r.id,
      name: r.name,
      updatedAt: ms(r.updated_at),
      deletedAt: r.deleted_at ? ms(r.deleted_at) : undefined,
    }),
  )

  await mergeTable<PageTag, RemotePageTag>(
    db.pageTags,
    'notiz_page_tags',
    (pt) => ({
      id: pt.id,
      user_id: userId,
      page_id: pt.pageId,
      tag_id: pt.tagId,
      updated_at: iso(pt.updatedAt),
      deleted_at: pt.deletedAt ? iso(pt.deletedAt) : null,
    }),
    (r) => ({
      id: r.id,
      pageId: r.page_id,
      tagId: r.tag_id,
      updatedAt: ms(r.updated_at),
      deletedAt: r.deleted_at ? ms(r.deleted_at) : undefined,
    }),
  )
}

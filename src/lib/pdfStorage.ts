import { db } from '../db/db'
import { supabase } from './supabaseClient'

// Eigener Storage-Bucket (siehe supabase/migrations/0008_pdf_printouts.sql) statt eines
// generischen "Uploads"-Buckets - macht die Policies (nur eigene Dateien lesen/schreiben) und
// spaeteres Aufraeumen einfacher.
const BUCKET = 'notiz-pdfs'

// Laedt die Original-PDF-Bytes eines PdfPrintout: zuerst aus dem lokalen Dexie-Blob-Cache (siehe
// db/types.ts PdfBlobCache), erst wenn dort nichts liegt aus Supabase Storage. Das ist die
// Grundlage fuer "nicht bei jedem Sync erneut herunterladen" UND fuers Offline-Verhalten - ein
// einmal geladenes PDF bleibt lokal verfuegbar, auch ohne Netz. Ein frisch heruntergeladener
// Blob wird sofort selbst gecacht, damit der naechste Aufruf (auch offline) ihn wiederfindet.
export async function loadPdfBlob(printout: { id: string; storagePath: string }): Promise<Blob> {
  const cached = await db.pdfBlobs.get(printout.id)
  if (cached) return cached.blob

  if (!supabase) throw new Error('Supabase ist nicht konfiguriert.')
  const { data, error } = await supabase.storage.from(BUCKET).download(printout.storagePath)
  if (error || !data) throw new Error(error?.message ?? 'PDF konnte nicht aus Supabase Storage geladen werden.')

  await db.pdfBlobs.put({ id: printout.id, blob: data, cachedAt: Date.now() })
  return data
}

// Laedt das Original-PDF unter einem pro Nutzer/Ausdruck eindeutigen Pfad hoch (die Policies in
// der Migration pruefen genau dieses Pfadmuster: erstes Pfadsegment == eigene user_id) und
// cached die Datei sofort lokal - erspart den Download beim naechsten Oeffnen auf demselben
// Geraet.
export async function uploadPdf(userId: string, printoutId: string, file: File): Promise<string> {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert.')
  const storagePath = `${userId}/${printoutId}.pdf`
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, file, { contentType: 'application/pdf' })
  if (error) throw new Error(error.message)

  await db.pdfBlobs.put({ id: printoutId, blob: file, cachedAt: Date.now() })
  return storagePath
}

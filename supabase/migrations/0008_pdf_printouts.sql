-- PDF-Dateiausdruck: Metadaten-Tabelle (siehe src/db/types.ts PdfPrintout) - laeuft ueber den
-- normalen Last-Write-Wins-Sync (src/lib/sync.ts). Die eigentliche Datei liegt NICHT hier,
-- sondern im Storage-Bucket "notiz-pdfs" unter storage_path (siehe src/lib/pdfStorage.ts).
create table if not exists notiz_pdf_printouts (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  page_id uuid not null references notiz_pages (id) on delete cascade,
  file_name text not null default '',
  storage_path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists notiz_pdf_printouts_user_id_idx on notiz_pdf_printouts (user_id);
create index if not exists notiz_pdf_printouts_page_id_idx on notiz_pdf_printouts (page_id);

alter table notiz_pdf_printouts enable row level security;

create policy "notiz_pdf_printouts_owner_only" on notiz_pdf_printouts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Storage: eigener privater Bucket fuer die Original-PDFs. Dateien liegen unter
-- "<user_id>/<printout_id>.pdf" - die Policies unten pruefen genau dieses erste Pfadsegment
-- gegen auth.uid(), damit jeder Account ausschliesslich seine eigenen Dateien lesen/schreiben
-- kann (row level security ist auf storage.objects in Supabase-Projekten immer schon aktiv).
insert into storage.buckets (id, name, public)
values ('notiz-pdfs', 'notiz-pdfs', false)
on conflict (id) do nothing;

create policy "notiz_pdfs_owner_select" on storage.objects
  for select using (bucket_id = 'notiz-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "notiz_pdfs_owner_insert" on storage.objects
  for insert with check (bucket_id = 'notiz-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "notiz_pdfs_owner_update" on storage.objects
  for update using (bucket_id = 'notiz-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "notiz_pdfs_owner_delete" on storage.objects
  for delete using (bucket_id = 'notiz-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);

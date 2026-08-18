-- Der technische Backup-Benutzer darf ausschliesslich Objekte aus dem PDF-Bucket lesen.
-- INSERT/UPDATE/DELETE werden bewusst nicht gewaehrt. Die feste auth-UID bindet die Regel
-- an genau den separat angelegten Supabase-Auth-Benutzer.
drop policy if exists "notiz_pdfs_backup_select" on storage.objects;

create policy "notiz_pdfs_backup_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'notiz-pdfs'
  and auth.uid() = '36a43368-68ad-439e-ae78-19786e55b874'::uuid
);

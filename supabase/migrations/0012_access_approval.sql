-- Zugangs-Warteliste nach dem bewaehrten Muster der Pferdeapp.
-- Bestehende Profile bleiben freigeschaltet; neue Konten starten als nicht freigegeben.

alter table notiz_profiles add column if not exists approved boolean not null default false;
alter table notiz_profiles add column if not exists created_at timestamptz not null default now();

-- Beim erstmaligen Ausrollen niemanden versehentlich aussperren.
update notiz_profiles set approved = true;

-- Auch Auth-Konten, die noch nie synchronisiert und deshalb noch ohne Profil sind, aufnehmen.
insert into notiz_profiles (id, email, display_name, approved, updated_at, created_at)
select id, coalesce(email, ''), raw_user_meta_data ->> 'full_name', true, now(), created_at
from auth.users
on conflict (id) do nothing;

create or replace function notiz_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notiz_profiles (id, email, display_name, approved, updated_at)
  values (
    new.id,
    coalesce(new.email, ''),
    new.raw_user_meta_data ->> 'full_name',
    coalesce(new.email, '') = 'marschummers@googlemail.com',
    now()
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists notiz_on_auth_user_created on auth.users;
create trigger notiz_on_auth_user_created
  after insert on auth.users
  for each row execute function notiz_handle_new_user();

create or replace function notiz_is_approved()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select approved from notiz_profiles where id = auth.uid()), false);
$$;

-- Profilpflege ohne die Moeglichkeit, das eigene Freigabefeld zu veraendern.
create or replace function notiz_update_own_profile(p_email text, p_display_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update notiz_profiles
  set email = coalesce(p_email, email),
      display_name = coalesce(nullif(trim(p_display_name), ''), display_name),
      updated_at = now()
  where id = auth.uid();
end;
$$;

revoke all on function notiz_update_own_profile(text, text) from public;
grant execute on function notiz_update_own_profile(text, text) to authenticated;

-- Profile: ausstehende Benutzer sehen nur sich selbst; freigegebene Benutzer das gemeinsame
-- Verzeichnis fuer Verantwortliche; nur der feste Admin darf Freigaben aendern.
drop policy if exists "profiles_read_authenticated" on notiz_profiles;
drop policy if exists "profiles_write_self" on notiz_profiles;
drop policy if exists "profiles_update_self" on notiz_profiles;
drop policy if exists "profiles_read_own" on notiz_profiles;
drop policy if exists "profiles_approved_read_directory" on notiz_profiles;
drop policy if exists "profiles_admin_read_all" on notiz_profiles;
drop policy if exists "profiles_admin_approves" on notiz_profiles;

create policy "profiles_read_own" on notiz_profiles
  for select to authenticated using (id = auth.uid());
create policy "profiles_approved_read_directory" on notiz_profiles
  for select to authenticated using (notiz_is_approved());
create policy "profiles_admin_read_all" on notiz_profiles
  for select to authenticated using ((auth.jwt() ->> 'email') = 'marschummers@googlemail.com');
create policy "profiles_admin_approves" on notiz_profiles
  for update to authenticated
  using ((auth.jwt() ->> 'email') = 'marschummers@googlemail.com')
  with check ((auth.jwt() ->> 'email') = 'marschummers@googlemail.com');

-- Private Notizdaten: Besitzerregel bleibt erhalten, Freigabe kommt als zusaetzliche Huerde dazu.
drop policy if exists "notiz_folders_owner_only" on notiz_folders;
create policy "notiz_folders_owner_only" on notiz_folders for all
  using (notiz_is_approved() and auth.uid() = user_id)
  with check (notiz_is_approved() and auth.uid() = user_id);
drop policy if exists "notiz_pages_owner_only" on notiz_pages;
create policy "notiz_pages_owner_only" on notiz_pages for all
  using (notiz_is_approved() and auth.uid() = user_id)
  with check (notiz_is_approved() and auth.uid() = user_id);
drop policy if exists "notiz_tags_owner_only" on notiz_tags;
create policy "notiz_tags_owner_only" on notiz_tags for all
  using (notiz_is_approved() and auth.uid() = user_id)
  with check (notiz_is_approved() and auth.uid() = user_id);
drop policy if exists "notiz_page_tags_owner_only" on notiz_page_tags;
create policy "notiz_page_tags_owner_only" on notiz_page_tags for all
  using (notiz_is_approved() and auth.uid() = user_id)
  with check (notiz_is_approved() and auth.uid() = user_id);
drop policy if exists "notiz_tasks_owner_only" on notiz_tasks;
create policy "notiz_tasks_owner_only" on notiz_tasks for all
  using (notiz_is_approved() and auth.uid() = user_id)
  with check (notiz_is_approved() and auth.uid() = user_id);
drop policy if exists "notiz_text_blocks_owner_only" on notiz_text_blocks;
create policy "notiz_text_blocks_owner_only" on notiz_text_blocks for all
  using (notiz_is_approved() and auth.uid() = user_id)
  with check (notiz_is_approved() and auth.uid() = user_id);
drop policy if exists "notiz_templates_owner_only" on notiz_templates;
create policy "notiz_templates_owner_only" on notiz_templates for all
  using (notiz_is_approved() and auth.uid() = user_id)
  with check (notiz_is_approved() and auth.uid() = user_id);
drop policy if exists "notiz_pdf_printouts_owner_only" on notiz_pdf_printouts;
create policy "notiz_pdf_printouts_owner_only" on notiz_pdf_printouts for all
  using (notiz_is_approved() and auth.uid() = user_id)
  with check (notiz_is_approved() and auth.uid() = user_id);

-- Gemeinsamer Projektbereich: lesen nur freigegeben; schreiben weiterhin nur als Ersteller.
drop policy if exists "projects_authenticated" on notiz_projects;
create policy "projects_authenticated" on notiz_projects for all to authenticated
  using (notiz_is_approved())
  with check (notiz_is_approved() and auth.uid() = user_id);
drop policy if exists "project_tasks_authenticated" on notiz_project_tasks;
create policy "project_tasks_authenticated" on notiz_project_tasks for all to authenticated
  using (notiz_is_approved())
  with check (notiz_is_approved() and auth.uid() = user_id);
drop policy if exists "project_task_afns_authenticated" on notiz_project_task_afns;
create policy "project_task_afns_authenticated" on notiz_project_task_afns for all to authenticated
  using (notiz_is_approved())
  with check (notiz_is_approved() and auth.uid() = user_id);

-- PDF-Originale ebenfalls serverseitig sperren.
drop policy if exists "notiz_pdfs_owner_select" on storage.objects;
create policy "notiz_pdfs_owner_select" on storage.objects for select
  using (notiz_is_approved() and bucket_id = 'notiz-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "notiz_pdfs_owner_insert" on storage.objects;
create policy "notiz_pdfs_owner_insert" on storage.objects for insert
  with check (notiz_is_approved() and bucket_id = 'notiz-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "notiz_pdfs_owner_update" on storage.objects;
create policy "notiz_pdfs_owner_update" on storage.objects for update
  using (notiz_is_approved() and bucket_id = 'notiz-pdfs' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (notiz_is_approved() and bucket_id = 'notiz-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "notiz_pdfs_owner_delete" on storage.objects;
create policy "notiz_pdfs_owner_delete" on storage.objects for delete
  using (notiz_is_approved() and bucket_id = 'notiz-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);


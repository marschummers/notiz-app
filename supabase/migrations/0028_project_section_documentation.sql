-- Laufender Projektstand als Fliesstext je Themenbereich sowie bewusst dokumentierte
-- inhaltliche Versionen. Speichern ohne Dokumentation aktualisiert nur die aktuelle Tabelle;
-- der Verlauf bleibt dadurch auf fachlich relevante Aenderungen beschraenkt.
create table if not exists notiz_project_section_documents (
  id uuid primary key,
  user_id uuid not null references auth.users (id),
  project_id uuid not null references notiz_projects (id) on delete cascade,
  section_id uuid not null unique references notiz_project_sections (id) on delete cascade,
  content text not null default '',
  updated_by_user_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists notiz_project_section_document_revisions (
  id uuid primary key,
  user_id uuid not null references auth.users (id),
  document_id uuid not null references notiz_project_section_documents (id) on delete cascade,
  project_id uuid not null references notiz_projects (id) on delete cascade,
  section_id uuid not null references notiz_project_sections (id) on delete cascade,
  previous_content text not null default '',
  content text not null default '',
  reason text,
  changed_by_user_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists notiz_project_section_documents_project_idx
  on notiz_project_section_documents (project_id);
create index if not exists notiz_project_section_document_revisions_project_idx
  on notiz_project_section_document_revisions (project_id, created_at desc);
create index if not exists notiz_project_section_document_revisions_section_idx
  on notiz_project_section_document_revisions (section_id, created_at desc);

alter table notiz_project_section_documents enable row level security;
alter table notiz_project_section_document_revisions enable row level security;

drop policy if exists "project_section_documents_team" on notiz_project_section_documents;
create policy "project_section_documents_team" on notiz_project_section_documents
  for all to authenticated
  using (notiz_is_approved() and notiz_can_access_project(project_id))
  with check (
    notiz_is_approved()
    and auth.uid() = user_id
    and auth.uid() = updated_by_user_id
    and notiz_can_access_project(project_id)
  );

drop policy if exists "project_section_document_revisions_team" on notiz_project_section_document_revisions;
create policy "project_section_document_revisions_team" on notiz_project_section_document_revisions
  for all to authenticated
  using (notiz_is_approved() and notiz_can_access_project(project_id))
  with check (
    notiz_is_approved()
    and auth.uid() = user_id
    and auth.uid() = changed_by_user_id
    and notiz_can_access_project(project_id)
  );

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'notiz_project_section_documents',
    'notiz_project_section_document_revisions'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;

alter table notiz_project_section_documents replica identity full;
alter table notiz_project_section_document_revisions replica identity full;

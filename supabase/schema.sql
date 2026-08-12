-- Notiz-App: eigene, per RLS strikt getrennte Tabellen im selben Supabase-Projekt wie die
-- Gym App (siehe supabase/coach_snapshot.sql dort) - deshalb "notiz_"-Prefix, um mit den
-- bestehenden Tabellen dieses Projekts nicht zu kollidieren. Jede Zeile gehoert genau einem
-- Account (user_id = auth.uid()); RLS stellt sicher, dass niemand fremde Zeilen lesen oder
-- schreiben kann, auch nicht ueber den oeffentlichen Anon-Key.
--
-- Ordner sind rekursiv verschachtelbar (parent_id -> notiz_folders.id, beliebige Tiefe).
-- Seiten gehoeren optional zu einem Ordner (folder_id NULL = "unabgelegt"). Die Striche einer
-- Seite (siehe Point/Stroke in src/App.tsx) werden als JSON direkt auf der Seite gespeichert,
-- nicht in einer eigenen Tabelle - fuer eine Handschrift-Notizapp mit Last-Write-Wins-Sync ist
-- eine Seite als atomare Einheit einfacher und robuster als strichweiser Sync.
--
-- `updated_at`/`deleted_at` folgen demselben Last-Write-Wins-/Softdelete-Muster wie in den
-- anderen Projekten (siehe src/lib/sync.ts) - eine Loeschung ist eine ganz normale Aenderung,
-- die sich per neuerem updated_at genauso verteilt wie jede andere.

create table if not exists notiz_folders (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  parent_id uuid references notiz_folders (id) on delete cascade,
  name text not null,
  -- bigint statt integer: "order" wird clientseitig als Date.now() (Millisekunden seit
  -- 1970) vergeben, das sprengt den Wertebereich von integer (max. ca. 2.1 Milliarden).
  "order" bigint not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists notiz_pages (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  folder_id uuid references notiz_folders (id) on delete set null,
  title text not null default '',
  strokes jsonb not null default '[]'::jsonb,
  "order" bigint not null default 0,
  -- Seiten-Hintergrund ('lined'/'dotted'/'cornell'/'blank'), siehe src/db/types.ts.
  background text not null default 'lined',
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- Favoriten-Status: nullable Zeitstempel statt Boolean, gleiches Muster wie deleted_at -
  -- liefert Status UND "zuletzt favorisiert"-Sortierung in einer Spalte.
  favorited_at timestamptz,
  -- Einfache Seiten-Properties (siehe src/db/types.ts PageType) - feste Typenliste statt
  -- generischem Property-System, custom_date ist ein frei waehlbares, optionales Datum.
  page_type text,
  custom_date timestamptz,
  -- AFN: numerische Referenznummer(n), echtes Property (kein Tag) - eine Seite kann mehrere
  -- haben, siehe src/db/types.ts Page.afns.
  afns integer[] not null default '{}'
);

create table if not exists notiz_tags (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists notiz_page_tags (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  page_id uuid not null references notiz_pages (id) on delete cascade,
  tag_id uuid not null references notiz_tags (id) on delete cascade,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- To-do auf einer Seite, an einer frei gewaehlten Position (x/y) platziert. Echter
-- strukturierter Datensatz statt aus dem Zeichentext geparst, siehe src/db/types.ts Task.
create table if not exists notiz_tasks (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  page_id uuid not null references notiz_pages (id) on delete cascade,
  text text not null default '',
  completed boolean not null default false,
  x double precision not null default 0,
  y double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Seitenunabhängige Schnellaufgaben aus der zentralen Aufgabenansicht.
create table if not exists notiz_quick_tasks (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  text text not null default '',
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Frei platziertes Textfeld auf einer Seite (per Tastatur beschrieben, keine Handschrift) -
-- gleiches Muster wie notiz_tasks, ohne completed-Spalte. Seitenverlinkungen stecken als
-- "[[pageId:Titel]]" im text-Feld selbst, siehe src/components/DrawingCanvas.tsx.
create table if not exists notiz_text_blocks (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  page_id uuid not null references notiz_pages (id) on delete cascade,
  text text not null default '',
  x double precision not null default 0,
  y double precision not null default 0,
  -- Vom Nutzer per Ziehen gewaehlte Breite in Pixeln (siehe src/db/types.ts TextBlock.width) -
  -- fehlend/null bedeutet "noch nie manuell verbreitert", nutzt dann die an den Inhalt
  -- angepasste Standardbreite.
  width integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Seiten-Vorlage: Schnappschuss ohne Fremdschluessel auf notiz_pages (siehe
-- src/db/types.ts Template) - eine spaeter geloeschte/geaenderte Seite wirkt sich nie auf
-- bereits gespeicherte Vorlagen aus.
create table if not exists notiz_templates (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  background text not null default 'lined',
  page_type text,
  tag_names jsonb not null default '[]'::jsonb,
  text_blocks jsonb not null default '[]'::jsonb,
  tasks jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- PDF-Dateiausdruck: nur Metadaten (siehe src/db/types.ts PdfPrintout) - die Datei selbst liegt
-- im Storage-Bucket "notiz-pdfs" (siehe Abschnitt "Storage" am Ende dieser Datei), unter
-- storage_path. Eine Seite traegt fuer diese erste Version hoechstens einen aktiven Ausdruck.
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

create index if not exists notiz_folders_user_id_idx on notiz_folders (user_id);
create index if not exists notiz_pages_user_id_idx on notiz_pages (user_id);
create index if not exists notiz_tags_user_id_idx on notiz_tags (user_id);
create index if not exists notiz_page_tags_user_id_idx on notiz_page_tags (user_id);
create index if not exists notiz_tasks_user_id_idx on notiz_tasks (user_id);
create index if not exists notiz_tasks_page_id_idx on notiz_tasks (page_id);
create index if not exists notiz_quick_tasks_user_id_idx on notiz_quick_tasks (user_id);
create index if not exists notiz_text_blocks_user_id_idx on notiz_text_blocks (user_id);
create index if not exists notiz_text_blocks_page_id_idx on notiz_text_blocks (page_id);
create index if not exists notiz_templates_user_id_idx on notiz_templates (user_id);
create index if not exists notiz_pdf_printouts_user_id_idx on notiz_pdf_printouts (user_id);
create index if not exists notiz_pdf_printouts_page_id_idx on notiz_pdf_printouts (page_id);

alter table notiz_folders enable row level security;
alter table notiz_pages enable row level security;
alter table notiz_tags enable row level security;
alter table notiz_page_tags enable row level security;
alter table notiz_tasks enable row level security;
alter table notiz_quick_tasks enable row level security;
alter table notiz_text_blocks enable row level security;
alter table notiz_templates enable row level security;
alter table notiz_pdf_printouts enable row level security;

create policy "notiz_folders_owner_only" on notiz_folders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "notiz_pages_owner_only" on notiz_pages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "notiz_tags_owner_only" on notiz_tags
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "notiz_page_tags_owner_only" on notiz_page_tags
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "notiz_tasks_owner_only" on notiz_tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "notiz_quick_tasks_owner_only" on notiz_quick_tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "notiz_text_blocks_owner_only" on notiz_text_blocks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "notiz_templates_owner_only" on notiz_templates
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "notiz_pdf_printouts_owner_only" on notiz_pdf_printouts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Storage: eigener privater Bucket fuer die Original-PDFs (siehe src/lib/pdfStorage.ts). Dateien
-- liegen unter "<user_id>/<printout_id>.pdf" - die Policies pruefen genau dieses erste
-- Pfadsegment gegen auth.uid(), damit jeder Account ausschliesslich seine eigenen Dateien
-- lesen/schreiben kann (row level security ist auf storage.objects in Supabase-Projekten immer
-- schon aktiv, ein eigenes "enable row level security" dafuer ist nicht noetig/moeglich).
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

-- Projekte und ihre Unterdaten duerfen nur fuer den Besitzer oder aktive Teammitglieder
-- sichtbar sein. SECURITY DEFINER vermeidet rekursive RLS-Auswertung beim Nachschlagen der
-- Mitgliedschaft in notiz_project_members.
create or replace function notiz_can_access_project(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from notiz_projects p
    where p.id = p_project_id
      and (
        p.owner_user_id = auth.uid()
        or exists (
          select 1
          from notiz_project_members m
          where m.project_id = p.id
            and m.user_id = auth.uid()
            and m.deleted_at is null
        )
      )
  );
$$;

create or replace function notiz_can_access_project_task(p_task_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from notiz_project_tasks t
    where t.id = p_task_id
      and notiz_can_access_project(t.project_id)
  );
$$;

revoke all on function notiz_can_access_project(uuid) from public;
revoke all on function notiz_can_access_project_task(uuid) from public;
grant execute on function notiz_can_access_project(uuid) to authenticated;
grant execute on function notiz_can_access_project_task(uuid) to authenticated;

drop policy if exists "projects_authenticated" on notiz_projects;
drop policy if exists "projects_team_select" on notiz_projects;
drop policy if exists "projects_owner_insert" on notiz_projects;
drop policy if exists "projects_team_update" on notiz_projects;
drop policy if exists "projects_team_delete" on notiz_projects;

create policy "projects_team_select" on notiz_projects
  for select to authenticated
  using (notiz_is_approved() and notiz_can_access_project(id));
create policy "projects_owner_insert" on notiz_projects
  for insert to authenticated
  with check (
    notiz_is_approved()
    and auth.uid() = user_id
    and (
      auth.uid() = owner_user_id
      or notiz_can_access_project(id)
    )
  );
create policy "projects_team_update" on notiz_projects
  for update to authenticated
  using (notiz_is_approved() and notiz_can_access_project(id))
  with check (notiz_is_approved() and auth.uid() = user_id and notiz_can_access_project(id));
create policy "projects_team_delete" on notiz_projects
  for delete to authenticated
  using (notiz_is_approved() and notiz_can_access_project(id));

drop policy if exists "project_members_approved" on notiz_project_members;
drop policy if exists "project_members_team_select" on notiz_project_members;
drop policy if exists "project_members_team_insert" on notiz_project_members;
drop policy if exists "project_members_team_update" on notiz_project_members;
drop policy if exists "project_members_team_delete" on notiz_project_members;

-- Die eigene Mitgliedschaft bleibt auch nach dem Soft-Delete lesbar. So erreicht die
-- Austritts-/Entfernungsinformation bestehende lokale Caches.
create policy "project_members_team_select" on notiz_project_members
  for select to authenticated
  using (
    notiz_is_approved()
    and (user_id = auth.uid() or notiz_can_access_project(project_id))
  );
create policy "project_members_team_insert" on notiz_project_members
  for insert to authenticated
  with check (notiz_is_approved() and notiz_can_access_project(project_id));
create policy "project_members_team_update" on notiz_project_members
  for update to authenticated
  using (notiz_is_approved() and notiz_can_access_project(project_id))
  with check (
    notiz_is_approved()
    and (
      notiz_can_access_project(project_id)
      or (user_id = auth.uid() and deleted_at is not null)
    )
  );
create policy "project_members_team_delete" on notiz_project_members
  for delete to authenticated
  using (notiz_is_approved() and notiz_can_access_project(project_id));

drop policy if exists "project_tasks_authenticated" on notiz_project_tasks;
drop policy if exists "project_tasks_team" on notiz_project_tasks;
create policy "project_tasks_team" on notiz_project_tasks
  for all to authenticated
  using (notiz_is_approved() and notiz_can_access_project(project_id))
  with check (notiz_is_approved() and auth.uid() = user_id and notiz_can_access_project(project_id));

drop policy if exists "project_milestones_authenticated" on notiz_project_milestones;
drop policy if exists "project_milestones_team" on notiz_project_milestones;
create policy "project_milestones_team" on notiz_project_milestones
  for all to authenticated
  using (notiz_is_approved() and notiz_can_access_project(project_id))
  with check (notiz_is_approved() and auth.uid() = user_id and notiz_can_access_project(project_id));

drop policy if exists "project_task_afns_authenticated" on notiz_project_task_afns;
drop policy if exists "project_task_afns_team" on notiz_project_task_afns;
create policy "project_task_afns_team" on notiz_project_task_afns
  for all to authenticated
  using (notiz_is_approved() and notiz_can_access_project_task(task_id))
  with check (notiz_is_approved() and auth.uid() = user_id and notiz_can_access_project_task(task_id));

drop policy if exists "project_task_comments_approved" on notiz_project_task_comments;
drop policy if exists "project_task_comments_team" on notiz_project_task_comments;
create policy "project_task_comments_team" on notiz_project_task_comments
  for all to authenticated
  using (notiz_is_approved() and notiz_can_access_project_task(task_id))
  with check (
    notiz_is_approved()
    and author_user_id = auth.uid()
    and notiz_can_access_project_task(task_id)
  );

-- Optionale Themenbereiche innerhalb eines Meilensteins.
create table if not exists notiz_project_sections (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references notiz_projects (id) on delete cascade,
  milestone_id uuid not null references notiz_project_milestones (id) on delete cascade,
  title text not null,
  sort_order bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table notiz_project_tasks
  add column if not exists section_id uuid references notiz_project_sections (id) on delete set null;

create index if not exists notiz_project_sections_project_idx on notiz_project_sections (project_id);
create index if not exists notiz_project_sections_milestone_idx on notiz_project_sections (milestone_id);
create index if not exists notiz_project_tasks_section_idx on notiz_project_tasks (section_id);

alter table notiz_project_sections enable row level security;
drop policy if exists "project_sections_team" on notiz_project_sections;
create policy "project_sections_team" on notiz_project_sections
  for all to authenticated
  using (notiz_is_approved() and notiz_can_access_project(project_id))
  with check (notiz_is_approved() and auth.uid() = user_id and notiz_can_access_project(project_id));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notiz_project_sections'
  ) then
    alter publication supabase_realtime add table public.notiz_project_sections;
  end if;
end $$;

alter table notiz_project_sections replica identity full;

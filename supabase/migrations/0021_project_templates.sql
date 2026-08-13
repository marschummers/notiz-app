-- Projektvorlagen (siehe src/db/types.ts ProjectTemplate/ProjectTemplateMilestone/
-- ProjectTemplateSection/ProjectTemplateTask): wiederverwendbare Struktur-Schnappschuesse
-- (Meilenstein/Themenbereich/Aufgabe) zum schnellen Anlegen neuer Projekte. Anders als bei
-- Projekten gibt es keine Mitgliederliste - stattdessen eine einfache Sichtbarkeit pro Vorlage:
-- 'private' = nur der Ersteller sieht/nutzt/bearbeitet/loescht sie, 'public' = alle
-- freigeschalteten Nutzer sehen und nutzen sie, aber nur der Ersteller darf sie bearbeiten
-- oder loeschen.
create table if not exists notiz_project_templates (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_by_user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists notiz_project_template_milestones (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  template_id uuid not null references notiz_project_templates (id) on delete cascade,
  title text not null,
  description text,
  relative_due_days integer,
  sort_order bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists notiz_project_template_sections (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  template_id uuid not null references notiz_project_templates (id) on delete cascade,
  milestone_template_id uuid not null references notiz_project_template_milestones (id) on delete cascade,
  title text not null,
  sort_order bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists notiz_project_template_tasks (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  template_id uuid not null references notiz_project_templates (id) on delete cascade,
  milestone_template_id uuid references notiz_project_template_milestones (id) on delete cascade,
  section_template_id uuid references notiz_project_template_sections (id) on delete set null,
  title text not null,
  description text,
  relative_due_days integer,
  sort_order bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists notiz_project_templates_created_by_idx on notiz_project_templates (created_by_user_id);
create index if not exists notiz_project_templates_visibility_idx on notiz_project_templates (visibility);
create index if not exists notiz_project_template_milestones_template_idx on notiz_project_template_milestones (template_id);
create index if not exists notiz_project_template_sections_template_idx on notiz_project_template_sections (template_id);
create index if not exists notiz_project_template_sections_milestone_idx on notiz_project_template_sections (milestone_template_id);
create index if not exists notiz_project_template_tasks_template_idx on notiz_project_template_tasks (template_id);
create index if not exists notiz_project_template_tasks_milestone_idx on notiz_project_template_tasks (milestone_template_id);
create index if not exists notiz_project_template_tasks_section_idx on notiz_project_template_tasks (section_template_id);

alter table notiz_project_templates enable row level security;
alter table notiz_project_template_milestones enable row level security;
alter table notiz_project_template_sections enable row level security;
alter table notiz_project_template_tasks enable row level security;

-- SECURITY DEFINER analog zu notiz_can_access_project/notiz_can_access_project_task (siehe
-- Migration 0017), vermeidet rekursive RLS-Auswertung beim Nachschlagen von Sichtbarkeit/
-- Ersteller in notiz_project_templates.
create or replace function notiz_can_view_project_template(p_template_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from notiz_project_templates t
    where t.id = p_template_id
      and (t.created_by_user_id = auth.uid() or t.visibility = 'public')
  );
$$;

create or replace function notiz_can_edit_project_template(p_template_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from notiz_project_templates t
    where t.id = p_template_id and t.created_by_user_id = auth.uid()
  );
$$;

revoke all on function notiz_can_view_project_template(uuid) from public;
revoke all on function notiz_can_edit_project_template(uuid) from public;
grant execute on function notiz_can_view_project_template(uuid) to authenticated;
grant execute on function notiz_can_edit_project_template(uuid) to authenticated;

create policy "project_templates_select" on notiz_project_templates
  for select to authenticated
  using (notiz_is_approved() and (created_by_user_id = auth.uid() or visibility = 'public'));
create policy "project_templates_insert" on notiz_project_templates
  for insert to authenticated
  with check (notiz_is_approved() and auth.uid() = user_id and auth.uid() = created_by_user_id);
create policy "project_templates_update" on notiz_project_templates
  for update to authenticated
  using (notiz_is_approved() and created_by_user_id = auth.uid())
  with check (notiz_is_approved() and auth.uid() = user_id and created_by_user_id = auth.uid());
create policy "project_templates_delete" on notiz_project_templates
  for delete to authenticated
  using (notiz_is_approved() and created_by_user_id = auth.uid());

create policy "project_template_milestones_select" on notiz_project_template_milestones
  for select to authenticated
  using (notiz_is_approved() and notiz_can_view_project_template(template_id));
create policy "project_template_milestones_insert" on notiz_project_template_milestones
  for insert to authenticated
  with check (notiz_is_approved() and auth.uid() = user_id and notiz_can_edit_project_template(template_id));
create policy "project_template_milestones_update" on notiz_project_template_milestones
  for update to authenticated
  using (notiz_is_approved() and notiz_can_edit_project_template(template_id))
  with check (notiz_is_approved() and auth.uid() = user_id and notiz_can_edit_project_template(template_id));
create policy "project_template_milestones_delete" on notiz_project_template_milestones
  for delete to authenticated
  using (notiz_is_approved() and notiz_can_edit_project_template(template_id));

create policy "project_template_sections_select" on notiz_project_template_sections
  for select to authenticated
  using (notiz_is_approved() and notiz_can_view_project_template(template_id));
create policy "project_template_sections_insert" on notiz_project_template_sections
  for insert to authenticated
  with check (notiz_is_approved() and auth.uid() = user_id and notiz_can_edit_project_template(template_id));
create policy "project_template_sections_update" on notiz_project_template_sections
  for update to authenticated
  using (notiz_is_approved() and notiz_can_edit_project_template(template_id))
  with check (notiz_is_approved() and auth.uid() = user_id and notiz_can_edit_project_template(template_id));
create policy "project_template_sections_delete" on notiz_project_template_sections
  for delete to authenticated
  using (notiz_is_approved() and notiz_can_edit_project_template(template_id));

create policy "project_template_tasks_select" on notiz_project_template_tasks
  for select to authenticated
  using (notiz_is_approved() and notiz_can_view_project_template(template_id));
create policy "project_template_tasks_insert" on notiz_project_template_tasks
  for insert to authenticated
  with check (notiz_is_approved() and auth.uid() = user_id and notiz_can_edit_project_template(template_id));
create policy "project_template_tasks_update" on notiz_project_template_tasks
  for update to authenticated
  using (notiz_is_approved() and notiz_can_edit_project_template(template_id))
  with check (notiz_is_approved() and auth.uid() = user_id and notiz_can_edit_project_template(template_id));
create policy "project_template_tasks_delete" on notiz_project_template_tasks
  for delete to authenticated
  using (notiz_is_approved() and notiz_can_edit_project_template(template_id));

-- Bewusst KEINE supabase_realtime-Publication-Ergaenzung: Vorlagen werden von genau einer
-- Person zu einer Zeit bearbeitet, kein Live-Push noetig - Aenderungen kommen ueber die
-- naechste normale Synchronisierung (siehe lib/sync.ts).

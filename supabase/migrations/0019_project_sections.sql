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

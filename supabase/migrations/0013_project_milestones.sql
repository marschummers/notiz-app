-- Projektbereich Phase 2: Meilensteine und optionale Zuordnung von Projektaufgaben.
create table if not exists notiz_project_milestones (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references notiz_projects (id) on delete cascade,
  title text not null,
  description text,
  due_date timestamptz,
  status text not null check (status in ('planned','in_progress','completed')),
  sort_order bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table notiz_project_tasks add column if not exists milestone_id uuid references notiz_project_milestones (id) on delete set null;

create index if not exists notiz_project_milestones_project_idx on notiz_project_milestones (project_id);
create index if not exists notiz_project_milestones_due_idx on notiz_project_milestones (due_date);
create index if not exists notiz_project_tasks_milestone_idx on notiz_project_tasks (milestone_id);

alter table notiz_project_milestones enable row level security;
drop policy if exists "project_milestones_authenticated" on notiz_project_milestones;
create policy "project_milestones_authenticated" on notiz_project_milestones for all to authenticated
  using (notiz_is_approved())
  with check (notiz_is_approved() and auth.uid() = user_id);


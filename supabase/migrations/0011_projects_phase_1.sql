-- Projektbereich Phase 1. `user_id` ist der Ersteller der synchronisierten Zeile; Projekte
-- sind im Gegensatz zu privaten Notizen fuer alle angemeldeten Benutzer sichtbar.
create table if not exists notiz_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  updated_at timestamptz not null default now()
);

create table if not exists notiz_projects (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  customer_name text,
  owner_user_id uuid not null references auth.users (id),
  status text not null check (status in ('active','waiting','completed','archived')),
  start_date timestamptz,
  target_date timestamptz,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists notiz_project_tasks (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references notiz_projects (id) on delete cascade,
  title text not null,
  description text,
  assignee_user_id uuid references auth.users (id),
  status text not null check (status in ('open','in_progress','waiting','completed')),
  due_date timestamptz,
  waiting_for text check (waiting_for is null or waiting_for in ('Kunde','Entwicklung','Support','Vertrieb','Extern','Sonstige')),
  sort_order bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists notiz_project_task_afns (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id uuid not null references notiz_project_tasks (id) on delete cascade,
  afn_number bigint not null check (afn_number > 0),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists notiz_projects_status_idx on notiz_projects (status);
create index if not exists notiz_project_tasks_project_idx on notiz_project_tasks (project_id);
create index if not exists notiz_project_tasks_assignee_idx on notiz_project_tasks (assignee_user_id);
create index if not exists notiz_project_task_afns_task_idx on notiz_project_task_afns (task_id);

alter table notiz_projects enable row level security;
alter table notiz_project_tasks enable row level security;
alter table notiz_project_task_afns enable row level security;
alter table notiz_profiles enable row level security;

create policy "projects_authenticated" on notiz_projects for all to authenticated using (true) with check (auth.uid() = user_id);
create policy "project_tasks_authenticated" on notiz_project_tasks for all to authenticated using (true) with check (auth.uid() = user_id);
create policy "project_task_afns_authenticated" on notiz_project_task_afns for all to authenticated using (true) with check (auth.uid() = user_id);
create policy "profiles_read_authenticated" on notiz_profiles for select to authenticated using (true);
create policy "profiles_write_self" on notiz_profiles for insert to authenticated with check (auth.uid() = id);
create policy "profiles_update_self" on notiz_profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);


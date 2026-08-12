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

create index if not exists notiz_quick_tasks_user_id_idx on notiz_quick_tasks (user_id);

alter table notiz_quick_tasks enable row level security;

create policy "notiz_quick_tasks_owner_only" on notiz_quick_tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

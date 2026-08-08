-- To-do-Funktion: eigene Tabelle, gleiches Muster wie notiz_folders/notiz_pages/notiz_tags
-- (RLS strikt auf den eigenen Account beschraenkt, weiches Loeschen ueber deleted_at).
-- page_id referenziert notiz_pages und wird beim Loeschen der Seite kaskadiert.
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

create index if not exists notiz_tasks_user_id_idx on notiz_tasks (user_id);
create index if not exists notiz_tasks_page_id_idx on notiz_tasks (page_id);

alter table notiz_tasks enable row level security;

create policy "notiz_tasks_owner_only" on notiz_tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

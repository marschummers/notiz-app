-- Einfache, chronologische Team-Kommentare an Projektaufgaben.
create table if not exists notiz_project_task_comments (
  id uuid primary key,
  task_id uuid not null references notiz_project_tasks (id) on delete cascade,
  author_user_id uuid not null references auth.users (id),
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists notiz_project_task_comments_task_idx
  on notiz_project_task_comments (task_id, created_at);

alter table notiz_project_task_comments enable row level security;
drop policy if exists "project_task_comments_approved" on notiz_project_task_comments;
create policy "project_task_comments_approved" on notiz_project_task_comments
  for all to authenticated
  using (notiz_is_approved())
  with check (notiz_is_approved() and author_user_id = auth.uid());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notiz_project_task_comments'
  ) then
    alter publication supabase_realtime add table public.notiz_project_task_comments;
  end if;
end $$;

alter table notiz_project_task_comments replica identity full;

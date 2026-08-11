-- Projektbereich Phase 3: Mitglieder und Realtime.
create table if not exists notiz_project_members (
  id uuid primary key,
  project_id uuid not null references notiz_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (project_id, user_id)
);

create index if not exists notiz_project_members_project_idx on notiz_project_members (project_id);
create index if not exists notiz_project_members_user_idx on notiz_project_members (user_id);

insert into notiz_project_members (id, project_id, user_id, role, created_at, updated_at)
select gen_random_uuid(), p.id, p.owner_user_id, 'owner', p.created_at, now()
from notiz_projects p
where p.deleted_at is null
on conflict (project_id, user_id) do update set role = 'owner', deleted_at = null, updated_at = excluded.updated_at;

alter table notiz_project_members enable row level security;
drop policy if exists "project_members_approved" on notiz_project_members;
create policy "project_members_approved" on notiz_project_members for all to authenticated
using (notiz_is_approved()) with check (notiz_is_approved());

-- Realtime benoetigt die Tabellen in der supabase_realtime-Publication. Der Block ist
-- wiederholt ausfuehrbar und fuegt nur noch fehlende Tabellen hinzu.
do $$
declare table_name text;
begin
  foreach table_name in array array['notiz_projects','notiz_project_members','notiz_project_tasks','notiz_project_milestones','notiz_project_task_afns']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;

alter table notiz_projects replica identity full;
alter table notiz_project_members replica identity full;
alter table notiz_project_tasks replica identity full;
alter table notiz_project_milestones replica identity full;
alter table notiz_project_task_afns replica identity full;

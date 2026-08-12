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
  with check (notiz_is_approved() and auth.uid() = user_id and auth.uid() = owner_user_id);
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

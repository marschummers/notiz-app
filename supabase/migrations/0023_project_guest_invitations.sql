-- Sichere Projektfreigaben fuer externe Gaeste. Gaeste werden absichtlich NICHT allgemein
-- freigegeben: Sie duerfen nur eingeladene Projekte lesen und eigene Kommentare schreiben.

alter table notiz_profiles add column if not exists is_guest boolean not null default false;

create table if not exists notiz_project_invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references notiz_projects (id) on delete cascade,
  email text not null,
  token uuid not null unique default gen_random_uuid(),
  invited_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notiz_project_invitations_project_idx on notiz_project_invitations (project_id);
create index if not exists notiz_project_invitations_email_idx on notiz_project_invitations (lower(email));
alter table notiz_project_invitations enable row level security;

create or replace function notiz_is_guest()
returns boolean language sql security definer stable set search_path = public
as $$ select coalesce((select is_guest from notiz_profiles where id = auth.uid()), false); $$;

create or replace function notiz_shares_project_with(p_user_id uuid)
returns boolean language sql security definer stable set search_path = public
as $$
  select exists (
    select 1 from notiz_project_members mine
    join notiz_project_members theirs on theirs.project_id = mine.project_id
    where mine.user_id = auth.uid() and mine.deleted_at is null
      and theirs.user_id = p_user_id and theirs.deleted_at is null
  );
$$;

revoke all on function notiz_is_guest() from public;
revoke all on function notiz_shares_project_with(uuid) from public;
grant execute on function notiz_is_guest() to authenticated;
grant execute on function notiz_shares_project_with(uuid) to authenticated;

drop policy if exists "profiles_guest_project_directory" on notiz_profiles;
create policy "profiles_guest_project_directory" on notiz_profiles
  for select to authenticated using (notiz_is_guest() and notiz_shares_project_with(id));

create or replace function notiz_create_project_invitation(p_project_id uuid, p_email text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_token uuid;
begin
  if not notiz_is_approved() or not exists (
    select 1 from notiz_projects where id = p_project_id and owner_user_id = auth.uid() and deleted_at is null
  ) then raise exception 'Nur der Projektverantwortliche darf Gaeste einladen.'; end if;
  if nullif(trim(p_email), '') is null then raise exception 'E-Mail-Adresse fehlt.'; end if;

  update notiz_project_invitations set revoked_at = now()
  where project_id = p_project_id and lower(email) = lower(trim(p_email))
    and accepted_at is null and revoked_at is null;
  insert into notiz_project_invitations(project_id, email, invited_by)
  values (p_project_id, lower(trim(p_email)), auth.uid()) returning token into v_token;
  return v_token;
end;
$$;

create or replace function notiz_accept_project_invitation(p_token uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_invite notiz_project_invitations%rowtype; v_email text;
begin
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  select * into v_invite from notiz_project_invitations
  where token = p_token and revoked_at is null and accepted_at is null and expires_at > now()
  for update;
  if not found then raise exception 'Die Einladung ist ungueltig oder abgelaufen.'; end if;
  if v_email = '' or v_email <> lower(v_invite.email) then
    raise exception 'Diese Einladung wurde fuer eine andere E-Mail-Adresse erstellt.';
  end if;

  update notiz_profiles set is_guest = true, updated_at = now() where id = auth.uid();
  insert into notiz_project_members(id, project_id, user_id, role, created_at, updated_at)
  values (gen_random_uuid(), v_invite.project_id, auth.uid(), 'member', now(), now())
  on conflict (project_id, user_id) do update set deleted_at = null, updated_at = now();
  update notiz_project_invitations set accepted_at = now(), accepted_by = auth.uid() where id = v_invite.id;
  return v_invite.project_id;
end;
$$;

revoke all on function notiz_create_project_invitation(uuid, text) from public;
revoke all on function notiz_accept_project_invitation(uuid) from public;
grant execute on function notiz_create_project_invitation(uuid, text) to authenticated;
grant execute on function notiz_accept_project_invitation(uuid) to authenticated;

drop policy if exists "project_invitations_owner_select" on notiz_project_invitations;
create policy "project_invitations_owner_select" on notiz_project_invitations for select to authenticated
  using (notiz_is_approved() and exists (
    select 1 from notiz_projects p where p.id = project_id and p.owner_user_id = auth.uid()
  ));

-- Projektdaten: interne Benutzer behalten ihre bisherigen Teamrechte. Gaeste erhalten nur SELECT.
drop policy if exists "projects_team_select" on notiz_projects;
create policy "projects_team_select" on notiz_projects for select to authenticated
  using ((notiz_is_approved() or notiz_is_guest()) and notiz_can_access_project(id));

drop policy if exists "project_members_team_select" on notiz_project_members;
create policy "project_members_team_select" on notiz_project_members for select to authenticated
  using ((notiz_is_approved() or notiz_is_guest()) and (user_id = auth.uid() or notiz_can_access_project(project_id)));
drop policy if exists "project_members_team_insert" on notiz_project_members;
drop policy if exists "project_members_team_update" on notiz_project_members;
drop policy if exists "project_members_team_delete" on notiz_project_members;
drop policy if exists "project_members_owner_insert" on notiz_project_members;
drop policy if exists "project_members_owner_update" on notiz_project_members;
drop policy if exists "project_members_owner_delete" on notiz_project_members;
create policy "project_members_owner_insert" on notiz_project_members for insert to authenticated
  with check (notiz_is_approved() and notiz_can_access_project(project_id));
create policy "project_members_owner_update" on notiz_project_members for update to authenticated
  using (notiz_is_approved() and notiz_can_access_project(project_id))
  with check (notiz_is_approved() and notiz_can_access_project(project_id));
create policy "project_members_owner_delete" on notiz_project_members for delete to authenticated
  using (notiz_is_approved() and notiz_can_access_project(project_id));

drop policy if exists "project_tasks_team" on notiz_project_tasks;
drop policy if exists "project_tasks_team_select" on notiz_project_tasks;
drop policy if exists "project_tasks_team_write" on notiz_project_tasks;
create policy "project_tasks_team_select" on notiz_project_tasks for select to authenticated
  using ((notiz_is_approved() or notiz_is_guest()) and notiz_can_access_project(project_id));
create policy "project_tasks_team_write" on notiz_project_tasks for all to authenticated
  using (notiz_is_approved() and notiz_can_access_project(project_id))
  with check (notiz_is_approved() and auth.uid() = user_id and notiz_can_access_project(project_id));

drop policy if exists "project_milestones_team" on notiz_project_milestones;
drop policy if exists "project_milestones_team_select" on notiz_project_milestones;
drop policy if exists "project_milestones_team_write" on notiz_project_milestones;
create policy "project_milestones_team_select" on notiz_project_milestones for select to authenticated
  using ((notiz_is_approved() or notiz_is_guest()) and notiz_can_access_project(project_id));
create policy "project_milestones_team_write" on notiz_project_milestones for all to authenticated
  using (notiz_is_approved() and notiz_can_access_project(project_id))
  with check (notiz_is_approved() and auth.uid() = user_id and notiz_can_access_project(project_id));

drop policy if exists "project_sections_team" on notiz_project_sections;
drop policy if exists "project_sections_team_select" on notiz_project_sections;
drop policy if exists "project_sections_team_write" on notiz_project_sections;
create policy "project_sections_team_select" on notiz_project_sections for select to authenticated
  using ((notiz_is_approved() or notiz_is_guest()) and notiz_can_access_project(project_id));
create policy "project_sections_team_write" on notiz_project_sections for all to authenticated
  using (notiz_is_approved() and notiz_can_access_project(project_id))
  with check (notiz_is_approved() and auth.uid() = user_id and notiz_can_access_project(project_id));

drop policy if exists "project_task_afns_team" on notiz_project_task_afns;
drop policy if exists "project_task_afns_team_select" on notiz_project_task_afns;
drop policy if exists "project_task_afns_team_write" on notiz_project_task_afns;
create policy "project_task_afns_team_select" on notiz_project_task_afns for select to authenticated
  using ((notiz_is_approved() or notiz_is_guest()) and notiz_can_access_project_task(task_id));
create policy "project_task_afns_team_write" on notiz_project_task_afns for all to authenticated
  using (notiz_is_approved() and notiz_can_access_project_task(task_id))
  with check (notiz_is_approved() and auth.uid() = user_id and notiz_can_access_project_task(task_id));

drop policy if exists "project_task_comments_team" on notiz_project_task_comments;
drop policy if exists "project_task_comments_team_select" on notiz_project_task_comments;
drop policy if exists "project_task_comments_own_insert" on notiz_project_task_comments;
drop policy if exists "project_task_comments_own_update" on notiz_project_task_comments;
drop policy if exists "project_task_comments_own_delete" on notiz_project_task_comments;
create policy "project_task_comments_team_select" on notiz_project_task_comments for select to authenticated
  using ((notiz_is_approved() or notiz_is_guest()) and notiz_can_access_project_task(task_id));
create policy "project_task_comments_own_insert" on notiz_project_task_comments for insert to authenticated
  with check ((notiz_is_approved() or notiz_is_guest()) and author_user_id = auth.uid() and notiz_can_access_project_task(task_id));
create policy "project_task_comments_own_update" on notiz_project_task_comments for update to authenticated
  using (author_user_id = auth.uid() and (notiz_is_approved() or notiz_is_guest()))
  with check (author_user_id = auth.uid() and (notiz_is_approved() or notiz_is_guest()));
create policy "project_task_comments_own_delete" on notiz_project_task_comments for delete to authenticated
  using (author_user_id = auth.uid() and (notiz_is_approved() or notiz_is_guest()));

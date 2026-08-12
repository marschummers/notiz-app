-- Supabase prueft bei INSERT ... ON CONFLICT DO UPDATE zuerst auch die INSERT-Policy.
-- Deshalb muessen bereits bestehende, fuer ein Teammitglied zugaengliche Projekte diese
-- Vorpruefung bestehen. Neue Projekte bleiben weiterhin auf den eigenen Besitzer beschraenkt,
-- weil notiz_can_access_project(id) fuer eine noch nicht vorhandene ID false liefert.
drop policy if exists "projects_owner_insert" on notiz_projects;
create policy "projects_owner_insert" on notiz_projects
  for insert to authenticated
  with check (
    notiz_is_approved()
    and auth.uid() = user_id
    and (
      auth.uid() = owner_user_id
      or notiz_can_access_project(id)
    )
  );

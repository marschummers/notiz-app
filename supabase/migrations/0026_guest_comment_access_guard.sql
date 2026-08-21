-- Entfernte Gaeste duerfen ihre frueheren Kommentare nicht weiter veraendern oder loeschen.
-- Die bestehende INSERT-Regel prueft den Projektzugang bereits; UPDATE und DELETE werden hier
-- auf denselben aktuellen Zugriff eingeschraenkt.

drop policy if exists "project_task_comments_own_update" on notiz_project_task_comments;
drop policy if exists "project_task_comments_own_delete" on notiz_project_task_comments;

create policy "project_task_comments_own_update" on notiz_project_task_comments
  for update to authenticated
  using (
    author_user_id = auth.uid()
    and (notiz_is_approved() or notiz_is_guest())
    and notiz_can_access_project_task(task_id)
  )
  with check (
    author_user_id = auth.uid()
    and (notiz_is_approved() or notiz_is_guest())
    and notiz_can_access_project_task(task_id)
  );

create policy "project_task_comments_own_delete" on notiz_project_task_comments
  for delete to authenticated
  using (
    author_user_id = auth.uid()
    and (notiz_is_approved() or notiz_is_guest())
    and notiz_can_access_project_task(task_id)
  );

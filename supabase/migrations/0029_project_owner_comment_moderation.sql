-- Kommentarverfasser duerfen weiterhin nur ihre eigenen Kommentare aendern. Zusaetzlich darf
-- der Projektverantwortliche Kommentare innerhalb seines Projekts moderieren (Soft-Loeschung
-- durch die App sowie notfalls eine echte Loeschung).
drop policy if exists "project_task_comments_owner_update" on notiz_project_task_comments;
drop policy if exists "project_task_comments_owner_delete" on notiz_project_task_comments;

create policy "project_task_comments_owner_update" on notiz_project_task_comments
  for update to authenticated
  using (
    notiz_is_approved()
    and exists (
      select 1
      from notiz_project_tasks task
      join notiz_projects project on project.id = task.project_id
      where task.id = task_id
        and task.deleted_at is null
        and project.deleted_at is null
        and project.owner_user_id = auth.uid()
    )
  )
  with check (
    notiz_is_approved()
    and exists (
      select 1
      from notiz_project_tasks task
      join notiz_projects project on project.id = task.project_id
      where task.id = task_id
        and task.deleted_at is null
        and project.deleted_at is null
        and project.owner_user_id = auth.uid()
    )
  );

create policy "project_task_comments_owner_delete" on notiz_project_task_comments
  for delete to authenticated
  using (
    notiz_is_approved()
    and exists (
      select 1
      from notiz_project_tasks task
      join notiz_projects project on project.id = task.project_id
      where task.id = task_id
        and task.deleted_at is null
        and project.deleted_at is null
        and project.owner_user_id = auth.uid()
    )
  );

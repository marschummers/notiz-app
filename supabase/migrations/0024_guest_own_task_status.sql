-- Gaeste duerfen ausschliesslich Status und "Wartet auf" ihrer eigenen Aufgaben pflegen.
-- Die normale UPDATE-Policy bleibt fuer Gaeste gesperrt; dieser eng begrenzte RPC ist der
-- einzige Schreibweg und verhindert Aenderungen an Titel, Termin, Prioritaet oder Zustaendigkeit.

create or replace function notiz_guest_update_own_task_status(
  p_task_id uuid,
  p_status text,
  p_waiting_for text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not notiz_is_guest() then
    raise exception 'Diese Funktion ist nur fuer Gastkonten vorgesehen.';
  end if;
  if p_status not in ('open', 'in_progress', 'waiting', 'completed') then
    raise exception 'Ungueltiger Aufgabenstatus.';
  end if;

  update notiz_project_tasks
  set status = p_status,
      waiting_for = case
        when p_status = 'waiting' then nullif(trim(coalesce(p_waiting_for, '')), '')
        else null
      end,
      updated_at = now()
  where id = p_task_id
    and assignee_user_id = auth.uid()
    and deleted_at is null
    and notiz_can_access_project(project_id);

  if not found then
    raise exception 'Die Aufgabe ist dir nicht zugewiesen oder nicht mehr zugaenglich.';
  end if;
end;
$$;

revoke all on function notiz_guest_update_own_task_status(uuid, text, text) from public;
grant execute on function notiz_guest_update_own_task_status(uuid, text, text) to authenticated;

-- "Wartet auf" ist ab jetzt ein Freitextfeld. Die Spalte war bereits text, wurde in der
-- ersten Projektmigration aber durch eine CHECK-Constraint auf sechs feste Werte begrenzt.
alter table notiz_project_tasks
  drop constraint if exists notiz_project_tasks_waiting_for_check;

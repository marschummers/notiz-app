-- Zwei feste, pro Projekt frei benennbare Zusatzfelder fuer Aufgaben. Die Bezeichnung
-- (z.B. "Modul") wird am Projekt hinterlegt, der eigentliche Wert an der Aufgabe. Bleibt die
-- Bezeichnung leer, blendet das Frontend das Feld aus - Werte gehen dabei nicht verloren.
alter table notiz_projects add column if not exists custom_field_1_label text;
alter table notiz_projects add column if not exists custom_field_2_label text;
alter table notiz_project_tasks add column if not exists custom_field_1_value text;
alter table notiz_project_tasks add column if not exists custom_field_2_value text;

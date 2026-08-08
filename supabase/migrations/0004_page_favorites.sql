-- Favoriten-Status fuer Seiten: gleiches Muster wie deleted_at (nullable Zeitstempel statt
-- eigenem Boolean-Feld) - liefert Status UND "zuletzt favorisiert"-Sortierung in einer Spalte.
alter table notiz_pages add column if not exists favorited_at timestamptz;

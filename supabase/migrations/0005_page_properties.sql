-- Einfache Seiten-Properties (Typ + optionales Datum) fuer den ersten Schritt - bewusst feste
-- Spalten statt eines generischen Property-Systems, siehe src/db/types.ts PageType.
alter table notiz_pages add column if not exists page_type text;
alter table notiz_pages add column if not exists custom_date timestamptz;

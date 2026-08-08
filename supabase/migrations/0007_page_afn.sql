-- AFN: rein numerische Referenznummer(n) pro Seite (1-999999), echtes Property (kein Tag) -
-- eine Seite kann mehrere haben, deshalb Array statt Einzelwert-Spalte, siehe src/db/types.ts
-- Page.afns.
alter table notiz_pages add column if not exists afns integer[] not null default '{}';

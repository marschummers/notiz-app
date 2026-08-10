-- Generische, erweiterbare Seiten-Properties. Die bisherigen Spalten page_type, custom_date
-- und afns bleiben absichtlich bestehen, damit ältere App-Versionen und vorhandene Daten
-- weiterhin funktionieren.
alter table notiz_pages add column if not exists properties jsonb not null default '{}'::jsonb;
alter table notiz_pages add column if not exists created_at timestamptz;

-- `order` wurde bei Seiten bisher beim Anlegen mit Date.now() gesetzt und ist deshalb für
-- Bestandsseiten die beste verfügbare Rekonstruktion des Erstellzeitpunkts.
update notiz_pages
set created_at = to_timestamp("order" / 1000.0)
where created_at is null;

alter table notiz_pages alter column created_at set default now();
alter table notiz_pages alter column created_at set not null;

alter table notiz_templates add column if not exists properties jsonb not null default '{}'::jsonb;


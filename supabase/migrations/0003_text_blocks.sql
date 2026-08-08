-- Frei platzierte Textfelder (per Tastatur beschrieben, keine Handschrift) - gleiches Muster
-- wie notiz_tasks, nur ohne completed-Spalte. Seitenverlinkungen ("[[pageId:Titel]]") stecken
-- im text-Feld selbst, brauchen also keine eigene Spalte/Tabelle.
create table if not exists notiz_text_blocks (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  page_id uuid not null references notiz_pages (id) on delete cascade,
  text text not null default '',
  x double precision not null default 0,
  y double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists notiz_text_blocks_user_id_idx on notiz_text_blocks (user_id);
create index if not exists notiz_text_blocks_page_id_idx on notiz_text_blocks (page_id);

alter table notiz_text_blocks enable row level security;

create policy "notiz_text_blocks_owner_only" on notiz_text_blocks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Seiten-Vorlagen: Schnappschuss (kein Fremdschluessel auf notiz_pages), siehe
-- src/db/types.ts Template. tag_names/text_blocks/tasks als jsonb, gleiches Muster wie
-- notiz_pages.strokes.
create table if not exists notiz_templates (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  background text not null default 'lined',
  page_type text,
  tag_names jsonb not null default '[]'::jsonb,
  text_blocks jsonb not null default '[]'::jsonb,
  tasks jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists notiz_templates_user_id_idx on notiz_templates (user_id);

alter table notiz_templates enable row level security;

create policy "notiz_templates_owner_only" on notiz_templates
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

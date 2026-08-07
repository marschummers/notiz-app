-- "order" wird clientseitig als Date.now() (Millisekunden seit 1970) vergeben - das sprengt
-- den Wertebereich von "integer" (max. ca. 2.1 Milliarden) bei weitem, siehe Fehler
-- "value ... is out of range for type integer" beim Sync. bigint deckt das locker ab.
alter table notiz_folders alter column "order" type bigint;
alter table notiz_pages alter column "order" type bigint;

-- Konfigurierbarer Seiten-Hintergrund (liniert/gepunktet/Cornell/leer), siehe
-- src/db/types.ts PageBackground.
alter table notiz_pages add column if not exists background text not null default 'lined';

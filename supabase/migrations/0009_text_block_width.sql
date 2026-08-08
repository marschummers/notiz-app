-- Vom Nutzer per Ziehen gewaehlte Breite eines Textfelds (siehe src/db/types.ts TextBlock.width) -
-- nullable, fehlend bedeutet "noch nie manuell verbreitert", das Feld nutzt dann die normale,
-- an den Inhalt angepasste Breite.
alter table notiz_text_blocks add column if not exists width integer;

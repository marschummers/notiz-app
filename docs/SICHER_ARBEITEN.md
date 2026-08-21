# Sicher an der Notiz-App arbeiten

## Verbindlicher Ablauf

1. Aenderungen werden auf einem eigenen Branch vorbereitet, nicht direkt auf `main`.
2. Datenbankaenderungen werden ausschliesslich als neue, nummerierte Datei unter
   `supabase/migrations/` angelegt. Bereits ausgefuehrte Migrationen bleiben unveraendert.
3. Die automatischen Code- und Migrationspruefungen muessen erfolgreich sein.
4. Vor einer Produktionsmigration muss das letzte Backup erfolgreich und der monatliche
   Wiederherstellungstest aktuell sein.
5. Die Migration wird zuerst auf einer wegwerfbaren, aus dem Backup wiederhergestellten
   Datenbank getestet. Bis dieser Schritt automatisiert ist, benoetigen Migrationen ein
   technisches Review.
6. Erst danach wird die Migration bewusst und einzeln in Supabase ausgefuehrt.
7. Nach dem Release werden Anmeldung, Projekte, Gastzugang, Kommentare, Aufgabenstatus und
   PDF-Zugriff kurz mit Testkonten geprueft.

## Niemals ohne separates technisches Review

- `DROP TABLE`, `DROP SCHEMA` oder `TRUNCATE`
- Deaktivieren oder grossflaechiges Lockern von RLS
- unbeschraenktes `DELETE` oder `UPDATE`
- Aenderungen an Authentifizierung, Gastrollen oder Storage-Policies
- Aenderungen, die mehrere bestehende Datensaetze umformen

Die automatische Pruefung blockiert einige dieser Muster absichtlich. Eine KI-Aussage wie
"das ist sicher" ersetzt weder den Test auf der Wegwerfdatenbank noch das Review.

## Rollout-Stufen

1. Zwei interne Testpersonen
2. Alle internen Berater
3. Ein einzelner Pilotkunde mit Test-/unkritischen Daten
4. Wenige weitere Pilotkunden
5. Breiter Kundenbetrieb erst nach nachgewiesener Mandantentrennung und eigener
   Supabase-Produktionsinstanz fuer die Notiz-App

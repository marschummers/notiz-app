-- Offene Zugangsanfragen koennen abgelehnt werden, ohne das Auth-Konto oder Daten zu loeschen.
-- Der Zeitstempel erhaelt die Entscheidung nachvollziehbar und erlaubt eine spaetere Freigabe.

alter table notiz_profiles
  add column if not exists rejected_at timestamptz;

# Notiz App – Pen-Input-Prototyp

Minimaler Test, bevor die eigentliche Notizen-App (Ordnerstruktur, Tags, Supabase-Sync) gebaut wird:
Funktioniert handschriftliche Eingabe mit dem Apple Pencil auf dem iPad in einer Web-App gut genug?

## Was hier drin ist

- Vollflächige Zeichenfläche (Canvas) mit Pointer Events
- Druckempfindliche Strichstärke (`pointer.pressure`)
- Palm Rejection: sobald einmal ein Stift erkannt wurde, zeichnet nur noch der Stift, nicht mehr der Handballen
- Farb-/Stiftstärkenauswahl, Radierer, Rückgängig, Leeren
- Als PWA installierbar ("Zum Home-Bildschirm")
- Debug-Anzeige unten rechts in der Toolbar zeigt erkannten Eingabetyp und Druckwert live

Zeichnungen werden nur lokal im Browser (`localStorage`) gespeichert – kein Sync, keine echten Notizdaten.

## Entwicklung

```bash
npm install
npm run dev
```

## Deploy

Push auf `main` deployt automatisch über GitHub Actions nach GitHub Pages.

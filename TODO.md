# To-do-Liste

Stand: 02.11.2026 (Version 0.4). Wird nach jedem Entwicklungsschritt aktualisiert.

## Phase 1 – Planung
- [x] Anforderungsanalyse, Architektur, Datenmodell, Kosten, Risiken
- [x] Offene Fragen geklärt (Acker-/Futterbau ohne Tiere, Kanton Zürich ÖLN, 2–3 Benutzer, online reicht)
- [x] Ansichten entworfen (Dashboard, Felder, Erfassen, Fruchtfolge)
- [x] GitHub-Repository
- [x] Supabase-Projekt (Region Zürich) anlegen, Migration 1 einspielen
- [x] App online auf Cloudflare (schweikhof-app.hjbfdy94n5.workers.dev)
- [x] Migration 2 einspielen
- [x] Migration 1–3 einspielen (komplett)
- [ ] Migration 4 einspielen (Maschinen, Partner, Hinweise, Teilen)
- [ ] Domain bei Jimdo klären (eigene DNS-Einträge möglich?)

## Phase 2 – Grundsystem
- [x] Projektgerüst React/TS/Vite, PWA, Gestaltung
- [x] Datenbank: Betrieb, Benutzer, Rollen, Zugriffsregeln, Änderungsprotokoll, Versionsschutz
- [x] Anmeldung, Registrierung, Ersteinrichtung
- [x] Navigation Handy (unten) und Mac (Seitenleiste)
- [x] Automatische Prüfungen (Build, Datenbanktests)
- [ ] Weitere Benutzer einladen, Rollen ändern, deaktivieren
- [ ] Passwort zurücksetzen

## Phase 3 – Felder und Fruchtfolge
- [x] Felder anlegen, bearbeiten, Feldhistorie
- [x] Kulturkatalog (Standardkulturen)
- [x] Fruchtfolge-Raster mit Flächensummen, Hinweisen, CSV-Export
- [ ] Import aus Excel (Fruchtkalender, Fruchtfolge) – Dateien vom Betrieb nötig
- [ ] Parzellen zu Feldern zuordnen
- [ ] Fotos zu Feldern
- [x] Hof-Ansicht mit swisstopo-Luftbild, Feldgrenzen zeichnen/ändern, Gebäude mit Links, Schalter Hof-Ansicht/Liste
- [ ] Export PDF und echtes .xlsx

## Phase 4 – Arbeiten, Lager, Düngung
- [x] Lagerartikel, Lagerjournal, Mindestbestand, Inventur
- [x] Feldarbeiten für mehrere Felder, schnelle Erfassung am Handy
- [x] Düngung mit automatischer Lagerbuchung, Nährstoffübersicht
- [x] Ackerschlagkartei mit Filtern, CSV-Export, Druck/PDF
- [ ] Pflanzenschutz: Wirkstoff, Zulassungsnummer, Wartefrist
- [ ] Echtes .xlsx und gestaltete PDF-Berichte

## Phase 5 bis 8
- [x] Maschinen, Wartungspläne, Wartung/Reparatur/Beobachtung, Ersatzteile, Standplatz
- [x] Partner (Lohnunternehmen, Mechaniker …)
- [x] Felder teilen/zusammenführen, Feldhinweise
- [x] Dünger-Katalog
- [ ] Fotos und Dokumente (Anleitungen, Rechnungen) zu Maschinen und Feldern
- [ ] Betriebsstunden automatisch aus Feldarbeiten
- [ ] Ernte und Verkauf
- [ ] Aufgaben und Kalender
- [ ] Pflanzenschutz, Backups ausserhalb Supabase, Sicherheitsprüfung, Subdomain

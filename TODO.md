# To-do-Liste

Stand: 02.11.2026. Wird nach jedem Entwicklungsschritt aktualisiert.

## Phase 1 – Planung
- [x] Anforderungsanalyse, Architektur, Datenmodell, Kosten, Risiken
- [x] Offene Fragen geklärt (Acker-/Futterbau ohne Tiere, Kanton Zürich ÖLN, 2–3 Benutzer, online reicht)
- [x] Ansichten entworfen (Dashboard, Felder, Erfassen, Fruchtfolge)
- [x] GitHub-Repository
- [ ] Supabase-Projekt (Region Zürich) anlegen, Migration einspielen
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
- [ ] Karte mit swisstopo, Feldgrenzen auf Luftbild zeichnen
- [ ] Export PDF und echtes .xlsx

## Phase 4 – Arbeiten, Lager, Düngung
- [ ] Lagerartikel, Lagerjournal, Mindestbestand
- [ ] Feldarbeiten für mehrere Felder, schnelle Erfassung am Handy
- [ ] Düngung mit automatischer Lagerbuchung, Nährstoffübersicht
- [ ] Ackerschlagkartei mit Filtern und Export

## Phase 5 bis 8
- [ ] Maschinen und Wartung
- [ ] Ernte und Verkauf
- [ ] Aufgaben und Kalender
- [ ] Pflanzenschutz, Backups ausserhalb Supabase, Sicherheitsprüfung, Subdomain

# To-do-Liste

Stand: 02.11.2026 (Version 0.15). Wird nach jedem Entwicklungsschritt aktualisiert.

## Phase 1 – Planung
- [x] Anforderungsanalyse, Architektur, Datenmodell, Kosten, Risiken
- [x] Offene Fragen geklärt (Acker-/Futterbau ohne Tiere, Kanton Zürich ÖLN, 2–3 Benutzer, online reicht)
- [x] Ansichten entworfen (Dashboard, Felder, Erfassen, Fruchtfolge)
- [x] GitHub-Repository
- [x] Supabase-Projekt (Region Zürich) anlegen, Migration 1 einspielen
- [x] App online auf Cloudflare (schweikhof-app.hjbfdy94n5.workers.dev)
- [x] Migration 2 einspielen
- [x] Migration 1–3 einspielen (komplett)
- [x] Migration 4 einspielen (Maschinen, Partner, Hinweise, Teilen)
- [ ] Migration 5 einspielen (Aufträge)
- [ ] Migration 6 einspielen (Benutzerverwaltung)
- [ ] Migrationen 7 bis 15 einspielen; danach Betriebsangaben (Adresse, IBAN) ergänzen, danach Import Fruchtfolge 2023–2029
- [ ] Feldgrenzen der 13 importierten Felder auf der Karte zeichnen
- [ ] Supabase: eigenen Mailversand (SMTP) einrichten, Standard-Mails sind auf wenige pro Stunde begrenzt
- [ ] Domain bei Jimdo klären (eigene DNS-Einträge möglich?)

## Phase 2 – Grundsystem
- [x] Projektgerüst React/TS/Vite, PWA, Gestaltung
- [x] Datenbank: Betrieb, Benutzer, Rollen, Zugriffsregeln, Änderungsprotokoll, Versionsschutz
- [x] Anmeldung, Registrierung, Ersteinrichtung
- [x] Navigation Handy (unten) und Mac (Seitenleiste)
- [x] Automatische Prüfungen (Build, Datenbanktests)
- [x] Weitere Benutzer einladen, Rollen ändern, deaktivieren, Aktivität
- [x] Passwort zurücksetzen und ändern
- [x] Umbenennung in «Hofmanager SchweikFarm», App-Symbole für iPhone/Android

## Phase 3 – Felder und Fruchtfolge
- [x] Felder anlegen, bearbeiten, Feldhistorie
- [x] Kulturkatalog (Standardkulturen)
- [x] Fruchtfolge-Raster mit Flächensummen, Hinweisen, CSV-Export
- [x] Import Fruchtfolge 2023–2029 aus Excel (13 Felder, Saat/Ernte nach Monat)
- [x] Zeitachse mit Saat- und Erntezeitpunkt, Zwischenkulturen
- [x] Mehrere Kulturen je Jahr (Zweitkultur, mehrere Zwischenkulturen, Untersaat, Teilfläche)
- [x] Felder löschen mit Papierkorb (24 h)
- [x] Feldgrenze zurücksetzen, Einrasten abschaltbar
- [x] Flächen/Orte ohne Fruchtfolge, Bäume auf eigener Kartenebene (Hochstamm-Zählung)
- [ ] Baumliste mit Export (z. B. für Hochstamm-Beiträge)
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
- [x] Aufträge (Lohnarbeit, Werkstatt) mit PDF und Mail, Abschluss in Kartei/Reparatur
- [x] Betriebsmittel «vom Dienstleister» dokumentiert ohne Lagerbuchung
- [ ] Dokumente (Anleitungen, Rechnungen als PDF) zu Maschinen und Feldern
- [ ] Betriebsstunden automatisch aus Feldarbeiten
- [x] Ernte mit Erträgen und Abnehmern (Partner, Ballen, kg, Preis, bezahlt)
- [x] Ernte ins Lager buchen mit Lagerort, mehrere Produkte und Dienstleister je Ernte
- [x] Schnellanlage von Artikeln und Partnern aus Auswahlfeldern
- [x] Sammelerfassung und Sammelbearbeitung von Ernten
- [x] Mitarbeitende verwalten, Stunden je Person
- [x] Folgearbeiten (Ketten) und Aufträge aus Aufgaben
- [x] Verknüpfungen: Verlauf bei Feld, Maschine, Partner; Kartei nach Person
- [x] Ballengewicht wird bei Abgaben automatisch übernommen
- [x] Verkauf ab Lager und aus der Ernte mit Rechnung (QR) und Quittung
- [x] Fotos zu Maschinen und Einträgen
- [x] Direkte Erfassung mit Zählerständen und Beobachtung; Mittel als Gesamtmenge
- [ ] Fotos zu Feldern und Feldhinweisen, Beobachtungen beim Erledigen
- [ ] Mahnung, Gutschrift (Ausgang mit Abnehmer und Preis)
- [x] Aufgaben (Feldarbeit planen, Maschinen, Allgemein), Erledigen mit Zählern, Mengen, Zeit, Beobachtung
- [x] Betriebsmittel nur per Häkchen bei Säen, Düngen, Pflanzenschutz
- [ ] Kalenderansicht, Erinnerungen
- [ ] Pflanzenschutz, Backups ausserhalb Supabase, Sicherheitsprüfung, Subdomain

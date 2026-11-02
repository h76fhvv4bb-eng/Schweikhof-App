# Hofmanager SchweikFarm

Digitale Betriebsführung für einen Schweizer Acker- und Futterbaubetrieb (ca. 16 ha, Kanton Zürich, ÖLN).
Läuft im Browser auf Mac, iPhone und iPad und lässt sich als App auf den Startbildschirm legen (PWA).

## Was schon funktioniert (Stand 02.11.2026, Version 0.9)

| Bereich | Stand |
| --- | --- |
| Anmeldung, Registrierung, Ersteinrichtung des Betriebs | fertig |
| Rollen (Administrator, Betriebsleiter, Mitarbeiter, Lesen), Benutzer einladen, Rolle ändern, deaktivieren, Aktivität, Passwort zurücksetzen/ändern | fertig |
| Änderungsprotokoll und Versionsschutz | fertig |
| Felder anlegen, bearbeiten, suchen, Feldhistorie | fertig |
| Fruchtfolge-Raster mit Kulturfarben, Flächensummen, Hinweisen, CSV-Export | fertig |
| Fruchtfolge-Zeitachse: Saat und Ernte je Kultur (Monat oder Tag), Zwischenkulturen, Status geplant/ist | fertig |
| Ernte & Erträge: Ballen, kg, Schnitt, Ertrag je ha; Abnehmer (Verkauf, Abgabe, Eigenbedarf, Lager) mit Preis und Zahlungsstatus | fertig |
| Bodenprobe-Korrekturfaktoren je Feld | fertig |
| Mehrere Kulturen je Feld und Jahr: Hauptkultur, Zweitkultur, mehrere Zwischenkulturen, Untersaat, Teilflächen | fertig |
| Hof-Ansicht: Feldgrenze zurücksetzen, Einrasten ein-/ausschaltbar, Flächen und Orte ohne Fruchtfolge (Garten, Hecke, Brunnen …), Bäume auf eigener Kartenebene | fertig |
| Felder löschen mit Papierkorb (24 h wiederherstellbar; Felder mit Aufzeichnungen bleiben archiviert) | fertig |
| Feldarbeiten erfassen (auch mehrere Felder, geplant/erledigt), Ackerschlagkartei mit Filtern, CSV-Export, Druck/PDF | fertig |
| Lager: Artikel, Eingang, Verbrauch, Korrektur, Inventur, Mindestbestand, Lagerwert, Journal | fertig |
| Düngung bucht automatisch vom Lager ab (ohne Doppelbuchung, Änderung/Löschung bucht zurück) | fertig |
| Nährstoffübersicht je Feld (N, P₂O₅, K₂O ausgebracht/geplant) | fertig |
| Dashboard (Fläche, Kulturen, Lagerwarnungen, geplante und letzte Arbeiten) | fertig |
| Hof-Ansicht: Luftbild (swisstopo), Felder abzeichnen und bearbeiten, Gebäude platzieren mit Link (z. B. Lager), Adresssuche, Parzellengrenzen | fertig |
| Felder teilen und zusammenführen (Karte oder Fläche), Historie bleibt erhalten | fertig |
| Feldhinweise (Gefahren wie Schächte), auch als Punkt auf der Karte, Anzeige beim Erfassen | fertig |
| Maschinen und Geräte mit technischen Daten, MFK, Standplatz in Maschinenhalle | fertig |
| Wartungspläne (Tage/Stunden), Wartungen, Reparaturen, Beobachtungen, Ersatzteile aus dem Lager | fertig |
| Partner (Lohnunternehmen, Mechaniker, Händler …), verknüpft mit Arbeiten und Reparaturen | fertig |
| Dünger-Katalog mit gängigen Mineraldüngern | fertig |
| Aufträge an Partner: Lohnarbeit (Felder, Betriebsmittel, Bereitstellung, Feldhinweise) und Werkstatt (Maschine, Beobachtungen), PDF, Versand per Mail, Abschluss in Kartei bzw. als Reparatur | fertig |
| Aufgaben, Kalender | folgt, siehe [TODO.md](TODO.md) |

## Technik

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, als PWA
- **Datenbank, Anmeldung, Dateien:** Supabase (PostgreSQL), Region Zürich
- **Geschäftslogik und Rechte:** in der Datenbank (`supabase/migrations`), durch Row Level Security abgesichert
- Entscheidungen und Begründungen: [docs/ENTSCHEIDUNGEN.md](docs/ENTSCHEIDUNGEN.md)

## Einrichtung

### 1. Datenbank (einmalig)

1. In Supabase das Projekt öffnen › **SQL Editor** › **New query**.
2. Neue, leere Datenbank: den Inhalt von `supabase/einrichtung_komplett.sql` einfügen und **Run** klicken.
   Bestehende Datenbank: nur die neuen Dateien aus `supabase/migrations/` der Reihe nach einspielen.
3. Unter **Authentication › Providers › Email** sicherstellen, dass E-Mail-Anmeldung aktiv ist.

### 2. App lokal starten (für Entwicklung)

```bash
cp .env.example .env      # Werte aus Supabase › Project Settings › API eintragen
npm install
npm run dev
```

### 3. Erste Anmeldung und weitere Benutzer

App öffnen › **Registrieren** › E-Mail bestätigen › anmelden › Betrieb anlegen.
Der erste Benutzer wird Administrator. Danach kann kein zweiter Betrieb mehr angelegt werden.
Weitere Personen: **Mehr › Benutzer verwalten › Person einladen**. Die Person registriert sich mit genau dieser E-Mail-Adresse
und wird nach der Bestätigung automatisch mit der gewählten Rolle zugeordnet.

### 4. Veröffentlichen

Die App ist eine statische Website (`npm run build` erzeugt `dist/`).
Empfohlen: Cloudflare Pages oder Netlify mit diesem Repository verbinden,
Build-Befehl `npm run build`, Ausgabeordner `dist`,
Umgebungsvariablen `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY` setzen.

## Sicherheit

- Der **anon**-Schlüssel ist öffentlich und darf in der App stehen. Die Daten schützen die Zugriffsregeln in der Datenbank.
- Der **service_role**-Schlüssel und das Datenbankpasswort gehören nie in den Code, in Chats oder E-Mails.
- `.env` ist in `.gitignore` und wird nie hochgeladen.

## Prüfungen

Bei jedem Hochladen prüft GitHub automatisch (Reiter **Actions**):
- ob die App fehlerfrei baut,
- ob die Datenbank-Migrationen laufen und die Zugriffs- und Versionsregeln greifen (`supabase/tests`).

## Hinweis

Die Fruchtfolge-Hinweise sind Empfehlungen und ersetzen keine Prüfung der ÖLN- oder kantonalen Vorgaben.

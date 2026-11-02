# Hofmanager Schweikhof

Digitale Betriebsführung für einen Schweizer Acker- und Futterbaubetrieb (ca. 16 ha, Kanton Zürich, ÖLN).
Läuft im Browser auf Mac, iPhone und iPad und lässt sich als App auf den Startbildschirm legen (PWA).

## Was schon funktioniert (Stand 02.11.2026)

| Bereich | Stand |
| --- | --- |
| Anmeldung, Registrierung, Ersteinrichtung des Betriebs | fertig |
| Rollen (Administrator, Betriebsleiter, Mitarbeiter, Lesen) in der Datenbank | fertig, Einladen weiterer Personen folgt |
| Änderungsprotokoll und Versionsschutz | fertig |
| Felder anlegen, bearbeiten, suchen, Feldhistorie | fertig |
| Fruchtfolge-Raster mit Kulturfarben, Flächensummen, Hinweisen, CSV-Export | fertig |
| Dashboard (Fläche, Felder, Kulturen) | Grundversion |
| Feldarbeiten, Düngung, Lager, Maschinen, Ernte, Verkauf, Aufgaben | folgt, siehe [TODO.md](TODO.md) |

## Technik

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, als PWA
- **Datenbank, Anmeldung, Dateien:** Supabase (PostgreSQL), Region Zürich
- **Geschäftslogik und Rechte:** in der Datenbank (`supabase/migrations`), durch Row Level Security abgesichert
- Entscheidungen und Begründungen: [docs/ENTSCHEIDUNGEN.md](docs/ENTSCHEIDUNGEN.md)

## Einrichtung

### 1. Datenbank (einmalig)

1. In Supabase das Projekt öffnen › **SQL Editor** › **New query**.
2. Den Inhalt jeder Datei aus `supabase/migrations/` der Reihe nach einfügen und **Run** klicken.
3. Unter **Authentication › Providers › Email** sicherstellen, dass E-Mail-Anmeldung aktiv ist.

### 2. App lokal starten (für Entwicklung)

```bash
cp .env.example .env      # Werte aus Supabase › Project Settings › API eintragen
npm install
npm run dev
```

### 3. Erste Anmeldung

App öffnen › **Registrieren** › E-Mail bestätigen › anmelden › Betrieb anlegen.
Der erste Benutzer wird Administrator. Danach kann kein zweiter Betrieb mehr angelegt werden.

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

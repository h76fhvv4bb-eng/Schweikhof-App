# Technische Entscheidungen

Kurz begründet, damit die Software auch ohne den ursprünglichen Entwickler weitergeführt werden kann.

## 2026-11-02 · Kein eigener Backend-Server
Geschäftslogik, Rechte und Protokoll liegen in PostgreSQL (Funktionen, Trigger, Row Level Security).
Das Frontend ist eine statische Website. Weniger Teile, geringe Kosten, kein Server zu warten.

## 2026-11-02 · Supabase, Region Zürich
Datenbank, Anmeldung und Dateispeicher aus einer Hand; Daten bleiben in der Schweiz.
Es ist Standard-PostgreSQL: Ein Umzug zu einem anderen Anbieter oder auf einen eigenen Server bleibt möglich.

## 2026-11-02 · Flächen in m² speichern
Alle Flächen werden intern in m² gespeichert und in ha angezeigt. So gibt es keine Rundungsfehler beim Summieren.

## 2026-11-02 · Anbau als eigene Tabelle (Feld × Jahr × Kultur)
Fruchtfolge, Feldhistorie, später auch Feldarbeiten und Ernten beziehen sich auf denselben Anbau-Eintrag.
Ist-Einträge (vergangene und laufende Jahre) können nicht gelöscht werden, nur korrigiert; jede Korrektur steht im Änderungsprotokoll.

## 2026-11-02 · Versionsschutz
Jede Tabelle hat eine Spalte `version`. Wer einen veralteten Stand speichert, bekommt eine Meldung statt die Änderung eines anderen zu überschreiben.
Das ist auch die Grundlage für einen späteren Offline-Abgleich.

## 2026-11-02 · Kein Offline-Modus im MVP
Laut Betrieb ist auf den Feldern Empfang vorhanden. Die App speichert nur die App-Hülle zwischen, Daten kommen immer frisch.

## 2026-11-02 · Feldgrenzen auf swisstopo statt Google Maps
Google erlaubt nicht, Geometrien aus Google Maps abzuzeichnen und zu speichern.
swisstopo-Luftbilder sind kostenlos nutzbar (Quellenangabe nötig) und für die Schweiz genauer.

## 2026-11-02 · Fruchtfolge-Hinweise
Regeln in `src/lib/fruchtfolgeRegeln.ts`, Anbaupausen in der Tabelle `kulturen`.
Die Werte sind Startwerte und keine Rechtsgrundlage; sie können pro Kultur angepasst werden.

## 2026-11-02 · Export zuerst als CSV
CSV mit Semikolon und UTF-8-Kennung öffnet sich in Excel direkt korrekt. Echtes .xlsx und PDF folgen mit dem Auswertungsmodul.

## 2026-11-02 · Lager als Buchungsjournal, Feldarbeit als eine Transaktion
Der Bestand wird nie überschrieben, er ist die Summe aller Lagerbewegungen (Sicht `lagerbestand`).
Feldarbeiten werden nur über die Datenbankfunktion `feldarbeit_speichern` geschrieben: Arbeit, Felder, Mittel und Lagerbuchung
entstehen gemeinsam oder gar nicht. Je Arbeit und Artikel gibt es höchstens eine Buchung (eindeutiger Index);
ändert sich die Menge, wird diese Buchung angepasst, und die Änderung steht im Änderungsprotokoll.
Geplante Arbeiten buchen nicht. Gelöschte Arbeiten werden nur markiert, ihre Buchung entfällt.

## 2026-11-02 · Nährstoffgehalte je Einheit
Gehalte werden als kg Nährstoff je Einheit des Artikels gespeichert. Bei kg/l gibt man % ein, bei t und m³ kg je Einheit.
Die Nährstoffübersicht zeigt ausgebrachte und geplante Mengen, ausdrücklich keinen Bodenvorrat und keine Suisse-Bilanz.

## 2026-11-02 · Maschinen vorerst als Text
Bis das Maschinenmodul steht, werden Maschine und Gerät bei Feldarbeiten als Text erfasst. Das Maschinenmodul ersetzt das später durch Verknüpfungen.

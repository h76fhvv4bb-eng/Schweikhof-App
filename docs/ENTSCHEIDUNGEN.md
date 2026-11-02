# Technische Entscheidungen – Hofmanager SchweikFarm

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

## 2026-11-02 · Hof-Ansicht mit Leaflet und swisstopo
Karte mit Leaflet (klein, stabil, gute Touch-Bedienung) und Leaflet-Geoman (Zeichnen/Bearbeiten, Einrasten an Punkten).
Grundkarten: swisstopo SWISSIMAGE (Luftbild) und Landeskarte, optional Parzellengrenzen der amtlichen Vermessung.
Feldgrenzen werden als GeoJSON (WGS84) in `felder.geometrie` gespeichert, die Fläche geodätisch berechnet (@turf/area).
Die Karte wird erst geladen, wenn die Hof-Ansicht geöffnet wird (eigener Code-Teil), damit die App schnell startet.
Gebäude stehen in `hofobjekte` mit Typ, Position und optionalem Link auf eine Seite der App.

## 2026-11-02 · Felder teilen und zusammenführen
Teilen erzeugt ein neues Feld mit Verweis auf das Ursprungsfeld (`vorgaenger`); das Ursprungsfeld behält die Historie
und wird kleiner. Kulturen ab dem laufenden Jahr werden auf den neuen Teil übertragen. Beim Zusammenführen gehen die
anderen Felder im Zielfeld auf (Status «zusammengeführt», `zusammengefuehrt_in`), ihre Historie bleibt abrufbar.
Auf der Karte wird mit Turf (intersect/difference/union) gerechnet, die Datenbankfunktionen sichern Flächen und Rechte.

## 2026-11-02 · Maschinen, Wartung, Partner
Wartungspläne mit Intervall in Tagen und/oder Betriebsstunden; Fälligkeit berechnet die Sicht `wartung_faelligkeit`
aus dem letzten zugeordneten Eintrag. Einträge werden über `maschineneintrag_speichern` geschrieben, das verwendete
Ersatzteile wie bei der Düngung genau einmal vom Lager bucht und den Stundenzähler nachführt.
Feldarbeiten verweisen jetzt auf Maschine, Gerät und Partner; die alten Textfelder bleiben für frühere Einträge erhalten.

## 2026-11-02 · Dünger-Katalog als Vorlage
Der Katalog enthält Standardgehalte gängiger Mineraldünger als Richtwerte. Er legt normale Lagerartikel an,
die danach frei angepasst werden. Massgebend bleibt die Deklaration des Produkts.

## 2026-11-02 · Aufträge an Partner
Aufträge (`auftraege` mit Feldern, Mitteln, Beobachtungen) werden nur über `auftrag_speichern`, `auftrag_status` und
`auftrag_abschliessen` geschrieben. Nummern laufen pro Jahr (2026-001) und werden unter einer Sperre vergeben.
Abschliessen erzeugt bei Lohnarbeit eine Feldarbeit mit Partner; Mittel mit Bereitstellung «Dienstleister» stehen in der
Kartei, buchen aber nicht vom Lager (`feldarbeit_mittel.vom_lager = false`). Freitext-Mittel werden dafür als Artikel ohne
Bestandsführung angelegt. Bei Werkstattaufträgen entsteht ein Reparatur-Eintrag, verknüpfte Beobachtungen werden geschlossen.

## 2026-11-02 · PDF im Browser, Versand über das Teilen-Menü
Das PDF entsteht im Browser mit jsPDF (erst beim ersten Gebrauch geladen). Versand über die Web-Share-Funktion:
auf iPhone, iPad und Mac «Mail» wählen, das PDF ist angehängt. Wo das nicht geht, wird das PDF heruntergeladen und das
Mailprogramm mit vorbereitetem Text geöffnet (Anhängen von Hand). So braucht es keinen eigenen Mailserver.

## 2026-11-02 · Benutzer per Einladung statt Adminkonto-Anlage
Ohne eigenen Server darf die App keine Konten für andere anlegen (dafür bräuchte es den geheimen service_role-Schlüssel).
Darum: Der Administrator erstellt eine Einladung (E-Mail, Rolle). Die Person registriert sich selbst; nach bestätigter
E-Mail ordnet `einladung_annehmen` sie dem Betrieb zu. Rollen und Aktiv-Status ändert nur `benutzer_aendern`, das den
letzten aktiven Administrator schützt. Deaktivierte Konten sehen keine Daten mehr (`mein_betrieb()` liefert nichts).

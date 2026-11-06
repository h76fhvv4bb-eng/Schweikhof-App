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

## 2026-11-02 · Ernte und Abnehmer
Jede Ernte (Schnitt, Drusch, Silage) ist ein Eintrag in `ernten` mit Ballen und/oder kg. Wer was übernommen hat, steht in
`ernte_abnehmer` (Verkauf, Abgabe, Eigenbedarf, Lager), bei Verkauf und Abgabe immer mit Partner. Der Preis wird als
Gesamtbetrag gespeichert; die App rechnet ihn aus Preis je Ballen, je 100 kg oder je t. Die Datenbank verhindert, dass mehr
abgegeben als geerntet wird. Der Zahlungsstatus darf direkt geändert werden, alles andere nur über `ernte_speichern`.

## 2026-11-02 · Fruchtfolge mit Saat und Ernte
`anbau` hat Saat- und Erntedatum; `nur_monat` heisst, nur der Monat ist bekannt (aus der Excel-Planung). Das Anbaujahr ist
das Jahr der Hauptnutzung (Winterweizen ab Oktober gesät zählt zum Folgejahr), mehrjährige Wiesen haben je Jahr einen Eintrag.
Zwischenkulturen sind eigene Einträge mit Art «Zwischenkultur». Der Excel-Import (`scripts/fruchtfolge_import.py`)
erzeugt eine wiederholbare SQL-Datei; erneutes Ausführen aktualisiert statt zu verdoppeln.

## 2026-11-02 · Felder löschen über einen Papierkorb
Löschen setzt `geloescht_am`; 24 Stunden lang stellt `feld_wiederherstellen` das Feld wieder her. Danach entfernt
`papierkorb_leeren` (läuft beim Öffnen der Felderliste) das Feld mit Anbau, Hinweisen und Parzellenzuordnung. Hat das Feld
Feldarbeiten, Ernten oder Aufträge, wird es nie entfernt, sondern bleibt ausgeblendet im Archiv, damit die Aufzeichnungen
vollständig bleiben. Die Feldnummer eines gelöschten Feldes darf sofort neu vergeben werden.

## 2026-11-02 · Mehrere Kulturen je Feld und Jahr
Pro Feld und Jahr gibt es genau eine Hauptkultur (Grundlage für Kartei, Ernte und Flächenstatistik). Weitere Kulturen
werden als Zweitkultur (z. B. Silomais nach Grünschnittroggen oder auf einer Teilfläche), Zwischenkultur oder Untersaat
erfasst, beliebig viele, jede Kultur einmal pro Jahr und Art. Jede Kultur kann eine Teilfläche haben (leer = ganzes Feld).

## 2026-11-02 · Flächen, Orte und Bäume ausserhalb der Felder
Garten, ungenutzte Flächen, Hecken, Brunnen, Tore usw. sowie Bäume liegen in `kartenobjekte` (Ebene flaeche, ort, baum),
nicht in `felder`. So erscheinen sie nie in Felderliste, Fruchtfolge, Kartei oder Ernte. Bäume haben eine eigene
Kartenebene («Bäume»), damit die Hof-Ansicht übersichtlich bleibt; dort sind die Felder nur blass als Orientierung sichtbar.
Beim Setzen von Bäumen gilt eine Vorlage (Art, Sorte, Pflanzjahr, Hochstamm), jeder Klick setzt einen Baum.

## 2026-11-02 · Einrasten beim Zeichnen
Das Einrasten an Ecken und Kanten anderer Flächen lässt sich während des Zeichnens ausschalten (Einstellung bleibt im
Browser gespeichert). In Zeichen- und Platziermodi sind Felder nicht anklickbar, damit Punkte auch innerhalb bestehender
Felder gesetzt werden können.

## 2026-11-02 · Ernte mit mehreren Produkten, Dienstleistern und Einlagerung
Eine Ernte (Kopf: Feld, Datum, Schnitt, Fläche) hat ein oder mehrere Produkte (`ernte_produkte`, z. B. Getreide und Stroh),
beliebig viele Dienstleister mit Leistung und Kosten (`ernte_dienstleister`) und Abgaben je Produkt (`ernte_abnehmer.produkt_id`).
Eine Abgabe «Lager» bucht einen Eingang (Art «Ernte») ins Lagerjournal, Quelle ist die Abgabe; ohne gewählten Artikel wird ein
Artikel «Produkt Ballenart Jahr – Lagerort» in der Kategorie Erzeugnisse angelegt bzw. wiederverwendet. Der Lagerort ist ein
Gebäude der Hof-Ansicht. Ändern oder Löschen der Ernte entfernt die alten Buchungen und bucht neu.

## 2026-11-02 · Aufgaben und Erledigen
Geplante Feldarbeiten bleiben Feldarbeiten mit Status «geplant» (eine Quelle für Kartei und Planung). Maschinen- und
allgemeine Aufgaben stehen in `aufgaben`. Die Seite «Aufgaben» zeigt beides zusammen nach Fälligkeit. Erledigen läuft
über `feldarbeit_erledigen` bzw. `aufgabe_erledigen`: effektive Mengen (Lager wird danach gebucht), Dauer, Stunden- und
Kilometerzähler (werden bei der Maschine nur nach oben nachgeführt) und Beobachtungen; eine Beobachtung kann als offener
Punkt bei der Maschine gemeldet werden. Aus einer Maschinen-Aufgabe entsteht beim Erledigen ein Wartungs-/Reparatureintrag.
Betriebsmittel werden in der Erfassung nur noch per Häkchen angegeben (Säen, Düngen, Pflanzenschutz, Andere);
bei Bodenbearbeitung und Ernte entfällt die Auswahl.

## 2026-11-02 · Schnellanlage und Sammelerfassung
In Auswahlfeldern für Betriebsmittel und Partner gibt es «+ Neu …» (nur für Verwaltende, wie beim Lager und den Partnern).
Der Dünger-Schnelldialog füllt Gehalte aus dem Katalog, wenn der Name passt. Mehrere Ernten werden über `ernten_speichern`
in einer Transaktion gespeichert (alles oder nichts, Fehlermeldung nennt die Zeile). Beim gemeinsamen Bearbeiten bleiben
bestehende Abgaben je Ernte erhalten; eine gemeinsame Abgabe gilt nur, wo für das Produkt noch nichts zugeteilt ist.

## 2026-11-02 · Mitarbeitende, Folgearbeiten, Aufträge aus Aufgaben
`mitarbeiter` enthält alle Personen, die auf dem Betrieb arbeiten; App-Konten werden automatisch übernommen
(Trigger auf `benutzer_profile`), weitere Personen brauchen kein Konto. Feldarbeiten und Aufgaben verweisen auf
`mitarbeiter_id`; `ausgefuehrt_von`/`zugewiesen_an` bleiben für App-Konten erhalten. Folgearbeiten sind normale geplante
Feldarbeiten mit `vorgaenger_id`; die Datenbank verhindert Kreise und das Erledigen vor der Vorgängerin (auch über
Aufträge). Ein Lohnauftrag kann eine geplante Arbeit (`auftraege.feldarbeit_id`) bzw. ein Werkstattauftrag eine Aufgabe
(`aufgabe_id`) übernehmen; der Abschluss des Auftrags erledigt genau diese Arbeit/Aufgabe statt eine neue anzulegen.
Solange ein Auftrag läuft, wird die Arbeit/Aufgabe über den Auftrag abgeschlossen.

## 2026-11-02 · Verkauf mit Rechnung und Quittung
Belege (`verkaeufe`, `verkauf_positionen`) werden nur über `verkauf_speichern`, `verkauf_bezahlt` und `verkauf_stornieren`
geschrieben. Nummern laufen pro Jahr. Positionen aus dem Lager buchen einen Ausgang (Art «Verkauf»), Positionen aus der
Ernte verweisen auf die Abgabe (jede Abgabe höchstens einmal verrechnet; Preis und Zahlungsstatus werden in die Ernte
übernommen). Damit die Verknüpfung beim erneuten Speichern einer Ernte erhalten bleibt, behalten Abgaben ihre ID und der
Fremdschlüssel wird erst am Transaktionsende geprüft. Stornierte Belege behalten ihre Nummer.
Das PDF entsteht im Browser; Rechnungen erhalten einen Swiss-QR-Zahlteil (ohne Referenz, Zahlungspflichtiger leer), wenn
Adresse und IBAN in den Betriebsangaben stehen. QR-IBAN wird nicht unterstützt. MWST ist optional (Satz frei wählbar).

## 2026-11-02 · Fotos
Fotos liegen im privaten Supabase-Storage-Bucket «fotos», Ordner je Betrieb; Zugriff nur für den eigenen Betrieb
(signierte Links, 1 Stunde gültig). Bilder werden vor dem Hochladen im Browser auf max. 1600 px verkleinert.
Die Tabelle `fotos` verknüpft sie mit Maschine, Eintrag (Wartung/Reparatur/Beobachtung) oder Feld.

## 2026-11-02 · Abschlussangaben beim direkten Erfassen
Auch ohne vorherige Planung fragt die Erfassung einer erledigten Arbeit nach Dauer, Person, Traktor/Gerät, Zählerständen
und Beobachtung. Gespeichert wird zuerst die Arbeit (`feldarbeit_speichern`), dann `feldarbeit_abschluss` (Zähler nur nach
oben, Beobachtung als offener Punkt bei der Maschine; beim erneuten Speichern wird dieser Punkt nachgeführt statt verdoppelt).
Betriebsmittel können pro ha oder als Gesamtmenge auf die gewählte Fläche eingegeben werden; gespeichert wird immer die
Menge pro ha, die Gesamtmenge rechnet die Datenbank daraus.

## 2026-11-03 · Kontrolle und Parzellenblätter
Die Seite «Kontrolle» stellt Unterlagen zusammen: farbige Fruchtfolge (A4 quer, ohne Dauergrünland) und Parzellenblätter
(A4, je Feld). Das Parzellenblatt folgt dem Aufbau des bekannten Ackerbau/Futterbau-Formulars (Bodenbearbeitung, Saat,
Düngung mit N/P2O5/K2O/MgO, Pflege/Pflanzenschutz, Ernte/Nutzung, Zwischenkultur), ist aber ein eigenes Layout. Zugeordnet
wird nach Kalenderjahr des Datums; die Arbeitsart bestimmt den Abschnitt. MgO = Mg / 0.603. Leere Zeilen bleiben zum
Nachtragen von Hand. Die Prüfung der Aufzeichnungen meldet Lücken als Hinweise, sie prüft keine Vorschriften.
Dauergrünland (Nutzungsart) erscheint nicht in der Fruchtfolge.

## 2026-11-03 · Maschinenteile und Warengruppen
`maschine_teile` verknüpft Lagerartikel mit Maschinen (Ersatzteil, Verschleissteil, Betriebsstoff, Einbauort, gewünschter
Vorrat). Der Bestand bleibt im Lager; die Maschine zeigt ihn an und warnt unter dem Vorrat. Beim Erfassen einer Wartung
stehen die Teile der Maschine zuoberst. Lagerartikel haben eine freie Warengruppe als Untergruppe der Kategorie.

## 2026-11-03 · Verknüpfungen geprüft (Migration 17)
Eine unabhängige Durchsicht hat die Verbindungen zwischen den Modulen geprüft. Die Regeln liegen in der Datenbank:
- Eine geplante Arbeit mit offenem Lohnauftrag lässt sich nur über den Auftrag abschliessen.
- Wird eine Arbeit gelöscht, sind ihre Folgearbeiten wieder frei.
- Eine Wartungs-Aufgabe setzt beim Erledigen den Wartungsplan zurück, auch über einen Werkstatt-Auftrag.
- Ist eine Abgabe auf einem Beleg verrechnet, kommen «bezahlt» und Preis vom Beleg. Ein Storno setzt «bezahlt» zurück.
- Ein Anbau kann gelöscht werden, ohne dass Arbeiten oder Ernten verschwinden; die Zuordnung zum Anbau wird nachgeführt.
- Ein Feld mit geplanten Arbeiten oder offenen Aufträgen kann nicht in den Papierkorb.
- Name und Status der Mitarbeitenden folgen dem Benutzerprofil.

## 2026-11-03 · Betriebsverwaltung, Weidegäste, Unterlagen (Migration 18)
- Betriebsangaben haben eine eigene Seite «Betrieb» (Übersicht, Bearbeiten nur für Administratoren). Neu: Bewirtschafter/in,
  Gemeinde, Bank, Website. Die Betriebsnummer steht auf allen PDFs (Kopf oder Fusszeile) und als Zeile in jedem CSV.
- Weidegäste (`beweidungen`, `beweidung_felder`): Tierhalter ist ein Partner (neue Art «Tierhalter»), Zeitraum mit offenem
  Ende, Felder mit Teilfläche, GVE optional. Weidezins pauschal, je Tier und Tag, je GVE und Tag oder je ha. Eine Rechnung
  übernimmt Tierhalter und Betrag und wird mit dem Eintrag verknüpft. Weidetage zählen Beginn und Ende mit.
- Im Parzellenblatt erscheint die Weide unter «Ernte / Nutzung» mit Beginn und Ende.
- Die Düngerbilanz zeigt ausgebrachte Nährstoffe aus den erfassten Arbeiten; sie ist ausdrücklich keine Suisse-Bilanz.
- «Alle Unterlagen» erstellt ein PDF: Deckblatt mit Betriebsangaben und Inhaltsverzeichnis, Hinweise, Fruchtfolge (Jahr −4
  bis +2), Parzellenblätter, Düngerbilanz, Verkäufe, Weidegäste. Hoch- und Querformat gemischt.

## 2026-11-03 · Umtrieb der Weidegäste (Migration 19)
Jedes Feld einer Weide ist ein Abschnitt mit eigenem Zeitraum (`beweidung_felder.von/bis`). «Weiterziehen» beendet die
aktuellen Felder am Vortag und beginnt die neuen am gewählten Tag; ein Wechsel am selben Tag ersetzt den vorherigen
(Korrektur). Liegen nach dem Datum schon Wechsel vor, wird im Formular nachgetragen. «Abgeholt» beendet Weide und Felder.
Weidetage je Feld zählen nur den eigenen Abschnitt; die beweidete Fläche zählt jedes Feld einmal.

## 2026-11-03 · Mehrere Rollen je Partner (Migration 20)
`partner.rollen` (Liste) ergänzt `art`. `art` bleibt die Hauptrolle (erste Rolle) und wird per Trigger nachgeführt, damit
ältere Abfragen und die Schnellanlage weiter funktionieren. Wird ein Partner als Tierhalter einer Weide gewählt, bekommt er
die Rolle «Tierhalter» dazu.

## 2026-11-03 · Mehrere Geräte pro Arbeit (Migration 21)
`feldarbeit_geraete` hält alle Geräte einer Arbeit in Reihenfolge; `geraet_id` bleibt das erste (für Zähler, ältere
Abfragen) und wird per Trigger abgeglichen. Gespeichert wird über `feldarbeit_speichern_geraete`, die `feldarbeit_speichern`
aufruft und danach die Liste setzt (eine Transaktion). Betriebsstunden werden nur beim ersten Gerät erfasst.

## 2026-11-04 · Aktuelle Kultur und Saat-Übernahme (Migration 22)
Die Hauptkultur eines Jahres bleibt die Grundlage für Fruchtfolge, Kartei und Parzellenblätter. Für Karte und Felderliste
zählt die «aktuelle Kultur»: die zuletzt gesäte Kultur, deren Saattermin erreicht und die noch nicht geerntet ist (auch
Herbstsaat für das Folgejahr). Ohne laufende Kultur gilt die Hauptkultur des Jahres.
Wird «Säen» erledigt, übernimmt ein Trigger das Datum in die passende Kultur (Saattermin ± 60 Tage, sonst geplante
Hauptkultur ohne Termin: ab Juli fürs Folgejahr), setzt sie auf «ist» und beendet die laufende Vorkultur am Vortag
(nicht bei Untersaat).

## 2026-11-04 · Richtpreise (Migration 23)
Jeder Betrieb hat einen eigenen Katalog `richtpreise` (Bereich, Bezeichnung, Einheit, Preis, Quelle, Jahr). Vorlagen enthalten
nur öffentlich zugängliche Richtwerte mit Quelle (Agroscope Kostenkatalog 2024: Traktoren, Lader, Arbeitskosten; AGRIDEA 2026:
Heu). Den vollständigen Agroscope-Katalog übernimmt der Betrieb selbst per CSV. Gleiche Bezeichnung und Einheit werden beim
Import aktualisiert. Ein Richtpreis ist ein Vorschlag: übernommen wird der Wert, eine spätere Änderung ändert bestehende
Belege nicht. Maschinen können einen Ansatz (`maschinen.richtpreis_id`) haben.

## 2026-11-06 · Lohnarbeit einheitlich (Migration 24)
- Eine Arbeit mit Lohnunternehmen hat immer einen Auftrag: `lohnauftrag_abgleichen` legt ihn beim Speichern an (geplant →
  «Entwurf», direkt erledigt → «Erledigt») und hält Partner, Termin und Felder gleich. Neuer Partner → Auftrag wieder
  «Entwurf»; Partner entfernt oder Arbeit gelöscht → «Abgebrochen». Betriebsmittel werden nur beim Anlegen übernommen.
- Status gibt es nur einmal: den des Auftrags. «Aufgaben» zeigt ihn an, und der Haken dort schliesst über denselben Ablauf
  ab wie «Aufträge» (`auftrag_abschliessen_abrechnung` → `auftrag_abschliessen`).
- Abrechnung: `abrechnung` (Stunde, Hektare, Ballen, Stück, Pauschale) und `preis_je_einheit` am Auftrag; beim Abschluss
  wird die Menge erfasst, `kosten_chf` = Menge × Preis (Pauschale = Preis). Die Kosten stehen auch in der Bemerkung der Arbeit.
  Nachträgliche Korrektur über `auftrag_abrechnung_nachtragen`.
- Lohnarbeit verlangt beim Abschluss keine eigenen Maschinenstunden, Arbeitszeit oder Person.
- Nach «Ernten» oder «Pressen» bietet die App «Ertrag jetzt erfassen» an; Feld(er), Datum, Fläche und Lohnunternehmen mit
  Kosten werden in die Ernte übernommen (keine Doppelerfassung).

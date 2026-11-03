// Erzeugt Beispiel-PDFs mit Testdaten (nur für die automatische Prüfung; wird im CI gebaut und als Artefakt abgelegt).
import { writeFileSync } from 'node:fs';
import { belegPdf } from '../src/lib/belegPdf';
import { fruchtfolgeZeichnen, parzellenblaetterPdf } from '../src/lib/kontrollePdf';
import type { Betrieb, Feld } from '../src/lib/typen';

const betrieb = {
  id: 'b', name: 'SchweikFarm', kanton: 'ZH', adresse: 'Schweikhof 9a\n8925 Ebertswil', telefon: '044 000 00 00', email: 'hof@example.ch',
  strasse: 'Schweikhof', hausnummer: '9a', plz: '8925', ort: 'Ebertswil', iban: 'CH9300762011623852957', mwst_nr: null, betriebsnummer: '0004/1/71', version: 1,
} as Betrieb;
const feld = (id: string, nr: string, name: string, m2: number, nutzung = 'Ackerland') =>
  ({ id, feldnummer: nr, name, flaeche_m2: m2, nutzungsart: nutzung, status: 'bewirtschaftet', korrektur_p2o5: 1.1, korrektur_k2o: 1, korrektur_mg: 0, bodenprobe_jahr: 2019 }) as unknown as Feld;
const felder = [feld('f1', '9', 'Obere Suterweid', 8000), feld('f2', '10', 'Mittlere Suterweid', 11000), feld('f3', '30', 'Hausweide', 5000, 'Dauergrünland')];

async function main() {
  const r = await belegPdf({
    betrieb: { name: betrieb.name, strasse: 'Schweikhof', hausnummer: '9a', plz: '8925', ort: 'Ebertswil', adresse: null, telefon: betrieb.telefon, email: betrieb.email, iban: 'CH9300762011623852957', mwst_nr: null },
    absender: 'Hans Lier',
    kunde: { name: 'Hof Nachbar', adresse: 'Dorfstrasse 1\n8925 Ebertswil' },
    beleg: { art: 'Rechnung', nummer: '2026-001', datum: '2026-11-03', faellig_am: '2026-12-03', zahlungsart: 'Überweisung', bezahlt_am: null, mwst_satz: null, bemerkungen: 'Abgeholt ab Hof', storniert: false },
    positionen: [
      { bezeichnung: 'Heu Rundballen (Obere Suterweid)', menge: 6, einheit: 'Ballen', preis: 55, betrag: 330 },
      { bezeichnung: 'Transport', menge: 1, einheit: 'Pauschal', preis: 40, betrag: 40 },
    ],
  });
  writeFileSync('probe_rechnung.pdf', Buffer.from(await r.arrayBuffer()));

  const ff = await fruchtfolgeZeichnen({
    von: 2023, bis: 2029, betrieb, felder,
    anbau: [
      { feld_id: 'f1', jahr: 2023, art: 'Hauptkultur', saatdatum: '2023-03-01', erntedatum: '2023-09-01', kulturen: { name: 'Sommerweizen', farbe: '#E9C46A' } },
      { feld_id: 'f1', jahr: 2024, art: 'Hauptkultur', saatdatum: '2023-09-01', erntedatum: null, kulturen: { name: 'Kunstwiese', farbe: '#8AB17D' } },
      { feld_id: 'f1', jahr: 2027, art: 'Hauptkultur', saatdatum: '2027-04-01', erntedatum: '2027-09-01', kulturen: { name: 'Silomais', farbe: '#F4A261' } },
      { feld_id: 'f1', jahr: 2027, art: 'Zwischenkultur', saatdatum: '2027-09-01', erntedatum: '2028-03-01', kulturen: { name: 'Gründüngung', farbe: '#B5E48C' } },
      { feld_id: 'f2', jahr: 2028, art: 'Hauptkultur', saatdatum: '2027-10-01', erntedatum: '2028-07-01', kulturen: { name: 'Winterweizen', farbe: '#2A6F97' } },
    ],
  });
  writeFileSync('probe_fruchtfolge.pdf', Buffer.from(await ff.arrayBuffer()));

  const pb = await parzellenblaetterPdf({
    betrieb, jahr: 2026, felder,
    blaetter: [
      {
        feld: felder[0], jahr: 2026, hauptkultur: 'Winterweizen', sorte: 'Arina', weitere: [], vorkultur: 'Silomais',
        zwischenkulturen: [{ name: 'Gründüngung', sorte: null, saat: '2026-08-01', umbruch: '2027-03-01', nurMonat: true }],
        arbeiten: [
          { id: 'a1', datum: '2026-03-12', arbeitsart: 'Düngen', status: 'erledigt', teil_ha: 0.8, dauer_h: 1, geraet: 'Streuer', person: 'HL', partner: null, bemerkungen: null, beobachtung: null,
            mittel: [{ bezeichnung: 'Ammonsalpeter 27.5 % N', einheit: 'kg', kategorie: 'Dünger', menge_je_ha: 150, gesamt: 120, n: 41.25, p2o5: null, k2o: null, mgo: null }] },
          { id: 'a2', datum: '2026-04-02', arbeitsart: 'Pflanzenschutz', status: 'erledigt', teil_ha: 0.8, dauer_h: 1, geraet: 'Spritze', person: 'HL', partner: null, bemerkungen: 'Unkraut', beobachtung: null,
            mittel: [{ bezeichnung: 'Herbizid X', einheit: 'l', kategorie: 'Pflanzenschutzmittel', menge_je_ha: 1.5, gesamt: 1.2, n: null, p2o5: null, k2o: null, mgo: null }] },
          { id: 'a3', datum: '2026-09-20', arbeitsart: 'Pflügen', status: 'erledigt', teil_ha: 0.8, dauer_h: 2, geraet: 'Pflug', person: 'HL', partner: null, bemerkungen: null, beobachtung: null, mittel: [] },
        ],
        ernten: [{ id: 'e1', datum: '2026-07-20', schnitt: null, teil_ha: 0.8, produkte: [{ produkt: 'Getreide', ballen: null, ballenart: null, kg: 5600 }, { produkt: 'Stroh', ballen: 12, ballenart: 'Quaderballen', kg: 3600 }] }],
      },
    ],
  });
  writeFileSync('probe_parzellenblatt.pdf', Buffer.from(await pb.arrayBuffer()));
  console.log('PDFs erstellt');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

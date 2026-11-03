// Erzeugt Beispiel-PDFs mit Testdaten (nur für die automatische Prüfung; wird im CI gebaut und als Artefakt abgelegt).
import { writeFileSync } from 'node:fs';
import { belegPdf } from '../src/lib/belegPdf';
import { fruchtfolgeZeichnen, parzellenblaetterPdf, type FruchtfolgeDaten } from '../src/lib/kontrollePdf';
import { duengerbilanzPdf, kontrollmappePdf, verkaeufePdf, weidePdf, type VerkaufsDaten, type WeideDaten } from '../src/lib/berichtePdf';
import type { KontrollDaten } from '../src/lib/kontrolle';
import type { Beweidung, Verkauf } from '../src/lib/typen';
import type { Betrieb, Feld } from '../src/lib/typen';

const betrieb = {
  id: 'b', name: 'SchweikFarm', kanton: 'ZH', adresse: 'Schweikhof 9a\n8925 Ebertswil', telefon: '044 000 00 00', email: 'hof@example.ch',
  strasse: 'Schweikhof', hausnummer: '9a', plz: '8925', ort: 'Ebertswil', iban: 'CH9300762011623852957', mwst_nr: null, betriebsnummer: '0004/1/71', bewirtschafter: 'Hans Lier', gemeinde: 'Hausen am Albis', version: 1,
} as Betrieb;
const feld = (id: string, nr: string, name: string, m2: number, nutzung = 'Ackerland') =>
  ({ id, feldnummer: nr, name, flaeche_m2: m2, nutzungsart: nutzung, status: 'bewirtschaftet', korrektur_p2o5: 1.1, korrektur_k2o: 1, korrektur_mg: 0, bodenprobe_jahr: 2019 }) as unknown as Feld;
const felder = [feld('f1', '9', 'Obere Suterweid', 8000), feld('f2', '10', 'Mittlere Suterweid', 11000), feld('f3', '30', 'Hausweide', 5000, 'Dauergrünland')];

async function main() {
  const r = await belegPdf({
    betrieb: { name: betrieb.name, strasse: 'Schweikhof', hausnummer: '9a', plz: '8925', ort: 'Ebertswil', adresse: null, telefon: betrieb.telefon, email: betrieb.email, iban: 'CH9300762011623852957', mwst_nr: null, betriebsnummer: '0004/1/71' },
    absender: 'Hans Lier',
    kunde: { name: 'Hof Nachbar', adresse: 'Dorfstrasse 1\n8925 Ebertswil' },
    beleg: { art: 'Rechnung', nummer: '2026-001', datum: '2026-11-03', faellig_am: '2026-12-03', zahlungsart: 'Überweisung', bezahlt_am: null, mwst_satz: null, bemerkungen: 'Abgeholt ab Hof', storniert: false },
    positionen: [
      { bezeichnung: 'Heu Rundballen (Obere Suterweid)', menge: 6, einheit: 'Ballen', preis: 55, betrag: 330 },
      { bezeichnung: 'Transport', menge: 1, einheit: 'Pauschal', preis: 40, betrag: 40 },
    ],
  });
  writeFileSync('probe_rechnung.pdf', Buffer.from(await r.arrayBuffer()));

  const ffDaten: FruchtfolgeDaten = {
    von: 2023, bis: 2029, betrieb, felder,
    anbau: [
      { feld_id: 'f1', jahr: 2023, art: 'Hauptkultur', saatdatum: '2023-03-01', erntedatum: '2023-09-01', kulturen: { name: 'Sommerweizen', farbe: '#E9C46A' } },
      { feld_id: 'f1', jahr: 2024, art: 'Hauptkultur', saatdatum: '2023-09-01', erntedatum: null, kulturen: { name: 'Kunstwiese', farbe: '#8AB17D' } },
      { feld_id: 'f1', jahr: 2027, art: 'Hauptkultur', saatdatum: '2027-04-01', erntedatum: '2027-09-01', kulturen: { name: 'Silomais', farbe: '#F4A261' } },
      { feld_id: 'f1', jahr: 2027, art: 'Zwischenkultur', saatdatum: '2027-09-01', erntedatum: '2028-03-01', kulturen: { name: 'Gründüngung', farbe: '#B5E48C' } },
      { feld_id: 'f2', jahr: 2028, art: 'Hauptkultur', saatdatum: '2027-10-01', erntedatum: '2028-07-01', kulturen: { name: 'Winterweizen', farbe: '#2A6F97' } },
    ],
  };
  const ff = await fruchtfolgeZeichnen(ffDaten);
  writeFileSync('probe_fruchtfolge.pdf', Buffer.from(await ff.arrayBuffer()));

  const kontroll: KontrollDaten = {
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
      {
        feld: felder[2], jahr: 2026, hauptkultur: null, sorte: null, weitere: [], vorkultur: null, zwischenkulturen: [], ernten: [],
        arbeiten: [
          { id: 'a4', datum: '2026-04-10', arbeitsart: 'Düngen', status: 'erledigt', teil_ha: 0.5, dauer_h: 1, geraet: 'Güllefass', person: 'HL', partner: null, bemerkungen: null, beobachtung: null,
            mittel: [{ bezeichnung: 'Rindergülle', einheit: 'm3', kategorie: 'Dünger', menge_je_ha: 25, gesamt: 12.5, n: 50, p2o5: 22.5, k2o: 112.5, mgo: 12 }] },
        ],
        weiden: [{ partner: 'Hof Nachbar', tierart: 'Rinder', anzahl: 12, gve: 8.4, von: '2026-05-01', bis: '2026-06-30', ha: 0.5 }],
      },
    ],
  };
  const pb = await parzellenblaetterPdf(kontroll);
  writeFileSync('probe_parzellenblatt.pdf', Buffer.from(await pb.arrayBuffer()));

  const weideEintrag: Beweidung = {
    id: 'w1', betrieb_id: 'b', partner_id: 'p1', tierart: 'Rinder', anzahl: 12, gve: 8.4, von: '2026-05-01', bis: '2026-06-30',
    entgelt_art: 'je Tier und Tag', entgelt_satz: 0.5, verkauf_id: null, bemerkungen: null, version: 1,
    beweidung_felder: [
      { feld_id: 'f3', flaeche_m2: 5000, von: '2026-05-01', bis: '2026-05-31' },
      { feld_id: 'f2', flaeche_m2: 4000, von: '2026-06-01', bis: '2026-06-20' },
      { feld_id: 'f3', flaeche_m2: 5000, von: '2026-06-21', bis: '2026-06-30' },
    ],
  };
  const weide: WeideDaten = { von: '2026-01-01', bis: '2026-12-31', betrieb, felder, partner: [{ id: 'p1', name: 'Hof Nachbar', adresse: null }], eintraege: [weideEintrag] };
  writeFileSync('probe_weide.pdf', Buffer.from(await (await weidePdf(weide)).arrayBuffer()));

  const beleg = {
    id: 'v1', nummer: '2026-001', art: 'Rechnung', datum: '2026-07-01', partner_id: 'p1', kunde_name: null, kunde_adresse: null, zahlungsart: 'Überweisung',
    faellig_am: '2026-07-31', bezahlt: false, bezahlt_am: null, mwst_satz: null, total_chf: 366, bemerkungen: null, storniert: false, version: 1,
    verkauf_positionen: [{ id: 'vp1', position: 1, bezeichnung: 'Weidezins 12 Rinder', menge: 732, einheit: 'Tiertage', preis_je_einheit: 0.5, betrag: 366, artikel_id: null, vom_lager: false, ernte_abnehmer_id: null }],
  } as unknown as Verkauf;
  const verkaeufe: VerkaufsDaten = {
    jahr: 2026, betrieb, belege: [{ ...beleg, kunde: 'Hof Nachbar' }],
    abgaben: [{ datum: '2026-07-20', feld: 'Obere Suterweid', produkt: 'Stroh', menge: '12 Quaderballen', partner: 'Reitstall', preis: 240, bezahlt: true }],
  };
  writeFileSync('probe_verkaeufe.pdf', Buffer.from(await (await verkaeufePdf(verkaeufe)).arrayBuffer()));
  writeFileSync('probe_duengerbilanz.pdf', Buffer.from(await (await duengerbilanzPdf(kontroll)).arrayBuffer()));

  const mappe = await kontrollmappePdf({
    jahr: 2026, betrieb, felder, kontroll, fruchtfolge: ffDaten, verkaeufe, weide,
    pruefpunkte: [
      { stufe: 'fehlt', text: '30 Hausweide: Düngung vom 10.04.2026 ohne Dünger und Menge' },
      { stufe: 'info', text: '9 Obere Suterweid: Feldgrenze noch nicht eingezeichnet' },
    ],
  });
  writeFileSync('probe_mappe.pdf', Buffer.from(await mappe.arrayBuffer()));
  console.log('PDFs erstellt');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

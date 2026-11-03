import type { jsPDF } from 'jspdf';
import { supabase } from './supabase';
import { APP_NAME } from './marke';
import type { Betrieb, Feld } from './typen';
import type { KontrollDaten, Parzellenblatt } from './kontrolle';
import { ABSCHNITT_VON } from './kontrolle';

const pdfText = (s: string) =>
  s
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/₂/g, '2')
    .replace(/₅/g, '5')
    .replace(/[^\x0A\x20-\x7E\xA0-\xFF]/g, '');
const zahl = (n: number | null | undefined, stellen = 2) =>
  n == null ? '' : new Intl.NumberFormat('de-CH', { maximumFractionDigits: stellen }).format(n).replace(/’/g, "'");
const tagMonat = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.` : '');
const monat = (iso: string | null | undefined) => (iso ? `${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '');
const heute = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
};

const GRUEN: [number, number, number] = [31, 77, 46];
const HELLGRUEN: [number, number, number] = [214, 236, 210];
const LINIE: [number, number, number] = [150, 170, 150];

interface Spalte {
  titel: string;
  breite: number;
  rechts?: boolean;
}

/** Zeichnet eine Tabelle mit grünem Kopf, Seitenumbruch und mindestens «leer» Leerzeilen zum Nachtragen von Hand */
function tabelle(doc: jsPDF, y: number, abschnitt: string, spalten: Spalte[], zeilen: string[][], opt: { links: number; unten: number; leer?: number; neueSeite: () => number }) {
  const zeilenHoehe = 6;
  const kopf = () => {
    const kopfZeilen = Math.max(...spalten.map((s) => (doc.splitTextToSize(pdfText(s.titel), s.breite - 2) as string[]).length));
    const h = Math.max(9, kopfZeilen * 3.2 + 3);
    doc.setFillColor(...HELLGRUEN);
    doc.setDrawColor(...LINIE);
    doc.setLineWidth(0.2);
    const breite = spalten.reduce((t, s) => t + s.breite, 0);
    doc.rect(opt.links, y, breite, h, 'FD');
    let x = opt.links;
    doc.setTextColor(20, 50, 28);
    for (const [i, s] of spalten.entries()) {
      if (i > 0) doc.line(x, y, x, y + h);
      doc.setFont('helvetica', i === 0 ? 'bold' : 'normal');
      doc.setFontSize(i === 0 ? 8.5 : 7);
      const t = doc.splitTextToSize(pdfText(i === 0 ? abschnitt : s.titel), s.breite - 2) as string[];
      doc.text(t, x + 1, y + 3.5);
      x += s.breite;
    }
    y += h;
  };
  if (y + 9 + zeilenHoehe * 2 > opt.unten) y = opt.neueSeite();
  kopf();
  const alle = [...zeilen];
  while (alle.length < Math.max(opt.leer ?? 2, zeilen.length + 1)) alle.push(spalten.map(() => ''));
  doc.setTextColor(30, 42, 32);
  for (const z of alle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    const teile = z.map((w, i) => doc.splitTextToSize(pdfText(w ?? ''), spalten[i].breite - 2) as string[]);
    const h = Math.max(zeilenHoehe, Math.max(...teile.map((t) => t.length)) * 3.2 + 2.2);
    if (y + h > opt.unten) {
      y = opt.neueSeite();
      kopf();
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(30, 42, 32);
    }
    let x = opt.links;
    doc.setDrawColor(...LINIE);
    for (const [i, s] of spalten.entries()) {
      doc.rect(x, y, s.breite, h);
      if (teile[i].length) doc.text(teile[i], s.rechts ? x + s.breite - 1 : x + 1, y + 4, s.rechts ? { align: 'right' } : undefined);
      x += s.breite;
    }
    y += h;
  }
  return y + 4;
}

function parzellenblatt(doc: jsPDF, b: Parzellenblatt, betrieb: Betrieb | null) {
  const links = 12;
  const rechts = 198;
  const unten = 284;
  let y = 12;
  const kopfzeile = (fortsetzung: boolean) => {
    doc.setFillColor(...GRUEN);
    doc.rect(links, y, rechts - links, 11, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(pdfText(`Parzellenblatt Ackerbau / Futterbau${fortsetzung ? ' (Fortsetzung)' : ''}`), links + 3, y + 7.5);
    doc.text(`Jahr ${b.jahr}`, rechts - 3, y + 7.5, { align: 'right' });
    y += 14;
  };
  const neueSeite = () => {
    doc.addPage();
    y = 12;
    kopfzeile(true);
    doc.setTextColor(30, 42, 32);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(pdfText(`${b.feld.feldnummer} ${b.feld.name}`), links, y + 2);
    y += 6;
    return y;
  };
  kopfzeile(false);

  // Kopfangaben
  const feld = (titel: string, wert: string, x: number, w: number) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(91, 107, 94);
    doc.text(pdfText(titel), x, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(30, 42, 32);
    doc.text(doc.splitTextToSize(pdfText(wert || ' '), w - 2) as string[], x, y + 4.5);
    doc.setDrawColor(...LINIE);
    doc.line(x, y + 6.5, x + w - 3, y + 6.5);
  };
  feld('Betriebsnummer', betrieb?.betriebsnummer ?? '', links, 50);
  feld('Betrieb', [betrieb?.name, betrieb?.ort].filter(Boolean).join(', '), links + 50, rechts - links - 50);
  y += 11;
  feld('Parzellenname / Nummer', `${b.feld.feldnummer} ${b.feld.name}`, links, 62);
  feld('Fläche ha', zahl(Number(b.feld.flaeche_m2) / 10000), links + 62, 22);
  feld('Hauptkultur und Sorte', [b.hauptkultur, b.sorte].filter(Boolean).join(' – ') + (b.weitere.length ? ` (${b.weitere.join('; ')})` : ''), links + 84, 70);
  feld('Vorkultur', b.vorkultur ?? '', links + 154, rechts - links - 154);
  y += 13;

  const arbeiten = (abschnitt: string) => b.arbeiten.filter((a) => (ABSCHNITT_VON[a.arbeitsart] ?? 'pflege') === abschnitt);
  const bem = (a: Parzellenblatt['arbeiten'][number], mitArt = false) =>
    [mitArt ? a.arbeitsart : null, a.geraet, a.partner && `durch ${a.partner}`, a.bemerkungen, a.beobachtung].filter(Boolean).join(' · ');
  const opt = (leer: number) => ({ links, unten, leer, neueSeite });

  // Bodenbearbeitung
  y = tabelle(
    doc, y, 'Bodenbearbeitung',
    [{ titel: '', breite: 42 }, { titel: 'Datum Tag/Monat', breite: 18 }, { titel: 'Teilfläche ha', breite: 16, rechts: true }, { titel: 'Bemerkungen (Gerät)', breite: 110 }],
    arbeiten('boden').map((a) => [a.arbeitsart, tagMonat(a.datum), zahl(a.teil_ha), bem(a)]),
    opt(3),
  );

  // Saat
  const saat = arbeiten('saat');
  y = tabelle(
    doc, y, 'Saat / Pflanzung / Sorte',
    [
      { titel: '', breite: 42 }, { titel: 'Datum Tag/Monat', breite: 18 }, { titel: 'Teilfläche ha', breite: 16, rechts: true },
      { titel: 'Menge pro Parzelle', breite: 20, rechts: true }, { titel: 'Menge pro ha', breite: 20, rechts: true }, { titel: 'Bemerkungen', breite: 70 },
    ],
    saat.flatMap((a) =>
      a.mittel.length
        ? a.mittel.map((m) => [m.bezeichnung, tagMonat(a.datum), zahl(a.teil_ha), `${zahl(m.gesamt, 1)} ${m.einheit}`, `${zahl(m.menge_je_ha, 1)} ${m.einheit}`, bem(a)])
        : [[b.sorte ?? '', tagMonat(a.datum), zahl(a.teil_ha), '', '', bem(a)]],
    ),
    opt(2),
  );

  // Düngung
  const duengung = arbeiten('duengung');
  y = tabelle(
    doc, y, 'Düngung (Düngemittel, Gehalt %)',
    [
      { titel: '', breite: 40 }, { titel: 'Datum Tag/Monat', breite: 15 }, { titel: 'Teilfl. ha', breite: 13, rechts: true },
      { titel: 'Menge pro Parzelle', breite: 18, rechts: true }, { titel: 'Menge pro ha', breite: 17, rechts: true }, { titel: 'Stadium', breite: 14 },
      { titel: 'N kg/ha', breite: 11, rechts: true }, { titel: 'P2O5 kg/ha', breite: 11, rechts: true }, { titel: 'K2O kg/ha', breite: 11, rechts: true },
      { titel: 'MgO kg/ha', breite: 11, rechts: true }, { titel: 'Gerät', breite: 14 }, { titel: 'Person', breite: 11 },
    ],
    duengung.flatMap((a) =>
      (a.mittel.length ? a.mittel : [null]).map((m) => [
        m?.bezeichnung ?? '(kein Dünger erfasst)', tagMonat(a.datum), zahl(a.teil_ha),
        m ? `${zahl(m.gesamt, 1)} ${m.einheit}` : '', m ? `${zahl(m.menge_je_ha, 1)} ${m.einheit}` : '', '',
        zahl(m?.n, 0), zahl(m?.p2o5, 0), zahl(m?.k2o, 0), zahl(m?.mgo, 0), a.geraet ?? (a.partner ? 'LU' : ''), a.person ?? '',
      ]),
    ),
    opt(4),
  );
  const summe = (k: 'n' | 'p2o5' | 'k2o' | 'mgo') => duengung.reduce((t, a) => t + a.mittel.reduce((u, m) => u + (m[k] ?? 0) * (a.teil_ha / (Number(b.feld.flaeche_m2) / 10000)), 0), 0);
  if (duengung.length) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...GRUEN);
    doc.text(
      pdfText(`Total ausgebracht (bezogen auf die ganze Parzelle): N ${zahl(summe('n'), 0)} · P2O5 ${zahl(summe('p2o5'), 0)} · K2O ${zahl(summe('k2o'), 0)} · MgO ${zahl(summe('mgo'), 0)} kg/ha`),
      links,
      y - 1,
    );
    y += 4;
  }

  // Pflege / Pflanzenschutz
  y = tabelle(
    doc, y, 'Pflege / Pflanzenschutz (Handelsname)',
    [
      { titel: '', breite: 40 }, { titel: 'Datum Tag/Monat', breite: 15 }, { titel: 'Teilfl. ha', breite: 13, rechts: true },
      { titel: 'Menge pro Parzelle', breite: 18, rechts: true }, { titel: 'Menge pro ha', breite: 17, rechts: true }, { titel: 'Stadium', breite: 14 },
      { titel: 'Wartefrist Tage', breite: 13 }, { titel: 'Grund der Behandlung / Bemerkungen', breite: 31 }, { titel: 'Gerät', breite: 14 }, { titel: 'Person', breite: 11 },
    ],
    arbeiten('pflege').flatMap((a) =>
      (a.mittel.length ? a.mittel : [null]).map((m) => [
        m?.bezeichnung ?? a.arbeitsart, tagMonat(a.datum), zahl(a.teil_ha), m ? `${zahl(m.gesamt, 2)} ${m.einheit}` : '', m ? `${zahl(m.menge_je_ha, 2)} ${m.einheit}` : '',
        '', '', [a.bemerkungen, a.beobachtung].filter(Boolean).join(' · '), a.geraet ?? (a.partner ? 'LU' : ''), a.person ?? '',
      ]),
    ),
    opt(3),
  );

  // Ernte / Nutzung
  const haFeld = Number(b.feld.flaeche_m2) / 10000;
  const ernteZeilen = b.ernten.map((e) => {
    const kg = e.produkte.reduce((t, p) => t + (p.kg ?? 0), 0);
    return [
      e.produkte.map((p) => p.produkt).join(' + ') + (e.schnitt ? ` (${e.schnitt}. Schnitt)` : ''),
      tagMonat(e.datum), zahl(e.teil_ha), kg ? zahl(kg / 100, 1) : '', kg && e.teil_ha ? zahl(kg / 100 / e.teil_ha, 1) : '', '',
      e.produkte.map((p) => [p.ballen != null ? `${p.ballen} ${p.ballenart ?? 'Ballen'}` : '', p.kg != null ? `${zahl(p.kg, 0)} kg ${p.produkt}` : ''].filter(Boolean).join(', ')).filter(Boolean).join(' · '),
    ];
  });
  const nutzung = arbeiten('nutzung').map((a) => [a.arbeitsart, tagMonat(a.datum), zahl(a.teil_ha), '', '', '', bem(a)]);
  y = tabelle(
    doc, y, 'Ernte / Nutzung',
    [
      { titel: '', breite: 42 }, { titel: 'Beginn Tag/Monat', breite: 16 }, { titel: 'Teilfläche ha', breite: 16, rechts: true },
      { titel: 'Ertrag dt pro Parzelle', breite: 19, rechts: true }, { titel: 'Ertrag dt pro ha', breite: 17, rechts: true }, { titel: 'Ende Tag/Monat', breite: 16 }, { titel: 'Bemerkungen', breite: 60 },
    ],
    [...ernteZeilen, ...nutzung].sort((x, z) => x[1].split('.').reverse().join('').localeCompare(z[1].split('.').reverse().join(''))),
    opt(3),
  );

  // Zwischenkultur
  const zk = b.zwischenkulturen;
  y = tabelle(
    doc, y, 'Zwischenkultur',
    [{ titel: '', breite: 42 }, { titel: 'Datum Tag/Monat', breite: 18 }, { titel: 'Teilfläche ha', breite: 16, rechts: true }, { titel: 'Typ / Sorte, Bemerkungen', breite: 110 }],
    zk.flatMap((z) => [
      ['Saat', z.nurMonat ? monat(z.saat) : tagMonat(z.saat), zahl(haFeld), [z.name, z.sorte].filter(Boolean).join(' – ')],
      ['Umbruch', z.nurMonat ? monat(z.umbruch) : tagMonat(z.umbruch), zahl(haFeld), ''],
    ]),
    opt(2),
  );
  void y;
}

function fusszeilen(doc: jsPDF, text: string, querformat = false) {
  const seiten = doc.getNumberOfPages();
  for (let i = 1; i <= seiten; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(120, 130, 122);
    doc.text(pdfText(`${text} - erstellt am ${heute()} mit ${APP_NAME} - Seite ${i}/${seiten}`), 12, querformat ? 203 : 291);
  }
}

/** Parzellenblätter als PDF: jedes Feld auf eigener Seite (bei vielen Einträgen mehrere Seiten) */
export async function parzellenblaetterPdf(d: KontrollDaten, nurMitInhalt = false): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const blaetter = d.blaetter.filter((b) => !nurMitInhalt || b.arbeiten.length || b.ernten.length || b.hauptkultur);
  blaetter.forEach((b, i) => {
    if (i > 0) doc.addPage();
    parzellenblatt(doc, b, d.betrieb);
  });
  if (!blaetter.length) {
    doc.setFontSize(12);
    doc.text('Keine Felder.', 20, 20);
  }
  fusszeilen(doc, `Parzellenblätter ${d.jahr}${d.betrieb ? ` - ${d.betrieb.name}` : ''}`);
  return doc.output('blob');
}

// ---------------------------------------------------------------- Fruchtfolge

export type AnbauF = { feld_id: string; jahr: number; art: string; saatdatum: string | null; erntedatum: string | null; kulturen: { name: string; farbe: string } | null };

export interface FruchtfolgeDaten {
  von: number;
  bis: number;
  betrieb: Betrieb | null;
  felder: Feld[];
  anbau: AnbauF[];
}

/** Farbige Fruchtfolge-Übersicht (A4 quer): Felder × Jahre, Hauptkultur farbig, Zwischenkulturen klein */
export async function fruchtfolgePdf(von: number, bis: number): Promise<Blob> {
  return fruchtfolgeZeichnen(await fruchtfolgeLaden(von, bis));
}

export async function fruchtfolgeLaden(von: number, bis: number): Promise<FruchtfolgeDaten> {
  const [betriebR, felderR, anbauR] = await Promise.all([
    supabase.from('betriebe').select('*').maybeSingle(),
    supabase.from('felder').select('*').is('geloescht_am', null).neq('status', 'zusammengeführt').neq('status', 'aufgegeben'),
    supabase.from('anbau').select('feld_id, jahr, art, saatdatum, erntedatum, kulturen(name, farbe)').gte('jahr', von).lte('jahr', bis),
  ]);
  if (felderR.error) throw felderR.error;
  if (anbauR.error) throw anbauR.error;
  return { von, bis, betrieb: betriebR.data as Betrieb | null, felder: (felderR.data ?? []) as Feld[], anbau: (anbauR.data ?? []) as unknown as AnbauF[] };
}

export async function fruchtfolgeZeichnen(daten: FruchtfolgeDaten): Promise<Blob> {
  const { von, bis, betrieb } = daten;
  const alle = [...daten.felder].sort((a, b) => a.feldnummer.localeCompare(b.feldnummer, 'de-CH', { numeric: true }));
  const felder = alle.filter((f) => f.nutzungsart !== 'Dauergrünland');
  const dauer = alle.filter((f) => f.nutzungsart === 'Dauergrünland');
  const anbau = daten.anbau;
  const jahre = Array.from({ length: bis - von + 1 }, (_, i) => von + i);

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const links = 10;
  const rechts = 287;
  const unten = 196;
  let y = 12;

  const titel = () => {
    doc.setFillColor(...GRUEN);
    doc.rect(links, y, rechts - links, 10, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(pdfText(`Fruchtfolge ${von}-${bis}`), links + 3, y + 7);
    doc.setFontSize(9);
    doc.text(pdfText([betrieb?.name, betrieb?.betriebsnummer && `Betriebsnr. ${betrieb.betriebsnummer}`].filter(Boolean).join(' - ')), rechts - 3, y + 7, { align: 'right' });
    y += 13;
  };
  titel();

  const festeSpalten = [
    { t: 'Nr.', b: 10 },
    { t: 'Feld', b: 38 },
    { t: 'ha', b: 11 },
    { t: 'P', b: 8 },
    { t: 'K', b: 8 },
    { t: 'Mg', b: 8 },
  ];
  const fest = festeSpalten.reduce((t, s) => t + s.b, 0);
  const jahrBreite = (rechts - links - fest) / jahre.length;
  const kopf = () => {
    doc.setFillColor(...HELLGRUEN);
    doc.setDrawColor(...LINIE);
    doc.rect(links, y, rechts - links, 7, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(20, 50, 28);
    let x = links;
    for (const s of festeSpalten) {
      doc.text(pdfText(s.t), x + 1, y + 4.8);
      x += s.b;
    }
    for (const j of jahre) {
      doc.line(x, y, x, y + 7);
      doc.text(String(j), x + jahrBreite / 2, y + 4.8, { align: 'center' });
      x += jahrBreite;
    }
    y += 7;
  };
  kopf();

  const textHell = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b < 110;
  };
  const zeilenHoehe = 11;
  for (const f of felder) {
    if (y + zeilenHoehe > unten - 4) {
      doc.addPage();
      y = 12;
      titel();
      kopf();
    }
    let x = links;
    doc.setDrawColor(...LINIE);
    doc.setTextColor(30, 42, 32);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const werte = [f.feldnummer, f.name, zahl(Number(f.flaeche_m2) / 10000), zahl(f.korrektur_p2o5, 1), zahl(f.korrektur_k2o, 1), zahl(f.korrektur_mg, 1)];
    festeSpalten.forEach((s, i) => {
      doc.rect(x, y, s.b, zeilenHoehe);
      doc.setFont('helvetica', i === 1 ? 'bold' : 'normal');
      doc.text(doc.splitTextToSize(pdfText(werte[i]), s.b - 2) as string[], x + 1, y + 4.2);
      x += s.b;
    });
    for (const j of jahre) {
      const h = anbau.find((a) => a.feld_id === f.id && a.jahr === j && a.art === 'Hauptkultur');
      const weitere = anbau.filter((a) => a.feld_id === f.id && a.jahr === j && a.art !== 'Hauptkultur');
      const farbe = h?.kulturen?.farbe ?? '#FFFFFF';
      doc.setFillColor(farbe);
      doc.rect(x, y, jahrBreite, zeilenHoehe, 'FD');
      if (h) {
        doc.setTextColor(...((textHell(farbe) ? [255, 255, 255] : [20, 30, 22]) as [number, number, number]));
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.text(doc.splitTextToSize(pdfText(h.kulturen?.name ?? ''), jahrBreite - 2)[0] as string, x + 1, y + 3.8);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(5.8);
        const zeit = [h.saatdatum && `S ${monat(h.saatdatum)}`, h.erntedatum && `E ${monat(h.erntedatum)}`].filter(Boolean).join(' ');
        if (zeit) doc.text(pdfText(zeit), x + 1, y + 6.6);
      }
      if (weitere.length) {
        const t = weitere.map((w) => `${w.art === 'Zwischenkultur' ? 'ZK' : w.art === 'Untersaat' ? 'US' : '2.'} ${w.kulturen?.name ?? ''}`).join(', ');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(5.8);
        doc.setTextColor(...((h && textHell(farbe) ? [255, 255, 255] : [60, 70, 62]) as [number, number, number]));
        doc.text(doc.splitTextToSize(pdfText(t), jahrBreite - 2)[0] as string, x + 1, y + 9.6);
      }
      x += jahrBreite;
    }
    y += zeilenHoehe;
  }

  // Flächen je Kultur und Jahr
  const kulturen = [...new Set(anbau.filter((a) => a.art === 'Hauptkultur' && felder.some((f) => f.id === a.feld_id)).map((a) => a.kulturen?.name ?? ''))].sort();
  const offen = felder.reduce((t, f) => t + Number(f.flaeche_m2), 0) / 10000;
  if (kulturen.length) {
    y += 4;
    if (y + 6 * (kulturen.length + 2) > unten) {
      doc.addPage();
      y = 12;
      titel();
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...GRUEN);
    doc.text(pdfText(`Fläche je Kultur (ha und Anteil an ${zahl(offen)} ha Fruchtfolgefläche)`), links, y);
    y += 2;
    for (const k of kulturen) {
      const farbe = anbau.find((a) => a.kulturen?.name === k)?.kulturen?.farbe ?? '#FFFFFF';
      let x = links;
      doc.setDrawColor(...LINIE);
      doc.setFillColor(farbe);
      doc.rect(x, y, 6, 5, 'FD');
      doc.setTextColor(30, 42, 32);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.text(pdfText(k), x + 8, y + 3.6);
      x = links + fest;
      for (const j of jahre) {
        const m2 = anbau
          .filter((a) => a.jahr === j && a.art === 'Hauptkultur' && a.kulturen?.name === k)
          .reduce((t, a) => t + Number(felder.find((f) => f.id === a.feld_id)?.flaeche_m2 ?? 0), 0);
        doc.rect(x, y, jahrBreite, 5);
        if (m2) doc.text(pdfText(`${zahl(m2 / 10000)} ha · ${Math.round((m2 / 10000 / offen) * 100)} %`), x + jahrBreite - 1, y + 3.6, { align: 'right' });
        x += jahrBreite;
      }
      y += 5;
    }
  }

  // Legende und Dauergrünland
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(91, 107, 94);
  doc.text(pdfText('S = Saat, E = Ernte/Umbruch (Monat/Jahr) · ZK = Zwischenkultur · US = Untersaat · 2. = Zweitkultur · P/K/Mg = Korrekturfaktoren Bodenprobe'), links, y);
  if (dauer.length) {
    y += 4;
    doc.text(
      pdfText(`Dauergrünland (nicht in der Fruchtfolge): ${dauer.map((f) => `${f.feldnummer} ${f.name} ${zahl(Number(f.flaeche_m2) / 10000)} ha`).join(', ')}`),
      links,
      y,
    );
  }
  fusszeilen(doc, `Fruchtfolge ${von}-${bis}${betrieb ? ` - ${betrieb.name}` : ''}`, true);
  return doc.output('blob');
}

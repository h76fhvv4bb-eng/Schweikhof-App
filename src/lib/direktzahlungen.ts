/**
 * Direktzahlungen und ÖLN: Prüfungen aus den erfassten Daten, grobe Beitragsschätzung und Tipps.
 * Ansätze Talzone gemäss «DZV mit Weisungen 2026» (BLW) und EKBV 2026. Hinweise, keine Rechtsberatung –
 * massgebend sind DZV, Weisungen und die Vorgaben des Kantons.
 */
import type { Anbau, Betrieb, Feld, Feldarbeit, Kultur } from './typen';
import { inFruchtfolge } from './typen';
import { schnittAb, tagMonatText } from './bff';

export const QUELLE_DZV = 'https://www.blw.admin.ch/dam/fr/sd-web/jgMQ64V3BzPZ/DZV%20de%20mit%20Weisungen%202026.pdf';
export const QUELLE_EKBV = 'https://www.blw.admin.ch/dam/fr/sd-web/2tYqGxpRl19m/EKBV%20mit%20Weisungen%202026%20de.pdf';
export const QUELLE_ZH = 'https://www.zh.ch/de/umwelt-tiere/landwirtschaft/direktzahlungen.html';

/** Ansätze 2026, Talzone, CHF/ha (Anh. 7 DZV, EKBV) */
export const ANSATZ = {
  basis: 600,
  basisBffGruenland: 300,
  offeneAckerflaeche: 400,
  bff: {
    'Extensiv genutzte Wiese': { q1: 780, q2: 1920 },
    'Wenig intensiv genutzte Wiese': { q1: 300, q2: 1540 },
    'Hecke mit Krautsaum': { q1: 2160, q2: 2840 },
    Buntbrache: { q1: 3800, q2: 0 },
    Rotationsbrache: { q1: 3300, q2: 0 },
    'Saum auf Ackerfläche': { q1: 3300, q2: 0 },
  } as Record<string, { q1: number; q2: number }>,
  vernetzungMax: 1000,
  eiweisserbsen: 1000,
  psmVerzichtGetreide: 400,
  herbizidVerzicht: 250,
  bodenbedeckung: 200,
  schonendeBearbeitung: 250,
  effizientN: 100,
} as const;

export type Stufe = 'ok' | 'warnung' | 'hinweis';
export interface Pruefung {
  titel: string;
  stufe: Stufe;
  text: string;
  felder?: string[];
  link?: { text: string; zu: string };
}
export interface Posten {
  text: string;
  ha: number;
  ansatz: number;
  betrag: number;
  bemerkung?: string;
}

const GETREIDE = ['Dinkel', 'Hafer', 'Sommergerste', 'Sommerweizen', 'Triticale', 'Wintergerste', 'Winterweizen'];
const WEIZEN = ['Winterweizen', 'Sommerweizen', 'Dinkel'];
const MAIS = ['Körnermais', 'Silomais'];
const ERBSEN = ['Eiweisserbsen'];
const BRACHE = ['Buntbrache', 'Rotationsbrache', 'Brache'];
const runden = (x: number) => Math.round(x * 100) / 100;
const pct = (x: number) => `${Math.round(x * 1000) / 10} %`;

export function dzAnalyse(d: {
  jahr: number;
  heute: string;
  betrieb: Betrieb | null | undefined;
  felder: Feld[];
  anbau: Anbau[];
  kulturen: Kultur[];
  arbeiten: Feldarbeit[];
  digifluxOffen: number;
}) {
  const { jahr } = d;
  const felder = d.felder.filter((f) => f.status === 'bewirtschaftet');
  const ha = (f: Feld) => Number(f.flaeche_m2) / 10000;
  const kultur = (id: string) => d.kulturen.find((k) => k.id === id);
  const haupt = new Map<string, Anbau>();
  for (const a of d.anbau) if (a.jahr === jahr && a.art === 'Hauptkultur') haupt.set(a.feld_id, a);
  const kname = (f: Feld) => (haupt.get(f.id) ? (kultur(haupt.get(f.id)!.kultur_id)?.name ?? haupt.get(f.id)!.kulturen?.name ?? '') : '');
  const kgruppe = (f: Feld) => (haupt.get(f.id) ? (kultur(haupt.get(f.id)!.kultur_id)?.kulturgruppe ?? '') : '');

  const ln = felder.reduce((s, f) => s + ha(f), 0);
  const acker = felder.filter((f) => inFruchtfolge(f) && kgruppe(f) !== 'Dauergrünland');
  const ackerHa = acker.reduce((s, f) => s + ha(f), 0);
  const kunstwiese = acker.filter((f) => kgruppe(f) === 'Kunstwiese' || f.nutzungsart === 'Kunstwiese');
  const brache = acker.filter((f) => BRACHE.includes(kname(f)));
  const offen = acker.filter((f) => !kunstwiese.includes(f) && !brache.includes(f));
  const offenHa = offen.reduce((s, f) => s + ha(f), 0);
  const gruenland = felder.filter((f) => !acker.includes(f));
  const istBff = (f: Feld) => !!f.bff_typ || BRACHE.includes(kname(f));
  const bffTyp = (f: Feld) => f.bff_typ ?? (BRACHE.includes(kname(f)) ? (kname(f) === 'Rotationsbrache' ? 'Rotationsbrache' : 'Buntbrache') : null);
  const bff = felder.filter(istBff);
  const bffHa = bff.reduce((s, f) => s + ha(f), 0);
  const gruenNichtBff = gruenland.filter((f) => !istBff(f));
  const gruenNichtBffHa = gruenNichtBff.reduce((s, f) => s + ha(f), 0);
  const gruenBff = gruenland.filter(istBff);
  const anteil = (namen: string[]) => (ackerHa > 0 ? acker.filter((f) => namen.includes(kname(f))).reduce((s, f) => s + ha(f), 0) / ackerHa : 0);
  const name = (f: Feld) => `${f.feldnummer} ${f.name}`;

  const pruefungen: Pruefung[] = [];

  // ---- BFF 7 %
  const fehltBff = Math.max(0, 0.07 * ln - bffHa);
  pruefungen.push({
    titel: 'Biodiversitätsförderflächen (mind. 7 % der LN)',
    stufe: fehltBff > 0.005 ? 'warnung' : 'ok',
    text:
      fehltBff > 0.005
        ? `${runden(bffHa)} ha BFF = ${pct(bffHa / (ln || 1))}. Es fehlen ca. ${runden(fehltBff)} ha. BFF-Typ beim Feld eintragen (z. B. extensive Wiese) oder eine Buntbrache/Nützlingsstreifen anlegen.`
        : `${runden(bffHa)} ha BFF = ${pct(bffHa / (ln || 1))} von ${runden(ln)} ha LN.`,
    link: { text: 'Felder', zu: '/felder' },
  });

  // ---- Fruchtfolge
  if (offenHa > 3) {
    const flaechen = new Map<string, number>();
    for (const f of acker) if (kname(f)) flaechen.set(kname(f), (flaechen.get(kname(f)) ?? 0) + ha(f));
    const zaehlend = [...flaechen].filter(([, h]) => h >= 0.1 * ackerHa);
    const ohne = acker.filter((f) => !kname(f));
    pruefungen.push({
      titel: 'Geregelte Fruchtfolge (mind. 4 Kulturen)',
      stufe: zaehlend.length >= 4 ? 'ok' : 'warnung',
      text: `${zaehlend.length} Hauptkulturen mit mind. 10 % der Ackerfläche: ${zaehlend.map(([k]) => k).join(', ') || '–'}.${ohne.length ? ` ${ohne.length} Ackerfelder ohne Hauptkultur ${jahr}.` : ''}`,
      felder: ohne.map(name),
      link: { text: 'Fruchtfolge', zu: '/fruchtfolge' },
    });
    const grenzen: [string, string[], number][] = [
      ['Getreide', GETREIDE, 0.66],
      ['Weizen und Dinkel', WEIZEN, 0.5],
      ['Mais', MAIS, 0.4],
      ['Eiweisserbsen', ERBSEN, 0.15],
    ];
    const ueber = grenzen.filter(([, n, max]) => anteil(n) > max + 1e-9);
    pruefungen.push({
      titel: 'Höchstanteile in der Fruchtfolge',
      stufe: ueber.length ? 'warnung' : 'ok',
      text: ueber.length
        ? ueber.map(([t, n, max]) => `${t} ${pct(anteil(n))} (max. ${pct(max)})`).join(' · ')
        : `Getreide ${pct(anteil(GETREIDE))} (max. 66 %), Weizen/Dinkel ${pct(anteil(WEIZEN))} (50 %), Mais ${pct(anteil(MAIS))} (40 %), Erbsen ${pct(anteil(ERBSEN))} (15 %).`,
    });
  }

  // ---- Bodenschutz: Ernte vor 31.8. → Winter-/Zwischenkultur/Gründüngung im gleichen Jahr
  if (offenHa > 3) {
    const offenBodenschutz: string[] = [];
    for (const f of offen) {
      const ernteArbeit = d.arbeiten
        .filter((a) => a.status === 'erledigt' && ['Ernten', 'Pressen'].includes(a.arbeitsart) && a.feldarbeit_felder.some((x) => x.feld_id === f.id))
        .map((a) => a.datum)
        .sort()[0];
      const h = haupt.get(f.id);
      const ernte = ernteArbeit ?? (h?.erntedatum && !h.nur_monat ? h.erntedatum : null);
      if (!ernte || ernte >= `${jahr}-08-31` || ernte > d.heute) continue;
      const folge = d.anbau.some(
        (a) => a.feld_id === f.id && a.id !== h?.id && a.saatdatum && a.saatdatum >= ernte && a.saatdatum <= `${jahr}-12-31`,
      );
      const gesaet = d.arbeiten.some((a) => a.arbeitsart === 'Säen' && a.status === 'erledigt' && a.datum >= ernte && a.feldarbeit_felder.some((x) => x.feld_id === f.id));
      if (!folge && !gesaet) offenBodenschutz.push(name(f));
    }
    pruefungen.push({
      titel: 'Bodenschutz: Begrünung nach früher Ernte',
      stufe: offenBodenschutz.length ? 'warnung' : 'ok',
      text: offenBodenschutz.length
        ? 'Vor dem 31. August geerntet, aber keine Saat danach erfasst. Im gleichen Jahr braucht es eine Winterkultur, Zwischenkultur oder Gründüngung.'
        : 'Nach allen Ernten vor dem 31. August ist eine Saat erfasst (oder keine frühe Ernte).',
      felder: offenBodenschutz,
    });
  }

  // ---- Arbeiten gegen Auflagen
  const zone = d.betrieb?.zone;
  const zuFrueh: string[] = [];
  const brachSchnitt: string[] = [];
  const duengungBff: string[] = [];
  const psmWinter: string[] = [];
  for (const a of d.arbeiten) {
    if (a.status !== 'erledigt') continue;
    const md = a.datum.slice(5);
    if (a.arbeitsart === 'Pflanzenschutz' && (md >= '11-15' || md <= '02-15')) psmWinter.push(`${a.datum.split('-').reverse().join('.')} (${a.feldarbeit_felder.length} Felder)`);
    for (const x of a.feldarbeit_felder) {
      const f = felder.find((y) => y.id === x.feld_id);
      if (!f) continue;
      const ab = schnittAb(f, zone);
      const schnitt = ['Mähen', 'Mulchen', 'Zetten', 'Wenden', 'Schwaden', 'Pressen'].includes(a.arbeitsart);
      if (schnitt && ab && md < ab && a.arbeitsart !== 'Pressen') zuFrueh.push(`${name(f)}: ${a.arbeitsart} ${a.datum.split('-').reverse().join('.')} (ab ${tagMonatText(ab)})`);
      if (schnitt && bffTyp(f) && ['Buntbrache', 'Rotationsbrache'].includes(bffTyp(f)!) && md > '03-15' && md < '10-01')
        brachSchnitt.push(`${name(f)}: ${a.arbeitsart} ${a.datum.split('-').reverse().join('.')}`);
      if (a.arbeitsart === 'Düngen' && f.bff_typ && f.bff_typ !== 'Wenig intensiv genutzte Wiese') duengungBff.push(`${name(f)} (${a.datum.split('-').reverse().join('.')})`);
    }
  }
  pruefungen.push({
    titel: 'Schnittzeitpunkte BFF-Wiesen',
    stufe: zuFrueh.length ? 'warnung' : 'ok',
    text: zuFrueh.length ? 'Schnitt vor dem frühesten Termin erfasst:' : `Kein Schnitt vor dem frühesten Termin erfasst (Talzone: 15. Juni).`,
    felder: [...new Set(zuFrueh)],
  });
  if (brache.length || brachSchnitt.length)
    pruefungen.push({
      titel: 'Schnitt Bunt-/Rotationsbrache (nur 1.10.–15.3.)',
      stufe: brachSchnitt.length ? 'warnung' : 'ok',
      text: brachSchnitt.length ? 'Schnitt ausserhalb der erlaubten Zeit erfasst:' : 'Kein Schnitt ausserhalb 1. Oktober bis 15. März erfasst.',
      felder: brachSchnitt,
    });
  if (duengungBff.length)
    pruefungen.push({ titel: 'Düngung auf BFF', stufe: 'warnung', text: 'Auf diesen BFF ist eine Düngung erfasst (nicht erlaubt):', felder: duengungBff });
  pruefungen.push({
    titel: 'Pflanzenschutz-Winterruhe (15.11.–15.2.)',
    stufe: psmWinter.length ? 'warnung' : 'ok',
    text: psmWinter.length ? 'Pflanzenschutz in der Winterruhe erfasst:' : 'Keine Pflanzenschutzbehandlung in der Winterruhe erfasst.',
    felder: psmWinter,
  });

  // ---- Dauergrünland ohne eigene Tiere
  if (gruenNichtBffHa > 0)
    pruefungen.push({
      titel: 'Dauergrünland ohne eigene Tiere',
      stufe: 'hinweis',
      text: `${runden(gruenNichtBffHa)} ha Dauergrünland/Weide ohne BFF. Den Basisbeitrag (${ANSATZ.basis} Fr./ha) gibt es dort nur mit mind. 1,0 RGVE/ha (Talzone), sonst anteilig gekürzt – bis ca. ${Math.round(gruenNichtBffHa * ANSATZ.basis)} Fr. Optionen: als extensive Wiese anmelden (Q I ${ANSATZ.bff['Extensiv genutzte Wiese'].q1} Fr./ha, Tierbesatz nur 30 %) oder geeignete Flächen in die Fruchtfolge nehmen (Kunstwiese).`,
      felder: gruenNichtBff.map(name),
    });

  // ---- Suisse-Bilanz und digiFLUX
  pruefungen.push({
    titel: 'Suisse-Bilanz',
    stufe: 'hinweis',
    text: 'Seit der Bilanz 2024 gibt es keinen Fehlerbereich von +10 % mehr für N und P. Düngungen vollständig erfassen und die Bilanz jedes Jahr rechnen (Wegleitung 1.20).',
    link: { text: 'Nährstoffe', zu: '/naehrstoffe' },
  });
  if (d.digifluxOffen > 0)
    pruefungen.push({
      titel: 'digiFLUX: Lieferungen bestätigen',
      stufe: 'warnung',
      text: `${d.digifluxOffen} Lieferung(en) noch zu bestätigen. Frist: 15. Februar des Folgejahres (sonst automatisch bestätigt).`,
      link: { text: 'digiFLUX', zu: '/digiflux' },
    });

  // ---- Grobe Schätzung der Beiträge (Talzone)
  const posten: Posten[] = [];
  const add = (text: string, h: number, ansatz: number, bemerkung?: string) => h > 0 && posten.push({ text, ha: runden(h), ansatz, betrag: Math.round(h * ansatz), bemerkung });
  add('Basisbeitrag Ackerfläche', ackerHa, ANSATZ.basis);
  add('Beitrag offene Ackerfläche', offenHa, ANSATZ.offeneAckerflaeche, 'ohne Kunstwiesen und Brachen');
  add('Basisbeitrag BFF-Grünland', gruenBff.reduce((s, f) => s + ha(f), 0), ANSATZ.basisBffGruenland, 'nur mit mind. 0,3 RGVE/ha');
  const typen = new Map<string, { h: number; q2: number; vn: number }>();
  for (const f of bff) {
    const t = bffTyp(f)!;
    const x = typen.get(t) ?? { h: 0, q2: 0, vn: 0 };
    x.h += ha(f);
    if (f.bff_qualitaet === 2) x.q2 += ha(f);
    if (f.bff_vernetzung) x.vn += ha(f);
    typen.set(t, x);
  }
  for (const [t, x] of typen) {
    const a = ANSATZ.bff[t];
    if (!a) {
      posten.push({ text: `BFF ${t}`, ha: runden(x.h), ansatz: 0, betrag: 0, bemerkung: 'Ansatz nicht hinterlegt' });
      continue;
    }
    add(`BFF ${t} (Q I)`, x.h, a.q1);
    if (a.q2) add(`BFF ${t} (Q II)`, x.q2, a.q2);
  }
  add('Einzelkulturbeitrag Eiweisserbsen', acker.filter((f) => ERBSEN.includes(kname(f))).reduce((s, f) => s + ha(f), 0), ANSATZ.eiweisserbsen, 'reif gedroschen');
  const vernetzungHa = bff.filter((f) => f.bff_vernetzung).reduce((s, f) => s + ha(f), 0);

  // ---- Zusätzliches Potenzial (Produktionssystembeiträge, freiwillig, Anmeldung bis 31. August des Vorjahres)
  const getreideHa = offen.filter((f) => GETREIDE.includes(kname(f)) || ERBSEN.includes(kname(f))).reduce((s, f) => s + ha(f), 0);
  const maisHa = offen.filter((f) => MAIS.includes(kname(f))).reduce((s, f) => s + ha(f), 0);
  const potenzial: Posten[] = [];
  const pot = (text: string, h: number, ansatz: number, bemerkung: string) => h > 0 && potenzial.push({ text, ha: runden(h), ansatz, betrag: Math.round(h * ansatz), bemerkung });
  pot('Verzicht auf Pflanzenschutzmittel (Getreide, Erbsen)', getreideHa, ANSATZ.psmVerzichtGetreide, 'ganze Kultur auf dem Betrieb, ab Saat bis Ernte');
  pot('Verzicht auf Herbizide (Mais u. a.)', maisHa, ANSATZ.herbizidVerzicht, 'mechanische Unkrautregulierung');
  pot('Angemessene Bodenbedeckung', offenHa, ANSATZ.bodenbedeckung, 'Ernte vor 1.10.: innert 7 Wochen Begrünung auf mind. 80 %');
  pot('Schonende Bodenbearbeitung', offenHa, ANSATZ.schonendeBearbeitung, 'Mulch-/Streifen-/Direktsaat, mind. 60 % der offenen Ackerfläche');
  pot('Effizienter Stickstoffeinsatz', ackerHa, ANSATZ.effizientN, 'N-Bilanz höchstens 90 % des Bedarfs');

  return {
    kennzahlen: { ln, ackerHa, offenHa, gruenHa: ln - ackerHa, bffHa, bffAnteil: ln ? bffHa / ln : 0, vernetzungHa },
    pruefungen,
    posten,
    summe: posten.reduce((s, p) => s + p.betrag, 0),
    potenzial,
    talzone: !zone || zone === 'Talzone',
  };
}

/** Feste Tipps mit Quelle */
export const DZ_TIPPS: { titel: string; text: string; quelle: string }[] = [
  {
    titel: 'Magere Wiesen als BFF anmelden',
    text: 'Extensiv genutzte Wiese: 780 Fr./ha (Q I), mit Qualitätsstufe II zusätzlich 1920 Fr., in der Vernetzung bis 1000 Fr. Kein Dünger, erster Schnitt ab 15. Juni (Talzone), Schnittgut abführen, kein Mähaufbereiter.',
    quelle: QUELLE_DZV,
  },
  {
    titel: 'Qualitätsstufe II gezielt fördern',
    text: 'Q II bringt mehr als das Doppelte von Q I. Artenreiche Bestände durch späten Schnitt, Heu statt Silage und Heublumensaat fördern; Q II wird durch eine Fachperson des Kantons beurteilt.',
    quelle: QUELLE_DZV,
  },
  {
    titel: 'Buntbrache und Nützlingsstreifen auf schwachen Ackerstücken',
    text: 'Buntbrache 3800 Fr./ha (2–8 Jahre am gleichen Ort, Schnitt nur 1.10.–15.3., halbe Fläche). Nützlingsstreifen 3300 Fr./ha (3–6 m breit, Saat bis 15. Mai) – beide zählen zur BFF-Pflicht von 7 %.',
    quelle: QUELLE_DZV,
  },
  {
    titel: 'Eiweisserbsen kombinieren',
    text: 'Einzelkulturbeitrag 1000 Fr./ha + PSM-Verzicht 400 Fr. + offene Ackerfläche 400 Fr. Höchstens 15 % der Ackerfläche, reif dreschen.',
    quelle: QUELLE_EKBV,
  },
  {
    titel: 'Produktionssystembeiträge rechtzeitig anmelden',
    text: 'PSM-Verzicht Getreide 400 Fr./ha, Herbizidverzicht 250 Fr., Bodenbedeckung 200 Fr., schonende Bodenbearbeitung 250 Fr., effizienter N-Einsatz 100 Fr. Anmeldung bis 31. August für das Folgejahr; bei Verstössen werden die Beiträge stark gekürzt.',
    quelle: QUELLE_DZV,
  },
  {
    titel: 'Dauergrünland ohne eigene Tiere',
    text: 'Den Basisbeitrag auf Dauergrünland gibt es nur mit mind. 1,0 RGVE/ha (Talzone; BFF-Grünland 0,3). Ob Weidegäste anrechenbar sind, beim Kanton klären. Geeignete Flächen als Kunstwiese in die Fruchtfolge nehmen oder als BFF bewirtschaften.',
    quelle: QUELLE_DZV,
  },
  {
    titel: 'Rückzugsstreifen in der Vernetzung (ZH)',
    text: 'In Vernetzungsprojekten des Kantons Zürich bleiben ab dem 2. Schnitt 10 % ungemäht, der Streifen wechselt den Ort und bleibt ab Mitte August über den Winter stehen.',
    quelle: 'https://www.zh.ch/de/umwelt-tiere/naturschutz/vernetzungsprojekte.html',
  },
  {
    titel: 'Suisse-Bilanz ohne Toleranz',
    text: 'Seit der Bilanz 2024 gibt es keinen Fehlerbereich von +10 % mehr. Zugeführte Hofdünger (digiFLUX) und alle Düngungen vollständig erfassen.',
    quelle: 'https://www.blw.admin.ch/dam/de/sd-web/PCfDBOdwjaOm/WegleitungSuisse-Bilanz1_20_D_DEF.pdf',
  },
];

/** Fristen Kanton Zürich (Stand Nov. 2026) */
export const DZ_FRISTEN: { wann: string; was: string }[] = [
  { wann: '15.11.–15.2.', was: 'Keine Pflanzenschutzbehandlungen (Winterruhe)' },
  { wann: 'bis 31.1.', was: 'digiFLUX: Hofdünger-Lieferungen des Vorjahres erfassen (Abgeber)' },
  { wann: 'bis 15.2.', was: 'digiFLUX: Lieferungen als Abnehmer bestätigen' },
  { wann: '11.–25.2.2027', was: 'Strukturdatenerhebung und Detailanmeldung PSB (LAWIS plus, ab Feb. 2027 Login mit AGOV)' },
  { wann: 'bis 1.5.2027', was: 'Abmeldung von Programmen, Änderung der Hauptkulturen' },
  { wann: '12.–26.8.2027', was: 'Anmeldung der Programme für 2028' },
];

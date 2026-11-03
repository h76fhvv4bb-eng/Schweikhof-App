import type { jsPDF } from 'jspdf';
import type { Beweidung, Betrieb, Feld, Verkauf } from './typen';
import type { KontrollDaten, Pruefpunkt } from './kontrolle';
import { betriebZeile, fruchtfolgeSeiten, fusszeilen, GRUEN, heute, LINIE, parzellenblaetterSeiten, pdfText, tabelle, zahl, type FruchtfolgeDaten, type Spalte } from './kontrollePdf';
import { umtriebText, weidetage, weidezins, weideHa } from './weide';

const datum = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');
const chf = (n: number | null | undefined) => (n == null ? '' : new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n).replace(/’/g, "'"));

interface Seite {
  links: number;
  rechts: number;
  unten: number;
  y: number;
}

/** Grüner Titelbalken mit Betrieb rechts; neue Seite optional; gibt die Seitenmasse zurück */
function kopf(doc: jsPDF, titel: string, betrieb: Betrieb | null, opt: { neueSeite: boolean; quer?: boolean; untertitel?: string }): Seite {
  if (opt.neueSeite) doc.addPage('a4', opt.quer ? 'landscape' : 'portrait');
  const breite = doc.internal.pageSize.getWidth();
  const hoehe = doc.internal.pageSize.getHeight();
  const s: Seite = { links: 12, rechts: breite - 12, unten: hoehe - 14, y: 12 };
  doc.setFillColor(...GRUEN);
  doc.rect(s.links, s.y, s.rechts - s.links, 11, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(pdfText(titel), s.links + 3, s.y + 7.5);
  doc.setFontSize(9);
  doc.text(pdfText(betriebZeile(betrieb)), s.rechts - 3, s.y + 7.5, { align: 'right' });
  s.y += 15;
  if (opt.untertitel) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(91, 107, 94);
    const z = doc.splitTextToSize(pdfText(opt.untertitel), s.rechts - s.links) as string[];
    doc.text(z, s.links, s.y);
    s.y += z.length * 3.8 + 2;
  }
  return s;
}

function zwischentitel(doc: jsPDF, s: Seite, text: string, neueSeite: () => number) {
  if (s.y + 20 > s.unten) s.y = neueSeite();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...GRUEN);
  doc.text(pdfText(text), s.links, s.y + 1);
  s.y += 4;
}

function hinweis(doc: jsPDF, s: Seite, text: string) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(91, 107, 94);
  const z = doc.splitTextToSize(pdfText(text), s.rechts - s.links) as string[];
  if (s.y + z.length * 3.4 > s.unten) return;
  doc.text(z, s.links, s.y);
  s.y += z.length * 3.4 + 2;
}

/** Spaltenbreiten auf die Seitenbreite strecken */
function spalten(s: Seite, def: [string, number, boolean?][]): Spalte[] {
  const summe = def.reduce((t, d) => t + d[1], 0);
  const f = (s.rechts - s.links) / summe;
  return def.map(([titel, b, rechts]) => ({ titel, breite: b * f, rechts }));
}

// ---------------------------------------------------------------- Düngerbilanz

export interface Gabe {
  datum: string;
  feld: Feld;
  dunger: string;
  einheit: string;
  menge_je_ha: number;
  teil_ha: number;
  gesamt: number;
  n: number; // kg/ha
  p2o5: number;
  k2o: number;
  mgo: number;
}

/** Alle Gaben mit Nährstoffen aus den Parzellenblatt-Daten (auch Dünger bei Saat oder Pflege) */
export function duengerGaben(d: KontrollDaten): Gabe[] {
  return d.blaetter
    .flatMap((b) =>
      b.arbeiten.flatMap((a) =>
        a.mittel
          .filter((m) => m.kategorie === 'Dünger' || m.n != null || m.p2o5 != null || m.k2o != null)
          .map((m) => ({
            datum: a.datum, feld: b.feld, dunger: m.bezeichnung, einheit: m.einheit, menge_je_ha: m.menge_je_ha, teil_ha: a.teil_ha, gesamt: m.gesamt,
            n: m.n ?? 0, p2o5: m.p2o5 ?? 0, k2o: m.k2o ?? 0, mgo: m.mgo ?? 0,
          })),
      ),
    )
    .sort((x, y) => x.datum.localeCompare(y.datum) || x.feld.feldnummer.localeCompare(y.feld.feldnummer, 'de-CH', { numeric: true }));
}

/** Summen je Feld: kg gesamt und kg/ha bezogen auf die ganze Feldfläche */
export function duengerJeFeld(d: KontrollDaten) {
  const gaben = duengerGaben(d);
  return d.blaetter
    .filter((b) => b.feld.status === 'bewirtschaftet' || gaben.some((g) => g.feld.id === b.feld.id))
    .map((b) => {
      const ha = Number(b.feld.flaeche_m2) / 10000;
      const eigene = gaben.filter((g) => g.feld.id === b.feld.id);
      const kg = (k: 'n' | 'p2o5' | 'k2o' | 'mgo') => eigene.reduce((t, g) => t + g[k] * g.teil_ha, 0);
      const t = { n: kg('n'), p2o5: kg('p2o5'), k2o: kg('k2o'), mgo: kg('mgo') };
      return { blatt: b, ha, gaben: eigene.length, kg: t, je_ha: { n: t.n / ha, p2o5: t.p2o5 / ha, k2o: t.k2o / ha, mgo: t.mgo / ha } };
    });
}

export function duengerbilanzSeiten(doc: jsPDF, d: KontrollDaten, neueSeite: boolean) {
  const s = kopf(doc, `Düngerbilanz ${d.jahr}`, d.betrieb, {
    neueSeite,
    quer: true,
    untertitel: 'Ausgebrachte Nährstoffe aus den erfassten Arbeiten (Gehalt der Dünger laut Lager). Kein Bodenvorrat und keine Suisse-Bilanz.',
  });
  const weiter = () => kopf(doc, `Düngerbilanz ${d.jahr} (Fortsetzung)`, d.betrieb, { neueSeite: true, quer: true }).y;
  const zeilen = duengerJeFeld(d);
  const total = zeilen.reduce(
    (t, z) => ({ ha: t.ha + z.ha, gaben: t.gaben + z.gaben, n: t.n + z.kg.n, p2o5: t.p2o5 + z.kg.p2o5, k2o: t.k2o + z.kg.k2o, mgo: t.mgo + z.kg.mgo }),
    { ha: 0, gaben: 0, n: 0, p2o5: 0, k2o: 0, mgo: 0 },
  );
  const sp = spalten(s, [
    ['Feld', 34], ['Kultur', 24], ['ha', 10, true], ['Gaben', 10, true], ['N kg/ha', 12, true], ['P2O5 kg/ha', 12, true], ['K2O kg/ha', 12, true],
    ['MgO kg/ha', 12, true], ['N kg', 12, true], ['P2O5 kg', 12, true], ['K2O kg', 12, true], ['MgO kg', 12, true],
  ]);
  const liste = zeilen.map((z) => [
    `${z.blatt.feld.feldnummer} ${z.blatt.feld.name}`, z.blatt.hauptkultur ?? (z.blatt.feld.nutzungsart !== 'Ackerland' ? z.blatt.feld.nutzungsart : ''), zahl(z.ha),
    String(z.gaben), zahl(z.je_ha.n, 0), zahl(z.je_ha.p2o5, 0), zahl(z.je_ha.k2o, 0), zahl(z.je_ha.mgo, 0),
    zahl(z.kg.n, 0), zahl(z.kg.p2o5, 0), zahl(z.kg.k2o, 0), zahl(z.kg.mgo, 0),
  ]);
  liste.push([
    'Total Betrieb', '', zahl(total.ha), String(total.gaben),
    total.ha ? zahl(total.n / total.ha, 0) : '', total.ha ? zahl(total.p2o5 / total.ha, 0) : '', total.ha ? zahl(total.k2o / total.ha, 0) : '', total.ha ? zahl(total.mgo / total.ha, 0) : '',
    zahl(total.n, 0), zahl(total.p2o5, 0), zahl(total.k2o, 0), zahl(total.mgo, 0),
  ]);
  zwischentitel(doc, s, 'Nährstoffe je Feld', weiter);
  s.y = tabelle(doc, s.y, 'Feld', sp, liste, { links: s.links, unten: s.unten, leer: 0, neueSeite: weiter, fett: (i) => i === liste.length - 1 });

  const gaben = duengerGaben(d);
  zwischentitel(doc, s, `Düngergaben (${gaben.length})`, weiter);
  s.y = tabelle(
    doc, s.y, 'Datum',
    spalten(s, [['Datum', 16], ['Feld', 30], ['Dünger', 38], ['Teilfl. ha', 11, true], ['Menge/ha', 15, true], ['Menge total', 15, true], ['N kg/ha', 10, true], ['P2O5 kg/ha', 10, true], ['K2O kg/ha', 10, true], ['MgO kg/ha', 10, true]]),
    gaben.map((g) => [
      datum(g.datum), `${g.feld.feldnummer} ${g.feld.name}`, g.dunger, zahl(g.teil_ha), `${zahl(g.menge_je_ha, 1)} ${g.einheit}`, `${zahl(g.gesamt, 1)} ${g.einheit}`,
      zahl(g.n, 0), zahl(g.p2o5, 0), zahl(g.k2o, 0), zahl(g.mgo, 0),
    ]),
    { links: s.links, unten: s.unten, leer: 0, neueSeite: weiter },
  );
  if (!gaben.length) hinweis(doc, s, 'Keine Düngung erfasst.');
  hinweis(doc, s, 'MgO = Mg / 0.603. Teilflächen werden für die kg/ha-Werte je Feld auf die ganze Feldfläche umgerechnet. Für die Nährstoffbilanz nach ÖLN bleiben die offiziellen Berechnungen massgebend.');
}

export async function duengerbilanzPdf(d: KontrollDaten): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  duengerbilanzSeiten(doc, d, false);
  fusszeilen(doc, `Düngerbilanz ${d.jahr} - ${betriebZeile(d.betrieb)}`);
  return doc.output('blob');
}

// ---------------------------------------------------------------- Verkäufe

export interface VerkaufsDaten {
  jahr: number;
  betrieb: Betrieb | null;
  belege: (Verkauf & { kunde: string })[];
  abgaben: { datum: string; feld: string; produkt: string; menge: string; partner: string; preis: number | null; bezahlt: boolean }[];
}

export function verkaeufeSeiten(doc: jsPDF, d: VerkaufsDaten, neueSeite: boolean) {
  const s = kopf(doc, `Verkäufe ${d.jahr}`, d.betrieb, { neueSeite, quer: true, untertitel: 'Rechnungen und Quittungen sowie Verkäufe aus der Ernte ohne Beleg.' });
  const weiter = () => kopf(doc, `Verkäufe ${d.jahr} (Fortsetzung)`, d.betrieb, { neueSeite: true, quer: true }).y;
  const gueltig = d.belege.filter((b) => !b.storniert);
  const total = gueltig.reduce((t, b) => t + Number(b.total_chf), 0);
  const offen = gueltig.filter((b) => !b.bezahlt).reduce((t, b) => t + Number(b.total_chf), 0);
  const ernteTotal = d.abgaben.reduce((t, a) => t + (a.preis ?? 0), 0);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 42, 32);
  doc.text(
    pdfText(`Belege: ${gueltig.length} · Total CHF ${chf(total)} · davon offen CHF ${chf(offen)}${d.abgaben.length ? ` · Ernte-Verkäufe ohne Beleg CHF ${chf(ernteTotal)}` : ''}`),
    s.links, s.y + 1,
  );
  s.y += 6;

  zwischentitel(doc, s, 'Rechnungen und Quittungen', weiter);
  const zeilen = d.belege.map((b) => [
    b.nummer, b.art, datum(b.datum), b.kunde, b.verkauf_positionen.map((p) => `${zahl(p.menge)} ${p.einheit} ${p.bezeichnung}`).join('; '),
    chf(b.total_chf), b.storniert ? 'storniert' : b.bezahlt ? 'bezahlt' : 'offen', datum(b.bezahlt_am),
  ]);
  zeilen.push(['Total (ohne Stornos)', '', '', '', '', chf(total), '', '']);
  s.y = tabelle(
    doc, s.y, 'Nr.',
    spalten(s, [['Nr.', 16], ['Art', 16], ['Datum', 18], ['Kunde', 40], ['Positionen', 110], ['Total CHF', 22, true], ['Status', 16], ['Bezahlt am', 18]]),
    zeilen,
    { links: s.links, unten: s.unten, leer: 0, neueSeite: weiter, fett: (i) => i === zeilen.length - 1 },
  );

  if (d.abgaben.length) {
    zwischentitel(doc, s, 'Verkäufe aus der Ernte ohne Beleg', weiter);
    s.y = tabelle(
      doc, s.y, 'Datum',
      spalten(s, [['Datum', 18], ['Feld', 40], ['Produkt', 40], ['Menge', 30], ['Abnehmer', 60], ['Preis CHF', 22, true], ['bezahlt', 16]]),
      d.abgaben.map((a) => [datum(a.datum), a.feld, a.produkt, a.menge, a.partner, chf(a.preis), a.bezahlt ? 'ja' : 'nein']),
      { links: s.links, unten: s.unten, leer: 0, neueSeite: weiter },
    );
  }
}

export async function verkaeufePdf(d: VerkaufsDaten): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  verkaeufeSeiten(doc, d, false);
  fusszeilen(doc, `Verkäufe ${d.jahr} - ${betriebZeile(d.betrieb)}`);
  return doc.output('blob');
}

// ---------------------------------------------------------------- Weidegäste

export interface WeideDaten {
  von: string;
  bis: string;
  betrieb: Betrieb | null;
  felder: Feld[];
  partner: { id: string; name: string; adresse: string | null }[];
  eintraege: Beweidung[];
}

export function weideSeiten(doc: jsPDF, d: WeideDaten, neueSeite: boolean) {
  const titel = `Weidegäste ${datum(d.von)} - ${datum(d.bis)}`;
  const s = kopf(doc, titel, d.betrieb, { neueSeite, quer: true, untertitel: 'Tiere anderer Betriebe auf den eigenen Flächen. Tage = Weidetage im gewählten Zeitraum (Beginn und Ende zählen mit).' });
  const weiter = () => kopf(doc, `${titel} (Fortsetzung)`, d.betrieb, { neueSeite: true, quer: true }).y;
  const feld = (id: string) => d.felder.find((f) => f.id === id);
  const partner = (id: string) => d.partner.find((p) => p.id === id);

  zwischentitel(doc, s, 'Weide-Einträge', weiter);
  const zeilen = d.eintraege.map((b) => {
    const tage = weidetage(b, d.von, d.bis);
    const zins = weidezins(b, d.von, d.bis);
    return [
      partner(b.partner_id)?.name ?? '', b.tierart, String(b.anzahl), b.gve != null ? zahl(b.gve, 1) : '', datum(b.von), b.bis ? datum(b.bis) : 'offen', String(tage),
      zahl(b.anzahl * tage, 0), b.gve != null ? zahl(Number(b.gve) * tage, 1) : '',
      umtriebText(b, (id) => feld(id)?.name ?? '?'),
      zins ? `${chf(zins.betrag)} (${zahl(zins.menge)} ${zins.einheit} à ${chf(zins.preis)})` : b.entgelt_art === 'keins' ? '-' : '',
    ];
  });
  s.y = tabelle(
    doc, s.y, 'Tierhalter',
    spalten(s, [['Tierhalter', 34], ['Tierart', 22], ['Anzahl', 12, true], ['GVE', 10, true], ['von', 18], ['bis', 18], ['Tage', 10, true], ['Tiertage', 14, true], ['GVE-Tage', 14, true], ['Felder (Umtrieb)', 70], ['Weidezins CHF', 34]]),
    zeilen,
    { links: s.links, unten: s.unten, leer: 0, neueSeite: weiter },
  );
  if (!d.eintraege.length) hinweis(doc, s, 'Keine Weidegäste im Zeitraum.');

  // Nach Feld
  const jeFeld = new Map<string, { tage: number; tiertage: number; gveTage: number; halter: Set<string> }>();
  for (const b of d.eintraege)
    for (const f of b.beweidung_felder) {
      const x = jeFeld.get(f.feld_id) ?? { tage: 0, tiertage: 0, gveTage: 0, halter: new Set<string>() };
      // Tage auf diesem Feld (eigener Zeitraum des Abschnitts), im gewählten Zeitraum
      const t = weidetage({ von: f.von ?? b.von, bis: f.bis ?? b.bis }, d.von, d.bis);
      x.tage += t;
      x.tiertage += t * b.anzahl;
      x.gveTage += b.gve != null ? t * Number(b.gve) : 0;
      x.halter.add(partner(b.partner_id)?.name ?? '');
      jeFeld.set(f.feld_id, x);
    }
  if (jeFeld.size) {
    zwischentitel(doc, s, 'Nach Feld', weiter);
    s.y = tabelle(
      doc, s.y, 'Feld',
      spalten(s, [['Feld', 50], ['Nutzung', 30], ['ha', 14, true], ['Weidetage', 18, true], ['Tiertage', 18, true], ['GVE-Tage', 18, true], ['Tierhalter', 80]]),
      [...jeFeld.entries()]
        .map(([id, x]) => ({ f: feld(id), x }))
        .sort((a, b) => (a.f?.feldnummer ?? '').localeCompare(b.f?.feldnummer ?? '', 'de-CH', { numeric: true }))
        .map(({ f, x }) => [
          f ? `${f.feldnummer} ${f.name}` : '?', f?.nutzungsart ?? '', f ? zahl(Number(f.flaeche_m2) / 10000) : '', String(x.tage), zahl(x.tiertage, 0),
          x.gveTage ? zahl(x.gveTage, 1) : '', [...x.halter].join(', '),
        ]),
      { links: s.links, unten: s.unten, leer: 0, neueSeite: weiter },
    );
  }
  const ha = d.eintraege.reduce((t, b) => t + weideHa(b), 0);
  if (d.eintraege.length) hinweis(doc, s, `Einträge: ${d.eintraege.length} · beweidete Fläche (Summe der Einträge): ${zahl(ha)} ha. GVE werden so übernommen, wie sie erfasst sind.`);
}

export async function weidePdf(d: WeideDaten): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  weideSeiten(doc, d, false);
  fusszeilen(doc, `Weidegäste - ${betriebZeile(d.betrieb)}`);
  return doc.output('blob');
}

// ---------------------------------------------------------------- Kontrollmappe

export interface MappeDaten {
  jahr: number;
  betrieb: Betrieb | null;
  felder: Feld[];
  kontroll: KontrollDaten;
  fruchtfolge: FruchtfolgeDaten;
  verkaeufe: VerkaufsDaten;
  weide: WeideDaten;
  pruefpunkte: Pruefpunkt[];
}

function deckblatt(doc: jsPDF, d: MappeDaten) {
  const b = d.betrieb;
  const links = 20;
  let y = 30;
  doc.setFillColor(...GRUEN);
  doc.rect(0, 0, 210, 14, 'F');
  doc.setTextColor(...GRUEN);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.text(pdfText(`Unterlagen ${d.jahr}`), links, y);
  y += 9;
  doc.setFontSize(14);
  doc.setTextColor(30, 42, 32);
  doc.text(pdfText(b?.name ?? 'Betrieb'), links, y);
  y += 12;

  const angabe = (titel: string, wert: string | null | undefined) => {
    if (!wert) return;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(91, 107, 94);
    doc.text(pdfText(titel), links, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(30, 42, 32);
    const z = doc.splitTextToSize(pdfText(wert), 120) as string[];
    doc.text(z, links + 45, y);
    y += Math.max(6.5, z.length * 4.8 + 1.7);
  };
  const adresse = b?.plz && b?.ort ? `${[b.strasse, b.hausnummer].filter(Boolean).join(' ')}\n${b.plz} ${b.ort}`.trim() : b?.adresse;
  angabe('Betriebsnummer', b?.betriebsnummer || '(fehlt)');
  angabe('Bewirtschafter/in', b?.bewirtschafter);
  angabe('Adresse', adresse);
  angabe('Gemeinde / Kanton', [b?.gemeinde, b?.kanton].filter(Boolean).join(' / '));
  angabe('Telefon', b?.telefon);
  angabe('E-Mail', b?.email);

  // Flächen
  const bewirtschaftet = d.felder.filter((f) => f.status === 'bewirtschaftet');
  const total = bewirtschaftet.reduce((t, f) => t + Number(f.flaeche_m2), 0) / 10000;
  const jeNutzung = new Map<string, number>();
  for (const f of bewirtschaftet) jeNutzung.set(f.nutzungsart, (jeNutzung.get(f.nutzungsart) ?? 0) + Number(f.flaeche_m2) / 10000);
  angabe('Bewirtschaftete Fläche', `${zahl(total)} ha auf ${bewirtschaftet.length} Feldern`);
  angabe('davon', [...jeNutzung.entries()].map(([n, h]) => `${n} ${zahl(h)} ha`).join('\n'));

  y += 6;
  doc.setDrawColor(...LINIE);
  doc.line(links, y, 190, y);
  y += 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...GRUEN);
  doc.text('Inhalt', links, y);
  return y + 8; // dort wird das Inhaltsverzeichnis eingetragen, wenn die Seitenzahlen feststehen
}

function pruefpunkteSeiten(doc: jsPDF, d: MappeDaten) {
  const s = kopf(doc, `Hinweise zu den Aufzeichnungen ${d.jahr}`, d.betrieb, {
    neueSeite: true,
    untertitel: 'Lücken und Unstimmigkeiten in den erfassten Daten. Das sind Hinweise zur Vollständigkeit, keine Prüfung der Vorschriften.',
  });
  const weiter = () => kopf(doc, 'Hinweise (Fortsetzung)', d.betrieb, { neueSeite: true }).y;
  const name = { fehlt: 'Fehlt', pruefen: 'Prüfen', info: 'Hinweis' };
  s.y = tabelle(
    doc, s.y, 'Stufe',
    spalten(s, [['Stufe', 18], ['Hinweis', 168]]),
    d.pruefpunkte.map((p) => [name[p.stufe], p.text]),
    { links: s.links, unten: s.unten, leer: 0, neueSeite: weiter },
  );
  if (!d.pruefpunkte.length) hinweis(doc, s, 'Keine Lücken gefunden.');
}

/** Alle Unterlagen in einem PDF: Deckblatt, Hinweise, Fruchtfolge, Parzellenblätter, Düngerbilanz, Verkäufe, Weidegäste */
export async function kontrollmappePdf(d: MappeDaten): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const abschnitte: { titel: string; von: number; bis: number }[] = [];
  const abschnitt = (titel: string, f: () => void) => {
    const von = doc.getNumberOfPages() + 1;
    f();
    abschnitte.push({ titel, von, bis: doc.getNumberOfPages() });
  };
  const yInhalt = deckblatt(doc, d);
  abschnitt('Hinweise zu den Aufzeichnungen', () => pruefpunkteSeiten(doc, d));
  abschnitt(`Fruchtfolge ${d.fruchtfolge.von}-${d.fruchtfolge.bis}`, () => fruchtfolgeSeiten(doc, d.fruchtfolge, true));
  abschnitt(`Parzellenblätter ${d.jahr}`, () => parzellenblaetterSeiten(doc, d.kontroll, true, true));
  abschnitt(`Düngerbilanz ${d.jahr}`, () => duengerbilanzSeiten(doc, d.kontroll, true));
  abschnitt(`Verkäufe ${d.jahr}`, () => verkaeufeSeiten(doc, d.verkaeufe, true));
  abschnitt(`Weidegäste ${d.jahr}`, () => weideSeiten(doc, d.weide, true));

  // Inhaltsverzeichnis auf dem Deckblatt
  doc.setPage(1);
  let y = yInhalt;
  for (const a of abschnitte) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(30, 42, 32);
    doc.text(pdfText(a.titel), 20, y);
    doc.text(a.von === a.bis ? `Seite ${a.von}` : `Seiten ${a.von}-${a.bis}`, 190, y, { align: 'right' });
    doc.setDrawColor(220, 226, 218);
    doc.line(20, y + 2, 190, y + 2);
    y += 8;
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(91, 107, 94);
  doc.text(
    doc.splitTextToSize(pdfText(`Zusammengestellt am ${heute()} aus den Daten im Hofmanager. Die Unterlagen geben die erfassten Daten wieder; sie ersetzen keine offizielle Berechnung oder Bestätigung.`), 170) as string[],
    20, Math.max(y + 6, 250),
  );

  fusszeilen(doc, `Unterlagen ${d.jahr} - ${betriebZeile(d.betrieb)}`, 1, 1);
  for (const a of abschnitte) fusszeilen(doc, `${a.titel} - ${betriebZeile(d.betrieb)}`, a.von, a.bis);
  return doc.output('blob');
}

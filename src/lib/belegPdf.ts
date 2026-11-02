import type { jsPDF } from 'jspdf';
import { datum } from './format';

export interface BelegDruck {
  betrieb: {
    name: string;
    strasse: string | null;
    hausnummer: string | null;
    plz: string | null;
    ort: string | null;
    adresse: string | null; // Freitext, falls keine strukturierte Adresse
    telefon: string | null;
    email: string | null;
    iban: string | null;
    mwst_nr: string | null;
  };
  absender: string | null;
  kunde: { name: string; adresse: string | null };
  beleg: {
    art: 'Rechnung' | 'Quittung';
    nummer: string;
    datum: string;
    faellig_am: string | null;
    zahlungsart: string | null;
    bezahlt_am: string | null;
    mwst_satz: number | null;
    bemerkungen: string | null;
    storniert: boolean;
  };
  positionen: { bezeichnung: string; menge: number; einheit: string; preis: number; betrag: number }[];
}

const pdfText = (s: string) =>
  s
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[^\x0A\x20-\x7E\xA0-\xFF]/g, '');

const geld = (n: number) => new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n).replace(/[’']/g, ' ');
const zahl = (n: number) => new Intl.NumberFormat('de-CH', { maximumFractionDigits: 3 }).format(n).replace(/’/g, "'");

/** IBAN prüfen (Prüfziffer nach ISO 13616) */
export function ibanGueltig(iban: string): boolean {
  const s = iban.replace(/\s/g, '').toUpperCase();
  if (!/^(CH|LI)[0-9]{2}[0-9A-Z]{17}$/.test(s)) return false;
  const umgestellt = s.slice(4) + s.slice(0, 4);
  let rest = 0;
  for (const z of umgestellt) {
    const wert = z >= 'A' && z <= 'Z' ? String(z.charCodeAt(0) - 55) : z;
    for (const ziffer of wert) rest = (rest * 10 + Number(ziffer)) % 97;
  }
  return rest === 1;
}

/** QR-IBAN (IID 30000–31999) verlangt eine QR-Referenz und wird hier nicht unterstützt */
export const istQrIban = (iban: string) => {
  const iid = Number(iban.replace(/\s/g, '').slice(4, 9));
  return iid >= 30000 && iid <= 31999;
};

const ibanFormat = (iban: string) => iban.replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim();

/** Summen eines Belegs */
export function belegSummen(positionen: { betrag: number }[], mwst: number | null) {
  const netto = Math.round(positionen.reduce((s, p) => s + p.betrag, 0) * 100) / 100;
  const steuer = mwst ? Math.round(netto * mwst) / 100 : 0;
  return { netto, steuer, total: Math.round((netto + steuer) * 100) / 100 };
}

/** Kann für diesen Betrieb eine QR-Rechnung erstellt werden? Gibt sonst den Grund zurück. */
export function qrMoeglich(b: BelegDruck['betrieb']): string | null {
  if (!b.iban) return 'IBAN fehlt in den Betriebsangaben';
  if (!ibanGueltig(b.iban)) return 'IBAN ist ungültig';
  if (istQrIban(b.iban)) return 'QR-IBAN wird nicht unterstützt, bitte die normale IBAN eintragen';
  if (!b.plz || !b.ort) return 'PLZ und Ort fehlen in den Betriebsangaben';
  return null;
}

/** Inhalt des Swiss QR Codes (Version 2.0, ohne Referenz, ohne Zahlungspflichtigen) */
function qrInhalt(b: BelegDruck['betrieb'], betrag: number, mitteilung: string) {
  const t = (s: string | null, max: number) => pdfText(s ?? '').replace(/\n/g, ' ').slice(0, max);
  return [
    'SPC', '0200', '1',
    b.iban!.replace(/\s/g, '').toUpperCase(),
    'S', t(b.name, 70), t(b.strasse, 70), t(b.hausnummer, 16), t(b.plz, 16), t(b.ort, 35), 'CH',
    '', '', '', '', '', '', '',
    betrag > 0 ? betrag.toFixed(2) : '', 'CHF',
    '', '', '', '', '', '', '',
    'NON', '',
    t(mitteilung, 140), 'EPD',
  ].join('\n');
}


/** Zeichnet den Zahlteil mit Empfangsschein (unterste 105 mm der Seite) */
async function zahlteil(doc: jsPDF, b: BelegDruck['betrieb'], betrag: number, mitteilung: string) {
  const QRCode = await import('qrcode');
  const oben = 192;
  doc.setDrawColor(0);
  doc.setLineWidth(0.2);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(0, oben, 210, oben);
  doc.line(62, oben, 62, 297);
  doc.setLineDashPattern([], 0);
  doc.setTextColor(0, 0, 0);

  const kreditor = [ibanFormat(b.iban!), b.name, [b.strasse, b.hausnummer].filter(Boolean).join(' '), `${b.plz} ${b.ort}`].filter((z) => z.trim());
  const schreib = (t: string, x: number, y: number, groesse: number, fett = false) => {
    doc.setFont('helvetica', fett ? 'bold' : 'normal');
    doc.setFontSize(groesse);
    doc.text(pdfText(t), x, y);
  };
  const ecken = (x: number, y: number, w: number, h: number) => {
    const l = 3;
    doc.setLineWidth(0.25);
    doc.lines([[l, 0]], x, y);
    doc.lines([[0, l]], x, y);
    doc.lines([[-l, 0]], x + w, y);
    doc.lines([[0, l]], x + w, y);
    doc.lines([[l, 0]], x, y + h);
    doc.lines([[0, -l]], x, y + h);
    doc.lines([[-l, 0]], x + w, y + h);
    doc.lines([[0, -l]], x + w, y + h);
  };

  // Empfangsschein
  let y = oben + 10;
  schreib('Empfangsschein', 5, y, 11, true);
  y += 7;
  schreib('Konto / Zahlbar an', 5, y, 6, true);
  y += 3.5;
  for (const z of kreditor) {
    schreib(z, 5, y, 8);
    y += 3.5;
  }
  y += 2;
  schreib('Zahlbar durch (Name/Adresse)', 5, y, 6, true);
  ecken(5, y + 1.5, 52, 20);
  schreib('Währung', 5, oben + 68, 6, true);
  schreib('Betrag', 20, oben + 68, 6, true);
  schreib('CHF', 5, oben + 72, 8);
  if (betrag > 0) schreib(geld(betrag), 20, oben + 72, 8);
  else ecken(27, oben + 69, 30, 10);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.text('Annahmestelle', 57, oben + 82, { align: 'right' });

  // Zahlteil
  schreib('Zahlteil', 67, oben + 10, 11, true);
  const qr = QRCode.create(qrInhalt(b, betrag, mitteilung), { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const groesse = 46;
  const m = groesse / n;
  const qx = 67;
  const qy = oben + 17;
  doc.setFillColor(0, 0, 0);
  for (let r = 0; r < n; r++) {
    let start = -1;
    for (let c = 0; c <= n; c++) {
      const dunkel = c < n && qr.modules.get(r, c);
      if (dunkel && start < 0) start = c;
      if (!dunkel && start >= 0) {
        doc.rect(qx + start * m, qy + r * m, (c - start) * m, m, 'F');
        start = -1;
      }
    }
  }
  // Schweizerkreuz in der Mitte (7 × 7 mm)
  const mx = qx + groesse / 2;
  const my = qy + groesse / 2;
  doc.setFillColor(255, 255, 255);
  doc.rect(mx - 3.5, my - 3.5, 7, 7, 'F');
  doc.setFillColor(0, 0, 0);
  doc.rect(mx - 2.95, my - 2.95, 5.9, 5.9, 'F');
  doc.setFillColor(255, 255, 255);
  doc.rect(mx - 0.6, my - 1.95, 1.2, 3.9, 'F');
  doc.rect(mx - 1.95, my - 0.6, 3.9, 1.2, 'F');

  schreib('Währung', 67, oben + 68, 8, true);
  schreib('Betrag', 85, oben + 68, 8, true);
  schreib('CHF', 67, oben + 73, 10);
  if (betrag > 0) schreib(geld(betrag), 85, oben + 73, 10);
  else ecken(78, oben + 70, 40, 15);

  y = oben + 10;
  const rx = 118;
  schreib('Konto / Zahlbar an', rx, y, 8, true);
  y += 4;
  for (const z of kreditor) {
    schreib(z, rx, y, 10);
    y += 4.2;
  }
  y += 2;
  schreib('Zusätzliche Informationen', rx, y, 8, true);
  y += 4;
  schreib(mitteilung, rx, y, 10);
  y += 6;
  schreib('Zahlbar durch (Name/Adresse)', rx, y, 8, true);
  ecken(rx, y + 1.5, 65, 25);
}

/** Erstellt Rechnung oder Quittung als PDF (A4). Rechnungen erhalten einen Zahlteil mit QR-Code, wenn möglich. */
export async function belegPdf(d: BelegDruck): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const links = 20;
  const rechts = 190;
  const gruen: [number, number, number] = [31, 77, 46];
  let y = 20;

  const text = (t: string, opt: { groesse?: number; fett?: boolean; farbe?: [number, number, number]; x?: number; max?: number; rechtsbuendig?: boolean } = {}) => {
    doc.setFont('helvetica', opt.fett ? 'bold' : 'normal');
    doc.setFontSize(opt.groesse ?? 10);
    doc.setTextColor(...(opt.farbe ?? [30, 42, 32]));
    const zeilen = doc.splitTextToSize(pdfText(t), opt.max ?? rechts - (opt.x ?? links)) as string[];
    for (const z of zeilen) {
      if (y > 280) {
        doc.addPage();
        y = 20;
      }
      doc.text(z, opt.x ?? links, y, opt.rechtsbuendig ? { align: 'right' } : undefined);
      y += (opt.groesse ?? 10) * 0.45;
    }
  };

  // Briefkopf
  const b = d.betrieb;
  text(b.name, { groesse: 16, fett: true, farbe: gruen });
  const adresse = b.plz && b.ort ? `${[b.strasse, b.hausnummer].filter(Boolean).join(' ')}, ${b.plz} ${b.ort}`.replace(/^, /, '') : (b.adresse ?? '').replace(/\n/g, ', ');
  const kontakt = [adresse, b.telefon && `Tel. ${b.telefon}`, b.email].filter(Boolean).join('  |  ');
  if (kontakt) text(kontakt, { groesse: 9, farbe: [91, 107, 94] });
  if (b.mwst_nr) text(`MWST-Nr. ${b.mwst_nr}`, { groesse: 9, farbe: [91, 107, 94] });

  // Empfänger (Fensterposition rechts)
  y = 50;
  text(d.kunde.name, { x: 120, max: 70 });
  if (d.kunde.adresse) for (const z of d.kunde.adresse.split(/\n|,\s*/)) text(z.trim(), { x: 120, max: 70 });

  y = 85;
  text(`${d.beleg.art} Nr. ${d.beleg.nummer}${d.beleg.storniert ? ' - STORNIERT' : ''}`, { groesse: 16, fett: true, farbe: d.beleg.storniert ? [142, 35, 24] : undefined });
  y += 1;
  const kopf = [`Datum: ${datum(d.beleg.datum)}`];
  if (d.beleg.art === 'Rechnung' && d.beleg.faellig_am) kopf.push(`Zahlbar bis: ${datum(d.beleg.faellig_am)}`);
  if (d.beleg.zahlungsart) kopf.push(`Zahlungsart: ${d.beleg.zahlungsart}`);
  text(kopf.join('     '), { groesse: 10 });
  y += 6;

  // Positionen
  const spalten = [10, 74, 20, 18, 22, 26]; // Pos, Bezeichnung, Menge, Einheit, Preis, Betrag
  const kopfzeile = ['Pos.', 'Bezeichnung', 'Menge', 'Einheit', 'Preis CHF', 'Betrag CHF'];
  const zeile = (werte: string[], fett: boolean) => {
    doc.setFont('helvetica', fett ? 'bold' : 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(30, 42, 32);
    const teile = werte.map((w, i) => doc.splitTextToSize(pdfText(w), spalten[i] - 2) as string[]);
    const h = Math.max(...teile.map((t) => t.length)) * 4.3 + 1.8;
    if (y + h > 280) {
      doc.addPage();
      y = 20;
    }
    let x = links;
    teile.forEach((t, i) => {
      const rechtsb = i >= 2 && i !== 3;
      doc.text(t, rechtsb ? x + spalten[i] - 2 : x, y, rechtsb ? { align: 'right' } : undefined);
      x += spalten[i];
    });
    y += h;
    doc.setDrawColor(226, 220, 203);
    doc.setLineWidth(0.2);
    doc.line(links, y - 3.4, rechts, y - 3.4);
  };
  zeile(kopfzeile, true);
  d.positionen.forEach((p, i) => zeile([String(i + 1), p.bezeichnung, zahl(p.menge), p.einheit, geld(p.preis), geld(p.betrag)], false));

  const s = belegSummen(d.positionen, d.beleg.mwst_satz);
  y += 2;
  const summe = (t: string, w: string, fett = false) => {
    doc.setFont('helvetica', fett ? 'bold' : 'normal');
    doc.setFontSize(fett ? 11 : 10);
    doc.text(pdfText(t), 140, y);
    doc.text(pdfText(w), rechts - 2, y, { align: 'right' });
    y += fett ? 6 : 5;
  };
  if (d.beleg.mwst_satz) {
    summe('Zwischentotal', geld(s.netto));
    summe(`MWST ${zahl(d.beleg.mwst_satz)} %`, geld(s.steuer));
  }
  doc.setDrawColor(...gruen);
  doc.setLineWidth(0.5);
  doc.line(140, y - 3.5, rechts, y - 3.5);
  summe('Total CHF', geld(s.total), true);
  y += 4;

  if (d.beleg.bemerkungen) {
    text(d.beleg.bemerkungen);
    y += 3;
  }

  if (d.beleg.art === 'Quittung') {
    text(`Betrag von CHF ${geld(s.total)} ${d.beleg.zahlungsart ? `(${d.beleg.zahlungsart}) ` : ''}dankend erhalten am ${datum(d.beleg.bezahlt_am ?? d.beleg.datum)}.`, { fett: true });
    y += 16;
    doc.setDrawColor(30, 42, 32);
    doc.setLineWidth(0.3);
    doc.line(links, y, links + 70, y);
    doc.line(120, y, rechts, y);
    y += 4;
    text('Ort, Datum', { groesse: 8, farbe: [91, 107, 94] });
    y -= 3.6;
    text(`Unterschrift ${d.absender ?? b.name}`, { groesse: 8, farbe: [91, 107, 94], x: 120 });
  } else {
    const grund = qrMoeglich(b);
    if (d.beleg.faellig_am) text(`Bitte bezahlen Sie den Betrag bis ${datum(d.beleg.faellig_am)}. Vielen Dank.`);
    else text('Vielen Dank für Ihren Einkauf.');
    if (grund && b.iban) text(`Bankverbindung: ${ibanFormat(b.iban)}`);
    y += 4;
    text(`Freundliche Grüsse${d.absender ? `\n${d.absender}` : ''}\n${b.name}`);
    if (!grund && !d.beleg.storniert) {
      if (y > 186) doc.addPage();
      await zahlteil(doc, b, s.total, `Rechnung ${d.beleg.nummer}`);
    }
  }

  const seiten = doc.getNumberOfPages();
  for (let i = 1; i <= seiten; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 130, 122);
    if (!(d.beleg.art === 'Rechnung' && i === seiten && !qrMoeglich(b))) doc.text(pdfText(`${b.name} - ${d.beleg.art} ${d.beleg.nummer} - Seite ${i}/${seiten}`), links, 290);
  }
  return doc.output('blob');
}

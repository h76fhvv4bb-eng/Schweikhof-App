import { datum } from './format';

export interface AuftragDruck {
  betrieb: { name: string; adresse: string | null; telefon: string | null; email: string | null; betriebsnummer?: string | null };
  absender: string | null;
  partner: { name: string; kontaktperson: string | null; adresse: string | null; email: string | null };
  auftrag: {
    nummer: string;
    art: 'Lohnarbeit' | 'Werkstatt';
    titel: string;
    arbeitsart: string | null;
    termin_von: string | null;
    termin_bis: string | null;
    beschreibung: string | null;
  };
  felder: { nr: string; name: string; ha: number; kultur: string | null; gemeinde: string | null; mitte: [number, number] | null; hinweise: { art: string; text: string }[] }[];
  mittel: { bezeichnung: string; menge_je_ha: number | null; einheit: string; total: number | null; bereitstellung: 'Betrieb' | 'Dienstleister'; bemerkung: string | null }[];
  maschine: {
    name: string; kategorie: string; hersteller: string | null; modell: string | null; baujahr: number | null; seriennummer: string | null;
    kennzeichen: string | null; betriebsstunden: number | null; standort: string | null;
  } | null;
  beobachtungen: { datum: string; titel: string; beschreibung: string | null; betriebsstunden: number | null }[];
}

/** Die Standardschriften des PDF kennen nur westeuropäische Zeichen: Sonderzeichen ersetzen. */
const pdfText = (s: string) =>
  s
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/₂/g, '2')
    .replace(/₅/g, '5')
    .replace(/³/g, '3')
    .replace(/[^\x0A\x20-\x7E\xA0-\xFF]/g, '');

const zahl = (n: number, stellen = 2) => new Intl.NumberFormat('de-CH', { maximumFractionDigits: stellen }).format(n).replace(/’/g, "'");

/** Erstellt das Auftrags-PDF (A4) im Browser. jsPDF wird erst hier geladen. */
export async function auftragPdf(d: AuftragDruck): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const links = 20;
  const rechts = 190;
  const breite = rechts - links;
  let y = 20;
  const gruen: [number, number, number] = [31, 77, 46];

  const neueSeiteWennNoetig = (hoehe: number) => {
    if (y + hoehe > 280) {
      doc.addPage();
      y = 20;
    }
  };
  const text = (t: string, opt: { groesse?: number; fett?: boolean; farbe?: [number, number, number]; x?: number; max?: number } = {}) => {
    doc.setFont('helvetica', opt.fett ? 'bold' : 'normal');
    doc.setFontSize(opt.groesse ?? 10);
    doc.setTextColor(...(opt.farbe ?? [30, 42, 32]));
    const zeilen = doc.splitTextToSize(pdfText(t), opt.max ?? breite - ((opt.x ?? links) - links)) as string[];
    for (const z of zeilen) {
      neueSeiteWennNoetig(6);
      doc.text(z, opt.x ?? links, y);
      y += (opt.groesse ?? 10) * 0.45;
    }
  };
  const abschnitt = (titel: string) => {
    y += 4;
    neueSeiteWennNoetig(14);
    doc.setDrawColor(...gruen);
    doc.setLineWidth(0.4);
    doc.line(links, y, rechts, y);
    y += 6;
    text(titel, { groesse: 12, fett: true, farbe: gruen });
    y += 1;
  };
  const tabelle = (kopf: string[], spalten: number[], zeilen: string[][]) => {
    const zeile = (werte: string[], fett: boolean) => {
      doc.setFont('helvetica', fett ? 'bold' : 'normal');
      doc.setFontSize(9);
      const teile = werte.map((w, i) => doc.splitTextToSize(pdfText(w), spalten[i] - 2) as string[]);
      const h = Math.max(...teile.map((t) => t.length)) * 4.2 + 1.5;
      neueSeiteWennNoetig(h);
      let x = links;
      teile.forEach((t, i) => {
        doc.setTextColor(30, 42, 32);
        doc.text(t, x, y);
        x += spalten[i];
      });
      y += h;
      doc.setDrawColor(226, 220, 203);
      doc.setLineWidth(0.2);
      doc.line(links, y - 3.2, rechts, y - 3.2);
    };
    zeile(kopf, true);
    zeilen.forEach((z) => zeile(z, false));
  };

  // Briefkopf
  text(d.betrieb.name, { groesse: 16, fett: true, farbe: gruen });
  const kontakt = [d.betrieb.adresse?.replace(/\n/g, ', '), d.betrieb.telefon && `Tel. ${d.betrieb.telefon}`, d.betrieb.email].filter(Boolean).join('  |  ');
  if (kontakt) text(kontakt, { groesse: 9, farbe: [91, 107, 94] });
  if (d.betrieb.betriebsnummer) text(`Betriebsnr. ${d.betrieb.betriebsnummer}`, { groesse: 9, farbe: [91, 107, 94] });
  y += 6;

  // Empfänger und Kopfdaten
  const yStart = y;
  text('An', { groesse: 8, farbe: [91, 107, 94] });
  text(d.partner.name, { fett: true });
  if (d.partner.kontaktperson) text(d.partner.kontaktperson);
  if (d.partner.adresse) d.partner.adresse.split('\n').forEach((z) => text(z));
  const yLinks = y;
  y = yStart;
  const x2 = 125;
  text(`Auftrag Nr. ${d.auftrag.nummer}`, { fett: true, x: x2, max: 65 });
  text(`Datum: ${datum(new Date())}`, { x: x2, max: 65 });
  if (d.auftrag.termin_von || d.auftrag.termin_bis) {
    const t = d.auftrag.termin_bis && d.auftrag.termin_bis !== d.auftrag.termin_von
      ? `${d.auftrag.termin_von ? datum(d.auftrag.termin_von) : ''} bis ${datum(d.auftrag.termin_bis)}`
      : datum(d.auftrag.termin_von);
    text(`Termin: ${t}`, { x: x2, max: 65 });
  }
  y = Math.max(y, yLinks) + 8;

  text(d.auftrag.art === 'Werkstatt' ? `Werkstattauftrag: ${d.auftrag.titel}` : `Auftrag ${d.auftrag.arbeitsart ?? 'Lohnarbeit'}: ${d.auftrag.titel}`, {
    groesse: 15,
    fett: true,
  });
  if (d.auftrag.beschreibung) {
    y += 2;
    text(d.auftrag.beschreibung);
  }

  if (d.auftrag.art === 'Lohnarbeit') {
    abschnitt('Felder');
    tabelle(
      ['Nr.', 'Feld', 'Fläche', 'Kultur', 'Gemeinde', 'Lage (Breite, Länge)'],
      [12, 40, 20, 32, 30, 36],
      d.felder.map((f) => [f.nr, f.name, `${zahl(f.ha)} ha`, f.kultur ?? '', f.gemeinde ?? '', f.mitte ? `${f.mitte[0].toFixed(5)}, ${f.mitte[1].toFixed(5)}` : '']),
    );
    text(`Total ${zahl(d.felder.reduce((s, f) => s + f.ha, 0))} ha`, { fett: true });

    const mitHinweis = d.felder.filter((f) => f.hinweise.length);
    if (mitHinweis.length) {
      abschnitt('Wichtige Hinweise zu den Feldern');
      for (const f of mitHinweis) {
        text(f.name, { fett: true });
        for (const h of f.hinweise) text(`${h.art === 'Gefahr' ? 'ACHTUNG' : h.art}: ${h.text}`, { fett: h.art === 'Gefahr', farbe: h.art === 'Gefahr' ? [142, 35, 24] : undefined, x: links + 4 });
        y += 1;
      }
    }

    if (d.mittel.length) {
      abschnitt('Betriebsmittel');
      tabelle(
        ['Mittel', 'Menge/ha', 'Total', 'Bereitgestellt durch', 'Bemerkung'],
        [52, 24, 24, 36, 34],
        d.mittel.map((m) => [
          m.bezeichnung,
          m.menge_je_ha != null ? `${zahl(m.menge_je_ha)} ${m.einheit}` : '',
          m.total != null ? `${zahl(m.total)} ${m.einheit}` : '',
          m.bereitstellung === 'Betrieb' ? 'Betrieb (liegt bereit)' : 'Dienstleister (bitte mitbringen)',
          m.bemerkung ?? '',
        ]),
      );
    }
  } else if (d.maschine) {
    abschnitt('Maschine');
    const m = d.maschine;
    tabelle(
      ['Angabe', 'Wert'],
      [50, 120],
      ([
        ['Bezeichnung', `${m.name} (${m.kategorie})`],
        ['Hersteller / Modell', [m.hersteller, m.modell].filter(Boolean).join(' ')],
        ['Baujahr', m.baujahr ? String(m.baujahr) : ''],
        ['Seriennummer', m.seriennummer ?? ''],
        ['Kontrollschild', m.kennzeichen ?? ''],
        ['Betriebsstunden', m.betriebsstunden != null ? `${zahl(m.betriebsstunden, 1)} h` : ''],
        ['Standort', m.standort ?? ''],
      ] as string[][]).filter((z) => z[1]),
    );
    if (d.beobachtungen.length) {
      abschnitt('Festgestellte Mängel / Beobachtungen');
      for (const b of d.beobachtungen) {
        text(`${datum(b.datum)}${b.betriebsstunden != null ? ` (bei ${zahl(b.betriebsstunden, 1)} h)` : ''}: ${b.titel}`, { fett: true });
        if (b.beschreibung) text(b.beschreibung, { x: links + 4 });
        y += 1;
      }
    }
  }

  abschnitt('Rückmeldung');
  text('Bitte bestätigen Sie den Auftrag und den Termin kurz per Mail oder Telefon. Vielen Dank.');
  y += 8;
  text(`Freundliche Grüsse${d.absender ? `\n${d.absender}` : ''}\n${d.betrieb.name}`);

  // Fusszeile
  const seiten = doc.getNumberOfPages();
  for (let i = 1; i <= seiten; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 130, 122);
    doc.text(pdfText(`${d.betrieb.name}${d.betrieb.betriebsnummer ? ` (Betriebsnr. ${d.betrieb.betriebsnummer})` : ''} - Auftrag ${d.auftrag.nummer} - Seite ${i}/${seiten}`), links, 290);
  }
  return doc.output('blob');
}

/**
 * Teilt das PDF über das Teilen-Menü (iPhone/Mac: «Mail» wählen, PDF ist angehängt).
 * Wo das nicht geht: PDF herunterladen und Mailprogramm mit vorbereitetem Text öffnen.
 */
export async function pdfPerMail(pdf: Blob, dateiname: string, an: string | null, betreff: string, text: string): Promise<'geteilt' | 'mailto' | 'abgebrochen'> {
  const datei = new File([pdf], dateiname, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [datei] })) {
    try {
      await nav.share({ files: [datei], title: betreff, text });
      return 'geteilt';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'abgebrochen';
    }
  }
  pdfHerunterladen(pdf, dateiname);
  const url = `mailto:${encodeURIComponent(an ?? '')}?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(
    `${text}\n\n(Das PDF «${dateiname}» wurde heruntergeladen. Bitte als Anhang beifügen.)`,
  )}`;
  window.location.href = url;
  return 'mailto';
}

export function pdfHerunterladen(pdf: Blob, dateiname: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(pdf);
  a.download = dateiname;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

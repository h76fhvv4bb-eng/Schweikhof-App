import type { Beweidung, Betrieb, Feld, Sperrung } from './typen';
import { betriebZeile, fusszeilen, GRUEN, pdfText, tabelle, type Spalte } from './kontrollePdf';
import { kartenbildZeichnen, type KartenFeld } from './kartenbild';
import { aktivAm, felderAm } from './weide';

const datum = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');
const tagPlus = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export interface SperrplanDaten {
  betrieb: Betrieb | null;
  felder: Feld[];
  sperrungen: Sperrung[];
  weiden: Beweidung[];
  partnerName: (id: string | null | undefined) => string | null;
  /** Stand (JJJJ-MM-TT) */
  stichtag: string;
  /** Sperrungen, die in den nächsten n Tagen beginnen, ebenfalls zeigen */
  vorschauTage?: number;
  /** nur Sperrungen für diese Nutzung (z. B. «Hundetraining»), sonst alle */
  fuer?: string | null;
}

/** Welche Sperrungen und Tiere gelten am Stichtag (inkl. bald beginnende) */
export function sperrlage(d: SperrplanDaten) {
  const bisVorschau = tagPlus(d.stichtag, d.vorschauTage ?? 14);
  const sperrungen = d.sperrungen
    .filter((s) => (s.bis == null || s.bis >= d.stichtag) && s.von <= bisVorschau)
    .filter((s) => !d.fuer || !s.fuer || s.fuer.toLowerCase() === d.fuer.toLowerCase())
    .sort((a, b) => a.von.localeCompare(b.von));
  const jetzt = (s: Sperrung) => s.von <= d.stichtag;
  const tiere: { feld_id: string; text: string; seit: string; halter: string | null }[] = [];
  for (const b of d.weiden.filter((w) => aktivAm(w, d.stichtag)))
    for (const a of felderAm(b, d.stichtag))
      tiere.push({ feld_id: a.feld_id, text: `${b.anzahl} ${b.tierart}`, seit: a.von, halter: d.partnerName(b.partner_id) });
  return { sperrungen, jetzt, tiere };
}

/** Plan für Nutzer der Flächen (z. B. Hundetraining): Karte mit gesperrten Feldern und Weidetieren, dazu die Liste */
export async function sperrplanPdf(d: SperrplanDaten): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const { sperrungen, jetzt, tiere } = sperrlage(d);
  const links = 12;
  const rechts = doc.internal.pageSize.getWidth() - 12;
  const unten = doc.internal.pageSize.getHeight() - 14;
  const feld = (id: string) => d.felder.find((f) => f.id === id);
  const titel = 'Hundeschule - gesperrte Flächen';

  const kopf = (t: string) => {
    doc.setFillColor(...GRUEN);
    doc.rect(links, 12, rechts - links, 11, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(pdfText(t), links + 3, 19.5);
    doc.setFontSize(9);
    doc.text(pdfText(betriebZeile(d.betrieb)), rechts - 3, 19.5, { align: 'right' });
    return 27;
  };
  let y = kopf(titel);
  doc.setTextColor(30, 42, 32);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(pdfText(`Stand ${datum(d.stichtag)}`), links, y + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const kontakt = [d.betrieb?.name, d.betrieb?.telefon && `Tel. ${d.betrieb.telefon}`].filter(Boolean).join(' - ');
  if (kontakt) doc.text(pdfText(`Bei Fragen: ${kontakt}`), rechts, y + 4, { align: 'right' });
  y += 9;

  // Karte: alle Felder, gesperrte rot schraffiert, Weiden mit Tieren orange
  const gesperrtJetzt = new Set(sperrungen.filter(jetzt).flatMap((s) => s.sperrung_felder.map((x) => x.feld_id)));
  const gesperrtBald = new Set(sperrungen.filter((s) => !jetzt(s)).flatMap((s) => s.sperrung_felder.map((x) => x.feld_id)));
  const tierFelder = new Map<string, string[]>();
  for (const t of tiere) tierFelder.set(t.feld_id, [...(tierFelder.get(t.feld_id) ?? []), t.text]);
  const kartenFelder: KartenFeld[] = d.felder
    .filter((f) => f.geometrie && f.status !== 'aufgegeben')
    .map((f) => {
      const gesperrt = gesperrtJetzt.has(f.id);
      const bald = !gesperrt && gesperrtBald.has(f.id);
      const tierText = tierFelder.get(f.id);
      const ab = bald ? sperrungen.filter((s) => s.sperrung_felder.some((x) => x.feld_id === f.id)).map((s) => s.von).sort()[0] : null;
      return {
        geometrie: f.geometrie!,
        fuellung: gesperrt ? 'rgba(220,38,38,0.35)' : tierText ? 'rgba(234,140,0,0.35)' : bald ? 'rgba(220,38,38,0.12)' : 'rgba(255,255,255,0.08)',
        schraffur: gesperrt ? 'rgba(185,28,28,0.75)' : bald ? 'rgba(185,28,28,0.35)' : undefined,
        rand: gesperrt ? '#B91C1C' : tierText ? '#C26A00' : bald ? '#E36A6A' : 'rgba(255,255,255,0.85)',
        randBreite: gesperrt || tierText ? 4 : bald ? 3 : 1.5,
        marke: f.feldnummer,
        markeFarbe: gesperrt ? '#B91C1C' : tierText ? '#C26A00' : '#1F4D2E',
        zeilen: [
          ...(gesperrt ? [{ text: 'GESPERRT', farbe: '#B91C1C', fett: true }] : []),
          ...(ab ? [{ text: `gesperrt ab ${datum(ab).slice(0, 6)}`, farbe: '#B91C1C', fett: true }] : []),
          ...(tierText ? tierText.map((t) => ({ text: `Tiere: ${t}`, farbe: '#8A4B00', fett: true })) : []),
        ],
      };
    });
  const karte = await kartenbildZeichnen(kartenFelder, {
    legende: [
      { farbe: 'rgba(220,38,38,0.8)', text: 'gesperrt', schraffur: true },
      ...(gesperrtBald.size ? [{ farbe: 'rgba(227,106,106,0.6)', text: 'bald gesperrt', schraffur: true }] : []),
      { farbe: 'rgba(234,140,0,0.85)', text: 'Weide mit Tieren' },
    ],
  }).catch(() => null);
  if (karte) {
    const maxB = rechts - links;
    const maxH = 150;
    const f = Math.min(maxB / karte.breite, maxH / karte.hoehe);
    const kb = karte.breite * f;
    const kh = karte.hoehe * f;
    doc.addImage(karte.bild, 'JPEG', links + (maxB - kb) / 2, y, kb, kh);
    doc.setDrawColor(150, 170, 150);
    doc.setLineWidth(0.3);
    doc.rect(links + (maxB - kb) / 2, y, kb, kh);
    y += kh + 2;
    doc.setFontSize(7);
    doc.setTextColor(91, 107, 94);
    doc.text(pdfText(`Zahl = Feldnummer.${karte.luftbild ? ' Luftbild: swisstopo.' : ''}`), links, y + 2);
    y += 5;
  } else {
    doc.setFontSize(9);
    doc.setTextColor(91, 107, 94);
    doc.text(pdfText('Keine Karte: Bei den Feldern sind noch keine Umrisse eingezeichnet.'), links, y + 4);
    y += 8;
  }

  // Liste der Sperrungen
  const abschnitt = (t: string) => {
    if (y + 16 > unten) y = kopf(`${titel} (Fortsetzung)`);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...GRUEN);
    doc.text(pdfText(t), links, y + 4);
    y += 6;
  };
  abschnitt('Gesperrte Felder');
  const spalten: Spalte[] = [
    { titel: 'Nr.', breite: 12 },
    { titel: 'Feld', breite: 50 },
    { titel: 'gesperrt', breite: 42 },
    { titel: 'Grund', breite: rechts - links - 104 },
  ];
  const zeilen = sperrungen.flatMap((s) =>
    s.sperrung_felder
      .map((x) => feld(x.feld_id))
      .filter((f): f is Feld => !!f)
      .sort((a, b) => a.feldnummer.localeCompare(b.feldnummer, 'de-CH', { numeric: true }))
      .map((f) => [
        f.feldnummer,
        f.name,
        `${jetzt(s) ? 'seit' : 'ab'} ${datum(s.von)}${s.bis ? ` bis ${datum(s.bis)}` : ' bis auf Weiteres'}`,
        [s.grund, s.bemerkungen].filter(Boolean).join(' - '),
      ]),
  );
  if (!zeilen.length) zeilen.push(['', 'Keine Sperrungen', '', '']);
  y = tabelle(doc, y, 'Nr.', spalten, zeilen, { links, unten, leer: 0, neueSeite: () => kopf(`${titel} (Fortsetzung)`) });

  if (tiere.length) {
    y += 3;
    abschnitt('Weiden mit Tieren (bitte nicht betreten)');
    const sp: Spalte[] = [
      { titel: 'Nr.', breite: 12 },
      { titel: 'Feld', breite: 50 },
      { titel: 'Tiere', breite: 42 },
      { titel: 'seit', breite: rechts - links - 104 },
    ];
    y = tabelle(
      doc, y, 'Nr.', sp,
      tiere.map((t) => [feld(t.feld_id)?.feldnummer ?? '', feld(t.feld_id)?.name ?? '?', t.text, datum(t.seit)]),
      { links, unten, leer: 0, neueSeite: () => kopf(`${titel} (Fortsetzung)`) },
    );
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(91, 107, 94);
  const fuss = doc.splitTextToSize(
    pdfText('Gesperrte Felder und Weiden mit Tieren bitte nicht betreten. Die Sperrungen können sich kurzfristig ändern - im Zweifel kurz nachfragen. Danke!'),
    rechts - links,
  ) as string[];
  if (y + 10 > unten) y = kopf(`${titel} (Fortsetzung)`);
  doc.text(fuss, links, y + 6);

  fusszeilen(doc, `${titel} - Stand ${datum(d.stichtag)} - ${betriebZeile(d.betrieb)}`);
  return doc.output('blob');
}

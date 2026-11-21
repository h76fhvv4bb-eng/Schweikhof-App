import type { Betrieb, Feld, HundeschuleFeld } from './typen';
import { betriebZeile, fusszeilen, GRUEN, pdfText, tabelle, type Spalte } from './kontrollePdf';
import { kartenbildZeichnen, type KartenFeld } from './kartenbild';

const datum = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const nr = (a: Feld, b: Feld) => a.feldnummer.localeCompare(b.feldnummer, 'de-CH', { numeric: true });

/** Plan für die Hundeschule: Karte mit freien (grün) und gesperrten (rot) Feldern, dazu beide Listen */
export async function hundeschulePdf(d: { betrieb: Betrieb | null; felder: Feld[]; status: HundeschuleFeld[]; stand: string; kultur?: (f: Feld) => string; tiere?: Map<string, string> }): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const links = 12;
  const rechts = doc.internal.pageSize.getWidth() - 12;
  const unten = doc.internal.pageSize.getHeight() - 14;
  const titel = 'Hundeschule - freie und gesperrte Felder';
  const st = (f: Feld) => d.status.find((s) => s.feld_id === f.id);
  const felder = d.felder.filter((f) => f.status !== 'aufgegeben').sort(nr);
  const gesperrt = felder.filter((f) => !st(f)?.frei || d.tiere?.has(f.id));

  const kopf = (t: string) => {
    doc.setFillColor(...GRUEN);
    doc.rect(links, 12, rechts - links, 11, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.5);
    doc.text(pdfText(t), links + 3, 19.5);
    doc.setFontSize(9);
    doc.text(pdfText(betriebZeile(d.betrieb)), rechts - 3, 19.5, { align: 'right' });
    return 27;
  };
  let y = kopf(titel);
  doc.setTextColor(30, 42, 32);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(pdfText(`Stand ${datum(d.stand)}`), links, y + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const kontakt = [d.betrieb?.name, d.betrieb?.telefon && `Tel. ${d.betrieb.telefon}`].filter(Boolean).join(' - ');
  if (kontakt) doc.text(pdfText(`Bei Fragen: ${kontakt}`), rechts, y + 4, { align: 'right' });
  y += 9;

  const kartenFelder: KartenFeld[] = felder
    .filter((f) => f.geometrie)
    .map((f) => {
      const tier = d.tiere?.get(f.id);
      if (tier)
        return {
          geometrie: f.geometrie!,
          fuellung: 'rgba(250,204,21,0.6)',
          rand: '#CA8A04',
          randBreite: 4,
          marke: f.feldnummer,
          markeFarbe: '#A16207',
          zeilen: [{ text: `TIERE: ${tier}`, farbe: '#713F12', fett: true }],
        };
      const ok = !!st(f)?.frei;
      return {
        geometrie: f.geometrie!,
        fuellung: ok ? 'rgba(34,160,70,0.45)' : 'rgba(220,38,38,0.28)',
        schraffur: ok ? undefined : 'rgba(185,28,28,0.7)',
        rand: ok ? '#15803D' : '#B91C1C',
        randBreite: ok ? 4 : 3,
        marke: f.feldnummer,
        markeFarbe: ok ? '#15803D' : '#B91C1C',
        zeilen: [{ text: ok ? 'FREI' : 'GESPERRT', farbe: ok ? '#15803D' : '#B91C1C', fett: true }],
      };
    });
  const karte = await kartenbildZeichnen(kartenFelder, {
    legende: [
      { farbe: 'rgba(34,160,70,0.85)', text: 'frei – darf genutzt werden' },
      { farbe: 'rgba(220,38,38,0.8)', text: 'gesperrt – bitte nicht betreten', schraffur: true },
      ...(d.tiere?.size ? [{ farbe: 'rgba(250,204,21,0.95)', text: 'Tiere auf der Weide – nicht betreten' }] : []),
    ],
  }).catch(() => null);
  if (karte) {
    const maxB = rechts - links;
    const f = Math.min(maxB / karte.breite, 150 / karte.hoehe);
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
  }

  const abschnitt = (t: string, farbe: [number, number, number]) => {
    if (y + 16 > unten) y = (doc.addPage(), kopf('Hundeschule (Fortsetzung)'));
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...farbe);
    doc.text(pdfText(t), links, y + 4);
    y += 6;
  };
  const spalten: Spalte[] = [
    { titel: 'Nr.', breite: 14 },
    { titel: 'Feld', breite: 58 },
    { titel: 'Kultur', breite: 48 },
    { titel: 'Bemerkung', breite: rechts - links - 120 },
  ];
  const bem = (f: Feld) => [d.tiere?.has(f.id) ? `Tiere: ${d.tiere.get(f.id)}` : '', st(f)?.bemerkung ?? ''].filter(Boolean).join(' - ');
  const zeilen = (l: Feld[]) => (l.length ? l.map((f) => [f.feldnummer, f.name, d.kultur?.(f) ?? '', bem(f)]) : [['', 'keine', '', '']]);
  abschnitt(`Gesperrte Felder (${gesperrt.length}) - alle übrigen Felder sind frei`, [185, 28, 28]);
  y = tabelle(doc, y, 'Nr.', spalten, zeilen(gesperrt), { links, unten, leer: 0, neueSeite: () => (doc.addPage(), kopf('Hundeschule (Fortsetzung)')) });

  const hinweis = [d.betrieb?.hundeschule_hinweis, 'Gesperrte Felder bitte nicht betreten. Im Zweifel kurz nachfragen. Danke!'].filter(Boolean).join('\n');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(30, 42, 32);
  const z = doc.splitTextToSize(pdfText(hinweis), rechts - links) as string[];
  if (y + 6 + z.length * 4.2 > unten) y = (doc.addPage(), kopf('Hundeschule (Fortsetzung)'));
  doc.text(z, links, y + 6);

  fusszeilen(doc, `Hundeschule - Stand ${datum(d.stand)} - ${betriebZeile(d.betrieb)}`);
  return doc.output('blob');
}

import type { MultiPolygon, Polygon } from 'geojson';
import type { Beweidung, Betrieb, Feld, FeldHinweis } from './typen';
import { betriebZeile, fusszeilen, GRUEN, pdfText, tabelle, zahl, type Spalte } from './kontrollePdf';
import { KARTEN } from './karte';
import { abschnitte, weidetage } from './weide';

const datum = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');
const heuteIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export interface WeideplanDaten {
  betrieb: Betrieb | null;
  partner: { name: string; adresse: string | null; telefon: string | null } | null;
  beweidung: Beweidung;
  felder: Feld[];
  hinweise: FeldHinweis[];
}

/** Reihenfolge: Abschnitte mit gleichem Beginn (Herde gleichzeitig auf mehreren Feldern) bekommen dieselbe Nummer */
export function planSchritte(b: Beweidung) {
  const liste = abschnitte(b);
  const nummern = new Map<string, number>();
  for (const a of liste) {
    const k = a.von ?? b.von;
    if (!nummern.has(k)) nummern.set(k, nummern.size + 1);
  }
  return liste.map((a) => ({ ...a, von: a.von ?? b.von, bis: a.bis ?? null, nr: nummern.get(a.von ?? b.von)! }));
}

// ------------------------------------------------------------------ Karte als Bild

const KACHEL = 256;
const lonX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z * KACHEL;
const latY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z * KACHEL;
};
const ringe = (g: Polygon | MultiPolygon) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);

function kachelLaden(url: string): Promise<HTMLImageElement | null> {
  return new Promise((ok) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const t = setTimeout(() => ok(null), 8000);
    img.onload = () => (clearTimeout(t), ok(img));
    img.onerror = () => (clearTimeout(t), ok(null));
    img.src = url;
  });
}

/**
 * Luftbild-Ausschnitt mit den Weideflächen und ihrer Reihenfolge. Fehlen Kacheln (offline), bleibt der Hintergrund grau –
 * Feldgrenzen und Nummern sind trotzdem da.
 */
async function kartenbild(d: WeideplanDaten, schritte: ReturnType<typeof planSchritte>): Promise<{ bild: string; breite: number; hoehe: number; luftbild: boolean } | null> {
  const weideIds = new Set(schritte.map((s) => s.feld_id));
  const weide = d.felder.filter((f) => weideIds.has(f.id) && f.geometrie);
  if (!weide.length) return null;
  let [w, s, o, n] = [180, 90, -180, -90];
  for (const f of weide)
    for (const poly of ringe(f.geometrie!))
      for (const [lon, lat] of poly[0]) {
        w = Math.min(w, lon);
        o = Math.max(o, lon);
        s = Math.min(s, lat);
        n = Math.max(n, lat);
      }
  // Rand: 15 % auf jeder Seite, mindestens etwa 60 m
  const rx = Math.max((o - w) * 0.15, 0.0008);
  const ry = Math.max((n - s) * 0.15, 0.0005);
  [w, o, s, n] = [w - rx, o + rx, s - ry, n + ry];

  const MAX_B = 1600;
  const MAX_H = 1300;
  let z = 19;
  while (z > 10 && (lonX(o, z) - lonX(w, z) > MAX_B || latY(s, z) - latY(n, z) > MAX_H)) z--;
  const x0 = lonX(w, z);
  const y0 = latY(n, z);
  const breite = Math.round(lonX(o, z) - x0);
  const hoehe = Math.round(latY(s, z) - y0);
  const canvas = document.createElement('canvas');
  canvas.width = breite;
  canvas.height = hoehe;
  const c = canvas.getContext('2d');
  if (!c) return null;
  c.fillStyle = '#D9DED6';
  c.fillRect(0, 0, breite, hoehe);

  // Luftbild-Kacheln
  const kacheln: Promise<void>[] = [];
  let geladen = 0;
  for (let tx = Math.floor(x0 / KACHEL); tx * KACHEL < x0 + breite; tx++)
    for (let ty = Math.floor(y0 / KACHEL); ty * KACHEL < y0 + hoehe; ty++) {
      const url = KARTEN.luftbild.replace('{z}', String(z)).replace('{x}', String(tx)).replace('{y}', String(ty));
      kacheln.push(
        kachelLaden(url).then((img) => {
          if (!img) return;
          c.drawImage(img, tx * KACHEL - x0, ty * KACHEL - y0);
          geladen++;
        }),
      );
    }
  await Promise.all(kacheln);

  const punkt = (lon: number, lat: number): [number, number] => [lonX(lon, z) - x0, latY(lat, z) - y0];
  const pfad = (g: Polygon | MultiPolygon) => {
    c.beginPath();
    for (const poly of ringe(g))
      for (const ring of poly)
        ring.forEach(([lon, lat], i) => {
          const [x, y] = punkt(lon, lat);
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        });
    c.closePath();
  };
  const skala = Math.max(1, breite / 900);

  // übrige Felder dünn, Weideflächen kräftig
  for (const f of d.felder) {
    if (!f.geometrie || weideIds.has(f.id)) continue;
    pfad(f.geometrie);
    c.strokeStyle = 'rgba(255,255,255,0.75)';
    c.lineWidth = 1.5 * skala;
    c.stroke();
  }
  const heute = heuteIso();
  for (const f of weide) {
    const eigene = schritte.filter((x) => x.feld_id === f.id);
    const vorbei = eigene.every((x) => x.bis != null && x.bis < heute);
    pfad(f.geometrie!);
    c.fillStyle = vorbei ? 'rgba(160,160,160,0.35)' : 'rgba(250,204,21,0.35)';
    c.fill('evenodd');
    c.strokeStyle = vorbei ? '#9CA3AF' : '#FACC15';
    c.lineWidth = 4 * skala;
    c.stroke();
  }
  // Nummern (Reihenfolge) in der Feldmitte
  for (const f of weide) {
    const nr = [...new Set(schritte.filter((x) => x.feld_id === f.id).map((x) => x.nr))].join(', ');
    const aussen = ringe(f.geometrie!)[0][0];
    const mx = aussen.reduce((t, p) => t + p[0], 0) / aussen.length;
    const my = aussen.reduce((t, p) => t + p[1], 0) / aussen.length;
    const [x, y] = punkt(mx, my);
    c.font = `bold ${Math.round(26 * skala)}px Helvetica, Arial, sans-serif`;
    const tb = Math.max(c.measureText(nr).width + 22 * skala, 44 * skala);
    const th = 44 * skala;
    c.fillStyle = '#1F4D2E';
    c.strokeStyle = '#FFFFFF';
    c.lineWidth = 3 * skala;
    c.beginPath();
    c.roundRect(x - tb / 2, y - th / 2, tb, th, th / 2);
    c.fill();
    c.stroke();
    c.fillStyle = '#FFFFFF';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(nr, x, y + 1);
    // Feldname darunter
    c.font = `bold ${Math.round(15 * skala)}px Helvetica, Arial, sans-serif`;
    const name = f.name;
    const nb = c.measureText(name).width + 12 * skala;
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.fillRect(x - nb / 2, y + th / 2 + 4 * skala, nb, 22 * skala);
    c.fillStyle = '#1E2A20';
    c.fillText(name, x, y + th / 2 + 15 * skala);
  }
  // Nordpfeil
  c.fillStyle = 'rgba(255,255,255,0.9)';
  c.fillRect(breite - 46 * skala, 8 * skala, 38 * skala, 46 * skala);
  c.fillStyle = '#1E2A20';
  c.font = `bold ${Math.round(16 * skala)}px Helvetica, Arial, sans-serif`;
  c.textAlign = 'center';
  c.fillText('N', breite - 27 * skala, 22 * skala);
  c.beginPath();
  c.moveTo(breite - 27 * skala, 30 * skala);
  c.lineTo(breite - 35 * skala, 48 * skala);
  c.lineTo(breite - 19 * skala, 48 * skala);
  c.closePath();
  c.fill();

  return { bild: canvas.toDataURL('image/jpeg', 0.85), breite, hoehe, luftbild: geladen > 0 };
}

// ------------------------------------------------------------------ PDF

/** Weideplan für den Tierhalter: Karte mit nummerierten Flächen und Reihenfolge mit Daten */
export async function weideplanPdf(d: WeideplanDaten): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const b = d.beweidung;
  const schritte = planSchritte(b);
  const feld = (id: string) => d.felder.find((f) => f.id === id);
  const heute = heuteIso();
  const links = 12;
  const rechts = doc.internal.pageSize.getWidth() - 12;
  const unten = doc.internal.pageSize.getHeight() - 14;

  const kopf = (titel: string) => {
    doc.setFillColor(...GRUEN);
    doc.rect(links, 12, rechts - links, 11, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(pdfText(titel), links + 3, 19.5);
    doc.setFontSize(9);
    doc.text(pdfText(betriebZeile(d.betrieb)), rechts - 3, 19.5, { align: 'right' });
    return 27;
  };
  let y = kopf('Weideplan');

  // Wer, was, wann
  doc.setTextColor(30, 42, 32);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(pdfText(`${d.partner?.name ?? ''}: ${b.anzahl} ${b.tierart}${b.gve != null ? ` (${zahl(Number(b.gve), 1)} GVE)` : ''}`), links, y + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(pdfText(`Weidezeit ${datum(b.von)} bis ${b.bis ? datum(b.bis) : 'offen'}`), links, y + 9);
  const kontakt = [d.betrieb?.name, d.betrieb?.telefon && `Tel. ${d.betrieb.telefon}`].filter(Boolean).join(' - ');
  if (kontakt) doc.text(pdfText(`Bei Fragen: ${kontakt}`), rechts, y + 9, { align: 'right' });
  y += 14;

  // Karte
  const karte = await kartenbild(d, schritte).catch(() => null);
  if (karte) {
    const maxB = rechts - links;
    const maxH = 135;
    const f = Math.min(maxB / karte.breite, maxH / karte.hoehe);
    const kb = karte.breite * f;
    const kh = karte.hoehe * f;
    doc.addImage(karte.bild, 'JPEG', links + (maxB - kb) / 2, y, kb, kh);
    doc.setDrawColor(150, 170, 150);
    doc.setLineWidth(0.3);
    doc.rect(links + (maxB - kb) / 2, y, kb, kh);
    y += kh + 3;
    doc.setFontSize(7);
    doc.setTextColor(91, 107, 94);
    doc.text(
      pdfText(`Gelb = Weideflächen, Zahl = Reihenfolge${schritte.some((s) => s.bis && s.bis < heute) ? ', grau = schon abgeweidet' : ''}.${karte.luftbild ? ' Luftbild: swisstopo.' : ''}`),
      links, y + 1,
    );
    y += 5;
  }

  // Reihenfolge
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...GRUEN);
  doc.text('Reihenfolge der Flächen', links, y + 3);
  y += 5;
  const spalten: Spalte[] = ([['Nr.', 10, true], ['Feld', 46], ['Fläche ha', 18, true], ['von', 30], ['bis', 22], ['Tage', 12, true], ['Hinweise', rechts - links - 138]] as [string, number, boolean?][]).map(
    ([titel, breite, r]) => ({ titel, breite, rechts: !!r }),
  );
  const zeilen = schritte.map((s) => {
    const f = feld(s.feld_id);
    const ganz = f && Math.abs(Number(f.flaeche_m2) - Number(s.flaeche_m2)) < 1;
    const hw = d.hinweise.filter((h) => h.feld_id === s.feld_id).map((h) => `${h.art === 'Gefahr' ? 'Achtung: ' : ''}${h.text}`);
    if (f?.bff_typ) hw.unshift(`Biodiversitätsförderfläche (${f.bff_typ})`);
    const status = s.bis && s.bis < heute ? ' (erledigt)' : s.von <= heute ? ' (jetzt)' : '';
    return [
      String(s.nr), f ? `${f.feldnummer} ${f.name}` : '?', `${zahl(Number(s.flaeche_m2) / 10000)}${ganz ? '' : ' (Teil)'}`,
      datum(s.von) + status, s.bis ? datum(s.bis) : b.bis ? datum(b.bis) : 'offen',
      s.bis || b.bis ? String(weidetage({ von: s.von, bis: s.bis ?? b.bis })) : '', hw.join('; '),
    ];
  });
  y = tabelle(doc, y, 'Nr.', spalten, zeilen, { links, unten, leer: 0, neueSeite: () => kopf('Weideplan (Fortsetzung)') });

  if (b.bemerkungen) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(30, 42, 32);
    const z = doc.splitTextToSize(pdfText(b.bemerkungen), rechts - links) as string[];
    if (y + 8 + z.length * 4 > unten) y = kopf('Weideplan (Fortsetzung)');
    doc.text('Bemerkungen', links, y + 5);
    doc.setFont('helvetica', 'normal');
    doc.text(z, links, y + 10);
    y += 10 + z.length * 4;
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(91, 107, 94);
  const fuss = doc.splitTextToSize(
    pdfText('Daten ohne Datum gelten für die ganze Weidezeit. Bitte Änderungen am Umtrieb kurz melden, damit der Plan nachgeführt werden kann.'),
    rechts - links,
  ) as string[];
  if (y + 6 < unten) doc.text(fuss, links, y + 5);

  fusszeilen(doc, `Weideplan ${d.partner?.name ?? ''} - ${betriebZeile(d.betrieb)}`);
  return doc.output('blob');
}

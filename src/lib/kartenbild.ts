/**
 * Karte als Bild für PDFs: Luftbild-Kacheln (swisstopo) mit Feldern, Farben, Schraffur und Beschriftung.
 * Fehlen Kacheln (offline, gesperrt), bleibt der Hintergrund grau – Felder und Beschriftung sind trotzdem da.
 */
import type { MultiPolygon, Polygon } from 'geojson';
import { KARTEN } from './karte';

export interface KartenFeld {
  geometrie: Polygon | MultiPolygon;
  /** Füllung (rgba) und Rand */
  fuellung?: string;
  rand?: string;
  randBreite?: number;
  /** schräge Schraffur in dieser Farbe */
  schraffur?: string;
  /** grosse Marke in der Feldmitte (z. B. Nummer) */
  marke?: string;
  markeFarbe?: string;
  /** Zeilen unter der Marke (z. B. Name, «GESPERRT») */
  zeilen?: { text: string; farbe?: string; fett?: boolean }[];
  /** gehört zum Bildausschnitt */
  imAusschnitt?: boolean;
}

const KACHEL = 256;
const lonX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z * KACHEL;
const latY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z * KACHEL;
};
export const ringe = (g: Polygon | MultiPolygon) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);

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

/** Schwerpunkt der grössten Teilfläche (Flächenformel) */
export function schwerpunkt(g: Polygon | MultiPolygon): [number, number] {
  const aussen = ringe(g).map((p) => p[0]).sort((x, y) => y.length - x.length)[0];
  let fl = 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < aussen.length - 1; i++) {
    const [x1, y1] = aussen[i];
    const [x2, y2] = aussen[i + 1];
    const k = x1 * y2 - x2 * y1;
    fl += k;
    mx += (x1 + x2) * k;
    my += (y1 + y2) * k;
  }
  if (Math.abs(fl) < 1e-14) {
    const n = Math.max(1, aussen.length - 1);
    return [aussen.slice(0, n).reduce((t, p) => t + p[0], 0) / n, aussen.slice(0, n).reduce((t, p) => t + p[1], 0) / n];
  }
  return [mx / (3 * fl), my / (3 * fl)];
}

export async function kartenbildZeichnen(
  felder: KartenFeld[],
  opt: { maxBreite?: number; maxHoehe?: number; legende?: { farbe: string; text: string; schraffur?: boolean }[] } = {},
): Promise<{ bild: string; breite: number; hoehe: number; luftbild: boolean } | null> {
  const ausschnitt = felder.filter((f) => f.imAusschnitt !== false);
  if (!ausschnitt.length) return null;
  let [w, s, o, n] = [180, 90, -180, -90];
  for (const f of ausschnitt)
    for (const poly of ringe(f.geometrie))
      for (const [lon, lat] of poly[0]) {
        w = Math.min(w, lon);
        o = Math.max(o, lon);
        s = Math.min(s, lat);
        n = Math.max(n, lat);
      }
  const rx = Math.max((o - w) * 0.08, 0.0006);
  const ry = Math.max((n - s) * 0.08, 0.0004);
  [w, o, s, n] = [w - rx, o + rx, s - ry, n + ry];
  const MAX_B = opt.maxBreite ?? 1800;
  const MAX_H = opt.maxHoehe ?? 1500;
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

  let geladen = 0;
  const kacheln: Promise<void>[] = [];
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
  const muster = (farbe: string) => {
    const m = document.createElement('canvas');
    const g = Math.round(14 * skala);
    m.width = g;
    m.height = g;
    const mc = m.getContext('2d')!;
    mc.strokeStyle = farbe;
    mc.lineWidth = 3 * skala;
    mc.beginPath();
    mc.moveTo(-1, g + 1);
    mc.lineTo(g + 1, -1);
    mc.moveTo(-1, 1);
    mc.lineTo(1, -1);
    mc.moveTo(g - 1, g + 1);
    mc.lineTo(g + 1, g - 1);
    mc.stroke();
    return c.createPattern(m, 'repeat');
  };

  // Flächen, dann Ränder (hervorgehobene zuletzt), dann Beschriftung
  for (const f of felder) {
    pfad(f.geometrie);
    if (f.fuellung) {
      c.fillStyle = f.fuellung;
      c.fill('evenodd');
    }
    if (f.schraffur) {
      const p = muster(f.schraffur);
      if (p) {
        c.fillStyle = p;
        c.fill('evenodd');
      }
    }
  }
  for (const f of [...felder].sort((a, b) => (a.randBreite ?? 1.5) - (b.randBreite ?? 1.5))) {
    pfad(f.geometrie);
    c.strokeStyle = f.rand ?? 'rgba(255,255,255,0.8)';
    c.lineWidth = (f.randBreite ?? 1.5) * skala;
    c.stroke();
  }
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  for (const f of felder) {
    if (!f.marke && !f.zeilen?.length) continue;
    const [x, y] = punkt(...schwerpunkt(f.geometrie));
    let yy = y;
    if (f.marke) {
      c.font = `bold ${Math.round(20 * skala)}px Helvetica, Arial, sans-serif`;
      const th = 34 * skala;
      const tb = Math.max(c.measureText(f.marke).width + 18 * skala, th);
      c.fillStyle = f.markeFarbe ?? '#1F4D2E';
      c.strokeStyle = '#FFFFFF';
      c.lineWidth = 2.5 * skala;
      c.beginPath();
      c.roundRect(x - tb / 2, y - th / 2, tb, th, th / 2);
      c.fill();
      c.stroke();
      c.fillStyle = '#FFFFFF';
      c.fillText(f.marke, x, y + 1);
      yy = y + th / 2 + 4 * skala;
    }
    for (const z of f.zeilen ?? []) {
      c.font = `${z.fett ? 'bold ' : ''}${Math.round(13 * skala)}px Helvetica, Arial, sans-serif`;
      const nb = c.measureText(z.text).width + 10 * skala;
      const nh = 19 * skala;
      c.fillStyle = 'rgba(255,255,255,0.92)';
      c.fillRect(x - nb / 2, yy, nb, nh);
      c.fillStyle = z.farbe ?? '#1E2A20';
      c.fillText(z.text, x, yy + nh / 2 + 1);
      yy += nh + 2 * skala;
    }
  }

  // Legende unten links
  if (opt.legende?.length) {
    c.font = `bold ${Math.round(13 * skala)}px Helvetica, Arial, sans-serif`;
    c.textAlign = 'left';
    const zh = 22 * skala;
    const lb = Math.max(...opt.legende.map((l) => c.measureText(l.text).width)) + 46 * skala;
    const lh = opt.legende.length * zh + 12 * skala;
    c.fillStyle = 'rgba(255,255,255,0.93)';
    c.fillRect(8 * skala, hoehe - lh - 8 * skala, lb, lh);
    opt.legende.forEach((l, i) => {
      const ly = hoehe - lh - 8 * skala + 6 * skala + i * zh;
      c.fillStyle = l.farbe;
      c.fillRect(16 * skala, ly + 3 * skala, 20 * skala, 15 * skala);
      if (l.schraffur) {
        const p = muster('#FFFFFF');
        if (p) {
          c.fillStyle = p;
          c.fillRect(16 * skala, ly + 3 * skala, 20 * skala, 15 * skala);
        }
      }
      c.fillStyle = '#1E2A20';
      c.fillText(l.text, 42 * skala, ly + 11 * skala);
    });
  }
  // Nordpfeil
  c.textAlign = 'center';
  c.fillStyle = 'rgba(255,255,255,0.9)';
  c.fillRect(breite - 46 * skala, 8 * skala, 38 * skala, 46 * skala);
  c.fillStyle = '#1E2A20';
  c.font = `bold ${Math.round(16 * skala)}px Helvetica, Arial, sans-serif`;
  c.fillText('N', breite - 27 * skala, 22 * skala);
  c.beginPath();
  c.moveTo(breite - 27 * skala, 30 * skala);
  c.lineTo(breite - 35 * skala, 48 * skala);
  c.lineTo(breite - 19 * skala, 48 * skala);
  c.closePath();
  c.fill();

  return { bild: canvas.toDataURL('image/jpeg', 0.85), breite, hoehe, luftbild: geladen > 0 };
}

import { area } from '@turf/area';
import type { MultiPolygon, Polygon } from 'geojson';
import type { HofobjektTyp } from './typen';

// Kartengrundlagen von swisstopo (kostenlos, Quellenangabe nötig)
export const KARTEN = {
  luftbild: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg',
  landeskarte: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
  parzellen: 'https://wmts.geo.admin.ch/1.0.0/ch.kantone.cadastralwebmap-farbe/default/current/3857/{z}/{x}/{y}.png',
};
export const QUELLE = '© <a href="https://www.swisstopo.admin.ch" target="_blank" rel="noopener">swisstopo</a>';

/** Mitte der Schweiz, falls noch nichts auf der Karte liegt */
export const SCHWEIZ = { breite: 47.38, laenge: 8.54, zoom: 11 };

/** Geodätisch berechnete Fläche in m² */
export function flaecheM2(g: Polygon | MultiPolygon): number {
  return Math.round(area({ type: 'Feature', geometry: g, properties: {} }) * 10) / 10;
}

/** Adresssuche über geo.admin.ch (Gemeinden, Adressen, Flurnamen) */
export async function ortSuchen(text: string): Promise<{ name: string; breite: number; laenge: number }[]> {
  const url = `https://api3.geo.admin.ch/rest/services/api/SearchServer?type=locations&sr=4326&limit=6&searchText=${encodeURIComponent(text)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Suche fehlgeschlagen');
  const j = (await r.json()) as { results?: { attrs: { label: string; lat: number; lon: number } }[] };
  return (j.results ?? []).map((x) => ({
    name: x.attrs.label.replace(/<[^>]*>/g, ''),
    breite: x.attrs.lat,
    laenge: x.attrs.lon,
  }));
}

const dach = (farbe: string) => `<path d="M6 20 L22 8 L38 20 Z" fill="${farbe}" stroke="#3A2A1A" stroke-width="2" stroke-linejoin="round"/>`;

/** Kleine Gebäude-Zeichnungen (44 × 44) im Hof-Stil */
export const GEBAEUDE: Record<HofobjektTyp, { farbe: string; link: string | null; svg: string }> = {
  Hof: {
    farbe: '#F6E7C8',
    link: '/',
    svg: `${dach('#C0392B')}<rect x="10" y="20" width="24" height="16" fill="#F2E3C6" stroke="#3A2A1A" stroke-width="2"/><rect x="19" y="26" width="6" height="10" fill="#8B5A2B"/><rect x="13" y="23" width="4" height="4" fill="#9EC4E0"/><rect x="27" y="23" width="4" height="4" fill="#9EC4E0"/>`,
  },
  Wohnhaus: {
    farbe: '#EAF3E6',
    link: null,
    svg: `${dach('#7A4E2A')}<rect x="11" y="20" width="22" height="16" fill="#FFFFFF" stroke="#3A2A1A" stroke-width="2"/><rect x="19" y="27" width="6" height="9" fill="#2F6B3C"/><rect x="13" y="23" width="4" height="4" fill="#9EC4E0"/>`,
  },
  Scheune: {
    farbe: '#F7E1DA',
    link: null,
    svg: `${dach('#8E2C20')}<rect x="9" y="20" width="26" height="16" fill="#C0392B" stroke="#3A2A1A" stroke-width="2"/><path d="M16 36V24h12v12M16 24l12 12M28 24L16 36" stroke="#FFFFFF" stroke-width="2" fill="none"/>`,
  },
  Lager: {
    farbe: '#E6F0F8',
    link: '/lager',
    svg: `<path d="M5 18 L22 9 L39 18 V36 H5 Z" fill="#B8C9D6" stroke="#3A2A1A" stroke-width="2" stroke-linejoin="round"/><rect x="13" y="22" width="18" height="14" fill="#5D7A90" stroke="#3A2A1A" stroke-width="2"/><path d="M13 26h18M13 30h18" stroke="#B8C9D6" stroke-width="1.5"/>`,
  },
  Düngerlager: {
    farbe: '#E3EEDD',
    link: '/lager',
    svg: `<path d="M5 18 L22 9 L39 18 V36 H5 Z" fill="#A9D18E" stroke="#3A2A1A" stroke-width="2" stroke-linejoin="round"/><path d="M14 36 C14 28 18 24 22 24 C26 24 30 28 30 36Z" fill="#F2E3C6" stroke="#3A2A1A" stroke-width="2"/>`,
  },
  Maschinenhalle: {
    farbe: '#FBEFD6',
    link: null,
    svg: `<path d="M5 36 V22 C5 13 39 13 39 22 V36 Z" fill="#D99A1E" stroke="#3A2A1A" stroke-width="2"/><rect x="12" y="24" width="20" height="12" fill="#5C3D00" stroke="#3A2A1A" stroke-width="2"/><circle cx="17" cy="33" r="2.5" fill="#F0954A"/><circle cx="27" cy="33" r="3.5" fill="#F0954A"/>`,
  },
  Silo: {
    farbe: '#EEF1F3',
    link: null,
    svg: `<rect x="14" y="13" width="16" height="23" fill="#C9D2D8" stroke="#3A2A1A" stroke-width="2"/><path d="M14 13 C14 5 30 5 30 13" fill="#8FA3AF" stroke="#3A2A1A" stroke-width="2"/><path d="M14 20h16M14 27h16" stroke="#8FA3AF" stroke-width="2"/>`,
  },
  Werkstatt: {
    farbe: '#F0ECE4',
    link: null,
    svg: `${dach('#5B6B5E')}<rect x="10" y="20" width="24" height="16" fill="#D5CDB8" stroke="#3A2A1A" stroke-width="2"/><path d="M17 33l7-7m-2-1 3 3" stroke="#3A2A1A" stroke-width="2.5" stroke-linecap="round"/>`,
  },
  Andere: {
    farbe: '#FFFFFF',
    link: null,
    svg: `<circle cx="22" cy="20" r="10" fill="#1F4D2E"/><circle cx="22" cy="20" r="4" fill="#FFFFFF"/><path d="M22 30 L22 38" stroke="#1F4D2E" stroke-width="3" stroke-linecap="round"/>`,
  },
};

const html = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function gebaeudeHtml(typ: HofobjektTyp, name: string, gewaehlt = false): string {
  const g = GEBAEUDE[typ];
  return `<div class="hof-gebaeude${gewaehlt ? ' gewaehlt' : ''}">
    <div class="hof-gebaeude-bild" style="background:${g.farbe}"><svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">${g.svg}</svg></div>
    <div class="hof-gebaeude-name">${html(name)}</div>
  </div>`;
}

export function feldLabelHtml(name: string, kultur: string | null, flaeche: string): string {
  return `<span class="hof-feld-name">${html(name)}</span><span class="hof-feld-info">${html(kultur ?? 'keine Kultur')} · ${html(flaeche)}</span>`;
}

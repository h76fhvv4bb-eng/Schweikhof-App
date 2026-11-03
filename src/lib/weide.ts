import type { Beweidung } from './typen';

const tagMs = 24 * 3600 * 1000;
const alsZeit = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const heuteIso = () => new Date().toISOString().slice(0, 10);

/** Weidetage (Beginn und Ende zählen mit), optional auf einen Zeitraum begrenzt. Offenes Ende = bis heute. */
export function weidetage(b: Pick<Beweidung, 'von' | 'bis'>, von?: string, bis?: string): number {
  const ende = b.bis ?? heuteIso();
  const a = Math.max(alsZeit(b.von), von ? alsZeit(von) : -Infinity);
  const e = Math.min(alsZeit(ende), bis ? alsZeit(bis) : Infinity);
  return e < a ? 0 : Math.round((e - a) / tagMs) + 1;
}

/** Liegt die Weide (ganz oder teilweise) im Zeitraum? */
export const imZeitraum = (b: Pick<Beweidung, 'von' | 'bis'>, von: string, bis: string) => b.von <= bis && (b.bis == null || b.bis >= von);

/** Läuft die Weide heute? */
export const aktiv = (b: Pick<Beweidung, 'von' | 'bis'>) => b.von <= heuteIso() && (b.bis == null || b.bis >= heuteIso());

export const weideHa = (b: Pick<Beweidung, 'beweidung_felder'>) => b.beweidung_felder.reduce((s, f) => s + Number(f.flaeche_m2), 0) / 10000;

/** Weidezins nach Art: Menge, Einheit, Betrag (null, wenn kein Entgelt oder Angaben fehlen) */
export function weidezins(b: Beweidung, von?: string, bis?: string): { menge: number; einheit: string; preis: number; betrag: number } | null {
  if (b.entgelt_art === 'keins' || b.entgelt_satz == null) return null;
  const preis = Number(b.entgelt_satz);
  const tage = weidetage(b, von, bis);
  let menge = 0;
  let einheit = '';
  switch (b.entgelt_art) {
    case 'pauschal':
      menge = 1;
      einheit = 'Pauschal';
      break;
    case 'je Tier und Tag':
      menge = b.anzahl * tage;
      einheit = 'Tiertage';
      break;
    case 'je GVE und Tag':
      if (b.gve == null) return null;
      menge = Math.round(Number(b.gve) * tage * 100) / 100;
      einheit = 'GVE-Tage';
      break;
    case 'je ha':
      menge = Math.round(weideHa(b) * 100) / 100;
      einheit = 'ha';
      break;
  }
  return { menge, einheit, preis, betrag: Math.round(menge * preis * 100) / 100 };
}

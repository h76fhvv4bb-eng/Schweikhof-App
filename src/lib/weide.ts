import type { Beweidung, WeideAbschnitt } from './typen';

const tagMs = 24 * 3600 * 1000;
const alsZeit = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const heuteIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** Tag davor / danach als ISO-Datum */
export const tagVerschieben = (iso: string, tage: number) => new Date(alsZeit(iso) + tage * tagMs).toISOString().slice(0, 10);

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

/** Beweidete Fläche: jedes Feld einmal (grösste erfasste Fläche), auch wenn die Tiere mehrmals darauf waren */
export const weideHa = (b: Pick<Beweidung, 'beweidung_felder'>) => {
  const je = new Map<string, number>();
  for (const f of beweidet(b)) je.set(f.feld_id, Math.max(je.get(f.feld_id) ?? 0, Number(f.flaeche_m2)));
  return [...je.values()].reduce((s, m) => s + m, 0) / 10000;
};

/** Abschnitte in der Reihenfolge des Umtriebs (gespeicherte Reihenfolge, sonst nach Datum; geplante ohne Datum am Schluss) */
export const abschnitte = (b: Pick<Beweidung, 'beweidung_felder'>): WeideAbschnitt[] =>
  [...b.beweidung_felder].sort((x, y) =>
    x.position != null && y.position != null
      ? x.position - y.position
      : Number(x.von == null) - Number(y.von == null) || (x.von ?? '').localeCompare(y.von ?? ''),
  );

/** Abschnitte mit Datum (tatsächlich beweidet bzw. fest terminiert) */
export const beweidet = (b: Pick<Beweidung, 'beweidung_felder'>): (WeideAbschnitt & { von: string })[] =>
  b.beweidung_felder.filter((f): f is WeideAbschnitt & { von: string } => f.von != null);

/** Geplante Felder ohne Datum, in ihrer Reihenfolge */
export const geplant = (b: Pick<Beweidung, 'beweidung_felder'>) => abschnitte(b).filter((f) => f.von == null);

/** Felder, auf denen die Tiere heute stehen (bei beendeter Weide: die letzten) */
export function aktuelleFelder(b: Beweidung): (WeideAbschnitt & { von: string })[] {
  const h = heuteIso();
  const jetzt = beweidet(b).filter((f) => f.von <= h && (f.bis == null || f.bis >= h));
  if (jetzt.length) return jetzt;
  const liste = abschnitte(b).filter((f): f is WeideAbschnitt & { von: string } => f.von != null && f.von <= h);
  const letzte = liste[liste.length - 1];
  return letzte ? liste.filter((f) => f.von === letzte.von) : [];
}

/** Umtrieb als Text, z. B. «A 01.05.–09.05. → B 10.05.–offen» */
export function umtriebText(b: Beweidung, feldName: (id: string) => string): string {
  const tm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
  return abschnitte(b)
    .map((f) => (f.von ? `${feldName(f.feld_id)} ${tm(f.von)}–${f.bis ? tm(f.bis) : 'offen'}` : `${feldName(f.feld_id)} (geplant)`))
    .join(' → ');
}

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

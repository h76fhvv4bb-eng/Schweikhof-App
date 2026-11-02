// Schweizer Darstellung: 1'234.56, TT.MM.JJJJ, CHF

const zahl = (stellen: number) =>
  new Intl.NumberFormat('de-CH', { minimumFractionDigits: stellen, maximumFractionDigits: stellen });

/** m² → "2.40 ha" */
export function ha(m2: number | null | undefined, stellen = 2): string {
  if (m2 == null) return '–';
  return `${zahl(stellen).format(m2 / 10000)} ha`;
}

/** Eingabe in ha ("2.4" oder "2,4") → m². Gibt null bei ungültiger Eingabe. */
export function haZuM2(eingabe: string): number | null {
  const wert = Number(eingabe.trim().replace(/['’\s]/g, '').replace(',', '.'));
  if (!Number.isFinite(wert) || wert <= 0) return null;
  return Math.round(wert * 10000 * 10) / 10;
}

export function m2(wert: number | null | undefined): string {
  if (wert == null) return '–';
  return `${zahl(0).format(wert)} m²`;
}

export function chf(betrag: number | null | undefined): string {
  if (betrag == null) return '–';
  return `CHF ${zahl(2).format(betrag)}`;
}

/** ISO-Datum oder Date → "02.11.2026" */
export function datum(d: string | Date | null | undefined): string {
  if (!d) return '–';
  const x = typeof d === 'string' ? new Date(d.length === 10 ? `${d}T12:00:00` : d) : d;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(x.getDate())}.${p(x.getMonth() + 1)}.${x.getFullYear()}`;
}

const wochentage = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
export function wochentagDatum(d = new Date()): string {
  return `${wochentage[d.getDay()]}, ${datum(d)}`;
}

/** Menge mit Einheit, bis 2 Nachkommastellen: "1'234.5 kg" */
export function menge(wert: number | null | undefined, einheit = ''): string {
  if (wert == null) return '–';
  const t = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 2 }).format(wert);
  return einheit ? `${t} ${einheit}` : t;
}

/** Zahl aus Eingabe ("1'200,5" → 1200.5), null wenn leer/ungültig */
export function zahlAus(eingabe: string): number | null {
  const s = eingabe.trim().replace(/['’\s]/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function heuteIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

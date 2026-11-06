import type { Betrieb, Feld } from './typen';

export const BFF_TYPEN = [
  'Extensiv genutzte Wiese', 'Wenig intensiv genutzte Wiese', 'Extensiv genutzte Weide', 'Waldweide', 'Streuefläche', 'Uferwiese',
  'Hecke mit Krautsaum', 'Buntbrache', 'Rotationsbrache', 'Saum auf Ackerfläche', 'Andere BFF',
] as const;
export type BffTyp = (typeof BFF_TYPEN)[number];
export const ZONEN = ['Talzone', 'Hügelzone', 'Bergzone I', 'Bergzone II', 'Bergzone III', 'Bergzone IV'] as const;

/** Kurzname für die Karte */
export const BFF_KURZ: Record<BffTyp, string> = {
  'Extensiv genutzte Wiese': 'Extensive Wiese',
  'Wenig intensiv genutzte Wiese': 'Wenig int. Wiese',
  'Extensiv genutzte Weide': 'Extensive Weide',
  Waldweide: 'Waldweide',
  Streuefläche: 'Streuefläche',
  Uferwiese: 'Uferwiese',
  'Hecke mit Krautsaum': 'Hecke',
  Buntbrache: 'Buntbrache',
  Rotationsbrache: 'Rotationsbrache',
  'Saum auf Ackerfläche': 'Saum',
  'Andere BFF': 'BFF',
};

/** Arbeiten, die als Schnitt bzw. Nutzung gelten */
export const SCHNITTARBEITEN: readonly string[] = ['Mähen', 'Zetten', 'Wenden', 'Schwaden', 'Pressen', 'Ernten', 'Mulchen'];

/**
 * Frühester Schnitt (Monat-Tag) nach DZV Anhang 4 als Richtwert:
 * Wiesen (extensiv, wenig intensiv), Uferwiesen und Krautsaum von Hecken: Tal- und Hügelzone 15. Juni,
 * Bergzone I und II 1. Juli, Bergzone III und IV 15. Juli; Streueflächen 1. September.
 * Ein am Feld eingetragener Termin (Vernetzung, Vereinbarung) geht vor.
 */
export function schnittAb(feld: Pick<Feld, 'bff_typ' | 'schnitt_ab'>, zone: Betrieb['zone'] | null | undefined): string | null {
  if (feld.schnitt_ab) return feld.schnitt_ab;
  switch (feld.bff_typ) {
    case 'Extensiv genutzte Wiese':
    case 'Wenig intensiv genutzte Wiese':
    case 'Uferwiese':
    case 'Hecke mit Krautsaum':
      if (zone === 'Bergzone I' || zone === 'Bergzone II') return '07-01';
      if (zone === 'Bergzone III' || zone === 'Bergzone IV') return '07-15';
      return '06-15';
    case 'Streuefläche':
      return '09-01';
    default:
      return null;
  }
}

export const tagMonatText = (md: string) => `${md.slice(3, 5)}.${md.slice(0, 2)}.`;

/** Hinweise zu einer Arbeit auf einem BFF-Feld (nur Hinweise, keine Sperre) */
export function bffHinweise(feld: Pick<Feld, 'name' | 'bff_typ' | 'schnitt_ab'>, zone: Betrieb['zone'] | null | undefined, arbeitsart: string, datum: string): string[] {
  if (!feld.bff_typ) return [];
  const h: string[] = [];
  const ab = schnittAb(feld, zone);
  if (ab && SCHNITTARBEITEN.includes(arbeitsart) && datum.slice(5) < ab)
    h.push(`«${feld.name}» (${feld.bff_typ}): Schnitt frühestens ab ${tagMonatText(ab)}${feld.schnitt_ab ? ' (am Feld eingetragen)' : ''}.`);
  if (arbeitsart === 'Mulchen' && ['Extensiv genutzte Wiese', 'Wenig intensiv genutzte Wiese', 'Uferwiese', 'Streuefläche', 'Buntbrache', 'Rotationsbrache', 'Saum auf Ackerfläche'].includes(feld.bff_typ))
    h.push(`«${feld.name}»: Mulchen ist auf dieser BFF in der Regel nicht vorgesehen. Vorgaben prüfen.`);
  if (arbeitsart === 'Düngen') {
    if (['Extensiv genutzte Wiese', 'Uferwiese', 'Streuefläche', 'Extensiv genutzte Weide', 'Waldweide', 'Buntbrache', 'Rotationsbrache', 'Saum auf Ackerfläche', 'Hecke mit Krautsaum'].includes(feld.bff_typ))
      h.push(`«${feld.name}» (${feld.bff_typ}): Düngung ist hier nicht vorgesehen.`);
    else if (feld.bff_typ === 'Wenig intensiv genutzte Wiese') h.push(`«${feld.name}»: nur beschränkte Düngung (z. B. Mist, Kompost) erlaubt. Vorgaben prüfen.`);
  }
  if (arbeitsart === 'Pflanzenschutz') h.push(`«${feld.name}» (BFF): Pflanzenschutz in der Regel nur als Einzelstock- bzw. Nesterbehandlung. Vorgaben prüfen.`);
  return h;
}

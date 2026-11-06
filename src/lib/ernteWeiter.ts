import { LEISTUNGEN } from './typen';

/** Leistung bei der Ernte passend zur Arbeitsart */
export function leistungAus(arbeitsart: string | null | undefined): (typeof LEISTUNGEN)[number] {
  if (arbeitsart && (LEISTUNGEN as readonly string[]).includes(arbeitsart)) return arbeitsart as (typeof LEISTUNGEN)[number];
  return arbeitsart === 'Ernten' ? 'Ernte' : 'Andere';
}

/**
 * Link zur Ernte-Erfassung, vorbelegt aus der erledigten Arbeit: Feld(er) mit Fläche, Datum und – bei Lohnarbeit –
 * Dienstleister mit Kosten. Ein Feld → Ernte erfassen, mehrere → Sammelerfassung.
 */
export function ernteLink(a: {
  felder: { feld_id: string; flaeche_m2: number | null }[];
  datum: string;
  arbeitsart?: string | null;
  partner_id?: string | null;
  kosten?: number | null;
}): string {
  const q = new URLSearchParams({ datum: a.datum });
  if (a.partner_id) {
    q.set('dl_partner', a.partner_id);
    q.set('dl_leistung', leistungAus(a.arbeitsart));
    if (a.kosten != null) q.set('dl_kosten', String(a.kosten));
  }
  const ha = (m2: number | null) => (m2 != null ? String(Math.round((Number(m2) / 10000) * 10000) / 10000) : '');
  if (a.felder.length === 1) {
    q.set('feld', a.felder[0].feld_id);
    if (a.felder[0].flaeche_m2 != null) q.set('ha', ha(a.felder[0].flaeche_m2));
    return `/ernte/neu?${q.toString()}`;
  }
  q.set('felder', a.felder.map((f) => `${f.feld_id}:${ha(f.flaeche_m2)}`).join(','));
  return `/ernte/sammel?${q.toString()}`;
}

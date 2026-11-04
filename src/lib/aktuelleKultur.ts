import type { Anbau } from './typen';

/** Was jetzt auf dem Feld wächst – unabhängig davon, zu welchem Anbaujahr die Kultur gehört */
export interface AktuelleKultur {
  eintrag: Anbau;
  /** wächst gerade (gesät bzw. Saattermin erreicht, noch nicht geerntet) */
  laeuft: boolean;
  /** Kultur gehört nicht zum laufenden Kalenderjahr (z. B. Herbstsaat für das nächste Jahr) */
  folgejahr: boolean;
  /** Hauptkultur des laufenden Jahres, falls eine andere Kultur angezeigt wird */
  hauptkultur: Anbau | null;
  seit: string | null;
}

const heuteIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const monatsEnde = (iso: string) => {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0));
  return d.toISOString().slice(0, 10);
};

/** Beginn: Saatdatum (bei «nur Monat» der Monatserste) */
export const beginn = (a: Anbau) => (a.saatdatum ? (a.nur_monat ? `${a.saatdatum.slice(0, 7)}-01` : a.saatdatum) : null);
/** Ende: Ernte/Umbruch (bei «nur Monat» das Monatsende) */
export const ende = (a: Anbau) => (a.erntedatum ? (a.nur_monat ? monatsEnde(a.erntedatum) : a.erntedatum) : null);

/**
 * Bestimmt die aktuelle Kultur eines Feldes aus seinen Anbau-Einträgen (Vorjahr bis Folgejahr, alle Arten).
 * Gesät oder Saattermin erreicht → diese Kultur gilt jetzt, auch wenn sie zum nächsten Anbaujahr gehört
 * (z. B. Kunstwiese im September gesät für das nächste Jahr). Die Hauptkultur des Jahres bleibt in den Daten.
 */
export function aktuelleKultur(eintraege: Anbau[], heute = heuteIso()): AktuelleKultur | null {
  const jahr = Number(heute.slice(0, 4));
  const hauptJahr = eintraege.find((a) => a.art === 'Hauptkultur' && a.jahr === jahr) ?? null;
  const gestartet = eintraege
    .filter((a) => {
      const b = beginn(a);
      const e = ende(a);
      if (b) return b <= heute && (!e || e >= heute);
      // ohne Saatdatum: Hauptkultur des laufenden Jahres gilt, solange nicht geerntet
      return a.art === 'Hauptkultur' && a.jahr === jahr && (!e || e >= heute);
    })
    // die zuletzt gesäte zuerst; ohne Saatdatum zuletzt; Haupt- vor Zwischenkultur
    .sort((x, y) => (beginn(y) ?? '0000').localeCompare(beginn(x) ?? '0000') || Number(y.art === 'Hauptkultur') - Number(x.art === 'Hauptkultur'));
  const laufend = gestartet[0];
  if (laufend)
    return {
      eintrag: laufend,
      laeuft: true,
      folgejahr: laufend.jahr > jahr,
      hauptkultur: hauptJahr && hauptJahr.id !== laufend.id ? hauptJahr : null,
      seit: beginn(laufend),
    };
  // nichts wächst (z. B. zwischen Ernte und nächster Saat): Hauptkultur des Jahres, sonst zuletzt geerntete
  if (hauptJahr) return { eintrag: hauptJahr, laeuft: false, folgejahr: false, hauptkultur: null, seit: beginn(hauptJahr) };
  const vorher = eintraege
    .filter((a) => (ende(a) ?? '9999') < heute)
    .sort((x, y) => (ende(y) ?? '').localeCompare(ende(x) ?? ''))[0];
  return vorher ? { eintrag: vorher, laeuft: false, folgejahr: false, hauptkultur: null, seit: beginn(vorher) } : null;
}

/** Aktuelle Kultur je Feld */
export function aktuelleKulturJeFeld(anbau: Anbau[], heute?: string): Map<string, AktuelleKultur> {
  const jeFeld = new Map<string, Anbau[]>();
  for (const a of anbau) jeFeld.set(a.feld_id, [...(jeFeld.get(a.feld_id) ?? []), a]);
  const m = new Map<string, AktuelleKultur>();
  for (const [feld, liste] of jeFeld) {
    const k = aktuelleKultur(liste, heute);
    if (k) m.set(feld, k);
  }
  return m;
}

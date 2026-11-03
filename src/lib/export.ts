import { datum } from './format';

let betriebKopf = '';
/** Wird beim Laden der Betriebsdaten gesetzt: Name und Betriebsnummer erscheinen in jedem Export */
export function exportBetrieb(b: { name: string; betriebsnummer?: string | null } | null | undefined) {
  betriebKopf = b ? [b.name, b.betriebsnummer && `Betriebsnr. ${b.betriebsnummer}`].filter(Boolean).join(' · ') : '';
}

/** CSV mit Semikolon und UTF-8-Kennung: öffnet sich in Excel (CH) direkt korrekt. */
export function csvHerunterladen(dateiname: string, titel: string, kopf: string[], zeilen: (string | number | null)[][]) {
  const alle = [[titel], ...(betriebKopf && !titel.includes(betriebKopf) ? [[betriebKopf]] : []), [`Erstellt am ${datum(new Date())}`], [], kopf, ...zeilen];
  const text = alle
    .map((z) => z.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = dateiname;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Zahl für CSV im Excel-CH-Format (Punkt als Dezimaltrennzeichen, ohne Tausender) */
export const csvZahl = (n: number | null | undefined, stellen = 2) => (n == null ? '' : Number(n).toFixed(stellen));

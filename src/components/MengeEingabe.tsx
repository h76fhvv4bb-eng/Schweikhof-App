import { ha, menge, zahlAus } from '../lib/format';

/** Menge pro ha als Text, aus Gesamtmenge und Fläche */
export const proHaAusTotal = (total: string, m2: number) => {
  const t = zahlAus(total);
  if (t == null || m2 <= 0) return '';
  return String(Math.round((t / (m2 / 10000)) * 10000) / 10000);
};

/**
 * Menge eines Betriebsmittels: entweder pro ha oder als Total für alle gewählten Flächen.
 * Beim Total wird die Menge nach Fläche auf die Felder aufgeteilt (gespeichert wird immer die Menge pro ha).
 */
export function MengeEingabe({
  proHa,
  total,
  einheit,
  flaecheM2,
  felder,
  onChange,
}: {
  proHa: string;
  /** gesetzt = Eingabe als Total */
  total: string | undefined;
  einheit: string;
  flaecheM2: number;
  /** gewählte Felder mit Fläche (für die Aufteilung) */
  felder: { name: string; m2: number }[];
  onChange: (w: { menge_je_ha: string; total: string | undefined }) => void;
}) {
  const alsTotal = total !== undefined;
  const jeHa = zahlAus(proHa) ?? 0;
  const gesamt = (jeHa * flaecheM2) / 10000;
  const runden = (x: number) => String(Math.round(x * 100) / 100);
  const ohneFlaeche = flaecheM2 <= 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#E7E1D0] p-1" role="group" aria-label="Menge eingeben als">
        {(
          [
            [false, `pro ha`],
            [true, `Total`],
          ] as const
        ).map(([t, text]) => (
          <button
            key={text}
            type="button"
            aria-pressed={alsTotal === t}
            disabled={t && ohneFlaeche}
            onClick={() =>
              alsTotal !== t && onChange(t ? { menge_je_ha: proHa, total: gesamt ? runden(gesamt) : '' } : { menge_je_ha: proHa, total: undefined })
            }
            className={`min-h-10 rounded-lg text-sm font-extrabold ${alsTotal === t ? 'bg-white text-hof shadow-sm' : 'text-[#4D5B50]'}`}
          >
            {text}
          </button>
        ))}
      </div>
      <label className="feld-label">
        {alsTotal ? `Total auf ${ha(flaecheM2)}` : 'Menge pro ha'}
        <span className="flex items-center gap-2">
          <input
            className="eingabe w-full"
            inputMode="decimal"
            value={alsTotal ? total : proHa}
            onChange={(e) =>
              onChange(
                alsTotal
                  ? { menge_je_ha: proHaAusTotal(e.target.value, flaecheM2), total: e.target.value }
                  : { menge_je_ha: e.target.value, total: undefined },
              )
            }
          />
          <span className="min-w-12 shrink-0 text-sm font-bold">
            {einheit}
            {alsTotal ? '' : '/ha'}
          </span>
        </span>
      </label>
      {jeHa > 0 && (
        <span className="text-xs font-semibold text-hof">
          {alsTotal ? `= ${menge(Math.round(jeHa * 100) / 100)} ${einheit}/ha` : `= ${menge(Math.round(gesamt * 100) / 100)} ${einheit} total auf ${ha(flaecheM2)}`}
        </span>
      )}
      {alsTotal && jeHa > 0 && felder.length > 1 && (
        <div className="flex flex-col gap-0.5 rounded-xl bg-white/70 p-2 text-xs">
          <span className="font-bold text-leise">Aufteilung nach Fläche</span>
          {felder.map((f) => (
            <span key={f.name} className="flex justify-between gap-2">
              <span className="truncate">
                {f.name} <span className="text-leise">({ha(f.m2)})</span>
              </span>
              <b className="shrink-0">
                {menge(Math.round(((jeHa * f.m2) / 10000) * 100) / 100)} {einheit}
              </b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

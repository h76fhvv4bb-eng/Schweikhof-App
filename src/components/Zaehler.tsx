import { menge, zahlAus } from '../lib/format';
import { MIT_MOTOR, type Maschine } from '../lib/typen';

/** Stunden- und Kilometerzähler einer Maschine erfassen (bisheriger Stand als Hinweis) */
export function ZaehlerFelder({
  maschine,
  stunden,
  km,
  onStunden,
  onKm,
}: {
  maschine: Maschine;
  stunden: string;
  km: string;
  onStunden: (v: string) => void;
  onKm?: (v: string) => void;
}) {
  const motor = MIT_MOTOR.includes(maschine.kategorie);
  return (
    <div className="grid grid-cols-2 gap-2 rounded-2xl bg-grund p-3">
      <span className="col-span-2 text-sm font-extrabold">{maschine.name}</span>
      <label className="feld-label">
        Stundenzähler
        <input
          className="eingabe"
          inputMode="decimal"
          value={stunden}
          onChange={(e) => onStunden(e.target.value)}
          placeholder={maschine.betriebsstunden != null ? `bisher ${menge(Number(maschine.betriebsstunden))}` : 'h'}
        />
      </label>
      {motor && onKm && (
        <label className="feld-label">
          Kilometer
          <input
            className="eingabe"
            inputMode="decimal"
            value={km}
            onChange={(e) => onKm(e.target.value)}
            placeholder={maschine.kilometerstand != null ? `bisher ${menge(Number(maschine.kilometerstand))}` : 'km'}
          />
        </label>
      )}
    </div>
  );
}

export function pruefeZaehler(wert: string, bisher: number | null | undefined, name: string): string | null {
  const z = zahlAus(wert);
  if (wert.trim() && (z == null || z < 0)) return `Zählerstand bei ${name} ungültig.`;
  if (z != null && bisher != null && z < Number(bisher)) return `Der Zähler bei ${name} ist kleiner als bisher (${menge(Number(bisher))}). Bitte prüfen.`;
  return null;
}


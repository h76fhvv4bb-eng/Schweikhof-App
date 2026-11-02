import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useLager } from '../lib/daten';
import { DUENGER_KATALOG } from '../lib/duengerKatalog';

/** Gängige Dünger auswählen und als Lagerartikel anlegen */
export function DuengerKatalog({ onFertig }: { onFertig: () => void }) {
  const { profil } = useAuth();
  const qc = useQueryClient();
  const lager = useLager();
  const vorhanden = new Set((lager.data ?? []).map((a) => a.bezeichnung.toLowerCase()));
  const [wahl, setWahl] = useState<string[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const gruppen = [...new Set(DUENGER_KATALOG.map((d) => d.gruppe))];

  async function uebernehmen() {
    setFehler(null);
    const zeilen = DUENGER_KATALOG.filter((d) => wahl.includes(d.bezeichnung)).map((d) => ({
      betrieb_id: profil!.betrieb_id,
      bezeichnung: d.bezeichnung,
      kategorie: 'Dünger',
      einheit: 'kg',
      n_je_einheit: d.n != null ? d.n / 100 : null,
      p2o5_je_einheit: d.p2o5 != null ? d.p2o5 / 100 : null,
      k2o_je_einheit: d.k2o != null ? d.k2o / 100 : null,
      mg_je_einheit: d.mg != null ? d.mg / 100 : null,
      s_je_einheit: d.s != null ? d.s / 100 : null,
      naehrstoffquelle: 'Richtwert',
      bemerkungen: 'Aus Dünger-Katalog übernommen. Gehalte mit der Deklaration auf dem Sack vergleichen.',
    }));
    if (!zeilen.length) return setFehler('Bitte mindestens einen Dünger wählen.');
    const { error } = await supabase.from('lagerartikel').insert(zeilen);
    if (error) return setFehler(fehlertext(error));
    qc.invalidateQueries({ queryKey: ['lager'] });
    onFertig();
  }

  return (
    <section className="karte flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-lg font-extrabold">Dünger aus Katalog übernehmen</h2>
        <button className="text-sm font-bold text-leise" onClick={onFertig}>
          Schliessen
        </button>
      </div>
      <p className="m-0 text-sm text-leise">
        Standard-Gehalte gängiger Mineraldünger. Nach dem Übernehmen Preis und Mindestbestand ergänzen und die Gehalte mit der Deklaration
        vergleichen.
      </p>
      {gruppen.map((g) => (
        <div key={g} className="flex flex-col gap-1">
          <span className="text-xs font-extrabold text-leise">{g.toUpperCase()}</span>
          {DUENGER_KATALOG.filter((d) => d.gruppe === g).map((d) => {
            const schonDa = vorhanden.has(d.bezeichnung.toLowerCase());
            return (
              <label key={d.bezeichnung} className={`flex min-h-11 items-center gap-3 text-sm font-bold ${schonDa ? 'opacity-50' : ''}`}>
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-hof"
                  disabled={schonDa}
                  checked={wahl.includes(d.bezeichnung)}
                  onChange={(e) => setWahl(e.target.checked ? [...wahl, d.bezeichnung] : wahl.filter((x) => x !== d.bezeichnung))}
                />
                <span className="flex-1">{d.bezeichnung}</span>
                {schonDa && <span className="text-xs">schon im Lager</span>}
              </label>
            );
          })}
        </div>
      ))}
      {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
      <button className="knopf" onClick={uebernehmen} disabled={!wahl.length}>
        {wahl.length || ''} Dünger ins Lager übernehmen
      </button>
    </section>
  );
}

import { useState } from 'react';
import { useAnbau, useBetrieb, useFelder, useNaehrstoffe } from '../lib/daten';
import { ha, menge } from '../lib/format';
import { csvHerunterladen, csvZahl } from '../lib/export';
import type { NaehrstoffeJeFeld } from '../lib/typen';

const leer = { n_kg_ha: 0, p2o5_kg_ha: 0, k2o_kg_ha: 0, n_kg: 0, p2o5_kg: 0, k2o_kg: 0, anzahl_gaben: 0 };

export function Naehrstoffe() {
  const [jahr, setJahr] = useState(new Date().getFullYear());
  const felder = useFelder();
  const anbau = useAnbau(jahr, jahr);
  const daten = useNaehrstoffe(jahr);
  const betrieb = useBetrieb();

  const wert = (feldId: string, status: 'erledigt' | 'geplant'): Omit<NaehrstoffeJeFeld, 'feld_id' | 'jahr' | 'status' | 'mg_kg_ha'> =>
    (daten.data ?? []).find((d) => d.feld_id === feldId && d.status === status) ?? leer;
  const kultur = (feldId: string) => anbau.data?.find((a) => a.feld_id === feldId)?.kulturen?.name ?? '–';
  const zeilen = (felder.data ?? []).filter((f) => f.status === 'bewirtschaftet');
  const maxN = Math.max(1, ...zeilen.map((f) => Number(wert(f.id, 'erledigt').n_kg_ha) + Number(wert(f.id, 'geplant').n_kg_ha)));
  const summe = (k: 'n_kg' | 'p2o5_kg' | 'k2o_kg', s: 'erledigt' | 'geplant') => zeilen.reduce((x, f) => x + Number(wert(f.id, s)[k]), 0);

  function exportieren() {
    csvHerunterladen(
      `naehrstoffe_${jahr}.csv`,
      `${betrieb.data?.name ?? 'Betrieb'} · Ausgebrachte Nährstoffe ${jahr} (aus erfassten Düngungen, kein Bodenvorrat)`,
      ['Feld', 'Kultur', 'Fläche ha', 'N kg/ha', 'P2O5 kg/ha', 'K2O kg/ha', 'N kg', 'P2O5 kg', 'K2O kg', 'Gaben', 'N geplant kg/ha'],
      zeilen.map((f) => {
        const e = wert(f.id, 'erledigt');
        return [f.name, kultur(f.id), csvZahl(Number(f.flaeche_m2) / 10000), csvZahl(e.n_kg_ha, 1), csvZahl(e.p2o5_kg_ha, 1), csvZahl(e.k2o_kg_ha, 1),
          csvZahl(e.n_kg, 1), csvZahl(e.p2o5_kg, 1), csvZahl(e.k2o_kg, 1), e.anzahl_gaben, csvZahl(wert(f.id, 'geplant').n_kg_ha, 1)];
      }),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-leise">Aus erfassten Düngungen · kein Bodenvorrat</span>
          <h1 className="m-0 text-3xl font-extrabold text-hof">Nährstoffe {jahr}</h1>
        </div>
        <div className="flex gap-2">
          <select className="eingabe" value={jahr} onChange={(e) => setJahr(Number(e.target.value))} aria-label="Jahr">
            {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() + 1 - i).map((j) => (
              <option key={j}>{j}</option>
            ))}
          </select>
          <button className="knopf-leise" onClick={exportieren}>
            Excel (CSV)
          </button>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ['N', 'n_kg'],
            ['P₂O₅', 'p2o5_kg'],
            ['K₂O', 'k2o_kg'],
          ] as const
        ).map(([name, k]) => (
          <div key={k} className="karte flex flex-col p-3">
            <span className="text-xs font-bold text-leise">{name} ausgebracht</span>
            <span className="text-2xl font-extrabold">{menge(Math.round(summe(k, 'erledigt')))} kg</span>
            {summe(k, 'geplant') > 0 && <span className="text-xs text-leise">+ {menge(Math.round(summe(k, 'geplant')))} kg geplant</span>}
          </div>
        ))}
      </div>

      <div className="karte overflow-x-auto p-2">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-leise">
              <th scope="col" className="p-2">Feld</th>
              <th scope="col" className="p-2">Kultur</th>
              <th scope="col" className="p-2 text-right">ha</th>
              <th scope="col" className="w-[30%] p-2">N kg/ha (dunkel = ausgebracht, hell = geplant)</th>
              <th scope="col" className="p-2 text-right">P₂O₅ kg/ha</th>
              <th scope="col" className="p-2 text-right">K₂O kg/ha</th>
              <th scope="col" className="p-2 text-right">Gaben</th>
            </tr>
          </thead>
          <tbody>
            {zeilen.map((f) => {
              const e = wert(f.id, 'erledigt');
              const g = wert(f.id, 'geplant');
              return (
                <tr key={f.id} className="border-t border-rand">
                  <th scope="row" className="p-2 text-left font-extrabold">{f.name}</th>
                  <td className="p-2">{kultur(f.id)}</td>
                  <td className="p-2 text-right">{ha(Number(f.flaeche_m2)).replace(' ha', '')}</td>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-3 flex-1 overflow-hidden rounded-full bg-grund">
                        <div className="h-full bg-hof" style={{ width: `${(Number(e.n_kg_ha) / maxN) * 100}%` }} />
                        <div className="h-full bg-[#A9D18E]" style={{ width: `${(Number(g.n_kg_ha) / maxN) * 100}%` }} />
                      </div>
                      <span className="w-12 text-right font-extrabold">{menge(Number(e.n_kg_ha))}</span>
                    </div>
                  </td>
                  <td className="p-2 text-right">{menge(Number(e.p2o5_kg_ha))}</td>
                  <td className="p-2 text-right">{menge(Number(e.k2o_kg_ha))}</td>
                  <td className="p-2 text-right">{e.anzahl_gaben}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="m-0 text-xs text-leise">
        Gezeigt werden die mit den Düngern ausgebrachten Nährstoffmengen nach hinterlegtem Gehalt. Das ist weder ein Bodenvorrat noch eine
        Suisse-Bilanz. Für die Nährstoffbilanz bleiben die offiziellen Berechnungen massgebend.
      </p>
    </div>
  );
}

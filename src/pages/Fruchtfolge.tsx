import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useAnbau, useFelder, useKulturen } from '../lib/daten';
import { hinweiseFuerJahr } from '../lib/fruchtfolgeRegeln';
import { datum, ha } from '../lib/format';
import type { Anbau, Kultur } from '../lib/typen';
import { Icon } from '../components/Icon';

const JAHRE_ZURUECK = 2;
const JAHRE_VOR = 2;

export function Fruchtfolge() {
  const { profil, darfVerwalten } = useAuth();
  const qc = useQueryClient();
  const aktuell = new Date().getFullYear();
  const [start, setStart] = useState(aktuell - JAHRE_ZURUECK);
  const jahre = Array.from({ length: JAHRE_ZURUECK + JAHRE_VOR + 1 }, (_, i) => start + i);
  // Für Hinweise braucht es auch die Jahre vor dem sichtbaren Bereich.
  const felder = useFelder();
  const kulturen = useKulturen();
  const anbau = useAnbau(start - 5, jahre[jahre.length - 1]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [speichert, setSpeichert] = useState<string | null>(null);

  const kulturById = useMemo(() => new Map((kulturen.data ?? []).map((k) => [k.id, k])), [kulturen.data]);
  const zelle = useMemo(() => {
    const m = new Map<string, Anbau>();
    for (const a of anbau.data ?? []) m.set(`${a.feld_id}|${a.jahr}`, a);
    return m;
  }, [anbau.data]);

  const sichtbareFelder = (felder.data ?? []).filter((f) => f.status !== 'aufgegeben');

  async function setzeKultur(feldId: string, jahr: number, kulturId: string) {
    setFehler(null);
    const schluessel = `${feldId}|${jahr}`;
    const bestehend = zelle.get(schluessel);
    setSpeichert(schluessel);
    try {
      if (!kulturId) {
        if (bestehend) {
          // Ist-Kulturen sind Dokumentation und werden nie gelöscht (auch die Datenbank verhindert das).
          if (bestehend.status === 'ist')
            throw new Error('Erfasste Ist-Kulturen werden nicht gelöscht. Bitte stattdessen die richtige Kultur wählen.');
          const { error } = await supabase.from('anbau').delete().eq('id', bestehend.id);
          if (error) throw error;
        }
      } else if (bestehend) {
        const { error } = await supabase
          .from('anbau')
          .update({ kultur_id: kulturId, version: bestehend.version })
          .eq('id', bestehend.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('anbau').insert({
          betrieb_id: profil!.betrieb_id,
          feld_id: feldId,
          kultur_id: kulturId,
          jahr,
          art: 'Hauptkultur',
          status: jahr <= aktuell ? 'ist' : 'geplant',
        });
        if (error) throw error;
      }
    } catch (e) {
      setFehler(fehlertext(e));
    } finally {
      setSpeichert(null);
      qc.invalidateQueries({ queryKey: ['anbau'] });
      qc.invalidateQueries({ queryKey: ['flaeche_je_kultur'] });
    }
  }

  // Flächen je Kultur für jedes sichtbare Jahr
  const summen = jahre.map((j) => {
    const m = new Map<string, number>();
    for (const f of sichtbareFelder) {
      const a = zelle.get(`${f.id}|${j}`);
      if (a) m.set(a.kultur_id, (m.get(a.kultur_id) ?? 0) + Number(f.flaeche_m2));
    }
    return m;
  });
  const genutzteKulturen = [...new Set(summen.flatMap((m) => [...m.keys()]))]
    .map((id) => kulturById.get(id))
    .filter((k): k is Kultur => !!k);

  function exportCsv() {
    const zeilen = [['Feldnr', 'Feld', 'Fläche ha', ...jahre.map(String)]];
    for (const f of sichtbareFelder)
      zeilen.push([
        f.feldnummer,
        f.name,
        (Number(f.flaeche_m2) / 10000).toFixed(2),
        ...jahre.map((j) => kulturById.get(zelle.get(`${f.id}|${j}`)?.kultur_id ?? '')?.name ?? ''),
      ]);
    const kopf = [`Fruchtfolge ${jahre[0]}–${jahre[jahre.length - 1]}`, `Erstellt ${datum(new Date())}`];
    const text = [kopf, [], ...zeilen].map((z) => z.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fruchtfolge_${jahre[0]}-${jahre[jahre.length - 1]}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-leise">Kultur je Feld und Jahr · Hinweise sind Empfehlungen</span>
          <h1 className="m-0 text-3xl font-extrabold text-hof">
            Fruchtfolge {jahre[0]}–{jahre[jahre.length - 1]}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="knopf-leise h-11 w-11 px-0" aria-label="Frühere Jahre" onClick={() => setStart(start - 1)}>
            <Icon name="zurueck" />
          </button>
          <button className="knopf-leise h-11 w-11 px-0" aria-label="Spätere Jahre" onClick={() => setStart(start + 1)}>
            <Icon name="weiter" />
          </button>
          <button className="knopf-leise" onClick={exportCsv}>
            Export Excel (CSV)
          </button>
        </div>
      </header>

      {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}

      {sichtbareFelder.length === 0 && felder.isSuccess && (
        <p className="karte m-0">
          Noch keine Felder. <Link to="/felder/neu">Erstes Feld anlegen</Link>
        </p>
      )}

      <div className="karte overflow-x-auto p-2">
        <table className="w-full min-w-[680px] border-separate border-spacing-1.5 text-sm">
          <thead>
            <tr>
              <th scope="col" className="px-2 py-1 text-left text-xs font-extrabold text-leise">
                Feld
              </th>
              {jahre.map((j) => (
                <th
                  key={j}
                  scope="col"
                  className={`rounded-xl px-2 py-1 text-xs font-extrabold ${j === aktuell ? 'bg-hof text-white' : 'text-leise'}`}
                >
                  {j}
                  <br />
                  <span className="font-semibold">{j < aktuell ? 'Ist' : j === aktuell ? 'aktuell' : 'Plan'}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sichtbareFelder.map((f) => {
              const folge = new Map<number, Kultur>();
              for (let j = start - 5; j <= jahre[jahre.length - 1]; j++) {
                const k = kulturById.get(zelle.get(`${f.id}|${j}`)?.kultur_id ?? '');
                if (k) folge.set(j, k);
              }
              return (
                <tr key={f.id}>
                  <th scope="row" className="whitespace-nowrap px-2 text-left">
                    <span className="block text-[15px] font-extrabold">{f.name}</span>
                    <span className="text-xs font-semibold text-leise">{ha(Number(f.flaeche_m2))}</span>
                  </th>
                  {jahre.map((j) => {
                    const a = zelle.get(`${f.id}|${j}`);
                    const k = a ? kulturById.get(a.kultur_id) : undefined;
                    const hinweise = hinweiseFuerJahr(folge, j);
                    const schluessel = `${f.id}|${j}`;
                    return (
                      <td key={j} className="p-0 align-top">
                        <label
                          className="relative flex min-h-[52px] items-center justify-center gap-1 rounded-xl px-2 text-center font-extrabold"
                          style={{
                            background: k?.farbe ?? '#F4F1E8',
                            opacity: j < aktuell ? 0.75 : 1,
                            border: hinweise.length ? '3px solid #A35A00' : j === aktuell ? '3px solid #1F4D2E' : '3px solid transparent',
                          }}
                          title={hinweise.join('\n')}
                        >
                          {hinweise.length > 0 && <Icon name="warnung" groesse={16} className="shrink-0 text-[#7A3A00]" />}
                          <span>{speichert === schluessel ? '…' : (k?.name ?? (darfVerwalten ? '+' : '–'))}</span>
                          <span className="sr-only">
                            {f.name} {j}
                          </span>
                          {darfVerwalten && (
                            <select
                              className="absolute inset-0 cursor-pointer opacity-0"
                              value={a?.kultur_id ?? ''}
                              onChange={(e) => setzeKultur(f.id, j, e.target.value)}
                            >
                              <option value="">– keine –</option>
                              {(kulturen.data ?? []).map((ku) => (
                                <option key={ku.id} value={ku.id}>
                                  {ku.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </label>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          {genutzteKulturen.length > 0 && (
            <tfoot>
              {genutzteKulturen.map((k) => (
                <tr key={k.id}>
                  <th scope="row" className="px-2 text-left text-xs font-bold">
                    <span className="mr-1.5 inline-block h-3 w-3 rounded" style={{ background: k.farbe }} />
                    {k.name}
                  </th>
                  {summen.map((m, i) => (
                    <td key={jahre[i]} className="text-center text-xs font-bold text-leise">
                      {m.get(k.id) ? ha(m.get(k.id)) : ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>

      <HinweisListe
        eintraege={sichtbareFelder.flatMap((f) => {
          const folge = new Map<number, Kultur>();
          for (let j = start - 5; j <= jahre[jahre.length - 1]; j++) {
            const k = kulturById.get(zelle.get(`${f.id}|${j}`)?.kultur_id ?? '');
            if (k) folge.set(j, k);
          }
          return jahre.flatMap((j) => hinweiseFuerJahr(folge, j).map((h) => `${f.name} ${j}: ${h}`));
        })}
      />
    </div>
  );
}

function HinweisListe({ eintraege }: { eintraege: string[] }) {
  if (!eintraege.length) return null;
  return (
    <section className="karte flex flex-col gap-2">
      <h2 className="m-0 text-lg font-extrabold">Hinweise (Empfehlungen)</h2>
      {eintraege.map((t) => (
        <p key={t} className="m-0 flex gap-2 rounded-xl bg-warn-hell p-3 text-sm font-semibold text-[#5C3D00]">
          <Icon name="warnung" groesse={18} className="shrink-0" />
          {t}
        </p>
      ))}
    </section>
  );
}

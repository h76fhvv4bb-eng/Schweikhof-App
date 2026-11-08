import { inFruchtfolge } from '../lib/typen';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useAnbau, useAnbauAlle, useFelder, useKulturen } from '../lib/daten';
import { hinweiseFuerJahr } from '../lib/fruchtfolgeRegeln';
import { datum, ha } from '../lib/format';
import type { Anbau, Kultur } from '../lib/typen';
import { Icon } from '../components/Icon';
import { FruchtfolgeZeitachse } from '../components/FruchtfolgeZeitachse';
import { AnbauDialog } from '../components/AnbauDialog';

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
  const alle = useAnbauAlle(jahre[0], jahre[jahre.length - 1]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [speichert, setSpeichert] = useState<string | null>(null);
  const [ansicht, setAnsicht] = useState<'raster' | 'zeitachse'>(() => {
    try {
      return localStorage.getItem('fruchtfolge-ansicht') === 'zeitachse' ? 'zeitachse' : 'raster';
    } catch {
      return 'raster';
    }
  });
  const [planen, setPlanen] = useState<{ feldId: string; feldName: string; feldM2: number; jahr: number; eintrag: Anbau | null; art?: Anbau['art'] } | null>(null);
  const weitere = useMemo(() => {
    const m = new Map<string, Anbau[]>();
    for (const a of alle.data ?? []) {
      if (a.art === 'Hauptkultur') continue;
      const k = `${a.feld_id}|${a.jahr}`;
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return m;
  }, [alle.data]);
  function waehleAnsicht(a: 'raster' | 'zeitachse') {
    setAnsicht(a);
    try {
      localStorage.setItem('fruchtfolge-ansicht', a);
    } catch {
      /* ohne Speicher weiter */
    }
  }

  const kulturById = useMemo(() => new Map((kulturen.data ?? []).map((k) => [k.id, k])), [kulturen.data]);
  const zelle = useMemo(() => {
    const m = new Map<string, Anbau>();
    for (const a of anbau.data ?? []) m.set(`${a.feld_id}|${a.jahr}`, a);
    return m;
  }, [anbau.data]);

  // Nur Ackerfläche (Ackerland, Kunstwiese) gehört in die Fruchtfolge; übrige Flächen auf Wunsch einblendbar
  const [mitDauergruenland, setMitDauergruenland] = useState(false);
  const aktiveFelder = (felder.data ?? []).filter((f) => f.status !== 'aufgegeben');
  const dauergruenland = aktiveFelder.filter((f) => !inFruchtfolge(f));
  const sichtbareFelder = aktiveFelder.filter((f) => mitDauergruenland || inFruchtfolge(f));

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
        ...jahre.map((j) =>
          [
            kulturById.get(zelle.get(`${f.id}|${j}`)?.kultur_id ?? '')?.name ?? '',
            ...(weitere.get(`${f.id}|${j}`) ?? []).map((x) => `${x.art}: ${x.kulturen?.name ?? ''}`),
          ]
            .filter(Boolean)
            .join(' + '),
        ),
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
          <div className="flex rounded-full border-2 border-hof p-0.5" role="group" aria-label="Ansicht">
            {(['raster', 'zeitachse'] as const).map((a) => (
              <button
                key={a}
                onClick={() => waehleAnsicht(a)}
                aria-pressed={ansicht === a}
                className={`min-h-10 rounded-full px-4 text-sm font-extrabold ${ansicht === a ? 'bg-hof text-white' : 'text-hof'}`}
              >
                {a === 'raster' ? 'Raster' : 'Zeitachse'}
              </button>
            ))}
          </div>
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

      {dauergruenland.length > 0 && (
        <label className="flex min-h-10 items-center gap-2 text-sm font-bold text-leise">
          <input type="checkbox" className="h-5 w-5 accent-hof" checked={mitDauergruenland} onChange={(e) => setMitDauergruenland(e.target.checked)} />
          {dauergruenland.length} Flächen ohne Ackerfläche ({[...new Set(dauergruenland.map((f) => f.nutzungsart))].join(', ')} · {ha(dauergruenland.reduce((t, f) => t + Number(f.flaeche_m2), 0))}){' '}
          {mitDauergruenland ? 'werden angezeigt' : 'sind ausgeblendet'}
        </label>
      )}

      {ansicht === 'zeitachse' && <FruchtfolgeZeitachse start={jahre[0]} jahre={jahre.length} mitDauergruenland={mitDauergruenland} />}

      {ansicht === 'raster' && (
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
                        {(darfVerwalten || (weitere.get(schluessel)?.length ?? 0) > 0) && (
                          <div className="mt-1 flex flex-wrap justify-center gap-1">
                            {darfVerwalten && a && (
                              <button
                                type="button"
                                className="min-h-7 rounded-md bg-grund px-2 text-[11px] font-bold text-hof"
                                title="Saat, Ernte, Teilfläche der Hauptkultur"
                                onClick={() => setPlanen({ feldId: f.id, feldName: f.name, feldM2: Number(f.flaeche_m2), jahr: j, eintrag: a })}
                              >
                                Details
                              </button>
                            )}
                            {(weitere.get(schluessel) ?? []).map((x) => (
                              <button
                                key={x.id}
                                type="button"
                                className="min-h-7 max-w-full truncate rounded-md px-2 text-[11px] font-bold"
                                style={{ background: x.kulturen?.farbe ?? '#ddd', opacity: x.status === 'geplant' ? 0.8 : 1 }}
                                title={`${x.art}: ${x.kulturen?.name}`}
                                onClick={() => setPlanen({ feldId: f.id, feldName: f.name, feldM2: Number(f.flaeche_m2), jahr: j, eintrag: x })}
                              >
                                {x.art === 'Zweitkultur' ? '2. ' : x.art === 'Untersaat' ? '↳ ' : 'ZK '}
                                {x.kulturen?.name}
                              </button>
                            ))}
                            {darfVerwalten && (
                              <button
                                type="button"
                                className="min-h-7 min-w-7 rounded-md border border-dashed border-linie px-2 text-[11px] font-bold text-leise"
                                aria-label={`Weitere Kultur ${f.name} ${j}`}
                                title="Weitere Kultur: Zweitkultur, Zwischenkultur oder Untersaat"
                                onClick={() =>
                                  setPlanen({ feldId: f.id, feldName: f.name, feldM2: Number(f.flaeche_m2), jahr: j, eintrag: null, art: a ? 'Zwischenkultur' : 'Hauptkultur' })
                                }
                              >
                                +
                              </button>
                            )}
                          </div>
                        )}
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
        <p className="m-0 mt-2 px-2 text-xs text-leise">
          Tipp: Hauptkultur direkt im Feld wählen. «Details» für Saat, Ernte und Teilfläche, «+» für weitere Kulturen im gleichen Jahr (Zweitkultur, Zwischenkultur, Untersaat). ZK = Zwischenkultur, 2. = Zweitkultur, ↳ = Untersaat.
        </p>
      </div>
      )}

      {planen && (
        <AnbauDialog
          eintrag={planen.eintrag}
          feldId={planen.feldId}
          feldName={planen.feldName}
          feldM2={planen.feldM2}
          jahr={planen.jahr}
          art={planen.art}
          onFertig={() => setPlanen(null)}
        />
      )}

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

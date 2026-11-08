import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAnbauAlle, useBetrieb, useDigifluxLieferungen, useFeldarbeiten, useFelder, useKulturen } from '../lib/daten';
import { chf, heuteIso } from '../lib/format';
import type { Anbau } from '../lib/typen';
import { DZ_FRISTEN, DZ_TIPPS, QUELLE_DZV, QUELLE_ZH, dzAnalyse, type Posten, type Stufe } from '../lib/direktzahlungen';
import { Icon } from '../components/Icon';

const FARBE: Record<Stufe, string> = { ok: 'bg-hof-hell text-hof', warnung: 'bg-warn-hell text-[#5C3D00]', hinweis: 'bg-[#E8EEF6] text-[#27466B]' };
const ZEICHEN: Record<Stufe, string> = { ok: '✓', warnung: '!', hinweis: 'i' };
const ha = (x: number) => `${x.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha`;

/** Direktzahlungen und ÖLN: Prüfungen aus den eigenen Daten, Beitragsschätzung, Tipps und Fristen */
export function DirektzahlungenSeite() {
  const [jahr, setJahr] = useState(new Date().getFullYear());
  const betrieb = useBetrieb();
  const felder = useFelder();
  const kulturen = useKulturen();
  const anbau = useAnbauAlle(jahr - 1, jahr + 1);
  const arbeiten = useFeldarbeiten(jahr);
  const digiflux = useDigifluxLieferungen();

  const a = useMemo(
    () =>
      dzAnalyse({
        jahr,
        heute: heuteIso(),
        betrieb: betrieb.data,
        felder: felder.data ?? [],
        anbau: (anbau.data ?? []) as Anbau[],
        kulturen: kulturen.data ?? [],
        arbeiten: arbeiten.data ?? [],
        digifluxOffen: (digiflux.data ?? []).filter((l) => l.status === 'SENT').length,
      }),
    [jahr, betrieb.data, felder.data, anbau.data, kulturen.data, arbeiten.data, digiflux.data],
  );
  const warnungen = a.pruefungen.filter((p) => p.stufe === 'warnung').length;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-leise">ÖLN-Prüfung, Beiträge und Tipps</span>
          <h1 className="m-0 text-3xl font-extrabold text-hof">Direktzahlungen {jahr}</h1>
        </div>
        <select className="eingabe w-28" value={jahr} onChange={(e) => setJahr(Number(e.target.value))} aria-label="Jahr">
          {[new Date().getFullYear() + 1, new Date().getFullYear(), new Date().getFullYear() - 1, new Date().getFullYear() - 2].map((j) => (
            <option key={j}>{j}</option>
          ))}
        </select>
      </header>

      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ['LN', ha(a.kennzahlen.ln)],
            ['Ackerfläche', ha(a.kennzahlen.ackerHa)],
            ['BFF', `${Math.round(a.kennzahlen.bffAnteil * 1000) / 10} %`],
          ] as const
        ).map(([t, w]) => (
          <div key={t} className="karte p-3">
            <span className="block text-xs font-bold text-leise">{t}</span>
            <b className="text-lg">{w}</b>
          </div>
        ))}
      </div>

      <section className="karte flex flex-col gap-2">
        <h2 className="m-0 text-lg font-extrabold">Prüfung aus deinen Daten</h2>
        <span className="text-sm text-leise">
          {warnungen ? `${warnungen} Punkt${warnungen > 1 ? 'e' : ''} prüfen.` : 'Keine Auffälligkeiten in den erfassten Daten.'} Grundlage sind die erfassten
          Felder, Kulturen und Arbeiten {jahr}.
        </span>
        {a.pruefungen.map((p) => (
          <div key={p.titel} className="flex gap-3 border-t border-rand pt-2">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${FARBE[p.stufe]}`}>{ZEICHEN[p.stufe]}</span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <b className="text-[15px]">{p.titel}</b>
              <span className="text-sm">{p.text}</span>
              {p.felder && p.felder.length > 0 && (
                <ul className="m-0 pl-4 text-sm text-leise">
                  {p.felder.slice(0, 8).map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                  {p.felder.length > 8 && <li>… und {p.felder.length - 8} weitere</li>}
                </ul>
              )}
              {p.link && (
                <Link to={p.link.zu} className="inline-flex min-h-9 items-center self-start text-sm font-bold">
                  {p.link.text} →
                </Link>
              )}
            </div>
          </div>
        ))}
      </section>

      <section className="karte flex flex-col gap-2">
        <h2 className="m-0 text-lg font-extrabold">Grobe Schätzung der Beiträge</h2>
        <span className="text-sm text-leise">
          Ansätze 2026 Talzone{!a.talzone && ' (dein Betrieb liegt nicht in der Talzone – Ansätze weichen ab)'}. Ohne Kürzungen, Begrenzungen,
          Landschaftsqualität und kantonale Vernetzungsbeiträge. Ohne Gewähr.
        </span>
        <Tabelle posten={a.posten} />
        <div className="flex justify-between border-t-2 border-text pt-2 font-extrabold">
          <span>Total geschätzt</span>
          <span>{chf(a.summe)}</span>
        </div>
        {a.kennzahlen.vernetzungHa > 0 && (
          <span className="text-xs text-leise">Dazu Vernetzungsbeiträge auf {ha(a.kennzahlen.vernetzungHa)} (Bund bis 1000 Fr./ha, Ansatz ZH je nach Typ).</span>
        )}
      </section>

      {a.potenzial.length > 0 && (
        <section className="karte flex flex-col gap-2">
          <h2 className="m-0 text-lg font-extrabold">Zusätzliches Potenzial</h2>
          <span className="text-sm text-leise">Freiwillige Produktionssystembeiträge – nur mit Anmeldung (bis 31. August für das Folgejahr) und wenn die Auflagen passen.</span>
          <Tabelle posten={a.potenzial} />
        </section>
      )}

      <section className="karte flex flex-col gap-3">
        <h2 className="m-0 text-lg font-extrabold">Tipps</h2>
        {DZ_TIPPS.map((t) => (
          <div key={t.titel} className="flex flex-col gap-0.5 border-t border-rand pt-2 first-of-type:border-0 first-of-type:pt-0">
            <b className="text-[15px]">{t.titel}</b>
            <span className="text-sm">{t.text}</span>
            <a href={t.quelle} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center self-start text-xs font-bold">
              Quelle
            </a>
          </div>
        ))}
      </section>

      <section className="karte flex flex-col gap-2">
        <h2 className="m-0 text-lg font-extrabold">Fristen (Kanton Zürich)</h2>
        {DZ_FRISTEN.map((f) => (
          <div key={f.was} className="grid grid-cols-[110px_1fr] gap-2 border-t border-rand pt-2 text-sm first-of-type:border-0">
            <b>{f.wann}</b>
            <span>{f.was}</span>
          </div>
        ))}
        <a href={QUELLE_ZH} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center self-start text-xs font-bold">
          Direktzahlungen Kanton Zürich
        </a>
      </section>

      <p className="m-0 flex gap-2 text-xs text-leise">
        <Icon name="warnung" groesse={16} className="shrink-0" />
        <span>
          Hinweise ohne Gewähr, keine Rechtsberatung. Massgebend sind die{' '}
          <a href={QUELLE_DZV} target="_blank" rel="noreferrer">
            DZV mit Weisungen
          </a>{' '}
          und die Vorgaben des Kantons; im Zweifel beim Landwirtschaftsamt oder Strickhof nachfragen.
        </span>
      </p>
    </div>
  );
}

function Tabelle({ posten }: { posten: Posten[] }) {
  if (!posten.length) return <span className="text-sm text-leise">Keine Flächen dafür erfasst.</span>;
  return (
    <div className="flex flex-col">
      {posten.map((p) => (
        <div key={p.text} className="flex justify-between gap-3 border-t border-rand py-1.5 text-sm first:border-0">
          <span className="min-w-0">
            {p.text}
            <span className="block text-xs text-leise">
              {ha(p.ha)} × {p.ansatz.toLocaleString('de-CH')} Fr.{p.bemerkung ? ` · ${p.bemerkung}` : ''}
            </span>
          </span>
          <b className="shrink-0">{chf(p.betrag)}</b>
        </div>
      ))}
    </div>
  );
}

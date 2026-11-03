import { lazy, Suspense, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAnbau, useFelder } from '../lib/daten';
import { useAuth } from '../lib/auth';
import { ha } from '../lib/format';
import { Icon } from '../components/Icon';
import { Papierkorb } from '../components/Papierkorb';

const Hofkarte = lazy(() => import('./Hofkarte'));

type Ansicht = 'hof' | 'liste';
function gespeicherteAnsicht(): Ansicht {
  try {
    return localStorage.getItem('felderAnsicht') === 'liste' ? 'liste' : 'hof';
  } catch {
    return 'hof';
  }
}

export function Felder() {
  const { darfVerwalten } = useAuth();
  const jahr = new Date().getFullYear();
  const felder = useFelder();
  const anbau = useAnbau(jahr, jahr);
  const [suche, setSuche] = useState('');
  const [params] = useSearchParams();
  const [ansicht, setAnsichtState] = useState<Ansicht>(() => (params.has('zeichnen') || params.has('teilen') ? 'hof' : gespeicherteAnsicht()));
  const setAnsicht = (a: Ansicht) => {
    setAnsichtState(a);
    try {
      localStorage.setItem('felderAnsicht', a);
    } catch {
      /* Speicher nicht verfügbar: Wahl gilt nur bis zum Neuladen */
    }
  };

  const kulturJeFeld = new Map((anbau.data ?? []).map((a) => [a.feld_id, a.kulturen]));
  const [sortierung, setSortierungState] = useState<'nr' | 'name' | 'flaeche' | 'kultur' | 'nutzung'>(() => {
    try {
      return (localStorage.getItem('felder-sortierung') as 'nr') || 'nr';
    } catch {
      return 'nr';
    }
  });
  const setSortierung = (v: typeof sortierung) => {
    setSortierungState(v);
    try {
      localStorage.setItem('felder-sortierung', v);
    } catch {
      /* ohne Speicher */
    }
  };
  const nrVergleich = (a: { feldnummer: string }, b: { feldnummer: string }) => a.feldnummer.localeCompare(b.feldnummer, 'de-CH', { numeric: true });
  const liste = (felder.data ?? [])
    .filter((f) => `${f.feldnummer} ${f.name} ${f.gemeinde ?? ''} ${kulturJeFeld.get(f.id)?.name ?? ''}`.toLowerCase().includes(suche.toLowerCase()))
    .sort((a, b) =>
      sortierung === 'name'
        ? a.name.localeCompare(b.name, 'de-CH')
        : sortierung === 'flaeche'
          ? Number(b.flaeche_m2) - Number(a.flaeche_m2)
          : sortierung === 'kultur'
            ? (kulturJeFeld.get(a.id)?.name ?? '~').localeCompare(kulturJeFeld.get(b.id)?.name ?? '~', 'de-CH') || nrVergleich(a, b)
            : sortierung === 'nutzung'
              ? a.nutzungsart.localeCompare(b.nutzungsart, 'de-CH') || nrVergleich(a, b)
              : nrVergleich(a, b),
    );
  const gruppeVon = (f: (typeof liste)[number]) =>
    sortierung === 'kultur' ? (kulturJeFeld.get(f.id)?.name ?? `Keine Kultur ${jahr}`) : sortierung === 'nutzung' ? f.nutzungsart : '';
  const gesamt = (felder.data ?? []).reduce((s, f) => s + Number(f.flaeche_m2), 0);

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <div>
          <span className="text-sm font-semibold text-leise">
            {felder.data?.length ?? 0} Felder · {ha(gesamt, 1)}
          </span>
          <h1 className="m-0 text-3xl font-extrabold text-hof">Felder</h1>
        </div>
        {darfVerwalten && (
          <Link to="/felder/neu" aria-label="Feld hinzufügen" className="knopf h-11 w-11 px-0">
            <Icon name="plus" />
          </Link>
        )}
      </header>

      <div role="tablist" aria-label="Ansicht" className="grid grid-cols-2 gap-1 rounded-2xl bg-[#E7E1D0] p-1">
        {(
          [
            ['hof', 'Hof-Ansicht'],
            ['liste', 'Liste'],
          ] as const
        ).map(([a, text]) => (
          <button
            key={a}
            role="tab"
            aria-selected={ansicht === a}
            onClick={() => setAnsicht(a)}
            className={`min-h-10 rounded-xl text-sm font-extrabold ${ansicht === a ? 'bg-white text-hof' : 'text-[#4D5B50]'}`}
          >
            {text}
          </button>
        ))}
      </div>

      {ansicht === 'hof' ? (
        <Suspense fallback={<p className="text-leise">Lade Karte …</p>}>
          <Hofkarte />
        </Suspense>
      ) : (
        <>
      <label className="karte flex items-center gap-2 py-0">
        <Icon name="suche" className="text-leise" />
        <span className="sr-only">Feld suchen</span>
        <input
          type="search"
          placeholder="Feld suchen"
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          className="min-h-12 flex-1 bg-transparent text-base outline-none"
        />
      </label>

      <label className="flex items-center gap-2 self-end text-sm font-bold">
        Sortieren
        <select className="eingabe h-11 py-0" value={sortierung} onChange={(e) => setSortierung(e.target.value as typeof sortierung)}>
          <option value="nr">nach Nummer</option>
          <option value="name">nach Name</option>
          <option value="flaeche">nach Fläche</option>
          <option value="kultur">nach Kultur {jahr} (gruppiert)</option>
          <option value="nutzung">nach Nutzungsart (gruppiert)</option>
        </select>
      </label>

      {felder.isLoading && <p className="text-leise">Lade Felder …</p>}
      {felder.error && <p className="text-fehler">Felder konnten nicht geladen werden.</p>}

      {liste.map((f, i) => {
        const k = kulturJeFeld.get(f.id);
        const gruppe = gruppeVon(f);
        const neueGruppe = gruppe && (i === 0 || gruppeVon(liste[i - 1]) !== gruppe);
        const gruppenFlaeche = neueGruppe ? liste.filter((x) => gruppeVon(x) === gruppe).reduce((t, x) => t + Number(x.flaeche_m2), 0) : 0;
        return (
          <div key={f.id} className="flex flex-col gap-2">
          {neueGruppe && (
            <h2 className="m-0 mt-2 flex items-center justify-between text-sm font-extrabold tracking-wide text-[#3E4C41]">
              <span className="flex items-center gap-2">
                {sortierung === 'kultur' && <span className="inline-block h-3 w-3 rounded" style={{ background: k?.farbe ?? '#E7E1D0' }} />}
                {gruppe.toUpperCase()}
              </span>
              <span className="text-xs text-leise">{ha(gruppenFlaeche)}</span>
            </h2>
          )}
          <Link key={f.id} to={`/felder/${f.id}`} className="karte flex items-center gap-3 p-3 text-text no-underline">
            <span
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-[15px] font-extrabold"
              style={{ background: k?.farbe ?? '#E7E1D0' }}
            >
              {f.feldnummer}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-base font-extrabold">{f.name}</span>
              <span className="text-sm text-leise">
                {k?.name ?? 'Keine Kultur ' + jahr} · {ha(Number(f.flaeche_m2))}
                {f.status !== 'bewirtschaftet' ? ` · ${f.status}` : ''}
              </span>
            </span>
            <Icon name="weiter" groesse={18} className="text-[#9AA59C]" />
          </Link>
          </div>
        );
      })}
        </>
      )}
      <Papierkorb />
    </div>
  );
}

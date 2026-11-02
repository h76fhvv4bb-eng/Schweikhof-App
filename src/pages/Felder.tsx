import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAnbau, useFelder } from '../lib/daten';
import { useAuth } from '../lib/auth';
import { ha } from '../lib/format';
import { Icon } from '../components/Icon';

export function Felder() {
  const { darfVerwalten } = useAuth();
  const jahr = new Date().getFullYear();
  const felder = useFelder();
  const anbau = useAnbau(jahr, jahr);
  const [suche, setSuche] = useState('');

  const kulturJeFeld = new Map((anbau.data ?? []).map((a) => [a.feld_id, a.kulturen]));
  const liste = (felder.data ?? []).filter((f) =>
    `${f.feldnummer} ${f.name} ${f.gemeinde ?? ''}`.toLowerCase().includes(suche.toLowerCase()),
  );
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

      {felder.isLoading && <p className="text-leise">Lade Felder …</p>}
      {felder.error && <p className="text-fehler">Felder konnten nicht geladen werden.</p>}

      {liste.map((f) => {
        const k = kulturJeFeld.get(f.id);
        return (
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
        );
      })}
    </div>
  );
}

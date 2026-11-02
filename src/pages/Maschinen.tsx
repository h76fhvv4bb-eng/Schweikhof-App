import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useHofobjekte, useMaschinen, useMaschinenEintraege, useWartungFaellig } from '../lib/daten';
import { datum, menge } from '../lib/format';
import { Icon } from '../components/Icon';

/** Tage bis zu einem Datum (negativ = vorbei) */
export function tageBis(iso: string | null): number | null {
  if (!iso) return null;
  const heute = new Date();
  heute.setHours(12, 0, 0, 0);
  return Math.round((new Date(`${iso}T12:00:00`).getTime() - heute.getTime()) / 86400000);
}

export function Maschinen() {
  const { darfVerwalten } = useAuth();
  const [params, setParams] = useSearchParams();
  const standort = params.get('standort');
  const maschinen = useMaschinen();
  const wartung = useWartungFaellig();
  const eintraege = useMaschinenEintraege();
  const orte = useHofobjekte();
  const [alle, setAlle] = useState(false);

  const liste = (maschinen.data ?? []).filter((m) => (alle || m.status !== 'verkauft') && (!standort || m.standort_id === standort));
  const kategorien = [...new Set(liste.map((m) => m.kategorie))];
  const ortName = (id: string | null) => orte.data?.find((o) => o.id === id)?.name;

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-end justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-leise">
            {liste.length} Maschinen und Geräte{standort && ` in «${ortName(standort) ?? '…'}»`}
          </span>
          <h1 className="m-0 text-3xl font-extrabold text-hof">Maschinen</h1>
        </div>
        {darfVerwalten && (
          <Link to="/maschinen/neu" className="knopf no-underline">
            <Icon name="plus" /> Maschine
          </Link>
        )}
      </header>
      <div className="flex flex-wrap gap-2">
        {standort && (
          <button className="knopf-leise" onClick={() => setParams({})}>
            Alle Standorte zeigen
          </button>
        )}
        <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
          <input type="checkbox" className="h-5 w-5 accent-hof" checked={alle} onChange={(e) => setAlle(e.target.checked)} />
          Verkaufte anzeigen
        </label>
      </div>

      {maschinen.isSuccess && liste.length === 0 && (
        <p className="karte m-0 text-leise">Noch keine Maschinen erfasst. Lege zuerst deinen Traktor an.</p>
      )}

      {kategorien.map((k) => (
        <section key={k} className="flex flex-col gap-2">
          <h2 className="m-0 mt-2 text-sm font-extrabold text-leise">{k}</h2>
          {liste
            .filter((m) => m.kategorie === k)
            .map((m) => {
              const plaene = (wartung.data ?? []).filter((w) => w.maschine_id === m.id);
              const ueber = plaene.filter((w) => w.ueberfaellig).length;
              const bald = plaene.filter((w) => w.bald_faellig && !w.ueberfaellig).length;
              const mfk = tageBis(m.mfk_faellig);
              const offen = (eintraege.data ?? []).filter((e) => e.maschine_id === m.id && e.offen).length;
              return (
                <Link key={m.id} to={`/maschinen/${m.id}`} className="karte flex flex-col gap-1.5 p-3 text-text no-underline">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-extrabold">{m.name}</span>
                    {m.betriebsstunden != null && <span className="text-sm font-bold text-leise">{menge(Number(m.betriebsstunden))} h</span>}
                  </div>
                  <span className="text-xs text-leise">
                    {[m.hersteller, m.modell, m.baujahr, m.kennzeichen, ortName(m.standort_id) && `Standplatz ${ortName(m.standort_id)}`]
                      .filter(Boolean)
                      .join(' · ')}
                    {m.status !== 'in Betrieb' && ` · ${m.status}`}
                  </span>
                  {(ueber > 0 || bald > 0 || (mfk != null && mfk <= 60) || offen > 0) && (
                    <div className="flex flex-wrap gap-1.5">
                      {ueber > 0 && <Marke rot>{ueber} Wartung überfällig</Marke>}
                      {bald > 0 && <Marke>{bald} Wartung bald</Marke>}
                      {mfk != null && mfk <= 60 && <Marke rot={mfk < 0}>MFK {mfk < 0 ? 'abgelaufen' : `am ${datum(m.mfk_faellig)}`}</Marke>}
                      {offen > 0 && <Marke>{offen} offene Beobachtung{offen > 1 ? 'en' : ''}</Marke>}
                    </div>
                  )}
                </Link>
              );
            })}
        </section>
      ))}
    </div>
  );
}

export function Marke({ children, rot }: { children: ReactNode; rot?: boolean }) {
  return (
    <span className={`rounded-lg px-2 py-0.5 text-xs font-extrabold ${rot ? 'bg-fehler-hell text-fehler' : 'bg-warn-hell text-warn'}`}>{children}</span>
  );
}

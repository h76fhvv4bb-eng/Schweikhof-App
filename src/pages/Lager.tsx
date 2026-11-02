import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useLager } from '../lib/daten';
import { chf, menge } from '../lib/format';
import { csvHerunterladen, csvZahl } from '../lib/export';
import { LAGERKATEGORIEN } from '../lib/typen';
import { Icon } from '../components/Icon';
import { DuengerKatalog } from '../components/DuengerKatalog';

export function Lager() {
  const { darfVerwalten } = useAuth();
  const lager = useLager();
  const [kategorie, setKategorie] = useState('');
  const [katalog, setKatalog] = useState(false);
  const liste = (lager.data ?? []).filter((a) => !kategorie || a.kategorie === kategorie);
  const knapp = liste.filter((a) => a.unter_mindestbestand);
  const wert = liste.reduce((s, a) => s + Number(a.lagerwert), 0);

  function exportieren() {
    csvHerunterladen(
      'lagerbestand.csv',
      'Lagerbestand',
      ['Artikelnr', 'Bezeichnung', 'Kategorie', 'Bestand', 'Einheit', 'Mindestbestand', 'Preis CHF/Einheit', 'Wert CHF', 'Lagerort'],
      liste.map((a) => [
        a.artikelnummer, a.bezeichnung, a.kategorie, csvZahl(a.bestand, 3), a.einheit, csvZahl(a.mindestbestand, 3),
        csvZahl(a.einkaufspreis), csvZahl(a.lagerwert), a.lagerort,
      ]),
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-leise">
            {liste.length} Artikel · Lagerwert {chf(wert)}
          </span>
          <h1 className="m-0 text-3xl font-extrabold text-hof">Lager</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="knopf-leise" onClick={exportieren}>
            Excel (CSV)
          </button>
          {darfVerwalten && (
            <button className="knopf-leise" onClick={() => setKatalog(!katalog)}>
              Dünger-Katalog
            </button>
          )}
          {darfVerwalten && (
            <Link to="/lager/neu" className="knopf no-underline">
              <Icon name="plus" /> Artikel
            </Link>
          )}
        </div>
      </header>

      {katalog && <DuengerKatalog onFertig={() => setKatalog(false)} />}

      <div className="flex flex-wrap gap-2">
        {['', ...LAGERKATEGORIEN].map((k) => (
          <button
            key={k || 'alle'}
            onClick={() => setKategorie(k)}
            aria-pressed={kategorie === k}
            className={`min-h-10 rounded-full border-2 px-3 text-sm font-bold ${
              kategorie === k ? 'border-hof bg-hof text-white' : 'border-linie bg-white'
            }`}
          >
            {k || 'Alle'}
          </button>
        ))}
      </div>

      {knapp.length > 0 && (
        <p className="m-0 flex gap-2 rounded-2xl bg-warn-hell p-3 text-sm font-semibold text-[#5C3D00]">
          <Icon name="warnung" groesse={18} className="shrink-0" />
          {knapp.length} Artikel unter Mindestbestand: {knapp.map((a) => a.bezeichnung).join(', ')}
        </p>
      )}

      {lager.isSuccess && liste.length === 0 && (
        <p className="karte m-0 text-leise">Noch keine Artikel. Lege zuerst deine Dünger an, damit Düngungen automatisch abgebucht werden.</p>
      )}

      {liste.map((a) => {
        const anteil = a.mindestbestand > 0 ? Math.min(1, Number(a.bestand) / (Number(a.mindestbestand) * 2)) : 1;
        return (
          <Link key={a.id} to={`/lager/${a.id}`} className="karte flex flex-col gap-2 p-3 text-text no-underline">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-extrabold">{a.bezeichnung}</span>
              <span className={`whitespace-nowrap font-extrabold ${a.unter_mindestbestand ? 'text-warn' : ''}`}>
                {a.lagerfuehrung ? menge(Number(a.bestand), a.einheit) : 'ohne Bestand'}
              </span>
            </div>
            {a.lagerfuehrung && (
              <div className="h-2.5 overflow-hidden rounded-full bg-[#EFE7D3]">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(0, anteil) * 100}%`, background: a.unter_mindestbestand ? '#D99A1E' : '#3F7D4F' }}
                />
              </div>
            )}
            <span className="text-xs text-leise">
              {a.kategorie}
              {a.mindestbestand > 0 && ` · min. ${menge(Number(a.mindestbestand), a.einheit)}`}
              {a.lagerort && ` · ${a.lagerort}`}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

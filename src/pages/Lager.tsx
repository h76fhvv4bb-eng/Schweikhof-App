import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useQueryClient } from '@tanstack/react-query';
import { useLager, useMaschinen, useMaschinenTeile } from '../lib/daten';
import { lagerartikelLoeschen } from '../lib/lagerLoeschen';
import { chf, menge } from '../lib/format';
import { csvHerunterladen, csvZahl } from '../lib/export';
import { LAGERKATEGORIEN, type Lagerbestand } from '../lib/typen';
import { Icon } from '../components/Icon';
import { DuengerKatalog } from '../components/DuengerKatalog';

export function Lager() {
  const { darfVerwalten } = useAuth();
  const lager = useLager();
  const [kategorie, setKategorie] = useState('');
  const [katalog, setKatalog] = useState(false);
  const [suche, setSuche] = useState('');
  const qc = useQueryClient();
  const [auswahl, setAuswahl] = useState<Set<string> | null>(null); // null = normale Ansicht
  const [meldung, setMeldung] = useState<{ text: string; fehler: boolean } | null>(null);
  const [loescht, setLoescht] = useState(false);
  const [gruppierung, setGruppierungState] = useState<'warengruppe' | 'kategorie' | 'lagerort' | 'maschine' | 'keine'>(() => {
    try {
      return (localStorage.getItem('lager-gruppe') as 'warengruppe') || 'warengruppe';
    } catch {
      return 'warengruppe';
    }
  });
  const [sortierung, setSortierung] = useState<'name' | 'bestand' | 'wert' | 'knapp'>('name');
  const setGruppierung = (g: typeof gruppierung) => {
    setGruppierungState(g);
    try {
      localStorage.setItem('lager-gruppe', g);
    } catch {
      /* ohne Speicher */
    }
  };
  const teile = useMaschinenTeile();
  const maschinen = useMaschinen();
  const maschinenVon = (artikelId: string) =>
    (teile.data ?? []).filter((t) => t.artikel_id === artikelId).map((t) => maschinen.data?.find((m) => m.id === t.maschine_id)?.name).filter(Boolean) as string[];
  const liste = (lager.data ?? [])
    .filter((a) => !kategorie || a.kategorie === kategorie)
    .filter((a) => !suche.trim() || `${a.bezeichnung} ${a.artikelnummer ?? ''} ${a.warengruppe ?? ''} ${a.lagerort ?? ''}`.toLowerCase().includes(suche.toLowerCase()))
    .sort((a, b) =>
      sortierung === 'bestand'
        ? Number(b.bestand) - Number(a.bestand)
        : sortierung === 'wert'
          ? Number(b.lagerwert) - Number(a.lagerwert)
          : sortierung === 'knapp'
            ? Number(b.unter_mindestbestand) - Number(a.unter_mindestbestand) || a.bezeichnung.localeCompare(b.bezeichnung, 'de-CH')
            : a.bezeichnung.localeCompare(b.bezeichnung, 'de-CH'),
    );
  const gruppeVon = (a: Lagerbestand): string[] =>
    gruppierung === 'warengruppe'
      ? [`${a.kategorie}${a.warengruppe ? ` · ${a.warengruppe}` : ''}`]
      : gruppierung === 'kategorie'
        ? [a.kategorie]
        : gruppierung === 'lagerort'
          ? [a.lagerort || 'Ohne Lagerort']
          : gruppierung === 'maschine'
            ? maschinenVon(a.id).length
              ? maschinenVon(a.id)
              : ['Keiner Maschine zugeordnet']
            : [''];
  const gruppen = new Map<string, Lagerbestand[]>();
  for (const a of liste) for (const g of gruppeVon(a)) gruppen.set(g, [...(gruppen.get(g) ?? []), a]);
  const gruppenSortiert = [...gruppen].sort(([x], [y]) => x.localeCompare(y, 'de-CH'));
  const knapp = liste.filter((a) => a.unter_mindestbestand);
  const wert = liste.reduce((s, a) => s + Number(a.lagerwert), 0);

  const ohneBestand = (a: Lagerbestand) => !a.lagerfuehrung || Number(a.bestand) === 0;
  const umschalten = (id: string) =>
    setAuswahl((alt) => {
      const neu = new Set(alt);
      if (neu.has(id)) neu.delete(id);
      else neu.add(id);
      return neu;
    });

  async function auswahlLoeschen() {
    if (!auswahl?.size || !confirm(`${auswahl.size} Artikel löschen? Frühere Buchungen und Feldarbeiten bleiben erhalten.`)) return;
    setLoescht(true);
    const r = await lagerartikelLoeschen([...auswahl]);
    setLoescht(false);
    setMeldung(r);
    if (!r.fehler) setAuswahl(null);
    qc.invalidateQueries({ queryKey: ['lager'] });
    qc.invalidateQueries({ queryKey: ['maschine_teile'] });
  }

  function exportieren() {
    csvHerunterladen(
      'lagerbestand.csv',
      'Lagerbestand',
      ['Artikelnr', 'Bezeichnung', 'Kategorie', 'Warengruppe', 'Bestand', 'Einheit', 'Mindestbestand', 'Preis CHF/Einheit', 'Wert CHF', 'Lagerort', 'Maschinen'],
      liste.map((a) => [
        a.artikelnummer, a.bezeichnung, a.kategorie, a.warengruppe ?? '', csvZahl(a.bestand, 3), a.einheit, csvZahl(a.mindestbestand, 3),
        csvZahl(a.einkaufspreis), csvZahl(a.lagerwert), a.lagerort, maschinenVon(a.id).join(', '),
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
            <button
              className="knopf-leise"
              aria-pressed={!!auswahl}
              onClick={() => {
                setAuswahl(auswahl ? null : new Set());
                setMeldung(null);
              }}
            >
              {auswahl ? 'Fertig' : 'Löschen …'}
            </button>
          )}
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

      <div className="flex flex-wrap items-center gap-2">
        <label className="karte flex flex-1 items-center gap-2 py-0">
          <Icon name="suche" className="text-leise" />
          <span className="sr-only">Artikel suchen</span>
          <input
            type="search"
            placeholder="Artikel suchen"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            className="min-h-11 min-w-0 flex-1 bg-transparent text-base outline-none"
          />
        </label>
        <label className="flex items-center gap-1 text-sm font-bold">
          Gruppieren
          <select className="eingabe h-11 py-0" value={gruppierung} onChange={(e) => setGruppierung(e.target.value as typeof gruppierung)}>
            <option value="warengruppe">nach Warengruppe</option>
            <option value="kategorie">nach Kategorie</option>
            <option value="lagerort">nach Lagerort</option>
            <option value="maschine">nach Maschine</option>
            <option value="keine">nicht gruppieren</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-sm font-bold">
          Sortieren
          <select className="eingabe h-11 py-0" value={sortierung} onChange={(e) => setSortierung(e.target.value as typeof sortierung)}>
            <option value="name">Name</option>
            <option value="knapp">Knappe zuerst</option>
            <option value="bestand">Bestand</option>
            <option value="wert">Lagerwert</option>
          </select>
        </label>
      </div>

      {auswahl && (
        <div className="karte flex flex-col gap-2 bg-grund">
          <span className="text-sm">
            Artikel antippen, die es im Lager nicht gibt. Artikel mit Bestand lassen sich nicht wählen; frühere Buchungen und Feldarbeiten bleiben erhalten.
          </span>
          <div className="flex flex-wrap gap-2">
            <button className="knopf-leise" onClick={() => setAuswahl(new Set(liste.filter(ohneBestand).map((a) => a.id)))}>
              Alle ohne Bestand wählen ({liste.filter(ohneBestand).length})
            </button>
            {auswahl.size > 0 && (
              <button className="knopf-leise" onClick={() => setAuswahl(new Set())}>
                Auswahl leeren
              </button>
            )}
            <button className="knopf bg-fehler shadow-none" disabled={!auswahl.size || loescht} onClick={auswahlLoeschen}>
              {loescht ? 'Lösche …' : `${auswahl.size} Artikel löschen`}
            </button>
          </div>
        </div>
      )}

      {meldung && (
        <p className={`m-0 rounded-xl p-3 text-sm font-semibold ${meldung.fehler ? 'bg-fehler-hell text-fehler' : 'bg-hof-hell text-hof'}`}>{meldung.text}</p>
      )}

      {knapp.length > 0 && (
        <p className="m-0 flex gap-2 rounded-2xl bg-warn-hell p-3 text-sm font-semibold text-[#5C3D00]">
          <Icon name="warnung" groesse={18} className="shrink-0" />
          {knapp.length} Artikel unter Mindestbestand: {knapp.map((a) => a.bezeichnung).join(', ')}
        </p>
      )}

      {lager.isSuccess && liste.length === 0 && (
        <p className="karte m-0 text-leise">Noch keine Artikel. Lege zuerst deine Dünger an, damit Düngungen automatisch abgebucht werden.</p>
      )}

      {gruppenSortiert.map(([gruppe, artikel]) => (
        <Gruppe key={gruppe || 'alle'} titel={gruppe} anzahl={artikel.length} wert={artikel.reduce((x, a) => x + Number(a.lagerwert), 0)}>
          {artikel.map((a) => {
            const anteil = a.mindestbestand > 0 ? Math.min(1, Number(a.bestand) / (Number(a.mindestbestand) * 2)) : 1;
            const masch = maschinenVon(a.id);
            return (
              <Karte
                key={a.id}
                to={`/lager/${a.id}`}
                auswahl={auswahl ? { gewaehlt: auswahl.has(a.id), moeglich: ohneBestand(a), umschalten: () => umschalten(a.id) } : null}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-extrabold">
                    {auswahl && <span className="mr-2">{auswahl.has(a.id) ? '☑' : '☐'}</span>}
                    {a.bezeichnung}
                  </span>
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
                  {a.warengruppe && ` · ${a.warengruppe}`}
                  {a.artikelnummer && ` · Nr. ${a.artikelnummer}`}
                  {a.mindestbestand > 0 && ` · min. ${menge(Number(a.mindestbestand), a.einheit)}`}
                  {a.lagerort && ` · ${a.lagerort}`}
                  {masch.length > 0 && gruppierung !== 'maschine' && ` · für ${masch.join(', ')}`}
                </span>
              </Karte>
            );
          })}
        </Gruppe>
      ))}
    </div>
  );
}

/** Artikelkarte: normal ein Link zum Artikel, im Löschmodus zum Auswählen */
function Karte({
  to,
  auswahl,
  children,
}: {
  to: string;
  auswahl: { gewaehlt: boolean; moeglich: boolean; umschalten: () => void } | null;
  children: ReactNode;
}) {
  const klasse = 'karte flex flex-col gap-2 p-3 text-text no-underline';
  if (!auswahl)
    return (
      <Link to={to} className={klasse}>
        {children}
      </Link>
    );
  return (
    <button
      type="button"
      disabled={!auswahl.moeglich}
      aria-pressed={auswahl.gewaehlt}
      onClick={auswahl.umschalten}
      className={`${klasse} w-full text-left ${auswahl.gewaehlt ? 'outline outline-3 outline-fehler' : ''} ${auswahl.moeglich ? '' : 'opacity-50'}`}
    >
      {children}
    </button>
  );
}

function Gruppe({ titel, anzahl, wert, children }: { titel: string; anzahl: number; wert: number; children: ReactNode }) {
  const [zu, setZu] = useState(false);
  if (!titel) return <>{children}</>;
  return (
    <section className="flex flex-col gap-2">
      <button className="flex min-h-10 items-center justify-between gap-2 text-left" onClick={() => setZu(!zu)} aria-expanded={!zu}>
        <span className="text-sm font-extrabold tracking-wide text-[#3E4C41]">
          {zu ? '▸' : '▾'} {titel.toUpperCase()} <span className="font-semibold text-leise">({anzahl})</span>
        </span>
        {wert > 0 && <span className="text-xs font-bold text-leise">{chf(wert)}</span>}
      </button>
      {!zu && children}
    </section>
  );
}

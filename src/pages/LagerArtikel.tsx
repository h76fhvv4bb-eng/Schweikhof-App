import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { ABHAENGIGE_DATEN, useLager } from '../lib/daten';
import { chf, datum, heuteIso, menge, zahlAus } from '../lib/format';
import { EINHEITEN, LAGERKATEGORIEN, type Lagerartikel, type Lagerbewegung } from '../lib/typen';
import { Icon } from '../components/Icon';

const NAEHRSTOFFE = [
  ['n_je_einheit', 'N'],
  ['p2o5_je_einheit', 'P₂O₅'],
  ['k2o_je_einheit', 'K₂O'],
  ['mg_je_einheit', 'Mg'],
  ['s_je_einheit', 'S'],
] as const;
type NaehrstoffFeld = (typeof NAEHRSTOFFE)[number][0];

/** Bei Einheit kg werden Gehalte als % eingegeben, sonst als kg je Einheit. */
const alsProzent = (einheit: string) => einheit === 'kg' || einheit === 'l';

export function LagerArtikel() {
  const { id } = useParams();
  const neu = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { darfVerwalten, profil } = useAuth();
  const lager = useLager();
  const artikel = lager.data?.find((a) => a.id === id);

  const [w, setW] = useState({
    bezeichnung: '', artikelnummer: '', kategorie: 'Dünger' as Lagerartikel['kategorie'], einheit: 'kg' as Lagerartikel['einheit'],
    hersteller: '', lieferant: '', lagerort: '', mindestbestand: '', einkaufspreis: '', lagerfuehrung: true,
    naehrstoffquelle: 'Deklaration', bemerkungen: '',
    n_je_einheit: '', p2o5_je_einheit: '', k2o_je_einheit: '', mg_je_einheit: '', s_je_einheit: '',
  });
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    if (!artikel) return;
    const f = alsProzent(artikel.einheit) ? 100 : 1;
    const nz = (v: number | null) => (v == null ? '' : String(Math.round(Number(v) * f * 10000) / 10000));
    setW({
      bezeichnung: artikel.bezeichnung, artikelnummer: artikel.artikelnummer ?? '', kategorie: artikel.kategorie, einheit: artikel.einheit,
      hersteller: artikel.hersteller ?? '', lieferant: artikel.lieferant ?? '', lagerort: artikel.lagerort ?? '',
      mindestbestand: String(artikel.mindestbestand ?? ''), einkaufspreis: artikel.einkaufspreis == null ? '' : String(artikel.einkaufspreis),
      lagerfuehrung: artikel.lagerfuehrung, naehrstoffquelle: artikel.naehrstoffquelle ?? 'Deklaration', bemerkungen: artikel.bemerkungen ?? '',
      n_je_einheit: nz(artikel.n_je_einheit), p2o5_je_einheit: nz(artikel.p2o5_je_einheit), k2o_je_einheit: nz(artikel.k2o_je_einheit),
      mg_je_einheit: nz(artikel.mg_je_einheit), s_je_einheit: nz(artikel.s_je_einheit),
    });
  }, [artikel]);

  async function speichern(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    if (!w.bezeichnung.trim()) return setFehler('Bezeichnung fehlt.');
    const f = alsProzent(w.einheit) ? 100 : 1;
    const daten: Record<string, unknown> = {
      bezeichnung: w.bezeichnung.trim(),
      artikelnummer: w.artikelnummer.trim() || null,
      kategorie: w.kategorie,
      einheit: w.einheit,
      hersteller: w.hersteller.trim() || null,
      lieferant: w.lieferant.trim() || null,
      lagerort: w.lagerort.trim() || null,
      mindestbestand: zahlAus(w.mindestbestand) ?? 0,
      einkaufspreis: zahlAus(w.einkaufspreis),
      lagerfuehrung: w.lagerfuehrung,
      bemerkungen: w.bemerkungen.trim() || null,
    };
    let hatNaehrstoff = false;
    for (const [feld, name] of NAEHRSTOFFE) {
      const v = zahlAus(w[feld as NaehrstoffFeld]);
      if (v != null && (v < 0 || (f === 100 && v > 100))) return setFehler(`Gehalt ${name} ungültig.`);
      daten[feld] = v == null ? null : v / f;
      if (v != null) hatNaehrstoff = true;
    }
    daten.naehrstoffquelle = hatNaehrstoff ? w.naehrstoffquelle : null;
    if ((daten.mindestbestand as number) < 0 || (daten.einkaufspreis != null && (daten.einkaufspreis as number) < 0))
      return setFehler('Zahlen dürfen nicht negativ sein.');

    const { error } = neu
      ? await supabase.from('lagerartikel').insert({ ...daten, betrieb_id: profil!.betrieb_id })
      : await supabase.from('lagerartikel').update({ ...daten, version: artikel!.version }).eq('id', id!);
    if (error) return setFehler(fehlertext(error));
    qc.invalidateQueries({ queryKey: ['lager'] });
    navigate('/lager');
  }

  const set = (k: keyof typeof w) => (e: { target: { value: string } }) => setW({ ...w, [k]: e.target.value });
  const prozent = alsProzent(w.einheit);

  if (!neu && lager.isSuccess && !artikel) return <p>Artikel nicht gefunden.</p>;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <Link to="/lager" aria-label="Zurück" className="knopf-leise h-11 w-11 px-0">
          <Icon name="zurueck" />
        </Link>
        <div>
          <h1 className="m-0 text-2xl font-extrabold text-hof">{neu ? 'Neuer Artikel' : w.bezeichnung}</h1>
          {artikel && artikel.lagerfuehrung && (
            <span className="text-sm font-bold text-leise">
              Bestand {menge(Number(artikel.bestand), artikel.einheit)} · Wert {chf(Number(artikel.lagerwert))}
            </span>
          )}
        </div>
      </header>

      {artikel && darfVerwalten && artikel.lagerfuehrung && <Buchen artikel={artikel} />}

      <form onSubmit={speichern} className="karte flex flex-col gap-3">
        <fieldset disabled={!darfVerwalten} className="m-0 flex flex-col gap-3 border-0 p-0">
          <label className="feld-label">
            Bezeichnung
            <input className="eingabe" required value={w.bezeichnung} onChange={set('bezeichnung')} placeholder="z. B. Ammonsalpeter 27.5 %" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="feld-label">
              Kategorie
              <select className="eingabe" value={w.kategorie} onChange={set('kategorie')}>
                {LAGERKATEGORIEN.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label className="feld-label">
              Einheit
              <select className="eingabe" value={w.einheit} onChange={set('einheit')} disabled={!neu}>
                {EINHEITEN.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label className="feld-label">
              Mindestbestand ({w.einheit})
              <input className="eingabe" inputMode="decimal" value={w.mindestbestand} onChange={set('mindestbestand')} />
            </label>
            <label className="feld-label">
              Einkaufspreis (CHF/{w.einheit})
              <input className="eingabe" inputMode="decimal" value={w.einkaufspreis} onChange={set('einkaufspreis')} />
            </label>
            <label className="feld-label">
              Artikelnummer
              <input className="eingabe" value={w.artikelnummer} onChange={set('artikelnummer')} />
            </label>
            <label className="feld-label">
              Lagerort
              <input className="eingabe" value={w.lagerort} onChange={set('lagerort')} />
            </label>
            <label className="feld-label">
              Hersteller
              <input className="eingabe" value={w.hersteller} onChange={set('hersteller')} />
            </label>
            <label className="feld-label">
              Lieferant
              <input className="eingabe" value={w.lieferant} onChange={set('lieferant')} />
            </label>
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm font-bold">
            <input type="checkbox" className="h-5 w-5 accent-hof" checked={w.lagerfuehrung} onChange={(e) => setW({ ...w, lagerfuehrung: e.target.checked })} />
            Bestand führen (aus bei z. B. zugeführtem Hofdünger ohne eigenes Lager)
          </label>

          {(w.kategorie === 'Dünger' || NAEHRSTOFFE.some(([k]) => w[k])) && (
            <div className="flex flex-col gap-2 rounded-2xl bg-grund p-3">
              <span className="text-sm font-extrabold">
                Nährstoffgehalt {prozent ? 'in %' : `in kg je ${w.einheit}`}
              </span>
              <div className="grid grid-cols-5 gap-2">
                {NAEHRSTOFFE.map(([k, name]) => (
                  <label key={k} className="feld-label">
                    {name}
                    <input className="eingabe px-2" inputMode="decimal" value={w[k]} onChange={set(k)} />
                  </label>
                ))}
              </div>
              <label className="feld-label">
                Quelle der Werte
                <select className="eingabe" value={w.naehrstoffquelle} onChange={set('naehrstoffquelle')}>
                  <option>Deklaration</option>
                  <option>Analyse</option>
                  <option>Richtwert</option>
                </select>
              </label>
            </div>
          )}
          <label className="feld-label">
            Bemerkungen
            <textarea className="eingabe min-h-20 py-2" value={w.bemerkungen} onChange={set('bemerkungen')} />
          </label>
        </fieldset>
        {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
        {darfVerwalten && <button className="knopf">Speichern</button>}
      </form>

      {artikel && artikel.lagerfuehrung && <Journal artikelId={artikel.id} einheit={artikel.einheit} />}
    </div>
  );
}

function Buchen({ artikel }: { artikel: Lagerartikel & { bestand: number } }) {
  const qc = useQueryClient();
  const [art, setArt] = useState<'Eingang' | 'Verbrauch' | 'Korrektur' | 'Inventur'>('Eingang');
  const [wert, setWert] = useState('');
  const [preis, setPreis] = useState('');
  const [tag, setTag] = useState(heuteIso());
  const [bemerkung, setBemerkung] = useState('');
  const [meldung, setMeldung] = useState<{ text: string; fehler: boolean } | null>(null);

  async function buchen(e: FormEvent) {
    e.preventDefault();
    setMeldung(null);
    const n = zahlAus(wert);
    if (n == null || (art !== 'Korrektur' && n <= 0) || n === 0)
      return setMeldung({ text: art === 'Korrektur' ? 'Menge ungleich 0 eingeben (minus = Abgang).' : 'Menge grösser als 0 eingeben.', fehler: true });
    let error;
    if (art === 'Inventur') {
      ({ error } = await supabase.rpc('inventur_buchen', { p_artikel: artikel.id, p_gezaehlt: n, p_datum: tag }));
    } else {
      ({ error } = await supabase.from('lagerbewegungen').insert({
        betrieb_id: artikel.betrieb_id,
        artikel_id: artikel.id,
        datum: tag,
        art,
        menge: art === 'Verbrauch' ? -n : n,
        preis_je_einheit: art === 'Eingang' ? zahlAus(preis) : null,
        bemerkung: bemerkung.trim() || null,
      }));
    }
    if (error) return setMeldung({ text: fehlertext(error), fehler: true });
    setWert('');
    setPreis('');
    setBemerkung('');
    setMeldung({ text: 'Gebucht.', fehler: false });
    ABHAENGIGE_DATEN.forEach((k) => qc.invalidateQueries({ queryKey: k }));
  }

  return (
    <form onSubmit={buchen} className="karte flex flex-col gap-3">
      <h2 className="m-0 text-lg font-extrabold">Buchen</h2>
      <div className="grid grid-cols-4 gap-1 rounded-2xl bg-[#E7E1D0] p-1">
        {(['Eingang', 'Verbrauch', 'Korrektur', 'Inventur'] as const).map((a) => (
          <button
            key={a}
            type="button"
            aria-pressed={art === a}
            onClick={() => setArt(a)}
            className={`min-h-10 rounded-xl text-sm font-extrabold ${art === a ? 'bg-white text-hof' : 'text-[#4D5B50]'}`}
          >
            {a}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="feld-label">
          {art === 'Inventur' ? `Gezählter Bestand (${artikel.einheit})` : art === 'Korrektur' ? `Menge ± (${artikel.einheit})` : `Menge (${artikel.einheit})`}
          <input className="eingabe" inputMode="decimal" value={wert} onChange={(e) => setWert(e.target.value)} />
        </label>
        <label className="feld-label">
          Datum
          <input className="eingabe" type="date" value={tag} onChange={(e) => setTag(e.target.value)} />
        </label>
        {art === 'Eingang' && (
          <label className="feld-label">
            Preis (CHF/{artikel.einheit})
            <input className="eingabe" inputMode="decimal" value={preis} onChange={(e) => setPreis(e.target.value)} />
          </label>
        )}
        {art !== 'Inventur' && (
          <label className="feld-label">
            Bemerkung
            <input className="eingabe" value={bemerkung} onChange={(e) => setBemerkung(e.target.value)} placeholder={art === 'Eingang' ? 'z. B. Lieferschein-Nr.' : ''} />
          </label>
        )}
      </div>
      {meldung && (
        <p className={`m-0 rounded-xl p-3 text-sm font-semibold ${meldung.fehler ? 'bg-fehler-hell text-fehler' : 'bg-hof-hell text-hof'}`}>{meldung.text}</p>
      )}
      <button className="knopf">Buchen</button>
    </form>
  );
}

function Journal({ artikelId, einheit }: { artikelId: string; einheit: string }) {
  const journal = useQuery({
    queryKey: ['lagerjournal', artikelId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lagerbewegungen')
        .select('id, artikel_id, datum, art, menge, preis_je_einheit, quelle_typ, quelle_id, bemerkung')
        .eq('artikel_id', artikelId)
        .order('datum', { ascending: false })
        .order('erstellt_am', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as Lagerbewegung[];
    },
  });
  return (
    <section className="karte flex flex-col gap-1">
      <h2 className="m-0 mb-1 text-lg font-extrabold">Lagerbewegungen</h2>
      {journal.data?.length === 0 && <p className="m-0 text-sm text-leise">Noch keine Buchungen.</p>}
      {journal.data?.map((b) => (
        <div key={b.id} className="flex items-baseline justify-between gap-2 border-b border-rand py-1.5 text-sm last:border-0">
          <span className="flex flex-col">
            <span className="font-bold">
              {datum(b.datum)} · {b.art}
            </span>
            {(b.bemerkung || b.quelle_typ) &&
              (b.quelle_typ === 'feldarbeit' ? (
                <Link to={`/arbeiten/${b.quelle_id}`} className="text-xs">
                  {b.bemerkung ?? 'Feldarbeit'} ansehen
                </Link>
              ) : (
                <span className="text-xs text-leise">{b.bemerkung}</span>
              ))}
          </span>
          <span className={`whitespace-nowrap font-extrabold ${Number(b.menge) < 0 ? 'text-fehler' : 'text-hof'}`}>
            {Number(b.menge) > 0 ? '+' : ''}
            {menge(Number(b.menge), einheit)}
          </span>
        </div>
      ))}
    </section>
  );
}

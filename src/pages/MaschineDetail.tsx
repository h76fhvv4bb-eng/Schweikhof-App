import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import {
  ABHAENGIGE_DATEN, useHofobjekte, useLager, useMaschinen, useMaschinenEintraege, usePartner, useWartungFaellig, useWartungsplaene,
} from '../lib/daten';
import { chf, datum, heuteIso, menge, zahlAus } from '../lib/format';
import { EINTRAGSARTEN, MASCHINENKATEGORIEN, MIT_MOTOR, type Maschine, type MaschinenEintrag } from '../lib/typen';
import { Icon } from '../components/Icon';
import { Marke, tageBis } from './Maschinen';

type Werte = Record<string, string>;
const TEXTFELDER = [
  'name', 'hersteller', 'modell', 'seriennummer', 'kennzeichen', 'stammnummer', 'reifen_vorne', 'reifen_hinten',
  'motoroel', 'hydraulikoel', 'getriebeoel', 'versicherung', 'bemerkungen', 'mfk_faellig', 'kaufdatum',
] as const;
const ZAHLFELDER = [
  'baujahr', 'leistung_ps', 'leergewicht_kg', 'gesamtgewicht_kg', 'hoechstgeschw_kmh', 'arbeitsbreite_m', 'tankinhalt_l', 'kaufpreis', 'betriebsstunden',
] as const;
const MIT_SCHILD = ['Traktor', 'Hoflader/Teleskoplader', 'Anhänger', 'Güllefass', 'Ladewagen'];

export function MaschineDetail() {
  const { id } = useParams();
  const neu = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profil, darfVerwalten } = useAuth();
  const maschinen = useMaschinen();
  const orte = useHofobjekte();
  const m = maschinen.data?.find((x) => x.id === id);
  const [w, setW] = useState<Werte>({ kategorie: 'Traktor', status: 'in Betrieb', standort_id: '' });
  const [fehler, setFehler] = useState<string | null>(null);
  const [offenDaten, setOffenDaten] = useState(neu);

  useEffect(() => {
    if (!m) return;
    const x: Werte = { kategorie: m.kategorie, status: m.status, standort_id: m.standort_id ?? '' };
    for (const k of [...TEXTFELDER, ...ZAHLFELDER]) {
      const v = m[k as keyof Maschine];
      x[k] = v == null ? '' : String(v);
    }
    setW(x);
  }, [m]);

  async function speichern(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    if (!w.name?.trim()) return setFehler('Name fehlt.');
    const daten: Record<string, unknown> = { kategorie: w.kategorie, status: w.status, standort_id: w.standort_id || null };
    for (const k of TEXTFELDER) daten[k] = w[k]?.trim() ? w[k].trim() : null;
    for (const k of ZAHLFELDER) {
      const n = zahlAus(w[k] ?? '');
      if (w[k]?.trim() && (n == null || n < 0)) return setFehler(`Ungültige Zahl bei «${k.replace(/_/g, ' ')}».`);
      daten[k] = n;
    }
    const { error } = neu
      ? await supabase.from('maschinen').insert({ ...daten, betrieb_id: profil!.betrieb_id })
      : await supabase.from('maschinen').update({ ...daten, version: m!.version }).eq('id', id!);
    if (error) return setFehler(fehlertext(error));
    ABHAENGIGE_DATEN.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    if (neu) navigate('/maschinen');
    else setOffenDaten(false);
  }

  const set = (k: string) => (e: { target: { value: string } }) => setW({ ...w, [k]: e.target.value });
  const motor = MIT_MOTOR.includes(w.kategorie);
  const schild = MIT_SCHILD.includes(w.kategorie);
  const hallen = (orte.data ?? []).filter((o) => ['Maschinenhalle', 'Scheune', 'Werkstatt', 'Hof', 'Lager'].includes(o.typ));

  if (!neu && maschinen.isSuccess && !m) return <p>Maschine nicht gefunden.</p>;

  const feld = (k: string, label: string, art: 'text' | 'zahl' | 'datum' = 'text', platzhalter = '') => (
    <label className="feld-label">
      {label}
      <input
        className="eingabe"
        type={art === 'datum' ? 'date' : 'text'}
        inputMode={art === 'zahl' ? 'decimal' : undefined}
        value={w[k] ?? ''}
        onChange={set(k)}
        placeholder={platzhalter}
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <Link to="/maschinen" aria-label="Zurück" className="knopf-leise h-11 w-11 px-0">
          <Icon name="zurueck" />
        </Link>
        <div>
          <h1 className="m-0 text-2xl font-extrabold text-hof">{neu ? 'Neue Maschine' : w.name}</h1>
          {m && (
            <span className="text-sm font-bold text-leise">
              {[m.kategorie, m.hersteller, m.modell, m.betriebsstunden != null && `${menge(Number(m.betriebsstunden))} h`].filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
      </header>

      {m && <Faelligkeiten maschine={m} />}

      {m && !offenDaten && (
        <button className="knopf-leise self-start" onClick={() => setOffenDaten(true)}>
          Stammdaten anzeigen / bearbeiten
        </button>
      )}

      {offenDaten && (
        <form onSubmit={speichern} className="karte flex flex-col gap-3">
          <fieldset disabled={!darfVerwalten} className="m-0 flex flex-col gap-3 border-0 p-0">
            <div className="grid grid-cols-2 gap-3">
              <label className="feld-label">
                Kategorie
                <select className="eingabe" value={w.kategorie} onChange={set('kategorie')}>
                  {MASCHINENKATEGORIEN.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </label>
              {feld('name', 'Name', 'text', motor ? 'z. B. Fendt 312' : 'z. B. Kreiselegge 3 m')}
              {feld('hersteller', 'Hersteller')}
              {feld('modell', 'Modell / Typ')}
              {feld('baujahr', 'Baujahr', 'zahl')}
              {feld('seriennummer', 'Seriennummer')}
              <label className="feld-label">
                Standplatz
                <select className="eingabe" value={w.standort_id} onChange={set('standort_id')}>
                  <option value="">– keiner –</option>
                  {hallen.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} ({o.typ})
                    </option>
                  ))}
                </select>
              </label>
              <label className="feld-label">
                Status
                <select className="eingabe" value={w.status} onChange={set('status')}>
                  <option>in Betrieb</option>
                  <option>ausser Betrieb</option>
                  <option>verkauft</option>
                </select>
              </label>
            </div>
            {hallen.length === 0 && (
              <p className="m-0 text-xs text-leise">Für den Standplatz zuerst in der Hof-Ansicht eine Maschinenhalle platzieren.</p>
            )}

            {(motor || schild) && (
              <>
                <h2 className="m-0 mt-2 text-base font-extrabold">Zulassung</h2>
                <div className="grid grid-cols-2 gap-3">
                  {feld('kennzeichen', 'Kontrollschild', 'text', 'z. B. ZH 12345')}
                  {feld('stammnummer', 'Stammnummer')}
                  {feld('mfk_faellig', 'Nächste MFK', 'datum')}
                  {feld('versicherung', 'Versicherung')}
                </div>
              </>
            )}

            <h2 className="m-0 mt-2 text-base font-extrabold">Technische Daten</h2>
            <div className="grid grid-cols-2 gap-3">
              {motor && feld('leistung_ps', 'Leistung (PS)', 'zahl')}
              {motor && feld('betriebsstunden', 'Betriebsstunden (Zähler)', 'zahl')}
              {!motor && feld('arbeitsbreite_m', 'Arbeitsbreite (m)', 'zahl')}
              {feld('leergewicht_kg', 'Leergewicht (kg)', 'zahl')}
              {(motor || schild) && feld('gesamtgewicht_kg', 'Gesamtgewicht (kg)', 'zahl')}
              {motor && feld('hoechstgeschw_kmh', 'Höchstgeschw. (km/h)', 'zahl')}
              {motor && feld('tankinhalt_l', 'Tankinhalt (l)', 'zahl')}
              {(motor || schild) && feld('reifen_vorne', 'Reifen vorne', 'text', 'z. B. 420/70 R24')}
              {(motor || schild) && feld('reifen_hinten', 'Reifen hinten', 'text', 'z. B. 520/70 R34')}
              {motor && feld('motoroel', 'Motoröl', 'text', 'z. B. 15W-40, 9 l')}
              {motor && feld('hydraulikoel', 'Hydraulik-/Getriebeöl')}
              {motor && feld('getriebeoel', 'Achsöl / Weiteres')}
            </div>

            <h2 className="m-0 mt-2 text-base font-extrabold">Kauf</h2>
            <div className="grid grid-cols-2 gap-3">
              {feld('kaufdatum', 'Kaufdatum', 'datum')}
              {feld('kaufpreis', 'Kaufpreis (CHF)', 'zahl')}
            </div>
            <label className="feld-label">
              Bemerkungen
              <textarea className="eingabe min-h-20 py-2" value={w.bemerkungen ?? ''} onChange={set('bemerkungen')} />
            </label>
          </fieldset>
          {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
          {darfVerwalten && <button className="knopf">Speichern</button>}
        </form>
      )}

      {m && <Wartungsplaene maschine={m} />}
      {m && <Eintraege maschine={m} />}
    </div>
  );
}

function Faelligkeiten({ maschine }: { maschine: Maschine }) {
  const wartung = useWartungFaellig();
  const plaene = (wartung.data ?? []).filter((w) => w.maschine_id === maschine.id && (w.bald_faellig || w.ueberfaellig));
  const mfk = tageBis(maschine.mfk_faellig);
  if (!plaene.length && (mfk == null || mfk > 60)) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {plaene.map((p) => (
        <Marke key={p.plan_id} rot={p.ueberfaellig}>
          {p.bezeichnung} {p.ueberfaellig ? 'überfällig' : 'bald fällig'}
        </Marke>
      ))}
      {mfk != null && mfk <= 60 && <Marke rot={mfk < 0}>MFK {mfk < 0 ? 'abgelaufen' : `am ${datum(maschine.mfk_faellig)}`}</Marke>}
    </div>
  );
}

function Wartungsplaene({ maschine }: { maschine: Maschine }) {
  const { darfVerwalten } = useAuth();
  const qc = useQueryClient();
  const plaene = useWartungsplaene(maschine.id);
  const faellig = useWartungFaellig();
  const [neu, setNeu] = useState({ bezeichnung: '', tage: '', stunden: '' });
  const [fehler, setFehler] = useState<string | null>(null);

  async function hinzufuegen(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    const tage = zahlAus(neu.tage);
    const stunden = zahlAus(neu.stunden);
    if (!neu.bezeichnung.trim()) return setFehler('Bezeichnung fehlt.');
    if (!tage && !stunden) return setFehler('Intervall in Tagen oder Betriebsstunden angeben.');
    const { error } = await supabase.from('wartungsplaene').insert({
      betrieb_id: maschine.betrieb_id, maschine_id: maschine.id, bezeichnung: neu.bezeichnung.trim(),
      intervall_tage: tage ? Math.round(tage) : null, intervall_stunden: stunden,
    });
    if (error) return setFehler(fehlertext(error));
    setNeu({ bezeichnung: '', tage: '', stunden: '' });
    qc.invalidateQueries({ queryKey: ['wartungsplaene'] });
    qc.invalidateQueries({ queryKey: ['wartung'] });
  }
  async function entfernen(id: string, version: number) {
    const { error } = await supabase.from('wartungsplaene').update({ aktiv: false, version }).eq('id', id);
    if (error) return setFehler(fehlertext(error));
    qc.invalidateQueries({ queryKey: ['wartungsplaene'] });
    qc.invalidateQueries({ queryKey: ['wartung'] });
  }

  return (
    <section className="karte flex flex-col gap-2">
      <h2 className="m-0 text-lg font-extrabold">Wartungsplan</h2>
      {plaene.data?.length === 0 && <p className="m-0 text-sm text-leise">Noch keine regelmässigen Wartungen hinterlegt.</p>}
      {plaene.data?.map((p) => {
        const f = faellig.data?.find((x) => x.plan_id === p.id);
        return (
          <div key={p.id} className="flex items-center justify-between gap-2 border-b border-rand py-1.5 text-sm last:border-0">
            <span className="flex flex-col">
              <span className="font-bold">{p.bezeichnung}</span>
              <span className="text-xs text-leise">
                alle {[p.intervall_tage && `${p.intervall_tage} Tage`, p.intervall_stunden && `${menge(Number(p.intervall_stunden))} h`].filter(Boolean).join(' oder ')}
                {f?.zuletzt_am ? ` · zuletzt ${datum(f.zuletzt_am)}` : ' · noch nie erfasst'}
              </span>
            </span>
            <span className={`text-right text-xs font-extrabold ${f?.ueberfaellig ? 'text-fehler' : f?.bald_faellig ? 'text-warn' : 'text-leise'}`}>
              {f?.faellig_am && `fällig ${datum(f.faellig_am)}`}
              {f?.faellig_am && f?.faellig_stunden != null && <br />}
              {f?.faellig_stunden != null && `bei ${menge(Number(f.faellig_stunden))} h`}
              {darfVerwalten && (
                <button className="ml-2 font-bold text-leise" onClick={() => entfernen(p.id, p.version)} aria-label={`${p.bezeichnung} entfernen`}>
                  ✕
                </button>
              )}
            </span>
          </div>
        );
      })}
      {darfVerwalten && (
        <form onSubmit={hinzufuegen} className="mt-1 grid grid-cols-[1fr_80px_80px_auto] items-end gap-2">
          <label className="feld-label">
            Neue Wartung
            <input className="eingabe" value={neu.bezeichnung} onChange={(e) => setNeu({ ...neu, bezeichnung: e.target.value })} placeholder="z. B. Motoröl" />
          </label>
          <label className="feld-label">
            Tage
            <input className="eingabe px-2" inputMode="numeric" value={neu.tage} onChange={(e) => setNeu({ ...neu, tage: e.target.value })} />
          </label>
          <label className="feld-label">
            Std.
            <input className="eingabe px-2" inputMode="decimal" value={neu.stunden} onChange={(e) => setNeu({ ...neu, stunden: e.target.value })} />
          </label>
          <button className="knopf h-12 w-12 px-0" aria-label="Wartung hinzufügen">
            <Icon name="plus" />
          </button>
        </form>
      )}
      {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
    </section>
  );
}

function Eintraege({ maschine }: { maschine: Maschine }) {
  const { profil, darfVerwalten } = useAuth();
  const eintraege = useMaschinenEintraege(maschine.id);
  const partner = usePartner();
  const [bearbeiten, setBearbeiten] = useState<MaschinenEintrag | 'neu' | null>(null);
  const kosten = (eintraege.data ?? []).reduce((s, e) => s + Number(e.kosten ?? 0), 0);
  const farbe: Record<string, string> = { Wartung: 'bg-hof-hell text-hof', Reparatur: 'bg-fehler-hell text-fehler', Beobachtung: 'bg-warn-hell text-warn', Kontrolle: 'bg-[#E6F0F8] text-[#2D5F86]' };

  return (
    <section className="karte flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="m-0 text-lg font-extrabold">Wartungen, Reparaturen, Beobachtungen</h2>
          {kosten > 0 && <span className="text-xs text-leise">Kosten total {chf(kosten)}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {darfVerwalten && (
            <Link to={`/auftraege/neu?art=Werkstatt&maschine=${maschine.id}`} className="knopf-leise no-underline">
              <Icon name="auftrag" /> Werkstattauftrag
            </Link>
          )}
          {profil?.rolle !== 'lesen' && bearbeiten == null && (
            <button className="knopf" onClick={() => setBearbeiten('neu')}>
              <Icon name="plus" /> Eintrag
            </button>
          )}
        </div>
      </div>
      {bearbeiten != null && <EintragFormular maschine={maschine} eintrag={bearbeiten === 'neu' ? null : bearbeiten} onFertig={() => setBearbeiten(null)} />}
      {eintraege.data?.length === 0 && bearbeiten == null && <p className="m-0 text-sm text-leise">Noch keine Einträge.</p>}
      {eintraege.data?.map((e) => (
        <button
          key={e.id}
          onClick={() => setBearbeiten(e)}
          className="flex flex-col gap-0.5 border-b border-rand py-2 text-left last:border-0"
        >
          <span className="flex items-center gap-2">
            <span className={`rounded-lg px-2 py-0.5 text-xs font-extrabold ${farbe[e.art]}`}>{e.art}</span>
            {e.offen && <span className="rounded-lg bg-warn-hell px-2 py-0.5 text-xs font-extrabold text-warn">offen</span>}
            <span className="font-bold">{e.titel}</span>
          </span>
          <span className="text-xs text-leise">
            {[
              datum(e.datum),
              e.betriebsstunden != null && `${menge(Number(e.betriebsstunden))} h`,
              e.kosten != null && chf(Number(e.kosten)),
              e.partner_id && partner.data?.find((p) => p.id === e.partner_id)?.name,
              ...e.eintrag_teile.map((t) => `${menge(Number(t.menge), t.lagerartikel?.einheit)} ${t.lagerartikel?.bezeichnung}`),
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          {e.beschreibung && <span className="text-sm">{e.beschreibung}</span>}
        </button>
      ))}
    </section>
  );
}

function EintragFormular({ maschine, eintrag, onFertig }: { maschine: Maschine; eintrag: MaschinenEintrag | null; onFertig: () => void }) {
  const qc = useQueryClient();
  const { darfVerwalten, profil } = useAuth();
  const partner = usePartner();
  const plaene = useWartungsplaene(maschine.id);
  const lager = useLager();
  const [w, setW] = useState({
    art: eintrag?.art ?? 'Wartung',
    datum: eintrag?.datum ?? heuteIso(),
    betriebsstunden: eintrag?.betriebsstunden != null ? String(eintrag.betriebsstunden) : maschine.betriebsstunden != null ? String(maschine.betriebsstunden) : '',
    titel: eintrag?.titel ?? '',
    beschreibung: eintrag?.beschreibung ?? '',
    kosten: eintrag?.kosten != null ? String(eintrag.kosten) : '',
    arbeitszeit_h: eintrag?.arbeitszeit_h != null ? String(eintrag.arbeitszeit_h) : '',
    partner_id: eintrag?.partner_id ?? '',
    wartungsplan_id: eintrag?.wartungsplan_id ?? '',
    offen: eintrag?.offen ?? false,
  });
  const [teile, setTeile] = useState<{ artikel_id: string; menge: string }[]>(
    eintrag?.eintrag_teile.map((t) => ({ artikel_id: t.artikel_id, menge: String(t.menge) })) ?? [],
  );
  const [fehler, setFehler] = useState<string | null>(null);
  const darfAendern = !eintrag || darfVerwalten || eintrag.erstellt_von === profil?.id;
  const artikel = (lager.data ?? []).filter((a) => ['Ersatzteile', 'Betriebsstoffe', 'Verbrauchsmaterial'].includes(a.kategorie));

  async function speichern(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    if (!w.titel.trim()) return setFehler('Bitte kurz beschreiben, was gemacht oder beobachtet wurde.');
    const teileListe = [];
    for (const t of teile) {
      if (!t.artikel_id) continue;
      const n = zahlAus(t.menge);
      if (!n || n <= 0) return setFehler('Bei jedem Ersatzteil eine Menge grösser als 0 angeben.');
      teileListe.push({ artikel_id: t.artikel_id, menge: n });
    }
    if (new Set(teileListe.map((t) => t.artikel_id)).size !== teileListe.length) return setFehler('Jedes Teil nur einmal angeben.');
    const { error } = await supabase.rpc('maschineneintrag_speichern', {
      p: {
        id: eintrag?.id ?? null, version: eintrag?.version, maschine_id: maschine.id, art: w.art, datum: w.datum,
        betriebsstunden: zahlAus(w.betriebsstunden), titel: w.titel.trim(), beschreibung: w.beschreibung.trim(),
        kosten: zahlAus(w.kosten), arbeitszeit_h: zahlAus(w.arbeitszeit_h), partner_id: w.partner_id || null,
        wartungsplan_id: w.wartungsplan_id || null, offen: w.offen, teile: teileListe,
      },
    });
    if (error) return setFehler(fehlertext(error));
    ABHAENGIGE_DATEN.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    onFertig();
  }
  async function loeschen() {
    if (!eintrag || !confirm('Eintrag löschen? Verbrauchte Teile werden ins Lager zurückgebucht.')) return;
    const { error } = await supabase.rpc('maschineneintrag_loeschen', { p_id: eintrag.id });
    if (error) return setFehler(fehlertext(error));
    ABHAENGIGE_DATEN.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    onFertig();
  }
  const set = (k: keyof typeof w) => (e: { target: { value: string } }) => setW({ ...w, [k]: e.target.value });

  return (
    <form onSubmit={speichern} className="flex flex-col gap-3 rounded-2xl bg-grund p-3">
      <fieldset disabled={!darfAendern} className="m-0 flex flex-col gap-3 border-0 p-0">
        <div className="grid grid-cols-4 gap-1 rounded-2xl bg-[#E7E1D0] p-1">
          {EINTRAGSARTEN.map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={w.art === a}
              onClick={() => setW({ ...w, art: a, offen: a === 'Beobachtung' ? true : w.offen })}
              className={`min-h-10 rounded-xl text-xs font-extrabold ${w.art === a ? 'bg-white text-hof' : 'text-[#4D5B50]'}`}
            >
              {a}
            </button>
          ))}
        </div>
        <label className="feld-label">
          {w.art === 'Beobachtung' ? 'Was ist aufgefallen?' : 'Was wurde gemacht?'}
          <input className="eingabe" value={w.titel} onChange={set('titel')} placeholder={w.art === 'Beobachtung' ? 'z. B. Hydraulik verliert Öl' : 'z. B. Motoröl und Filter gewechselt'} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="feld-label">
            Datum
            <input className="eingabe" type="date" value={w.datum} onChange={set('datum')} />
          </label>
          <label className="feld-label">
            Betriebsstunden
            <input className="eingabe" inputMode="decimal" value={w.betriebsstunden} onChange={set('betriebsstunden')} />
          </label>
          {w.art !== 'Beobachtung' && (
            <>
              <label className="feld-label">
                Kosten (CHF)
                <input className="eingabe" inputMode="decimal" value={w.kosten} onChange={set('kosten')} />
              </label>
              <label className="feld-label">
                Arbeitszeit (Std.)
                <input className="eingabe" inputMode="decimal" value={w.arbeitszeit_h} onChange={set('arbeitszeit_h')} />
              </label>
            </>
          )}
          <label className="feld-label">
            Ausgeführt von (Partner)
            <select className="eingabe" value={w.partner_id} onChange={set('partner_id')}>
              <option value="">selbst</option>
              {(partner.data ?? []).filter((p) => p.aktiv).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {w.art === 'Wartung' && (plaene.data?.length ?? 0) > 0 && (
            <label className="feld-label">
              Gehört zu Wartungsplan
              <select className="eingabe" value={w.wartungsplan_id} onChange={set('wartungsplan_id')}>
                <option value="">–</option>
                {plaene.data!.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.bezeichnung}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <label className="feld-label">
          Beschreibung
          <textarea className="eingabe min-h-16 py-2" value={w.beschreibung} onChange={set('beschreibung')} />
        </label>
        {(w.art === 'Beobachtung' || w.art === 'Reparatur' || w.offen) && (
          <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
            <input type="checkbox" className="h-5 w-5 accent-hof" checked={w.offen} onChange={(e) => setW({ ...w, offen: e.target.checked })} />
            Noch offen (Mangel nicht behoben)
          </label>
        )}
        {w.art !== 'Beobachtung' && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-leise">Verwendete Teile und Betriebsstoffe aus dem Lager</span>
            {teile.map((t, i) => (
              <div key={i} className="grid grid-cols-[1fr_90px_auto] gap-2">
                <select
                  className="eingabe"
                  value={t.artikel_id}
                  onChange={(e) => setTeile(teile.map((x, j) => (j === i ? { ...x, artikel_id: e.target.value } : x)))}
                  aria-label="Artikel"
                >
                  <option value="">– wählen –</option>
                  {artikel.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.bezeichnung} ({menge(Number(a.bestand), a.einheit)})
                    </option>
                  ))}
                </select>
                <input
                  className="eingabe px-2"
                  inputMode="decimal"
                  value={t.menge}
                  onChange={(e) => setTeile(teile.map((x, j) => (j === i ? { ...x, menge: e.target.value } : x)))}
                  aria-label="Menge"
                />
                <button type="button" className="knopf-leise h-12 w-12 px-0" onClick={() => setTeile(teile.filter((_, j) => j !== i))} aria-label="Teil entfernen">
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="self-start text-sm font-extrabold text-hof" onClick={() => setTeile([...teile, { artikel_id: '', menge: '1' }])}>
              + Teil aus Lager
            </button>
            {artikel.length === 0 && <span className="text-xs text-leise">Im Lager gibt es noch keine Ersatzteile oder Betriebsstoffe.</span>}
          </div>
        )}
      </fieldset>
      {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
      <div className="flex flex-wrap gap-2">
        {darfAendern && <button className="knopf">Speichern</button>}
        <button type="button" className="knopf-leise" onClick={onFertig}>
          {darfAendern ? 'Abbrechen' : 'Schliessen'}
        </button>
        {eintrag && darfAendern && (
          <button type="button" className="ml-auto text-sm font-bold text-fehler" onClick={loeschen}>
            Löschen
          </button>
        )}
      </div>
    </form>
  );
}

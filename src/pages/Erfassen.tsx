import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { ABHAENGIGE_DATEN, useFeldarbeit, useFeldarbeitGeraete, useFelder, useGeplanteArbeiten, useHinweise, useLager, useMaschinen, useMitarbeiter, usePartner, useBetrieb } from '../lib/daten';
import { PersonAuswahl } from './Mitarbeiter';
import { HinweisListe } from '../components/FeldWerkzeuge';
import { MIT_MOTOR } from '../lib/typen';
import { ha, heuteIso, menge, zahlAus } from '../lib/format';
import { ARBEITSARTEN, ERNTEARBEITEN, rollenText, type Arbeitsart, type Lagerbestand, type Maschine } from '../lib/typen';
import { Icon } from '../components/Icon';
import { ZaehlerFelder, pruefeZaehler } from '../components/Zaehler';
import { ErnteWeiter } from '../components/ErnteWeiter';
import { ernteLink } from '../lib/ernteWeiter';
import { bffHinweise } from '../lib/bff';
import { NEU, NeuerArtikelDialog } from '../components/Schnellanlage';

const HAUPTARTEN: Arbeitsart[] = ['Pflügen', 'Grubbern', 'Eggen', 'Säen', 'Düngen', 'Pflanzenschutz', 'Mähen', 'Wenden', 'Schwaden', 'Pressen', 'Ernten', 'Mulchen'];
const MITTEL_KATEGORIE: Partial<Record<Arbeitsart, Lagerbestand['kategorie']>> = {
  Düngen: 'Dünger',
  Säen: 'Saatgut',
  Pflanzenschutz: 'Pflanzenschutzmittel',
};
/** Arbeiten, bei denen Betriebsmittel angegeben werden können (Häkchen); bei Düngen und Pflanzenschutz standardmässig an */
const MIT_MITTEL_MOEGLICH: Arbeitsart[] = ['Düngen', 'Säen', 'Pflanzenschutz', 'Andere'];
const MITTEL_STANDARD: Arbeitsart[] = ['Düngen', 'Pflanzenschutz'];

interface MittelZeile {
  artikel_id: string;
  menge_je_ha: string;
  vom_lager: boolean;
  total?: string; // Gesamtmenge, wenn so eingegeben (z. B. 50 kg auf die gewählte Fläche)
}

/** Menge pro ha als Text, aus Gesamtmenge und Fläche */
const proHaAusTotal = (total: string, m2: number) => {
  const t = zahlAus(total);
  if (t == null || m2 <= 0) return '';
  return String(Math.round((t / (m2 / 10000)) * 10000) / 10000);
};

export function Erfassen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profil, darfVerwalten } = useAuth();
  const felder = useFelder();
  const betrieb = useBetrieb();
  const lager = useLager();
  const mitarbeiter = useMitarbeiter();
  const geplanteArbeiten = useGeplanteArbeiten();
  const vorhanden = useFeldarbeit(id);
  const [params] = useSearchParams();

  const [datum, setDatum] = useState(heuteIso());
  const [arbeitsart, setArbeitsart] = useState<Arbeitsart>('Düngen');
  const [geplant, setGeplant] = useState(false);
  const [gewaehlt, setGewaehlt] = useState<Record<string, string>>({}); // feld_id → Teilfläche in ha ('' = ganzes Feld)
  const [mittel, setMittel] = useState<MittelZeile[]>([]);
  const [mitMittel, setMitMittel] = useState(true);
  const [neuerArtikelFuer, setNeuerArtikelFuer] = useState<number | null>(null);
  const [mehr, setMehr] = useState(false);
  const [dauer, setDauer] = useState('');
  const [maschine, setMaschine] = useState('');
  const [geraet, setGeraet] = useState('');
  const [maschineId, setMaschineId] = useState('');
  const [geraetIds, setGeraetIds] = useState<string[]>([]); // mehrere Geräte am Traktor, das erste zählt als Hauptgerät
  const geraetId = geraetIds[0] ?? '';
  const geraeteListe = useFeldarbeitGeraete();
  const [partnerId, setPartnerId] = useState('');
  const lohnarbeit = !!partnerId;
  const [ernteWeiter, setErnteWeiter] = useState<string | null>(null);
  const maschinen = useMaschinen();
  const partner = usePartner();
  const hinweise = useHinweise();
  const [person, setPerson] = useState(''); // Mitarbeiter-ID
  const [vorgaengerId, setVorgaengerId] = useState('');
  const [abschluss, setAbschluss] = useState({ m_stunden: '', m_km: '', g_stunden: '', beobachtung: '', melden: '' });
  const [ausbringung, setAusbringung] = useState('');
  const [bemerkungen, setBemerkungen] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [speichert, setSpeichert] = useState(false);

  // Bestehende Arbeit laden
  useEffect(() => {
    const a = vorhanden.data;
    if (!a) return;
    setDatum(a.datum);
    setArbeitsart(a.arbeitsart);
    setGeplant(a.status === 'geplant');
    const felderMap: Record<string, string> = {};
    for (const f of a.feldarbeit_felder) {
      const feld = felder.data?.find((x) => x.id === f.feld_id);
      felderMap[f.feld_id] = feld && Math.abs(Number(feld.flaeche_m2) - Number(f.flaeche_m2)) > 0.5 ? String(Number(f.flaeche_m2) / 10000) : '';
    }
    setGewaehlt(felderMap);
    setMittel(a.feldarbeit_mittel.map((m) => ({ artikel_id: m.artikel_id, menge_je_ha: String(m.menge_je_ha), vom_lager: m.vom_lager !== false })));
    setMitMittel(a.feldarbeit_mittel.length > 0);
    setDauer(a.dauer_h == null ? '' : String(a.dauer_h));
    setMaschine(a.maschine ?? '');
    setGeraet(a.geraet ?? '');
    setMaschineId(a.maschine_id ?? '');
    setGeraetIds(geraeteListe.data?.get(a.id) ?? (a.geraet_id ? [a.geraet_id] : []));
    setPartnerId(a.partner_id ?? '');
    setPerson(a.mitarbeiter_id ?? mitarbeiter.data?.find((m) => m.benutzer_id === a.ausgefuehrt_von)?.id ?? '');
    setVorgaengerId(a.vorgaenger_id ?? '');
    setAbschluss({
      m_stunden: a.maschine_stunden != null ? String(a.maschine_stunden) : '',
      m_km: a.maschine_km != null ? String(a.maschine_km) : '',
      g_stunden: a.geraet_stunden != null ? String(a.geraet_stunden) : '',
      beobachtung: a.beobachtung ?? '',
      melden: '',
    });
    setAusbringung(a.ausbringung ?? '');
    setBemerkungen(a.bemerkungen ?? '');
    setMehr(!!(a.dauer_h || a.maschine || a.geraet || a.bemerkungen || a.ausbringung || a.maschine_id || a.geraet_id || a.partner_id));
  }, [vorhanden.data, felder.data, mitarbeiter.data, geraeteListe.data]);

  useEffect(() => {
    const ich = mitarbeiter.data?.find((m) => m.benutzer_id === profil?.id);
    if (!id && ich && !params.get('geplant')) setPerson(ich.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, profil, mitarbeiter.data]);

  // Aus der Hof-Ansicht: ?feld=<id> wählt das Feld vor; aus den Aufgaben: ?geplant=1, Folgearbeit: ?nach=<id>
  useEffect(() => {
    const feld = params.get('feld');
    if (!id && feld) setGewaehlt({ [feld]: '' });
    const nach = params.get('nach');
    if (!id && nach) setVorgaengerId(nach);
    if (!id && params.get('geplant')) {
      setGeplant(true);
      setMehr(true);
    }
  }, [id, params]);

  // Folgearbeit: Felder und Datum der vorherigen Arbeit übernehmen
  const vorgaenger = (geplanteArbeiten.data ?? []).find((a) => a.id === vorgaengerId);
  useEffect(() => {
    if (id || !vorgaenger || params.get('nach') !== vorgaenger.id) return;
    setGewaehlt((g) => (Object.keys(g).length ? g : Object.fromEntries(vorgaenger.feldarbeit_felder.map((f) => [f.feld_id, '']))));
    const d = new Date(`${vorgaenger.datum}T12:00:00`);
    d.setDate(d.getDate() + 1);
    setDatum(d.toISOString().slice(0, 10));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vorgaenger?.id]);

  // Betriebsmittel: je nach Arbeitsart vorschlagen (beim Laden einer bestehenden Arbeit nicht überschreiben)
  useEffect(() => {
    if (vorhanden.data && vorhanden.data.arbeitsart === arbeitsart) return;
    setMitMittel(MITTEL_STANDARD.includes(arbeitsart));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arbeitsart]);

  const aktiveFelder = (felder.data ?? []).filter((f) => f.status === 'bewirtschaftet');
  const inBetrieb = (maschinen.data ?? []).filter((m) => m.status === 'in Betrieb');
  const zugmaschinen = inBetrieb.filter((m) => MIT_MOTOR.includes(m.kategorie));
  const geraete = inBetrieb.filter((m) => !MIT_MOTOR.includes(m.kategorie));
  const flaecheM2 = useMemo(
    () =>
      Object.entries(gewaehlt).reduce((s, [fid, teil]) => {
        const f = felder.data?.find((x) => x.id === fid);
        const t = zahlAus(teil);
        return s + (t ? t * 10000 : Number(f?.flaeche_m2 ?? 0));
      }, 0),
    [gewaehlt, felder.data],
  );
  const kategorie = MITTEL_KATEGORIE[arbeitsart];
  const artikelAuswahl = (lager.data ?? []).filter((a) => !kategorie || a.kategorie === kategorie);
  const mittelMoeglich = MIT_MITTEL_MOEGLICH.includes(arbeitsart) || (mittel.length > 0 && mittel.some((m) => m.artikel_id));
  const zeigeMittel = mittelMoeglich && mitMittel;

  useEffect(() => {
    if (zeigeMittel && mittel.length === 0) setMittel([{ artikel_id: '', menge_je_ha: '', vom_lager: true }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zeigeMittel]);

  // Wurde die Gesamtmenge eingegeben, bei geänderter Fläche die Menge pro ha neu rechnen
  useEffect(() => {
    if (mittel.some((m) => m.total))
      setMittel((ms) => ms.map((m) => (m.total ? { ...m, menge_je_ha: proHaAusTotal(m.total, flaecheM2) } : m)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flaecheM2]);

  function feldUmschalten(fid: string) {
    setGewaehlt((g) => {
      const n = { ...g };
      if (fid in n) delete n[fid];
      else n[fid] = '';
      return n;
    });
  }

  async function speichern(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    const felderListe = Object.entries(gewaehlt).map(([feld_id, teil]) => {
      const t = zahlAus(teil);
      return t ? { feld_id, flaeche_m2: Math.round(t * 100000) / 10 } : { feld_id };
    });
    if (felderListe.length === 0) return setFehler('Bitte mindestens ein Feld wählen.');
    const mittelListe = [];
    for (const m of zeigeMittel ? mittel : []) {
      if (!m.artikel_id && !m.menge_je_ha) continue;
      const wert = zahlAus(m.menge_je_ha);
      if (!m.artikel_id) return setFehler('Bitte bei jeder Mengenangabe ein Mittel wählen.');
      if (!wert || wert <= 0) return setFehler('Bitte eine Menge pro ha grösser als 0 eingeben.');
      mittelListe.push({ artikel_id: m.artikel_id, menge_je_ha: wert, vom_lager: m.vom_lager });
    }
    if (new Set(mittelListe.map((m) => m.artikel_id)).size !== mittelListe.length)
      return setFehler('Jedes Mittel nur einmal pro Arbeit angeben.');
    const d = zahlAus(dauer);
    if (dauer && (d == null || d < 0)) return setFehler('Arbeitsdauer ungültig.');
    if (!geplant && datum > heuteIso()) return setFehler('Eine erledigte Arbeit kann nicht in der Zukunft liegen. Als «geplant» speichern?');
    const zMaschine = maschinen.data?.find((m) => m.id === maschineId);
    const zGeraet = maschinen.data?.find((m) => m.id === geraetId);
    if (!geplant && !lohnarbeit) {
      const pz =
        (zMaschine && (pruefeZaehler(abschluss.m_stunden, id ? null : zMaschine.betriebsstunden, zMaschine.name) ??
          pruefeZaehler(abschluss.m_km, id ? null : zMaschine.kilometerstand, zMaschine.name))) ||
        (zGeraet && pruefeZaehler(abschluss.g_stunden, id ? null : zGeraet.betriebsstunden, zGeraet.name));
      if (pz && !confirm(`${pz}\n\nTrotzdem speichern?`)) return;
    }

    setSpeichert(true);
    const nutzlast = {
        id: id ?? null,
        version: vorhanden.data?.version,
        datum,
        arbeitsart,
        status: geplant ? 'geplant' : 'erledigt',
        // neue Lohnarbeit: keine eigene Person und Arbeitszeit (bestehende Angaben bleiben beim Bearbeiten)
        dauer_h: lohnarbeit && !geplant && !id ? null : d,
        maschine,
        geraet,
        maschine_id: maschineId || null,
        geraet_id: geraetId || null,
        partner_id: partnerId || null,
        mitarbeiter_id: lohnarbeit && !geplant && !id ? null : person || null,
        ausgefuehrt_von: lohnarbeit && !geplant && !id ? null : (mitarbeiter.data?.find((m) => m.id === person)?.benutzer_id ?? null),
        vorgaenger_id: vorgaengerId || null,
        ausbringung,
        bemerkungen,
        felder: felderListe,
        mittel: mittelListe,
        geraete: geraetIds,
    };
    let { data: arbeitId, error } = await supabase.rpc('feldarbeit_speichern_geraete', { p: nutzlast });
    // Datenbank ohne Migration 21: wie bisher mit einem Gerät speichern
    if (error && /feldarbeit_speichern_geraete/.test(error.message)) {
      ({ data: arbeitId, error } = await supabase.rpc('feldarbeit_speichern', { p: nutzlast }));
      if (!error && geraetIds.length > 1) alert('Gespeichert, aber nur mit dem ersten Gerät. Für mehrere Geräte bitte Migration 21 in Supabase einspielen.');
    }
    if (error) {
      setSpeichert(false);
      return setFehler(fehlertext(error));
    }
    const hatAbschluss = abschluss.m_stunden || abschluss.m_km || abschluss.g_stunden || abschluss.beobachtung.trim() || vorhanden.data?.beobachtung || vorhanden.data?.maschine_stunden != null;
    if (!geplant && hatAbschluss) {
      const r = await supabase.rpc('feldarbeit_abschluss', {
        p_id: arbeitId as string,
        p: {
          maschine_stunden: maschineId && !lohnarbeit ? zahlAus(abschluss.m_stunden) : null,
          maschine_km: maschineId && !lohnarbeit ? zahlAus(abschluss.m_km) : null,
          geraet_stunden: geraetId && !lohnarbeit ? zahlAus(abschluss.g_stunden) : null,
          beobachtung: abschluss.beobachtung.trim() || null,
          beobachtung_an_maschine: abschluss.melden || null,
        },
      });
      if (r.error) {
        setSpeichert(false);
        ABHAENGIGE_DATEN.forEach((k) => qc.invalidateQueries({ queryKey: k }));
        return setFehler(`Arbeit gespeichert, aber Zähler/Beobachtung nicht: ${fehlertext(r.error)}`);
      }
    }
    setSpeichert(false);
    ABHAENGIGE_DATEN.concat([['auftraege']]).forEach((k) => qc.invalidateQueries({ queryKey: k }));
    // Nach einer neu erfassten Erntearbeit direkt zur Ernte
    if (!geplant && !id && ERNTEARBEITEN.includes(arbeitsart)) {
      return setErnteWeiter(
        ernteLink({
          felder: felderListe.map((f) => ({ feld_id: f.feld_id, flaeche_m2: ('flaeche_m2' in f ? f.flaeche_m2 : null) ?? Number(felder.data?.find((x) => x.id === f.feld_id)?.flaeche_m2 ?? 0) })),
          datum,
          arbeitsart,
          partner_id: partnerId || null,
        }),
      );
    }
    navigate(geplant ? '/aufgaben' : '/kartei');
  }

  async function loeschen() {
    if (!id || !confirm('Diese Arbeit löschen? Lagerbuchungen werden zurückgenommen.')) return;
    const { error } = await supabase.rpc('feldarbeit_loeschen', { p_id: id });
    if (error) return setFehler(fehlertext(error));
    ABHAENGIGE_DATEN.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    navigate('/kartei');
  }

  if (profil?.rolle === 'lesen') return <p>Mit der Rolle «Lesen» können keine Arbeiten erfasst werden.</p>;
  const ichMitarbeiter = mitarbeiter.data?.find((m) => m.benutzer_id === profil?.id)?.id;
  const darfAendern =
    !id || darfVerwalten || vorhanden.data?.erstellt_von === profil?.id || (!!ichMitarbeiter && vorhanden.data?.mitarbeiter_id === ichMitarbeiter);

  return (
    <form onSubmit={speichern} className="flex flex-col gap-5 pb-24">
      <header className="flex items-center gap-3">
        <Link to={id ? '/kartei' : '/'} aria-label="Zurück" className="knopf-leise h-11 w-11 px-0">
          <Icon name="zurueck" />
        </Link>
        <h1 className="m-0 text-2xl font-extrabold text-hof">{id ? 'Arbeit bearbeiten' : geplant ? 'Arbeit planen' : 'Arbeit erfassen'}</h1>
      </header>

      <fieldset disabled={!darfAendern} className="m-0 flex flex-col gap-5 border-0 p-0">
        <section className="flex flex-col gap-2">
          <h2 className="m-0 text-[15px] font-extrabold text-[#3E4C41]">1 · Was?</h2>
          <div className="grid grid-cols-4 gap-2">
            {HAUPTARTEN.map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={arbeitsart === a}
                onClick={() => setArbeitsart(a)}
                className={`min-h-14 rounded-2xl px-1 text-[13px] font-extrabold ${
                  arbeitsart === a ? 'border-[3px] border-hof bg-hof-hell text-hof' : 'border-0 bg-white shadow-[0_3px_0_var(--color-rand)]'
                }`}
              >
                {a}
              </button>
            ))}
          </div>
          <label className="feld-label">
            Andere Arbeitsart
            <select className="eingabe" value={arbeitsart} onChange={(e) => setArbeitsart(e.target.value as Arbeitsart)}>
              {ARBEITSARTEN.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <h2 className="m-0 text-[15px] font-extrabold text-[#3E4C41]">2 · Wo?</h2>
            <span className="text-sm font-extrabold text-hof">
              {Object.keys(gewaehlt).length} Felder · {ha(flaecheM2)}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {aktiveFelder.map((f) => {
              const an = f.id in gewaehlt;
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={an}
                  onClick={() => feldUmschalten(f.id)}
                  className={`min-h-11 rounded-full border-2 px-4 text-sm font-extrabold ${
                    an ? 'border-hof bg-hof text-white' : 'border-linie bg-white text-text'
                  }`}
                >
                  {f.name}
                </button>
              );
            })}
            {aktiveFelder.length === 0 && (
              <Link to="/felder/neu" className="text-sm font-bold">
                Zuerst ein Feld anlegen
              </Link>
            )}
          </div>
          {Object.keys(gewaehlt).length > 0 && (
            <div className="flex flex-col gap-1">
              <HinweisListe hinweise={(hinweise.data ?? []).filter((h) => h.feld_id in gewaehlt && h.art !== 'Info')} />
            </div>
          )}
          {Object.keys(gewaehlt).length > 0 && mehr && (
            <div className="karte flex flex-col gap-2">
              <span className="text-xs font-bold text-leise">Nur Teilfläche bearbeitet? (leer = ganzes Feld)</span>
              {Object.entries(gewaehlt).map(([fid, teil]) => {
                const f = felder.data?.find((x) => x.id === fid);
                return (
                  <label key={fid} className="flex items-center justify-between gap-2 text-sm font-bold">
                    {f?.name} ({ha(Number(f?.flaeche_m2))})
                    <input
                      className="eingabe w-28"
                      inputMode="decimal"
                      placeholder="ha"
                      value={teil}
                      onChange={(e) => setGewaehlt({ ...gewaehlt, [fid]: e.target.value })}
                    />
                  </label>
                );
              })}
            </div>
          )}
        </section>

        <section className="karte flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="feld-label">
              Datum
              <input className="eingabe" type="date" required value={datum} onChange={(e) => setDatum(e.target.value)} />
            </label>
            <label className="feld-label">
              Status
              <select className="eingabe" value={geplant ? 'geplant' : 'erledigt'} onChange={(e) => setGeplant(e.target.value === 'geplant')}>
                <option value="erledigt">erledigt</option>
                <option value="geplant">geplant</option>
              </select>
            </label>
          </div>

          {(geplant || vorgaengerId) && (
            <label className="feld-label">
              Erst nach … (Folgearbeit, optional)
              <select className="eingabe" value={vorgaengerId} onChange={(e) => setVorgaengerId(e.target.value)}>
                <option value="">– unabhängig –</option>
                {(geplanteArbeiten.data ?? [])
                  .filter((a) => a.id !== id)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.arbeitsart} · {a.feldarbeit_felder.map((f) => felder.data?.find((x) => x.id === f.feld_id)?.name).join(', ')} ({a.datum.split('-').reverse().join('.')})
                    </option>
                  ))}
                {vorgaengerId && !geplanteArbeiten.data?.some((a) => a.id === vorgaengerId) && <option value={vorgaengerId}>bereits erledigte Arbeit</option>}
              </select>
              {vorgaenger && <span className="text-xs font-normal text-leise">Diese Arbeit kann erst erledigt werden, wenn «{vorgaenger.arbeitsart}» erledigt ist.</span>}
            </label>
          )}
          {mittelMoeglich && (
            <label className="flex min-h-11 items-center gap-2 text-sm font-extrabold">
              <input type="checkbox" className="h-5 w-5 accent-hof" checked={mitMittel} onChange={(e) => setMitMittel(e.target.checked)} />
              Betriebsmittel angeben ({kategorie ?? 'Saatgut, Dünger …'})
            </label>
          )}
          {zeigeMittel && (
            <div className="flex flex-col gap-3">
              <h2 className="m-0 text-[15px] font-extrabold text-[#3E4C41]">3 · Womit und wie viel?</h2>
              {mittel.map((m, i) => {
                const art = lager.data?.find((a) => a.id === m.artikel_id);
                const proHa = zahlAus(m.menge_je_ha) ?? 0;
                const gesamt = (proHa * flaecheM2) / 10000;
                const fehlt = art && art.lagerfuehrung && m.vom_lager && !geplant && gesamt > Number(art.bestand) + (id ? gesamtAlt(vorhanden.data, art.id) : 0);
                const n = art?.n_je_einheit != null ? proHa * Number(art.n_je_einheit) : null;
                return (
                  <div key={i} className="flex flex-col gap-2 rounded-2xl bg-grund p-3">
                    <label className="feld-label">
                      {kategorie ?? 'Betriebsmittel'}
                      <select
                        className="eingabe"
                        value={m.artikel_id}
                        onChange={(e) =>
                          e.target.value === NEU
                            ? setNeuerArtikelFuer(i)
                            : setMittel(mittel.map((x, j) => (j === i ? { ...x, artikel_id: e.target.value } : x)))
                        }
                      >
                        <option value="">– wählen –</option>
                        {darfVerwalten && <option value={NEU}>+ Neu: {kategorie ?? 'Betriebsmittel'} anlegen …</option>}
                        {artikelAuswahl.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.bezeichnung}
                            {a.lagerfuehrung ? ` · Lager ${menge(Number(a.bestand), a.einheit)}` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="feld-label">
                        Menge pro ha
                        <span className="flex items-center gap-2">
                          <input
                            className={`eingabe w-full ${m.total ? 'bg-white/60 text-leise' : ''}`}
                            inputMode="decimal"
                            value={m.total ? (proHa ? String(Math.round(proHa * 100) / 100) : '') : m.menge_je_ha}
                            onChange={(e) => setMittel(mittel.map((x, j) => (j === i ? { ...x, menge_je_ha: e.target.value, total: undefined } : x)))}
                          />
                          <span className="shrink-0">{art?.einheit ?? ''}/ha</span>
                        </span>
                      </label>
                      <label className="feld-label">
                        oder Gesamt auf {ha(flaecheM2)}
                        <span className="flex items-center gap-2">
                          <input
                            className={`eingabe w-full ${m.total ? '' : 'bg-white/60 text-leise'}`}
                            inputMode="decimal"
                            value={m.total ?? (gesamt ? String(Math.round(gesamt * 100) / 100) : '')}
                            onChange={(e) =>
                              setMittel(mittel.map((x, j) => (j === i ? { ...x, total: e.target.value, menge_je_ha: proHaAusTotal(e.target.value, flaecheM2) } : x)))
                            }
                            disabled={flaecheM2 <= 0}
                          />
                          <span className="shrink-0">{art?.einheit ?? ''}</span>
                        </span>
                      </label>
                    </div>
                    {m.total && proHa > 0 && (
                      <span className="text-xs font-semibold text-hof">
                        = {menge(proHa)} {art?.einheit}/ha auf {ha(flaecheM2)}
                      </span>
                    )}
                    {n != null && proHa > 0 && (
                      <span className="text-sm text-[#3E4C41]">
                        N: <strong>{menge(n)} kg/ha</strong> · {menge((n * flaecheM2) / 10000)} kg total
                      </span>
                    )}
                    {fehlt && (
                      <span className="flex gap-2 rounded-xl bg-warn-hell p-2 text-sm font-semibold text-[#5C3D00]">
                        <Icon name="warnung" groesse={18} className="shrink-0" />
                        Lager reicht nicht ({menge(Number(art!.bestand), art!.einheit)} vorhanden). Speichern ist trotzdem möglich.
                      </span>
                    )}
                    {art?.lagerfuehrung && (
                      <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-hof"
                          checked={m.vom_lager}
                          onChange={(e) => setMittel(mittel.map((x, j) => (j === i ? { ...x, vom_lager: e.target.checked } : x)))}
                        />
                        Vom eigenen Lager abbuchen (aus = vom Dienstleister mitgebracht)
                      </label>
                    )}
                    {mittel.length > 1 && (
                      <button type="button" className="self-start text-sm font-bold text-fehler" onClick={() => setMittel(mittel.filter((_, j) => j !== i))}>
                        Entfernen
                      </button>
                    )}
                  </div>
                );
              })}
              {artikelAuswahl.length === 0 && (
                <p className="m-0 text-sm text-leise">
                  Noch keine Artikel der Kategorie «{kategorie ?? 'Betriebsmittel'}».{' '}
                  {darfVerwalten ? 'Im Auswahlfeld «+ Neu» wählen.' : <Link to="/lager">Zum Lager</Link>}
                </p>
              )}
            </div>
          )}
          {zeigeMittel && (
            <button
              type="button"
              className="self-start text-sm font-extrabold text-hof"
              onClick={() => setMittel([...mittel, { artikel_id: '', menge_je_ha: '', vom_lager: true }])}
            >
              + weiteres Mittel
            </button>
          )}
          {!mehr && (
            <button type="button" className="self-start text-sm font-extrabold text-hof" onClick={() => setMehr(true)}>
              + {geplant ? 'Dauer, Maschine, Person, Lohnunternehmen, ' : ''}Teilfläche, Bemerkung
            </button>
          )}
          {mehr && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                {geplant && (
                <>
                <label className="feld-label">
                  {geplant ? 'Geschätzte Dauer (Std.)' : 'Dauer (Std.)'}
                  <input className="eingabe" inputMode="decimal" value={dauer} onChange={(e) => setDauer(e.target.value)} />
                </label>
                <label className="feld-label">
                  {geplant ? 'Wer?' : 'Ausgeführt von'}
                  <PersonAuswahl wert={person} onWahl={setPerson} leer="–" />
                </label>
                <label className="feld-label">
                  Maschine
                  {zugmaschinen.length > 0 ? (
                    <select className="eingabe" value={maschineId} onChange={(e) => setMaschineId(e.target.value)}>
                      <option value="">–</option>
                      {zugmaschinen.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input className="eingabe" value={maschine} onChange={(e) => setMaschine(e.target.value)} placeholder="z. B. Traktor" />
                  )}
                </label>
                {geraete.length > 0 ? (
                  <GeraeteWahl geraete={geraete} wahl={geraetIds} onWahl={setGeraetIds} />
                ) : (
                  <label className="feld-label">
                    Gerät
                    <input className="eingabe" value={geraet} onChange={(e) => setGeraet(e.target.value)} placeholder="z. B. Düngerstreuer" />
                  </label>
                )}
                </>
                )}
                {geplant && (
                  <label className="feld-label col-span-2">
                    Vergeben an Lohnunternehmen / Partner
                    <select className="eingabe" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                      <option value="">– eigener Betrieb –</option>
                      {(partner.data ?? []).filter((p) => p.aktiv).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({rollenText(p)})
                        </option>
                      ))}
                    </select>
                    {partnerId && <span className="text-xs font-normal text-leise">Wird automatisch als Lohnauftrag unter «Aufträge» geführt.</span>}
                  </label>
                )}
              </div>
              {arbeitsart === 'Düngen' && (
                <label className="feld-label">
                  Ausbringungsmethode
                  <input className="eingabe" value={ausbringung} onChange={(e) => setAusbringung(e.target.value)} placeholder="z. B. Breitstreuer, Schleppschlauch" />
                </label>
              )}
              <label className="feld-label">
                Bemerkungen
                <textarea className="eingabe min-h-20 py-2" value={bemerkungen} onChange={(e) => setBemerkungen(e.target.value)} />
              </label>
            </div>
          )}
        </section>

        {!geplant && (
          <section className="karte flex flex-col gap-3">
            <h2 className="m-0 text-[15px] font-extrabold text-[#3E4C41]">{zeigeMittel ? '4' : '3'} · Wer, wie lange, womit, Beobachtungen?</h2>
            <label className="feld-label">
              Ausgeführt durch
              <select className="eingabe" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                <option value="">eigener Betrieb</option>
                {(partner.data ?? []).filter((p) => p.aktiv || p.id === partnerId).map((p) => (
                  <option key={p.id} value={p.id}>
                    Lohnunternehmen: {p.name} ({rollenText(p)})
                  </option>
                ))}
              </select>
            </label>
            {lohnarbeit && (
              <p className="m-0 text-sm text-leise">
                Lohnarbeit: eigene Maschinenstunden und Arbeitszeit entfallen. Die Arbeit erscheint unter «Aufträge», dort lässt sich die Abrechnung erfassen.
              </p>
            )}
            {!lohnarbeit && (
            <div className="grid grid-cols-2 gap-3">
              <label className="feld-label">
                Wie lange? (Std.)
                <input className="eingabe" inputMode="decimal" value={dauer} onChange={(e) => setDauer(e.target.value)} placeholder="z. B. 2.5" />
              </label>
              <label className="feld-label">
                Wer?
                <PersonAuswahl wert={person} onWahl={setPerson} leer="–" />
              </label>
              <label className="feld-label">
                Traktor / Maschine
                {zugmaschinen.length > 0 ? (
                  <select className="eingabe" value={maschineId} onChange={(e) => setMaschineId(e.target.value)}>
                    <option value="">–</option>
                    {zugmaschinen.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input className="eingabe" value={maschine} onChange={(e) => setMaschine(e.target.value)} placeholder="z. B. Traktor" />
                )}
              </label>
              {geraete.length > 0 ? (
                <GeraeteWahl geraete={geraete} wahl={geraetIds} onWahl={setGeraetIds} />
              ) : (
                <label className="feld-label">
                  Gerät
                  <input className="eingabe" value={geraet} onChange={(e) => setGeraet(e.target.value)} placeholder="z. B. Düngerstreuer" />
                </label>
              )}
            </div>
            )}
            {(() => {
              const zm = lohnarbeit ? undefined : maschinen.data?.find((m) => m.id === maschineId);
              const zg = lohnarbeit ? undefined : maschinen.data?.find((m) => m.id === geraetId);
              return (
                <>
                  {zm && (
                    <ZaehlerFelder
                      maschine={zm}
                      stunden={abschluss.m_stunden}
                      km={abschluss.m_km}
                      onStunden={(v) => setAbschluss({ ...abschluss, m_stunden: v })}
                      onKm={(v) => setAbschluss({ ...abschluss, m_km: v })}
                    />
                  )}
                  {zg && <ZaehlerFelder maschine={zg} stunden={abschluss.g_stunden} km="" onStunden={(v) => setAbschluss({ ...abschluss, g_stunden: v })} />}
                  <label className="feld-label">
                    Beobachtungen (optional)
                    <textarea
                      className="eingabe min-h-16 py-2"
                      value={abschluss.beobachtung}
                      onChange={(e) => setAbschluss({ ...abschluss, beobachtung: e.target.value })}
                      placeholder="z. B. Nasse Stelle im Feld, Streuer streut links ungleich"
                    />
                  </label>
                  {abschluss.beobachtung.trim() && (zm || zg) && (
                    <label className="feld-label">
                      Bei einer Maschine als offenen Punkt melden?
                      <select className="eingabe" value={abschluss.melden} onChange={(e) => setAbschluss({ ...abschluss, melden: e.target.value })}>
                        <option value="">{vorhanden.data?.beobachtung_eintrag_id ? 'Bereits gemeldet / nein' : 'Nein, nur bei der Arbeit notieren'}</option>
                        {[zm, zg].filter(Boolean).map((m) => (
                          <option key={m!.id} value={m!.id}>
                            Ja, bei {m!.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              );
            })()}
          </section>
        )}
      </fieldset>

      {ernteWeiter && <ErnteWeiter titel={`${arbeitsart} erledigt`} link={ernteWeiter} onSpaeter={() => navigate('/kartei')} />}
      {neuerArtikelFuer != null && (
        <NeuerArtikelDialog
          kategorie={kategorie}
          onFertig={(neuId) => {
            if (neuId) setMittel(mittel.map((x, j) => (j === neuerArtikelFuer ? { ...x, artikel_id: neuId } : x)));
            setNeuerArtikelFuer(null);
          }}
        />
      )}

      {(() => {
        // Hinweise für Biodiversitätsförderflächen (Schnitttermin, Düngung, Pflanzenschutz)
        const hinweise = Object.keys(gewaehlt).flatMap((fid) => {
          const f = felder.data?.find((x) => x.id === fid);
          return f ? bffHinweise(f, betrieb.data?.zone, arbeitsart, datum) : [];
        });
        return hinweise.length > 0 ? (
          <div className="flex flex-col gap-1 rounded-xl bg-warn-hell p-3 text-sm font-semibold text-[#5C3D00]">
            {hinweise.map((h) => (
              <span key={h}>⚠ {h}</span>
            ))}
          </div>
        ) : null;
      })()}
      {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}

      {darfAendern && (
        <div className="fixed inset-x-0 bottom-0 z-10 bg-grund/95 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 md:static md:bg-transparent md:p-0">
          <button className="knopf h-14 w-full text-lg" disabled={speichert}>
            {speichert ? 'Speichere …' : 'Speichern'}
          </button>
        </div>
      )}
      {id && darfAendern && (
        <button type="button" className="self-start text-sm font-bold text-fehler" onClick={loeschen}>
          Arbeit löschen
        </button>
      )}
    </form>
  );
}

/** Beim Bearbeiten ist die bisher gebuchte Menge schon vom Bestand abgezogen. */
function gesamtAlt(a: { status: string; feldarbeit_mittel: { artikel_id: string; gesamtmenge: number }[] } | undefined, artikelId: string) {
  if (!a || a.status !== 'erledigt') return 0;
  return a.feldarbeit_mittel.filter((m) => m.artikel_id === artikelId).reduce((s, m) => s + Number(m.gesamtmenge), 0);
}

/** Mehrere Geräte am Traktor (z. B. Kreiselegge + Sämaschine, Front- und Heckmähwerk) */
function GeraeteWahl({ geraete, wahl, onWahl }: { geraete: Maschine[]; wahl: string[]; onWahl: (ids: string[]) => void }) {
  const name = (id: string) => geraete.find((m) => m.id === id)?.name ?? 'Gerät';
  const frei = geraete.filter((m) => !wahl.includes(m.id));
  return (
    <div className="col-span-2 flex flex-col gap-1.5">
      <span className="feld-label">Geräte{wahl.length > 1 ? ` (${wahl.length})` : ''}</span>
      {wahl.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {wahl.map((id, i) => (
            <span key={id} className="flex min-h-10 items-center gap-1 rounded-full bg-hof-hell pl-3 pr-1 text-sm font-bold text-hof">
              {name(id)}
              {i === 0 && wahl.length > 1 && <span className="text-xs font-semibold">(Zähler)</span>}
              <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full text-lg" aria-label={`${name(id)} entfernen`} onClick={() => onWahl(wahl.filter((x) => x !== id))}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {frei.length > 0 && (
        <select
          className="eingabe"
          value=""
          onChange={(e) => {
            if (e.target.value) onWahl([...wahl, e.target.value]);
          }}
        >
          <option value="">{wahl.length ? '+ weiteres Gerät anhängen …' : '– Gerät wählen –'}</option>
          {frei.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.kategorie})
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

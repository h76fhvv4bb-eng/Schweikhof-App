import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { ABHAENGIGE_DATEN, useBenutzer, useFeldarbeit, useFelder, useHinweise, useLager, useMaschinen, usePartner } from '../lib/daten';
import { HinweisListe } from '../components/FeldWerkzeuge';
import { MIT_MOTOR } from '../lib/typen';
import { ha, heuteIso, menge, zahlAus } from '../lib/format';
import { ARBEITSARTEN, type Arbeitsart, type Lagerbestand } from '../lib/typen';
import { Icon } from '../components/Icon';

const HAUPTARTEN: Arbeitsart[] = ['Pflügen', 'Grubbern', 'Säen', 'Düngen', 'Pflanzenschutz', 'Mähen', 'Pressen', 'Ernten'];
const MITTEL_KATEGORIE: Partial<Record<Arbeitsart, Lagerbestand['kategorie']>> = {
  Düngen: 'Dünger',
  Säen: 'Saatgut',
  Pflanzenschutz: 'Pflanzenschutzmittel',
};

interface MittelZeile {
  artikel_id: string;
  menge_je_ha: string;
}

export function Erfassen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profil, darfVerwalten } = useAuth();
  const felder = useFelder();
  const lager = useLager();
  const benutzer = useBenutzer();
  const vorhanden = useFeldarbeit(id);

  const [datum, setDatum] = useState(heuteIso());
  const [arbeitsart, setArbeitsart] = useState<Arbeitsart>('Düngen');
  const [geplant, setGeplant] = useState(false);
  const [gewaehlt, setGewaehlt] = useState<Record<string, string>>({}); // feld_id → Teilfläche in ha ('' = ganzes Feld)
  const [mittel, setMittel] = useState<MittelZeile[]>([]);
  const [mehr, setMehr] = useState(false);
  const [dauer, setDauer] = useState('');
  const [maschine, setMaschine] = useState('');
  const [geraet, setGeraet] = useState('');
  const [maschineId, setMaschineId] = useState('');
  const [geraetId, setGeraetId] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const maschinen = useMaschinen();
  const partner = usePartner();
  const hinweise = useHinweise();
  const [person, setPerson] = useState('');
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
    setMittel(a.feldarbeit_mittel.map((m) => ({ artikel_id: m.artikel_id, menge_je_ha: String(m.menge_je_ha) })));
    setDauer(a.dauer_h == null ? '' : String(a.dauer_h));
    setMaschine(a.maschine ?? '');
    setGeraet(a.geraet ?? '');
    setMaschineId(a.maschine_id ?? '');
    setGeraetId(a.geraet_id ?? '');
    setPartnerId(a.partner_id ?? '');
    setPerson(a.ausgefuehrt_von ?? '');
    setAusbringung(a.ausbringung ?? '');
    setBemerkungen(a.bemerkungen ?? '');
    setMehr(!!(a.dauer_h || a.maschine || a.geraet || a.bemerkungen || a.ausbringung || a.maschine_id || a.geraet_id || a.partner_id));
  }, [vorhanden.data, felder.data]);

  useEffect(() => {
    if (!id && profil) setPerson(profil.id);
  }, [id, profil]);

  // Aus der Hof-Ansicht: ?feld=<id> wählt das Feld vor
  const [params] = useSearchParams();
  useEffect(() => {
    const feld = params.get('feld');
    if (!id && feld) setGewaehlt({ [feld]: '' });
  }, [id, params]);

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
  const zeigeMittel = !!kategorie || mittel.length > 0;

  useEffect(() => {
    if (kategorie && mittel.length === 0) setMittel([{ artikel_id: '', menge_je_ha: '' }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kategorie]);

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
    for (const m of mittel) {
      if (!m.artikel_id && !m.menge_je_ha) continue;
      const wert = zahlAus(m.menge_je_ha);
      if (!m.artikel_id) return setFehler('Bitte bei jeder Mengenangabe ein Mittel wählen.');
      if (!wert || wert <= 0) return setFehler('Bitte eine Menge pro ha grösser als 0 eingeben.');
      mittelListe.push({ artikel_id: m.artikel_id, menge_je_ha: wert });
    }
    if (new Set(mittelListe.map((m) => m.artikel_id)).size !== mittelListe.length)
      return setFehler('Jedes Mittel nur einmal pro Arbeit angeben.');
    const d = zahlAus(dauer);
    if (dauer && (d == null || d < 0)) return setFehler('Arbeitsdauer ungültig.');
    if (!geplant && datum > heuteIso()) return setFehler('Eine erledigte Arbeit kann nicht in der Zukunft liegen. Als «geplant» speichern?');

    setSpeichert(true);
    const { error } = await supabase.rpc('feldarbeit_speichern', {
      p: {
        id: id ?? null,
        version: vorhanden.data?.version,
        datum,
        arbeitsart,
        status: geplant ? 'geplant' : 'erledigt',
        dauer_h: d,
        maschine,
        geraet,
        maschine_id: maschineId || null,
        geraet_id: geraetId || null,
        partner_id: partnerId || null,
        ausgefuehrt_von: person || null,
        ausbringung,
        bemerkungen,
        felder: felderListe,
        mittel: mittelListe,
      },
    });
    setSpeichert(false);
    if (error) return setFehler(fehlertext(error));
    ABHAENGIGE_DATEN.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    navigate('/kartei');
  }

  async function loeschen() {
    if (!id || !confirm('Diese Arbeit löschen? Lagerbuchungen werden zurückgenommen.')) return;
    const { error } = await supabase.rpc('feldarbeit_loeschen', { p_id: id });
    if (error) return setFehler(fehlertext(error));
    ABHAENGIGE_DATEN.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    navigate('/kartei');
  }

  if (profil?.rolle === 'lesen') return <p>Mit der Rolle «Lesen» können keine Arbeiten erfasst werden.</p>;
  const darfAendern = !id || darfVerwalten || vorhanden.data?.erstellt_von === profil?.id;

  return (
    <form onSubmit={speichern} className="flex flex-col gap-5 pb-24">
      <header className="flex items-center gap-3">
        <Link to={id ? '/kartei' : '/'} aria-label="Zurück" className="knopf-leise h-11 w-11 px-0">
          <Icon name="zurueck" />
        </Link>
        <h1 className="m-0 text-2xl font-extrabold text-hof">{id ? 'Arbeit bearbeiten' : 'Arbeit erfassen'}</h1>
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

          {zeigeMittel && (
            <div className="flex flex-col gap-3">
              <h2 className="m-0 text-[15px] font-extrabold text-[#3E4C41]">3 · Womit und wie viel?</h2>
              {mittel.map((m, i) => {
                const art = lager.data?.find((a) => a.id === m.artikel_id);
                const proHa = zahlAus(m.menge_je_ha) ?? 0;
                const gesamt = (proHa * flaecheM2) / 10000;
                const fehlt = art && art.lagerfuehrung && !geplant && gesamt > Number(art.bestand) + (id ? gesamtAlt(vorhanden.data, art.id) : 0);
                const n = art?.n_je_einheit != null ? proHa * Number(art.n_je_einheit) : null;
                return (
                  <div key={i} className="flex flex-col gap-2 rounded-2xl bg-grund p-3">
                    <label className="feld-label">
                      {kategorie ?? 'Betriebsmittel'}
                      <select
                        className="eingabe"
                        value={m.artikel_id}
                        onChange={(e) => setMittel(mittel.map((x, j) => (j === i ? { ...x, artikel_id: e.target.value } : x)))}
                      >
                        <option value="">– wählen –</option>
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
                            className="eingabe w-full"
                            inputMode="decimal"
                            value={m.menge_je_ha}
                            onChange={(e) => setMittel(mittel.map((x, j) => (j === i ? { ...x, menge_je_ha: e.target.value } : x)))}
                          />
                          <span>{art?.einheit ?? ''}/ha</span>
                        </span>
                      </label>
                      <div className="feld-label">
                        Gesamt (berechnet)
                        <span className="flex min-h-12 items-center rounded-xl bg-white px-3 text-base font-extrabold text-text">
                          {menge(gesamt, art?.einheit)}
                        </span>
                      </div>
                    </div>
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
                  Noch keine Artikel der Kategorie «{kategorie ?? 'Betriebsmittel'}». <Link to="/lager/neu">Im Lager anlegen</Link>
                </p>
              )}
            </div>
          )}
          <button
            type="button"
            className="self-start text-sm font-extrabold text-hof"
            onClick={() => setMittel([...mittel, { artikel_id: '', menge_je_ha: '' }])}
          >
            + {zeigeMittel ? 'weiteres Mittel' : 'Betriebsmittel'}
          </button>
          {!mehr && (
            <button type="button" className="self-start text-sm font-extrabold text-hof" onClick={() => setMehr(true)}>
              + Dauer, Maschine, Person, Teilfläche, Bemerkung
            </button>
          )}
          {mehr && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="feld-label">
                  Dauer (Std.)
                  <input className="eingabe" inputMode="decimal" value={dauer} onChange={(e) => setDauer(e.target.value)} />
                </label>
                <label className="feld-label">
                  Ausgeführt von
                  <select className="eingabe" value={person} onChange={(e) => setPerson(e.target.value)}>
                    <option value="">–</option>
                    {(benutzer.data ?? []).map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
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
                <label className="feld-label">
                  Gerät
                  {geraete.length > 0 ? (
                    <select className="eingabe" value={geraetId} onChange={(e) => setGeraetId(e.target.value)}>
                      <option value="">–</option>
                      {geraete.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input className="eingabe" value={geraet} onChange={(e) => setGeraet(e.target.value)} placeholder="z. B. Düngerstreuer" />
                  )}
                </label>
                <label className="feld-label col-span-2">
                  Ausgeführt durch Lohnunternehmen / Partner
                  <select className="eingabe" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                    <option value="">– eigener Betrieb –</option>
                    {(partner.data ?? []).filter((p) => p.aktiv).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.art})
                      </option>
                    ))}
                  </select>
                </label>
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
      </fieldset>

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

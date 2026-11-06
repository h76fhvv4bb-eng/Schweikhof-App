import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useBetrieb, useDigifluxLieferungen, useLager } from '../lib/daten';
import { datum, menge } from '../lib/format';
import { EINHEITEN, LAGERKATEGORIEN, type DigifluxLieferung } from '../lib/typen';
import { tabelleLesen } from '../lib/tabelleLesen';
import {
  DIGIFLUX_FELDER, FAMILIE_TEXT, STATUS_TEXT, einheitApp, kategorieVorschlag, lieferungenAus, spaltenErkennen, umrechnen,
  type DigifluxZeile, type Zuordnung,
} from '../lib/digiflux';
import { csvHerunterladen, csvZahl } from '../lib/export';

type Meldung = { text: string; fehler: boolean } | null;
const ABGELEHNT = ['REJECTED', 'CANCELLED', 'DELETED'];

/** Ergebnis von digiflux_importieren als Satz */
function importText(r: { neu: number; aktualisiert: number; gebucht: number; storniert: number; fehler: string[]; gelesen?: number }) {
  const t = [
    r.gelesen != null && `${r.gelesen} Lieferungen in digiFLUX gelesen.`,
    `${r.neu} neu, ${r.aktualisiert} aktualisiert.`,
    r.gebucht > 0 && `${r.gebucht} direkt ins Lager gebucht (gemerkte Zuordnung).`,
    r.storniert > 0 && `${r.storniert} Buchung(en) storniert (abgelehnt).`,
    r.fehler.length > 0 && `Nicht gebucht: ${r.fehler.join('; ')}`,
  ];
  return t.filter(Boolean).join(' ');
}

/** digiFLUX: Lieferungen von Hofdünger, Dünger und Pflanzenschutzmitteln an den Betrieb (Nachfolger von HODUFLU) */
export function DigiFluxSeite() {
  const { darfVerwalten } = useAuth();
  const qc = useQueryClient();
  const betrieb = useBetrieb();
  const lieferungen = useDigifluxLieferungen();
  const [api, setApi] = useState<'?' | 'ja' | 'nein' | 'fehlt'>('?');
  const [jahr, setJahr] = useState(new Date().getFullYear());
  const [filter, setFilter] = useState<'alle' | 'offen' | 'bestaetigen'>('alle');
  const [meldung, setMeldung] = useState<Meldung>(null);
  const [laeuft, setLaeuft] = useState('');
  const [dateiOffen, setDateiOffen] = useState(false);
  const [uebernehmen, setUebernehmen] = useState<DigifluxLieferung | null>(null);
  const [ablehnen, setAblehnen] = useState<DigifluxLieferung | null>(null);
  const lager = useLager();

  const neuLaden = () => ['digiflux', 'lager', 'lagerbewegungen'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  // Ist die Schnittstelle eingerichtet? (Edge Function «digiflux» mit technischem Benutzer)
  useEffect(() => {
    if (!darfVerwalten) return;
    supabase.functions
      .invoke('digiflux', { body: { aktion: 'status' } })
      .then(({ data, error }) => setApi(error ? 'fehlt' : data?.konfiguriert ? 'ja' : 'nein'))
      .catch(() => setApi('fehlt'));
  }, [darfVerwalten]);

  async function funktion(body: Record<string, unknown>) {
    const { data, error } = await supabase.functions.invoke('digiflux', { body });
    if (error) {
      // Fehlermeldung der Funktion lesen
      const ctx = (error as { context?: Response }).context;
      const j = ctx ? await ctx.json().catch(() => null) : null;
      throw new Error(j?.fehler ?? error.message);
    }
    if (data?.fehler) throw new Error(data.fehler);
    return data;
  }

  async function abrufen() {
    setMeldung(null);
    setLaeuft('abrufen');
    try {
      const r = await funktion({ aktion: 'abrufen', von: `${jahr - 1}-01-01`, bis: `${jahr}-12-31` });
      setMeldung({ text: importText(r), fehler: false });
      neuLaden();
    } catch (e) {
      setMeldung({ text: e instanceof Error ? e.message : String(e), fehler: true });
    } finally {
      setLaeuft('');
    }
  }

  async function bestaetigen(l: DigifluxLieferung, status: 'ACCEPTED' | 'REJECTED', grund?: string) {
    setMeldung(null);
    setLaeuft(l.id);
    try {
      await funktion({ aktion: 'bestaetigen', id: l.id, status, grund });
      setMeldung({ text: status === 'ACCEPTED' ? 'Lieferung in digiFLUX bestätigt.' : 'Lieferung in digiFLUX abgelehnt.', fehler: false });
      neuLaden();
    } catch (e) {
      setMeldung({ text: e instanceof Error ? e.message : String(e), fehler: true });
    } finally {
      setLaeuft('');
    }
  }

  async function zuruecksetzen(l: DigifluxLieferung, ignorieren: boolean) {
    setMeldung(null);
    const { error } = await supabase.rpc('digiflux_zuruecksetzen', { p_id: l.id, p_ignorieren: ignorieren });
    if (error) return setMeldung({ text: fehlertext(error), fehler: true });
    neuLaden();
  }

  const alle = lieferungen.data ?? [];
  const jahre = [...new Set([new Date().getFullYear(), ...alle.map((l) => Number(l.lieferdatum.slice(0, 4)))])].sort((a, b) => b - a);
  const imJahr = alle.filter((l) => l.lieferdatum.startsWith(String(jahr)));
  const offen = (l: DigifluxLieferung) => !l.lagerbewegung_id && !l.ignoriert && !ABGELEHNT.includes(l.status ?? '');
  const liste = imJahr.filter((l) => (filter === 'offen' ? offen(l) : filter === 'bestaetigen' ? l.status === 'SENT' : true));
  const artikel = (id: string | null) => lager.data?.find((a) => a.id === id);

  // Summen je Produkt (bestätigt bzw. nicht abgelehnt)
  const summen = useMemo(() => {
    const m = new Map<string, { produkt: string; familie: string | null; menge: number; einheit: string; n: number }>();
    for (const l of imJahr) {
      if (ABGELEHNT.includes(l.status ?? '')) continue;
      const k = `${l.produkt ?? l.produkt_id}|${einheitApp(l.einheit)}`;
      const x = m.get(k) ?? { produkt: l.produkt ?? l.produkt_id ?? '?', familie: l.produktfamilie, menge: 0, einheit: einheitApp(l.einheit), n: 0 };
      x.menge += Number(l.menge);
      x.n++;
      m.set(k, x);
    }
    return [...m.values()].sort((a, b) => a.produkt.localeCompare(b.produkt, 'de-CH'));
  }, [imJahr]);

  function exportieren() {
    csvHerunterladen(
      `digiFLUX_Lieferungen_${jahr}.csv`,
      `digiFLUX-Lieferungen ${jahr}`,
      ['Lieferdatum', 'Abgeber', 'Produkt', 'Produktfamilie', 'Menge', 'Einheit', 'Status', 'Lieferschein-Nr.', 'Lagerartikel', 'Im Lager gebucht', 'digiFLUX-ID', 'Quelle', 'Kommentar'],
      imJahr.map((l) => [
        datum(l.lieferdatum), l.abgeber ?? '', l.produkt ?? l.produkt_id ?? '', FAMILIE_TEXT[l.produktfamilie ?? ''] ?? l.produktfamilie ?? '', csvZahl(l.menge), l.einheit,
        STATUS_TEXT[l.status ?? ''] ?? l.status ?? '', l.lieferschein_nr ?? '', artikel(l.artikel_id)?.bezeichnung ?? '', l.lagerbewegung_id ? 'ja' : l.ignoriert ? 'ausgeblendet' : 'nein',
        l.dfx_id, l.quelle, l.kommentar ?? '',
      ]),
    );
  }

  if (lieferungen.isSuccess && lieferungen.data === null)
    return (
      <div className="flex flex-col gap-4">
        <h1 className="m-0 text-2xl font-extrabold text-hof">digiFLUX</h1>
        <p className="karte m-0">Bitte zuerst Migration 31 in Supabase einspielen.</p>
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="m-0 text-2xl font-extrabold text-hof">digiFLUX</h1>
          <span className="text-sm text-leise">Lieferungen von Hofdünger, Dünger und Pflanzenschutzmitteln an den Betrieb (früher HODUFLU)</span>
        </div>
        <button className="knopf-leise min-h-10" onClick={exportieren} disabled={!imJahr.length}>
          CSV {jahr}
        </button>
      </header>

      <section className="karte flex flex-col gap-2">
        <h2 className="m-0 text-lg font-extrabold">Verbindung</h2>
        <span className="text-sm">
          Standort-ID:{' '}
          {betrieb.data?.dflid ? <b>{betrieb.data.dflid}</b> : <Link to="/betrieb">beim Betrieb eintragen</Link>}
          <span className="text-leise"> (damit nur Lieferungen an deinen Betrieb übernommen werden)</span>
        </span>
        {darfVerwalten && (
          <div className="flex flex-wrap gap-2">
            {api === 'ja' && (
              <button className="knopf min-h-10" onClick={abrufen} disabled={!!laeuft}>
                {laeuft === 'abrufen' ? 'Hole Lieferungen …' : 'Lieferungen abrufen'}
              </button>
            )}
            <button className={`${api === 'ja' ? 'knopf-leise' : 'knopf'} min-h-10`} onClick={() => setDateiOffen(!dateiOffen)}>
              Datei importieren
            </button>
          </div>
        )}
        {api === 'ja' && <span className="text-xs text-leise">Schnittstelle eingerichtet: Lieferungen werden direkt aus digiFLUX geholt und können hier bestätigt werden.</span>}
        {(api === 'nein' || api === 'fehlt') && (
          <span className="text-xs text-leise">
            Schnittstelle noch nicht eingerichtet – Import per Datei funktioniert trotzdem. Für den automatischen Abgleich braucht es einen technischen
            Benutzer von digiFLUX (Anleitung: «docs/digiflux.md» im Projekt).
          </span>
        )}
      </section>

      {meldung && <p className={`m-0 rounded-xl p-3 text-sm font-semibold ${meldung.fehler ? 'bg-fehler-hell text-fehler' : 'bg-hof-hell text-hof'}`}>{meldung.text}</p>}

      {dateiOffen && darfVerwalten && (
        <DateiImport
          dflid={betrieb.data?.dflid ?? null}
          onFertig={(text) => {
            setDateiOffen(false);
            setMeldung({ text, fehler: false });
            neuLaden();
          }}
        />
      )}

      <section className="flex flex-wrap items-center gap-2">
        <select className="eingabe h-10 min-h-0 w-28 py-0" value={jahr} onChange={(e) => setJahr(Number(e.target.value))} aria-label="Jahr">
          {jahre.map((j) => (
            <option key={j}>{j}</option>
          ))}
        </select>
        {(
          [
            ['alle', `Alle (${imJahr.length})`],
            ['offen', `Nicht im Lager (${imJahr.filter(offen).length})`],
            ['bestaetigen', `Zu bestätigen (${imJahr.filter((l) => l.status === 'SENT').length})`],
          ] as const
        ).map(([k, t]) => (
          <button
            key={k}
            aria-pressed={filter === k}
            onClick={() => setFilter(k)}
            className={`min-h-10 rounded-full border-2 px-3 text-sm font-bold ${filter === k ? 'border-hof bg-hof text-white' : 'border-linie bg-white'}`}
          >
            {t}
          </button>
        ))}
      </section>

      {imJahr.length === 0 && (
        <p className="karte m-0 text-leise">
          Noch keine Lieferungen {jahr}. Exportiere in digiFLUX die Liste deiner Lieferungen (Excel oder CSV) und importiere sie hier – oder richte die
          Schnittstelle ein.
        </p>
      )}

      {liste.map((l) => {
        const a = artikel(l.artikel_id);
        const abgelehnt = ABGELEHNT.includes(l.status ?? '');
        return (
          <div key={l.id} className={`karte flex flex-col gap-2 p-3 ${l.ignoriert || abgelehnt ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <span className="flex flex-col">
                <b>
                  {menge(Number(l.menge))} {l.einheit} {l.produkt ?? l.produkt_id ?? 'Produkt?'}
                </b>
                <span className="text-sm text-leise">
                  {datum(l.lieferdatum)} · {l.abgeber ?? l.abgeber_id ?? 'Abgeber?'}
                  {l.lieferschein_nr && ` · LS ${l.lieferschein_nr}`}
                  {l.produktfamilie && ` · ${FAMILIE_TEXT[l.produktfamilie] ?? l.produktfamilie}`}
                </span>
              </span>
              {l.status && (
                <span
                  className={`shrink-0 rounded-lg px-2 py-0.5 text-xs font-extrabold ${
                    l.status === 'ACCEPTED' ? 'bg-hof-hell text-hof' : abgelehnt ? 'bg-fehler-hell text-fehler' : 'bg-[#FFF3C4] text-[#7A5B00]'
                  }`}
                >
                  {STATUS_TEXT[l.status] ?? l.status}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {l.lagerbewegung_id && a ? (
                <span>
                  Im Lager gebucht: <Link to={`/lager/${a.id}`}>{a.bezeichnung}</Link>
                </span>
              ) : l.ignoriert ? (
                <span className="text-leise">Ausgeblendet (nicht im Lager)</span>
              ) : abgelehnt ? (
                <span className="text-leise">Abgelehnt – nicht im Lager</span>
              ) : (
                <span className="text-leise">Noch nicht im Lager</span>
              )}
              {darfVerwalten && (
                <span className="ml-auto flex flex-wrap gap-2">
                  {api === 'ja' && l.quelle === 'API' && l.status === 'SENT' && (
                    <>
                      <button className="knopf min-h-9" disabled={!!laeuft} onClick={() => bestaetigen(l, 'ACCEPTED')}>
                        Bestätigen
                      </button>
                      <button className="knopf-leise min-h-9" disabled={!!laeuft} onClick={() => setAblehnen(l)}>
                        Ablehnen
                      </button>
                    </>
                  )}
                  {!abgelehnt && !l.lagerbewegung_id && (
                    <button className="knopf-leise min-h-9" onClick={() => setUebernehmen(l)}>
                      Ins Lager
                    </button>
                  )}
                  {l.lagerbewegung_id && (
                    <button className="knopf-leise min-h-9" onClick={() => setUebernehmen(l)}>
                      Ändern
                    </button>
                  )}
                  {(l.lagerbewegung_id || !l.ignoriert) && !abgelehnt && (
                    <button
                      className="knopf-leise min-h-9"
                      onClick={() => zuruecksetzen(l, true)}
                      title="Nicht ins Lager buchen (z. B. direkt ausgebracht oder bereits von Hand erfasst)"
                    >
                      Ausblenden
                    </button>
                  )}
                  {l.ignoriert && (
                    <button className="knopf-leise min-h-9" onClick={() => zuruecksetzen(l, false)}>
                      Wieder anzeigen
                    </button>
                  )}
                </span>
              )}
            </div>
          </div>
        );
      })}

      {summen.length > 0 && (
        <section className="karte flex flex-col gap-1">
          <h2 className="m-0 text-lg font-extrabold">Summe {jahr} je Produkt</h2>
          {summen.map((s) => (
            <div key={`${s.produkt}|${s.einheit}`} className="flex justify-between gap-2 border-b border-rand py-1 text-sm last:border-0">
              <span>
                {s.produkt}
                <span className="text-leise"> · {s.n} Lieferung{s.n > 1 ? 'en' : ''}</span>
              </span>
              <b>
                {menge(Math.round(s.menge * 1000) / 1000)} {s.einheit}
              </b>
            </div>
          ))}
          <span className="text-xs text-leise">Ohne abgelehnte Lieferungen. Für die Suisse-Bilanz zählen die in digiFLUX bestätigten Lieferungen.</span>
        </section>
      )}

      {uebernehmen && <UebernehmenDialog l={uebernehmen} onFertig={(t) => (setUebernehmen(null), t && (setMeldung({ text: t, fehler: false }), neuLaden()))} />}
      {ablehnen && (
        <AblehnenDialog
          l={ablehnen}
          onFertig={(grund) => {
            const l = ablehnen;
            setAblehnen(null);
            if (grund) bestaetigen(l, 'REJECTED', grund);
          }}
        />
      )}
    </div>
  );
}

/** Excel/CSV aus digiFLUX lesen, Spalten prüfen, importieren */
function DateiImport({ dflid, onFertig }: { dflid: string | null; onFertig: (text: string) => void }) {
  const [zeilen, setZeilen] = useState<string[][] | null>(null);
  const [kopf, setKopf] = useState(0);
  const [start, setStart] = useState(1);
  const [zu, setZu] = useState<Zuordnung>({});
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  async function lesen(datei: File | undefined) {
    setFehler(null);
    setZeilen(null);
    if (!datei) return;
    try {
      const z = await tabelleLesen(datei);
      if (z.length < 2) return setFehler('Die Datei enthält keine Lieferungen.');
      const e = spaltenErkennen(z);
      setZeilen(z);
      setKopf(e.kopf);
      setStart(e.daten);
      setZu(e.zuordnung);
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    }
  }

  const ergebnis = zeilen ? lieferungenAus(zeilen, kopf, start, zu, dflid) : null;
  const titel = zeilen?.[kopf] ?? [];
  const fehlend = DIGIFLUX_FELDER.filter((f) => 'pflicht' in f && f.pflicht && zu[f.k] == null);

  async function importieren() {
    if (!ergebnis?.lieferungen.length) return;
    setLaeuft(true);
    setFehler(null);
    const { data, error } = await supabase.rpc('digiflux_importieren', { p: { quelle: 'Datei', lieferungen: ergebnis.lieferungen } });
    setLaeuft(false);
    if (error) {
      const m = fehlertext(error);
      return setFehler(/digiflux_importieren/.test(m) ? 'Bitte zuerst Migration 31 in Supabase einspielen.' : m);
    }
    onFertig(importText(data));
  }

  return (
    <section className="karte flex flex-col gap-3">
      <h2 className="m-0 text-lg font-extrabold">Datei aus digiFLUX importieren</h2>
      <span className="text-sm text-leise">
        In digiFLUX die Lieferungen deines Betriebs als Excel (.xlsx) oder CSV exportieren und hier wählen. Bereits importierte Lieferungen werden nur
        aktualisiert (z. B. Status «bestätigt»), nicht doppelt erfasst.
      </span>
      <input type="file" accept=".xlsx,.csv,.txt" className="eingabe py-2" onChange={(e) => lesen(e.target.files?.[0])} />
      {zeilen && (
        <>
          <details open={fehlend.length > 0}>
            <summary className="cursor-pointer text-sm font-bold">
              Spalten ({Object.keys(zu).length} erkannt{fehlend.length ? `, es fehlt: ${fehlend.map((f) => f.text).join(', ')}` : ''})
            </summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {DIGIFLUX_FELDER.map((f) => (
                <label key={f.k} className="feld-label">
                  {f.text}
                  {'pflicht' in f && f.pflicht && ' *'}
                  <select
                    className="eingabe"
                    value={zu[f.k] ?? ''}
                    onChange={(e) => setZu({ ...zu, [f.k]: e.target.value === '' ? undefined : Number(e.target.value) })}
                  >
                    <option value="">– keine –</option>
                    {titel.map((t, i) => (
                      <option key={i} value={i}>
                        {t || `Spalte ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </details>
          {ergebnis && (
            <>
              <span className="text-sm font-bold">
                {ergebnis.lieferungen.length} Lieferungen bereit
                {ergebnis.fremd > 0 && ` · ${ergebnis.fremd} an andere Standorte übersprungen`}
                {ergebnis.fehler.length > 0 && ` · ${ergebnis.fehler.length} Zeilen mit Fehlern`}
              </span>
              {ergebnis.lieferungen.slice(0, 5).map((l: DigifluxZeile) => (
                <span key={l.dfx_id} className="rounded-xl bg-grund p-2 text-sm">
                  {datum(l.lieferdatum)} · {menge(l.menge)} {l.einheit} {l.produkt ?? '?'} · {l.abgeber ?? '?'}
                  {l.status && ` · ${STATUS_TEXT[l.status] ?? l.status}`}
                </span>
              ))}
              {ergebnis.lieferungen.length > 5 && <span className="text-xs text-leise">… und {ergebnis.lieferungen.length - 5} weitere</span>}
              {ergebnis.fehler.slice(0, 5).map((f) => (
                <span key={f} className="text-xs text-fehler">
                  {f}
                </span>
              ))}
            </>
          )}
          <button className="knopf" onClick={importieren} disabled={laeuft || !ergebnis?.lieferungen.length || fehlend.length > 0}>
            {laeuft ? 'Importiere …' : `${ergebnis?.lieferungen.length ?? 0} Lieferungen importieren`}
          </button>
        </>
      )}
      {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
    </section>
  );
}

/** Lieferung einem Lagerartikel zuordnen (vorhandener oder neuer) und als Eingang buchen */
function UebernehmenDialog({ l, onFertig }: { l: DigifluxLieferung; onFertig: (text?: string) => void }) {
  const lager = useLager();
  const [artikelId, setArtikelId] = useState(l.artikel_id ?? '');
  const [neu, setNeu] = useState({
    bezeichnung: l.produkt ?? l.produkt_id ?? '',
    kategorie: kategorieVorschlag(l.produktfamilie) as string,
    einheit: einheitApp(l.einheit) as string,
  });
  const [mengeHand, setMengeHand] = useState('');
  const [merken, setMerken] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const artikel = (lager.data ?? []).filter((a) => ['Dünger', 'Pflanzenschutzmittel', 'Saatgut', 'Sonstiges'].includes(a.kategorie));
  const zielEinheit = artikelId ? lager.data?.find((a) => a.id === artikelId)?.einheit : neu.einheit;
  const umgerechnet = zielEinheit ? umrechnen(Number(l.menge), l.einheit, zielEinheit) : null;
  // passende Einheit zuerst
  const sortiert = [...artikel].sort(
    (a, b) => Number(umrechnen(1, l.einheit, b.einheit) != null) - Number(umrechnen(1, l.einheit, a.einheit) != null) || a.bezeichnung.localeCompare(b.bezeichnung, 'de-CH'),
  );

  async function ok() {
    setFehler(null);
    const m = mengeHand.trim() ? Number(mengeHand.replace(',', '.')) : null;
    if (mengeHand.trim() && (m == null || !Number.isFinite(m) || m <= 0)) return setFehler('Menge ungültig.');
    if (umgerechnet == null && m == null) return setFehler(`Die Einheit ${l.einheit} lässt sich nicht in ${zielEinheit} umrechnen. Bitte die Menge in ${zielEinheit} angeben.`);
    if (!artikelId && !neu.bezeichnung.trim()) return setFehler('Bitte einen Artikel wählen oder einen Namen für den neuen Artikel eingeben.');
    setLaeuft(true);
    const { error } = await supabase.rpc('digiflux_uebernehmen', {
      p_id: l.id,
      p: { ...(artikelId ? { artikel_id: artikelId } : { neu: { ...neu, bezeichnung: neu.bezeichnung.trim() } }), menge: m, merken },
    });
    setLaeuft(false);
    if (error) return setFehler(fehlertext(error));
    onFertig(`Ins Lager gebucht: ${menge(m ?? umgerechnet ?? 0)} ${zielEinheit} ${artikelId ? (lager.data?.find((a) => a.id === artikelId)?.bezeichnung ?? '') : neu.bezeichnung}.`);
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-t-[22px] bg-white p-5 sm:rounded-[22px]">
        <h2 className="m-0 text-xl font-extrabold text-hof">Ins Lager übernehmen</h2>
        <span className="text-sm">
          {datum(l.lieferdatum)} · {menge(Number(l.menge))} {l.einheit} <b>{l.produkt ?? l.produkt_id}</b> von {l.abgeber ?? '?'}
        </span>
        <label className="feld-label">
          Lagerartikel
          <select className="eingabe" value={artikelId} onChange={(e) => setArtikelId(e.target.value)}>
            <option value="">+ Neuer Artikel …</option>
            {sortiert.map((a) => (
              <option key={a.id} value={a.id}>
                {a.bezeichnung} ({a.einheit})
              </option>
            ))}
          </select>
        </label>
        {!artikelId && (
          <div className="grid grid-cols-[1fr_100px] gap-2 rounded-2xl bg-grund p-3">
            <label className="feld-label col-span-2">
              Bezeichnung
              <input className="eingabe" value={neu.bezeichnung} onChange={(e) => setNeu({ ...neu, bezeichnung: e.target.value })} />
            </label>
            <label className="feld-label">
              Kategorie
              <select className="eingabe" value={neu.kategorie} onChange={(e) => setNeu({ ...neu, kategorie: e.target.value })}>
                {LAGERKATEGORIEN.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label className="feld-label">
              Einheit
              <select className="eingabe" value={neu.einheit} onChange={(e) => setNeu({ ...neu, einheit: e.target.value })}>
                {EINHEITEN.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <span className="col-span-2 text-xs text-leise">Nährstoffgehalte danach beim Artikel ergänzen, damit die Nährstoffbilanz stimmt.</span>
          </div>
        )}
        {umgerechnet != null ? (
          <span className="text-sm font-bold">
            Eingang: {menge(umgerechnet)} {zielEinheit} am {datum(l.lieferdatum)}
          </span>
        ) : (
          <label className="feld-label">
            Menge in {zielEinheit}
            <input className="eingabe" inputMode="decimal" value={mengeHand} onChange={(e) => setMengeHand(e.target.value)} autoFocus />
          </label>
        )}
        <label className="flex items-center gap-2 text-sm font-bold">
          <input type="checkbox" className="h-5 w-5 accent-hof" checked={merken} onChange={(e) => setMerken(e.target.checked)} />
          Für dieses Produkt merken (nächste Lieferungen automatisch buchen)
        </label>
        {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
        <div className="flex gap-2">
          <button className="knopf flex-1" onClick={ok} disabled={laeuft}>
            {laeuft ? 'Buche …' : 'Ins Lager buchen'}
          </button>
          <button className="knopf-leise" onClick={() => onFertig()}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}

function AblehnenDialog({ l, onFertig }: { l: DigifluxLieferung; onFertig: (grund?: string) => void }) {
  const [grund, setGrund] = useState('');
  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="flex w-full max-w-md flex-col gap-3 rounded-t-[22px] bg-white p-5 sm:rounded-[22px]">
        <h2 className="m-0 text-xl font-extrabold text-hof">Lieferung ablehnen</h2>
        <span className="text-sm">
          {datum(l.lieferdatum)} · {menge(Number(l.menge))} {l.einheit} {l.produkt} von {l.abgeber}
        </span>
        <label className="feld-label">
          Grund (geht an den Abgeber)
          <input className="eingabe" value={grund} onChange={(e) => setGrund(e.target.value)} placeholder="z. B. falsche Menge, nicht geliefert" autoFocus />
        </label>
        <div className="flex gap-2">
          <button className="knopf flex-1" disabled={!grund.trim()} onClick={() => onFertig(grund.trim())}>
            Ablehnen
          </button>
          <button className="knopf-leise" onClick={() => onFertig()}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}

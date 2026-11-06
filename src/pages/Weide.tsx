import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useBetrieb, useBeweidungen, useFelder, useHinweise, usePartner, useVerkaeufe } from '../lib/daten';
import { chf, datum, ha, haZuM2, heuteIso, menge, zahlAus } from '../lib/format';
import { ENTGELTARTEN, TIERARTEN, hatRolle, type Beweidung, type Feld } from '../lib/typen';
import { abschnitte, aktiv, aktuelleFelder, geplant, tagVerschieben, weideHa, weidetage, weidezins } from '../lib/weide';
import { csvHerunterladen, csvZahl } from '../lib/export';
import { pdfHerunterladen } from '../lib/auftragPdf';
import { Icon } from '../components/Icon';
import { NEU, NeuerPartnerDialog } from '../components/Schnellanlage';

const jahrVon = (j: number) => `${j}-01-01`;
const jahrBis = (j: number) => `${j}-12-31`;

/** Liste der Weidegäste mit Zeitraum-Filter, Weiterziehen und Export */
export function WeideListe() {
  const { darfVerwalten } = useAuth();
  const [params] = useSearchParams();
  const j = new Date().getFullYear();
  const [von, setVon] = useState(jahrVon(j));
  const [bis, setBis] = useState(jahrBis(j));
  const [partnerId, setPartnerId] = useState(params.get('partner') ?? '');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [dialog, setDialog] = useState<{ b: Beweidung; art: 'weiter' | 'ende' } | null>(null);
  const alle = useBeweidungen();
  const felder = useFelder();
  const partner = usePartner();
  const liste = (alle.data ?? []).filter((b) => b.von <= bis && (b.bis == null || b.bis >= von) && (!partnerId || b.partner_id === partnerId));
  const pName = (id: string) => partner.data?.find((p) => p.id === id)?.name ?? '';
  const fName = (id: string) => felder.data?.find((f) => f.id === id)?.name ?? '?';
  const halter = [...new Set((alle.data ?? []).map((b) => b.partner_id))];
  const tiertage = liste.reduce((s, b) => s + b.anzahl * weidetage(b, von, bis), 0);
  const zinsTotal = liste.reduce((s, b) => s + (weidezins(b, von, bis)?.betrag ?? 0), 0);

  function csv() {
    csvHerunterladen(
      `Weidegaeste_${von}_${bis}.csv`,
      `Weidegäste ${datum(von)} - ${datum(bis)}`,
      ['Tierhalter', 'Tierart', 'Anzahl', 'GVE', 'Feld', 'Fläche ha', 'auf dem Feld von', 'bis', 'Tage im Zeitraum', 'Tiertage', 'GVE-Tage', 'Weidezins CHF (ganze Weide)', 'Bemerkungen'],
      liste.flatMap((b) => {
        const zins = weidezins(b, von, bis);
        return abschnitte(b).map((f, i) => {
          const t = f.von ? weidetage({ von: f.von, bis: f.bis ?? b.bis }, von, bis) : 0;
          return [
            pName(b.partner_id), b.tierart, b.anzahl, b.gve != null ? csvZahl(b.gve) : '', fName(f.feld_id), csvZahl(Number(f.flaeche_m2) / 10000),
            f.von ? datum(f.von) : 'geplant', f.bis ? datum(f.bis) : 'offen', t, b.anzahl * t, b.gve != null ? csvZahl(Number(b.gve) * t) : '',
            i === 0 && zins ? csvZahl(zins.betrag) : '', i === 0 ? (b.bemerkungen ?? '') : '',
          ];
        });
      }),
    );
  }
  async function pdf() {
    setFehler(null);
    setLaeuft(true);
    try {
      const [{ weideLaden }, { weidePdf }] = await Promise.all([import('../lib/berichte'), import('../lib/berichtePdf')]);
      pdfHerunterladen(await weidePdf(await weideLaden(von, bis, partnerId || undefined)), `Weidegaeste_${von}_${bis}.pdf`);
    } catch (e) {
      setFehler(fehlertext(e));
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-leise">Tiere anderer Betriebe auf unseren Feldern</span>
          <h1 className="m-0 text-3xl font-extrabold text-hof">Weidegäste</h1>
        </div>
        {darfVerwalten && (
          <Link to={`/weide/neu${partnerId ? `?partner=${partnerId}` : ''}`} className="knopf no-underline">
            <Icon name="plus" /> Weide erfassen
          </Link>
        )}
      </header>

      <section className="karte flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="feld-label">
            von
            <input type="date" className="eingabe" value={von} onChange={(e) => setVon(e.target.value)} />
          </label>
          <label className="feld-label">
            bis
            <input type="date" className="eingabe" value={bis} onChange={(e) => setBis(e.target.value)} />
          </label>
          <label className="feld-label min-w-40 flex-1">
            Tierhalter
            <select className="eingabe" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">Alle</option>
              {halter.map((id) => (
                <option key={id} value={id}>
                  {pName(id)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {[j - 1, j].map((x) => (
            <button
              key={x}
              className="knopf-leise min-h-10"
              onClick={() => {
                setVon(jahrVon(x));
                setBis(jahrBis(x));
              }}
            >
              Jahr {x}
            </button>
          ))}
          <button className="knopf-leise min-h-10" onClick={pdf} disabled={laeuft || !liste.length}>
            {laeuft ? 'Erstelle …' : 'PDF'}
          </button>
          <button className="knopf-leise min-h-10" onClick={csv} disabled={!liste.length}>
            Excel (CSV)
          </button>
        </div>
        <span className="text-sm text-leise">
          {liste.length} Einträge · {menge(tiertage)} Tiertage im Zeitraum{zinsTotal > 0 && ` · Weidezins ${chf(zinsTotal)}`}
        </span>
        {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
      </section>

      {alle.isSuccess && !liste.length && (
        <p className="karte m-0 text-leise">Keine Weidegäste im Zeitraum. Erfasse hier, wenn Tiere eines anderen Betriebs auf deinen Feldern weiden.</p>
      )}
      {liste.map((b) => {
        const jetzt = aktuelleFelder(b);
        const laufend = aktiv(b);
        return (
          <div key={b.id} className="karte flex flex-col gap-2 p-3">
            <Link to={`/weide/${b.id}`} className="flex flex-col gap-1 text-text no-underline">
              <div className="flex items-center justify-between gap-2">
                <span className="font-extrabold">
                  {b.anzahl} {b.tierart} · {pName(b.partner_id)}
                </span>
                {laufend && <span className="shrink-0 rounded-lg bg-hof-hell px-2 py-0.5 text-xs font-extrabold text-hof">auf der Weide</span>}
              </div>
              {laufend && jetzt.length > 0 && (
                <span className="text-sm font-bold">
                  Jetzt: {jetzt.map((f) => fName(f.feld_id)).join(', ')} seit {datum(jetzt[0].von)} ({weidetage({ von: jetzt[0].von, bis: null })} Tage)
                </span>
              )}
              <span className="text-sm text-leise">
                {datum(b.von)} – {b.bis ? datum(b.bis) : 'offen'} · {weidetage(b)} Tage · {ha(weideHa(b) * 10000)}
              </span>
              <Umtrieb b={b} fName={fName} />
              {weidezins(b) && <span className="text-sm font-bold">Weidezins {chf(weidezins(b)!.betrag)}{b.verkauf_id ? ' · verrechnet' : ''}</span>}
            </Link>
            {darfVerwalten && laufend && (
              <div className="flex flex-wrap gap-2">
                <button className="knopf min-h-10" onClick={() => setDialog({ b, art: 'weiter' })}>
                  Weiterziehen
                </button>
                <button className="knopf-leise min-h-10" onClick={() => setDialog({ b, art: 'ende' })}>
                  Abgeholt
                </button>
              </div>
            )}
          </div>
        );
      })}
      {dialog && <UmtriebDialog b={dialog.b} art={dialog.art} felder={felder.data ?? []} onFertig={() => setDialog(null)} />}
    </div>
  );
}

/** Kette der Felder: A (01.05.–09.05.) → B (seit 10.05.) */
function Umtrieb({ b, fName }: { b: Beweidung; fName: (id: string) => string }) {
  const liste = abschnitte(b);
  if (liste.length < 2) return liste.length ? <span className="text-sm text-leise">Feld: {fName(liste[0].feld_id)}</span> : null;
  const tm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
  return (
    <span className="flex flex-wrap items-center gap-1 text-xs">
      {liste.map((f, i) => (
        <span key={f.id ?? i} className="flex items-center gap-1">
          {i > 0 && <span className="text-leise">→</span>}
          <span
            className={`rounded-lg px-2 py-0.5 font-bold ${f.von && aktiv({ von: f.von, bis: f.bis }) ? 'bg-hof text-white' : f.von ? 'bg-grund' : 'border border-dashed border-linie text-leise'}`}
          >
            {i + 1}. {fName(f.feld_id)} {f.von ? `${tm(f.von)}–${f.bis ? tm(f.bis) : ''}` : '(geplant)'}
          </span>
        </span>
      ))}
    </span>
  );
}

/** Tiere auf ein anderes Feld bringen oder als abgeholt melden */
export function UmtriebDialog({ b, art, felder, onFertig }: { b: Beweidung; art: 'weiter' | 'ende'; felder: Feld[]; onFertig: () => void }) {
  const qc = useQueryClient();
  const [tag, setTag] = useState(heuteIso());
  // nächstes geplantes Feld ist vorgewählt
  const plan = geplant(b);
  const [wahl, setWahl] = useState<Record<string, string>>(() => (plan[0] ? { [plan[0].feld_id]: '' } : {}));
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const jetzt = new Set(aktuelleFelder(b).map((f) => f.feld_id));
  const planNr = (id: string) => {
    const i = plan.findIndex((p) => p.feld_id === id);
    return i < 0 ? 999 : i;
  };
  const auswahl = felder
    .filter((f) => f.status !== 'aufgegeben')
    .sort((x, y) => planNr(x.id) - planNr(y.id) || Number(jetzt.has(x.id)) - Number(jetzt.has(y.id)));

  async function ok() {
    setFehler(null);
    if (art === 'weiter' && !Object.keys(wahl).length) return setFehler('Bitte das neue Feld wählen.');
    for (const [fid, h] of Object.entries(wahl)) if (h.trim() && haZuM2(h) == null) return setFehler(`Fläche bei «${felder.find((f) => f.id === fid)?.name}» ungültig.`);
    setLaeuft(true);
    const { error } =
      art === 'weiter'
        ? await supabase.rpc('beweidung_umtreiben', {
            p_id: b.id,
            p: { datum: tag, felder: Object.entries(wahl).map(([feld_id, h]) => ({ feld_id, flaeche_m2: h.trim() ? haZuM2(h) : null })) },
          })
        : await supabase.rpc('beweidung_beenden', { p_id: b.id, p_datum: tag });
    setLaeuft(false);
    if (error) {
      const m = fehlertext(error);
      return setFehler(/beweidung_(umtreiben|beenden)/.test(m) ? 'Bitte zuerst Migration 19 in Supabase einspielen.' : m);
    }
    await qc.invalidateQueries({ queryKey: ['beweidungen'] });
    onFertig();
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-t-[22px] bg-white p-5 sm:rounded-[22px]">
        <h2 className="m-0 text-xl font-extrabold text-hof">
          {art === 'weiter' ? `${b.anzahl} ${b.tierart} weiterziehen` : `${b.anzahl} ${b.tierart} abgeholt`}
        </h2>
        <label className="feld-label">
          {art === 'weiter' ? 'Ab wann auf dem neuen Feld?' : 'Letzter Weidetag'}
          <input type="date" className="eingabe" value={tag} min={b.von} onChange={(e) => setTag(e.target.value)} />
        </label>
        {art === 'weiter' ? (
          <>
            <span className="text-sm text-leise">
              Das bisherige Feld ({[...jetzt].map((id) => felder.find((f) => f.id === id)?.name).join(', ') || '–'}) endet am {datum(tagVerschieben(tag, -1))}.
            </span>
            <div className="flex flex-col gap-1">
              {auswahl.map((f) => {
                const an = f.id in wahl;
                return (
                  <div key={f.id} className="flex min-h-11 items-center gap-2">
                    <label className="flex flex-1 items-center gap-2 font-bold">
                      <input
                        type="checkbox"
                        className="h-5 w-5 accent-hof"
                        checked={an}
                        onChange={(e) => {
                          const x = { ...wahl };
                          if (e.target.checked) x[f.id] = '';
                          else delete x[f.id];
                          setWahl(x);
                        }}
                      />
                      {f.feldnummer} {f.name}
                      <span className="text-xs font-semibold text-leise">
                        {ha(Number(f.flaeche_m2))}
                        {jetzt.has(f.id) && ' · jetzt hier'}
                        {planNr(f.id) < 999 && ` · geplant als ${planNr(f.id) === 0 ? 'nächstes' : `${planNr(f.id) + 1}.`} Feld`}
                      </span>
                    </label>
                    {an && (
                      <input
                        className="eingabe w-20"
                        inputMode="decimal"
                        placeholder="ha"
                        aria-label={`Weidefläche ${f.name} in ha`}
                        value={wahl[f.id]}
                        onChange={(e) => setWahl({ ...wahl, [f.id]: e.target.value })}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <span className="text-sm text-leise">
            Die Weide und das aktuelle Feld enden an diesem Tag.{plan.length > 0 && ` Geplante Felder ohne Datum (${plan.length}) werden entfernt.`}
          </span>
        )}
        {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
        <div className="flex gap-2">
          <button className="knopf flex-1" onClick={ok} disabled={laeuft}>
            {laeuft ? 'Speichere …' : art === 'weiter' ? 'Weiterziehen' : 'Weide beenden'}
          </button>
          <button className="knopf-leise" onClick={onFertig}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}

type Zeile = { feld_id: string; ha: string; von: string; bis: string };

/** Weide erfassen oder bearbeiten, mit allen Feldern und Zeiträumen (Umtrieb nachtragen) */
export function WeideFormular() {
  const { id } = useParams();
  const neu = !id;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { darfVerwalten } = useAuth();
  const alle = useBeweidungen();
  const felder = useFelder();
  const partner = usePartner();
  const vorhanden = alle.data?.find((b) => b.id === id);
  const verkaeufe = useVerkaeufe(vorhanden ? Number((vorhanden.bis ?? vorhanden.von).slice(0, 4)) : new Date().getFullYear());
  const beleg = vorhanden?.verkauf_id ? verkaeufe.data?.find((v) => v.id === vorhanden.verkauf_id) : undefined;

  const [w, setW] = useState({
    partner_id: params.get('partner') ?? '', tierart: 'Rinder', anzahl: '', gve: '', von: heuteIso(), bis: '',
    entgelt_art: 'keins' as Beweidung['entgelt_art'], entgelt_satz: '', bemerkungen: '',
  });
  const [zeilen, setZeilen] = useState<Zeile[]>(() => [{ feld_id: params.get('feld') ?? '', ha: '', von: '', bis: '' }]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [neuerPartner, setNeuerPartner] = useState(false);
  const [dialog, setDialog] = useState<'weiter' | 'ende' | null>(null);
  const betrieb = useBetrieb();
  const hinweise = useHinweise();
  const [planLaeuft, setPlanLaeuft] = useState<'' | 'pdf' | 'mail'>('');
  const [planFehler, setPlanFehler] = useState<string | null>(null);

  /** Weideplan für den Tierhalter: Karte mit nummerierten Flächen und Reihenfolge (gespeicherter Stand) */
  async function weideplan(wie: 'pdf' | 'mail') {
    if (!vorhanden) return;
    setPlanLaeuft(wie);
    setPlanFehler(null);
    try {
      const [{ weideplanPdf }, { pdfPerMail }] = await Promise.all([import('../lib/weideplanPdf'), import('../lib/auftragPdf')]);
      const halter = partner.data?.find((p) => p.id === vorhanden.partner_id) ?? null;
      const pdf = await weideplanPdf({
        betrieb: betrieb.data ?? null,
        partner: halter ? { name: halter.name, adresse: halter.adresse, telefon: halter.telefon } : null,
        beweidung: vorhanden,
        felder: felder.data ?? [],
        hinweise: hinweise.data ?? [],
      });
      const dateiname = `Weideplan_${(halter?.name ?? 'Weide').replace(/[^A-Za-z0-9ÄÖÜäöüéè_-]+/g, '_')}_${vorhanden.von}.pdf`;
      if (wie === 'pdf') {
        const url = URL.createObjectURL(pdf);
        if (!window.open(url, '_blank')) pdfHerunterladen(pdf, dateiname);
      } else {
        await pdfPerMail(
          pdf, dateiname, halter?.email ?? null, `Weideplan ${vorhanden.anzahl} ${vorhanden.tierart}`,
          `Grüezi\n\nIm Anhang der Weideplan mit den Flächen und der Reihenfolge.\n\nFreundliche Grüsse\n${betrieb.data?.name ?? ''}`,
        );
      }
    } catch (e) {
      setPlanFehler(`Weideplan konnte nicht erstellt werden: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPlanLaeuft('');
    }
  }
  const geladen = useMemo(() => ({ schluessel: '' }), []);

  useEffect(() => {
    // neu übernehmen, wenn sich der Eintrag oder seine Felder geändert haben (z. B. nach «Weiterziehen»)
    const schluessel = vorhanden ? `${vorhanden.id}|${vorhanden.version}|${JSON.stringify(abschnitte(vorhanden))}` : '';
    if (!vorhanden || geladen.schluessel === schluessel) return;
    geladen.schluessel = schluessel;
    setW({
      partner_id: vorhanden.partner_id, tierart: vorhanden.tierart, anzahl: String(vorhanden.anzahl), gve: vorhanden.gve != null ? String(vorhanden.gve) : '',
      von: vorhanden.von, bis: vorhanden.bis ?? '', entgelt_art: vorhanden.entgelt_art, entgelt_satz: vorhanden.entgelt_satz != null ? String(vorhanden.entgelt_satz) : '',
      bemerkungen: vorhanden.bemerkungen ?? '',
    });
    const f = felder.data ?? [];
    setZeilen(
      abschnitte(vorhanden).map((x) => {
        const ganz = f.find((y) => y.id === x.feld_id);
        return {
          feld_id: x.feld_id, von: x.von ?? '', bis: x.bis ?? '',
          ha: ganz && Math.abs(Number(ganz.flaeche_m2) - Number(x.flaeche_m2)) < 1 ? '' : String(Number(x.flaeche_m2) / 10000),
        };
      }),
    );
  }, [vorhanden, felder.data, geladen]);

  const tierhalter = (partner.data ?? []).filter((p) => p.aktiv && (hatRolle(p, 'Tierhalter') || p.id === w.partner_id));
  const andere = (partner.data ?? []).filter((p) => p.aktiv && !hatRolle(p, 'Tierhalter') && p.id !== w.partner_id);
  const auswaehlbar = (felder.data ?? []).filter((f) => f.status !== 'aufgegeben');
  const set = (k: keyof typeof w) => (e: { target: { value: string } }) => setW({ ...w, [k]: e.target.value });
  /** Zeile ändern; bekommt ein Feld einen Beginn, endet das vorherige offene Feld am Vortag */
  const aendere = (i: number, teil: Partial<Zeile>) =>
    setZeilen(
      zeilen.map((z, j) => {
        if (j === i) return { ...z, ...teil };
        const vorher = zeilen[i - 1];
        if (teil.von && j === i - 1 && vorher && !vorher.bis && (vorher.von || (i - 1 === 0 ? w.von : '')) && (vorher.von || w.von) < teil.von && zeilen[i].von !== vorher.von)
          return { ...z, bis: tagVerschieben(teil.von, -1) };
        return z;
      }),
    );
  const feldM2 = (fid: string) => Number(auswaehlbar.find((f) => f.id === fid)?.flaeche_m2 ?? 0);

  /** Nächstes Feld im Umtrieb – Datum bleibt offen, bis es bekannt ist (Reihenfolge zählt) */
  function weiterzug() {
    setZeilen([...zeilen, { feld_id: '', ha: '', von: '', bis: '' }]);
  }
  /** Weiteres Feld gleichzeitig (Herde auf zwei Feldern) */
  function gleichzeitig() {
    const letzte = zeilen[zeilen.length - 1];
    setZeilen([...zeilen, { feld_id: '', ha: '', von: letzte?.von ?? '', bis: letzte?.bis ?? '' }]);
  }

  // Vorschau
  const vorschau: Beweidung = {
    id: '', betrieb_id: '', partner_id: w.partner_id, tierart: w.tierart, anzahl: Number(w.anzahl) || 0, gve: zahlAus(w.gve), von: w.von, bis: w.bis || null,
    entgelt_art: w.entgelt_art, entgelt_satz: zahlAus(w.entgelt_satz), verkauf_id: null, bemerkungen: null, version: 0,
    beweidung_felder: zeilen
      .filter((z) => z.feld_id)
      .map((z, i) => {
        const von = z.von || (i === 0 ? w.von : null);
        return { feld_id: z.feld_id, flaeche_m2: haZuM2(z.ha) ?? feldM2(z.feld_id), von, bis: von ? z.bis || w.bis || null : null };
      }),
  };
  const zins = w.von ? weidezins(vorschau) : null;

  async function speichern(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    if (!w.partner_id) return setFehler('Bitte den Tierhalter wählen.');
    const anzahl = Number(w.anzahl);
    if (!Number.isInteger(anzahl) || anzahl < 1) return setFehler('Anzahl Tiere: ganze Zahl ab 1.');
    const gve = zahlAus(w.gve);
    if (w.gve.trim() && (gve == null || gve < 0)) return setFehler('GVE ungültig.');
    const gewaehlt = zeilen.filter((z) => z.feld_id);
    if (!gewaehlt.length) return setFehler('Bitte mindestens ein Feld wählen.');
    for (const z of gewaehlt) {
      const name = auswaehlbar.find((f) => f.id === z.feld_id)?.name;
      if (z.ha.trim() && haZuM2(z.ha) == null) return setFehler(`Fläche bei «${name}» ungültig.`);
      if (z.von && z.von < w.von) return setFehler(`«${name}»: Beginn liegt vor dem Beginn der Weide.`);
      if (z.von && z.bis && z.bis < z.von) return setFehler(`«${name}»: Ende liegt vor dem Beginn.`);
      if (!z.von && z.bis && z !== gewaehlt[0]) return setFehler(`«${name}»: Ende ohne Beginn – bitte auch den Beginn eintragen oder beides leer lassen.`);
    }
    const satz = zahlAus(w.entgelt_satz);
    if (w.entgelt_art !== 'keins' && (satz == null || satz < 0)) return setFehler('Bitte den Weidezins angeben.');
    const { data, error } = await supabase.rpc('beweidung_speichern', {
      p: {
        id: id ?? null, version: vorhanden?.version, partner_id: w.partner_id, tierart: w.tierart.trim(), anzahl, gve, von: w.von, bis: w.bis || null,
        entgelt_art: w.entgelt_art, entgelt_satz: w.entgelt_art === 'keins' ? null : satz, bemerkungen: w.bemerkungen,
        felder: gewaehlt.map((z) => ({ feld_id: z.feld_id, flaeche_m2: z.ha.trim() ? haZuM2(z.ha) : null, von: z.von || null, bis: z.bis || null })),
      },
    });
    if (error) {
      const m = fehlertext(error);
      return setFehler(/beweidung_speichern/.test(m) ? 'Bitte zuerst die Migrationen 18 und 19 in Supabase einspielen.' : m);
    }
    // Partner bekommt die Rolle «Tierhalter» dazu, falls er sie noch nicht hat
    const halter = partner.data?.find((p) => p.id === w.partner_id);
    if (halter && !hatRolle(halter, 'Tierhalter') && halter.rollen) {
      await supabase.from('partner').update({ rollen: [...halter.rollen, 'Tierhalter'], version: halter.version }).eq('id', halter.id);
      qc.invalidateQueries({ queryKey: ['partner'] });
    }
    await qc.invalidateQueries({ queryKey: ['beweidungen'] });
    navigate(neu ? `/weide/${data as string}` : '/weide');
  }

  async function loeschen() {
    if (!vorhanden || !confirm('Diesen Weide-Eintrag löschen?')) return;
    const { error } = await supabase.rpc('beweidung_loeschen', { p_id: vorhanden.id });
    if (error) return setFehler(fehlertext(error));
    await qc.invalidateQueries({ queryKey: ['beweidungen'] });
    navigate('/weide');
  }

  if (!neu && alle.isSuccess && !vorhanden) return <p>Weide-Eintrag nicht gefunden.</p>;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <Link to="/weide" aria-label="Zurück" className="knopf-leise h-11 w-11 px-0">
          <Icon name="zurueck" />
        </Link>
        <h1 className="m-0 text-2xl font-extrabold text-hof">{neu ? 'Weide erfassen' : `${w.anzahl} ${w.tierart}`}</h1>
      </header>

      {!neu && vorhanden && aktiv(vorhanden) && darfVerwalten && (
        <section className="karte flex flex-wrap items-center gap-2">
          <span className="flex-1 text-sm font-bold">
            Jetzt auf: {aktuelleFelder(vorhanden).map((f) => auswaehlbar.find((x) => x.id === f.feld_id)?.name).join(', ') || '–'}
          </span>
          <button className="knopf min-h-10" onClick={() => setDialog('weiter')}>
            Weiterziehen
          </button>
          <button className="knopf-leise min-h-10" onClick={() => setDialog('ende')}>
            Abgeholt
          </button>
        </section>
      )}

      {!neu && vorhanden && (
        <section className="karte flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex-1 font-extrabold">Weideplan für den Tierhalter</span>
            <button type="button" className="knopf-leise min-h-10" disabled={!!planLaeuft} onClick={() => weideplan('pdf')}>
              {planLaeuft === 'pdf' ? 'Erstelle …' : 'PDF'}
            </button>
            <button type="button" className="knopf-leise min-h-10" disabled={!!planLaeuft} onClick={() => weideplan('mail')}>
              {planLaeuft === 'mail' ? 'Erstelle …' : 'Senden'}
            </button>
          </div>
          <span className="text-xs text-leise">
            Luftbild mit den nummerierten Weideflächen und die Reihenfolge mit Daten. Geplante Flächen unten unter «Felder und Umtrieb» mit Datum eintragen und speichern.
          </span>
          {planFehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{planFehler}</p>}
        </section>
      )}

      <form onSubmit={speichern} className="flex flex-col gap-4">
        <fieldset disabled={!darfVerwalten} className="m-0 flex flex-col gap-4 border-0 p-0">
          <section className="karte flex flex-col gap-3">
            <label className="feld-label">
              Tierhalter
              <select
                className="eingabe"
                value={w.partner_id}
                onChange={(e) => (e.target.value === NEU ? setNeuerPartner(true) : setW({ ...w, partner_id: e.target.value }))}
              >
                <option value="">– wählen –</option>
                <optgroup label="Tierhalter">
                  {tierhalter.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
                {andere.length > 0 && (
                  <optgroup label="Andere Partner">
                    {andere.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                <option value={NEU}>+ Neuer Tierhalter …</option>
              </select>
            </label>
            <div className="grid grid-cols-[1fr_100px_100px] gap-3">
              <label className="feld-label">
                Tierart
                <input className="eingabe" list="tierarten" value={w.tierart} onChange={set('tierart')} />
                <datalist id="tierarten">
                  {TIERARTEN.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </label>
              <label className="feld-label">
                Anzahl
                <input className="eingabe" inputMode="numeric" value={w.anzahl} onChange={set('anzahl')} />
              </label>
              <label className="feld-label">
                GVE
                <input className="eingabe" inputMode="decimal" value={w.gve} onChange={set('gve')} placeholder="optional" />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="feld-label">
                Tiere gebracht am
                <input type="date" className="eingabe" value={w.von} onChange={set('von')} required />
              </label>
              <label className="feld-label">
                abgeholt am (leer = noch da)
                <input type="date" className="eingabe" value={w.bis} onChange={set('bis')} min={w.von} />
              </label>
            </div>
            {w.von && (
              <span className="text-sm text-leise">
                {weidetage(vorschau)} Weidetage{!w.bis && ' bis heute'} · {menge((Number(w.anzahl) || 0) * weidetage(vorschau))} Tiertage
              </span>
            )}
          </section>

          <section className="karte flex flex-col gap-3">
            <div>
              <h2 className="m-0 text-lg font-extrabold">Felder und Umtrieb</h2>
              <span className="text-sm text-leise">
                Ein Feld pro Zeile, in der Reihenfolge des Umtriebs. Datum unbekannt? Einfach leer lassen – das Feld gilt dann als geplant und
                wird im Weideplan nach der Reihenfolge nummeriert. Erstes Feld ohne Datum = ab Beginn der Weide. Fläche leer = ganzes Feld.
              </span>
            </div>
            {zeilen.map((z, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-2xl bg-grund p-3">
                <div className="flex items-end gap-2">
                  <label className="feld-label flex-1">
                    {`${i + 1}. Feld`}
                    <select className="eingabe" value={z.feld_id} onChange={(e) => aendere(i, { feld_id: e.target.value })}>
                      <option value="">– Feld wählen –</option>
                      {auswaehlbar.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.feldnummer} {f.name} ({ha(Number(f.flaeche_m2))})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="feld-label w-20">
                    ha
                    <input className="eingabe" inputMode="decimal" placeholder="ganz" value={z.ha} onChange={(e) => aendere(i, { ha: e.target.value })} />
                  </label>
                  {i > 0 && (
                    <button
                      type="button"
                      className="knopf-leise h-11 w-11 px-0"
                      aria-label="Weiter nach vorne in der Reihenfolge"
                      title="In der Reihenfolge nach vorne"
                      onClick={() => setZeilen(zeilen.map((z2, j) => (j === i - 1 ? zeilen[i] : j === i ? zeilen[i - 1] : z2)))}
                    >
                      ↑
                    </button>
                  )}
                  {zeilen.length > 1 && (
                    <button type="button" className="knopf-leise h-11 w-11 px-0 text-fehler" aria-label="Zeile entfernen" onClick={() => setZeilen(zeilen.filter((_, j) => j !== i))}>
                      ×
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="feld-label">
                    von
                    <input type="date" className="eingabe" value={z.von} min={w.von} onChange={(e) => aendere(i, { von: e.target.value })} />
                  </label>
                  <label className="feld-label">
                    bis
                    <input type="date" className="eingabe" value={z.bis} min={z.von || w.von} onChange={(e) => aendere(i, { bis: e.target.value })} />
                  </label>
                </div>
                {z.feld_id && (
                  <span className="text-xs text-leise">
                    {z.von || i === 0
                      ? `${weidetage({ von: z.von || w.von, bis: z.bis || w.bis || null })} Tage auf diesem Feld`
                      : 'Geplant – Datum noch offen. Beim «Weiterziehen» wird das Datum eingetragen.'}
                  </span>
                )}
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="knopf-leise min-h-10" onClick={weiterzug}>
                <Icon name="plus" /> Danach weiter auf Feld …
              </button>
              <button type="button" className="knopf-leise min-h-10" onClick={gleichzeitig}>
                <Icon name="plus" /> Gleichzeitig auf weiterem Feld
              </button>
            </div>
          </section>

          <section className="karte flex flex-col gap-3">
            <h2 className="m-0 text-lg font-extrabold">Weidezins</h2>
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <label className="feld-label">
                Verrechnung
                <select className="eingabe" value={w.entgelt_art} onChange={set('entgelt_art')}>
                  {ENTGELTARTEN.map((a) => (
                    <option key={a} value={a}>
                      {a === 'keins' ? 'kein Weidezins' : a}
                    </option>
                  ))}
                </select>
              </label>
              {w.entgelt_art !== 'keins' && (
                <label className="feld-label">
                  CHF
                  <input className="eingabe" inputMode="decimal" value={w.entgelt_satz} onChange={set('entgelt_satz')} />
                </label>
              )}
            </div>
            {zins && (
              <span className="text-sm font-bold">
                {menge(zins.menge)} {zins.einheit} × {chf(zins.preis)} = {chf(zins.betrag)}
                {!w.bis && ' (bis heute)'}
              </span>
            )}
            {w.entgelt_art === 'je GVE und Tag' && !w.gve.trim() && <span className="text-sm text-fehler">Für «je GVE und Tag» bitte oben die GVE eintragen.</span>}
            <label className="feld-label">
              Bemerkungen
              <textarea className="eingabe min-h-20" value={w.bemerkungen} onChange={set('bemerkungen')} placeholder="z. B. Wasser, Zaun, Abmachungen" />
            </label>
          </section>
        </fieldset>

        {!neu && vorhanden && weidezins(vorhanden) && (
          <section className="karte flex flex-wrap items-center gap-3">
            {beleg ? (
              <Link to={`/verkauf/${beleg.id}`} className="font-bold">
                {beleg.art} {beleg.nummer} · {chf(beleg.total_chf)} · {beleg.storniert ? 'storniert' : beleg.bezahlt ? 'bezahlt' : 'offen'}
              </Link>
            ) : (
              <span className="text-sm text-leise">Weidezins noch nicht verrechnet.</span>
            )}
            {darfVerwalten && (!beleg || beleg.storniert) && (
              <Link to={`/verkauf/neu?art=Rechnung&beweidung=${vorhanden.id}`} className="knopf-leise no-underline">
                Rechnung erstellen
              </Link>
            )}
          </section>
        )}

        {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
        {darfVerwalten && (
          <div className="flex gap-2">
            <button className="knopf flex-1">Speichern</button>
            {!neu && (
              <button type="button" className="knopf-leise text-fehler" onClick={loeschen}>
                Löschen
              </button>
            )}
          </div>
        )}
      </form>
      {neuerPartner && (
        <NeuerPartnerDialog
          art="Tierhalter"
          onFertig={(neuId) => {
            if (neuId) setW((x) => ({ ...x, partner_id: neuId }));
            setNeuerPartner(false);
          }}
        />
      )}
      {dialog && vorhanden && (
        <UmtriebDialog
          b={vorhanden}
          art={dialog}
          felder={felder.data ?? []}
          onFertig={() => setDialog(null)}
        />
      )}
    </div>
  );
}

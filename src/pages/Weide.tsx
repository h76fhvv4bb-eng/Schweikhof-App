import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useBeweidungen, useFelder, usePartner, useVerkaeufe } from '../lib/daten';
import { chf, datum, ha, haZuM2, heuteIso, menge, zahlAus } from '../lib/format';
import { ENTGELTARTEN, TIERARTEN, type Beweidung } from '../lib/typen';
import { aktiv, weideHa, weidetage, weidezins } from '../lib/weide';
import { csvHerunterladen, csvZahl } from '../lib/export';
import { pdfHerunterladen } from '../lib/auftragPdf';
import { Icon } from '../components/Icon';
import { NEU, NeuerPartnerDialog } from '../components/Schnellanlage';

const jahrVon = (j: number) => `${j}-01-01`;
const jahrBis = (j: number) => `${j}-12-31`;

/** Liste der Weidegäste mit Zeitraum-Filter und Export */
export function WeideListe() {
  const { darfVerwalten } = useAuth();
  const [params] = useSearchParams();
  const j = new Date().getFullYear();
  const [von, setVon] = useState(jahrVon(j));
  const [bis, setBis] = useState(jahrBis(j));
  const [partnerId, setPartnerId] = useState(params.get('partner') ?? '');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
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
      ['Tierhalter', 'Tierart', 'Anzahl', 'GVE', 'von', 'bis', 'Tage im Zeitraum', 'Tiertage', 'GVE-Tage', 'Feld', 'Fläche ha', 'Weidezins CHF', 'Bemerkungen'],
      liste.flatMap((b) => {
        const t = weidetage(b, von, bis);
        const zins = weidezins(b, von, bis);
        return b.beweidung_felder.map((f, i) => [
          pName(b.partner_id), b.tierart, b.anzahl, b.gve != null ? csvZahl(b.gve) : '', datum(b.von), b.bis ? datum(b.bis) : 'offen', t, b.anzahl * t,
          b.gve != null ? csvZahl(Number(b.gve) * t) : '', fName(f.feld_id), csvZahl(Number(f.flaeche_m2) / 10000), i === 0 && zins ? csvZahl(zins.betrag) : '', b.bemerkungen ?? '',
        ]);
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
            <button key={x} className="knopf-leise min-h-10" onClick={() => { setVon(jahrVon(x)); setBis(jahrBis(x)); }}>
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
      {liste.map((b) => (
        <Link key={b.id} to={`/weide/${b.id}`} className="karte flex flex-col gap-1 p-3 text-text no-underline">
          <div className="flex items-center justify-between gap-2">
            <span className="font-extrabold">
              {b.anzahl} {b.tierart} · {pName(b.partner_id)}
            </span>
            {aktiv(b) && <span className="rounded-lg bg-hof-hell px-2 py-0.5 text-xs font-extrabold text-hof">auf der Weide</span>}
          </div>
          <span className="text-sm text-leise">
            {datum(b.von)} – {b.bis ? datum(b.bis) : 'offen'} · {weidetage(b)} Tage · {b.beweidung_felder.map((f) => fName(f.feld_id)).join(', ')} ({ha(weideHa(b) * 10000)})
          </span>
          {weidezins(b) && <span className="text-sm font-bold">Weidezins {chf(weidezins(b)!.betrag)}{b.verkauf_id ? ' · verrechnet' : ''}</span>}
        </Link>
      ))}
    </div>
  );
}

/** Weide erfassen oder bearbeiten */
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
  const [auswahl, setAuswahl] = useState<Record<string, string>>(() => (params.get('feld') ? { [params.get('feld')!]: '' } : {})); // feld_id → ha (leer = ganzes Feld)
  const [fehler, setFehler] = useState<string | null>(null);
  const [neuerPartner, setNeuerPartner] = useState(false);
  const geladen = useMemo(() => ({ id: '' }), []);

  useEffect(() => {
    if (!vorhanden || geladen.id === vorhanden.id) return;
    geladen.id = vorhanden.id;
    setW({
      partner_id: vorhanden.partner_id, tierart: vorhanden.tierart, anzahl: String(vorhanden.anzahl), gve: vorhanden.gve != null ? String(vorhanden.gve) : '',
      von: vorhanden.von, bis: vorhanden.bis ?? '', entgelt_art: vorhanden.entgelt_art, entgelt_satz: vorhanden.entgelt_satz != null ? String(vorhanden.entgelt_satz) : '',
      bemerkungen: vorhanden.bemerkungen ?? '',
    });
    const f = felder.data ?? [];
    setAuswahl(
      Object.fromEntries(
        vorhanden.beweidung_felder.map((x) => {
          const ganz = f.find((y) => y.id === x.feld_id);
          return [x.feld_id, ganz && Math.abs(Number(ganz.flaeche_m2) - Number(x.flaeche_m2)) < 1 ? '' : String(Number(x.flaeche_m2) / 10000)];
        }),
      ),
    );
  }, [vorhanden, felder.data, geladen]);

  const tierhalter = (partner.data ?? []).filter((p) => p.aktiv && (p.art === 'Tierhalter' || p.id === w.partner_id));
  const andere = (partner.data ?? []).filter((p) => p.aktiv && p.art !== 'Tierhalter' && p.id !== w.partner_id);
  const auswaehlbar = (felder.data ?? []).filter((f) => f.status !== 'aufgegeben');
  const set = (k: keyof typeof w) => (e: { target: { value: string } }) => setW({ ...w, [k]: e.target.value });

  // Vorschau des Weidezinses
  const vorschau: Beweidung = {
    id: '', betrieb_id: '', partner_id: w.partner_id, tierart: w.tierart, anzahl: Number(w.anzahl) || 0, gve: zahlAus(w.gve), von: w.von, bis: w.bis || null,
    entgelt_art: w.entgelt_art, entgelt_satz: zahlAus(w.entgelt_satz), verkauf_id: null, bemerkungen: null, version: 0,
    beweidung_felder: Object.entries(auswahl).map(([feld_id, h]) => ({ feld_id, flaeche_m2: haZuM2(h) ?? Number(auswaehlbar.find((f) => f.id === feld_id)?.flaeche_m2 ?? 0) })),
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
    if (!Object.keys(auswahl).length) return setFehler('Bitte mindestens ein Feld wählen.');
    for (const [fid, h] of Object.entries(auswahl))
      if (h.trim() && haZuM2(h) == null) return setFehler(`Fläche bei «${auswaehlbar.find((f) => f.id === fid)?.name}» ungültig.`);
    const satz = zahlAus(w.entgelt_satz);
    if (w.entgelt_art !== 'keins' && (satz == null || satz < 0)) return setFehler('Bitte den Weidezins angeben.');
    const { data, error } = await supabase.rpc('beweidung_speichern', {
      p: {
        id: id ?? null, version: vorhanden?.version, partner_id: w.partner_id, tierart: w.tierart.trim(), anzahl, gve, von: w.von, bis: w.bis || null,
        entgelt_art: w.entgelt_art, entgelt_satz: w.entgelt_art === 'keins' ? null : satz, bemerkungen: w.bemerkungen,
        felder: Object.entries(auswahl).map(([feld_id, h]) => ({ feld_id, flaeche_m2: h.trim() ? haZuM2(h) : null })),
      },
    });
    if (error) {
      const m = fehlertext(error);
      return setFehler(/beweidung_speichern/.test(m) ? 'Bitte zuerst Migration 18 in Supabase einspielen.' : m);
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
                Auf der Weide ab
                <input type="date" className="eingabe" value={w.von} onChange={set('von')} required />
              </label>
              <label className="feld-label">
                bis (leer = noch da)
                <input type="date" className="eingabe" value={w.bis} onChange={set('bis')} min={w.von} />
              </label>
            </div>
            {w.von && <span className="text-sm text-leise">{weidetage(vorschau)} Weidetage{!w.bis && ' bis heute'} · {menge((Number(w.anzahl) || 0) * weidetage(vorschau))} Tiertage</span>}
          </section>

          <section className="karte flex flex-col gap-2">
            <h2 className="m-0 text-lg font-extrabold">Felder</h2>
            <span className="text-sm text-leise">Fläche leer lassen = ganzes Feld.</span>
            {auswaehlbar.map((f) => {
              const an = f.id in auswahl;
              return (
                <div key={f.id} className="flex min-h-11 items-center gap-3">
                  <label className="flex flex-1 items-center gap-2 font-bold">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-hof"
                      checked={an}
                      onChange={(e) => {
                        const x = { ...auswahl };
                        if (e.target.checked) x[f.id] = '';
                        else delete x[f.id];
                        setAuswahl(x);
                      }}
                    />
                    {f.feldnummer} {f.name}
                    <span className="text-xs font-semibold text-leise">
                      {f.nutzungsart} · {ha(Number(f.flaeche_m2))}
                    </span>
                  </label>
                  {an && (
                    <input
                      className="eingabe w-24"
                      inputMode="decimal"
                      placeholder="ha"
                      aria-label={`Weidefläche ${f.name} in ha`}
                      value={auswahl[f.id]}
                      onChange={(e) => setAuswahl({ ...auswahl, [f.id]: e.target.value })}
                    />
                  )}
                </div>
              );
            })}
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
    </div>
  );
}

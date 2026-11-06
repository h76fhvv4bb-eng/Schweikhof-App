import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useBeweidungen, useFelder, usePartner, useBetrieb } from '../lib/daten';
import { aktiv } from '../lib/weide';
import { datum, ha, haZuM2 } from '../lib/format';
import { FELDSTATUS, NUTZUNGSARTEN, type Anbau, type Feld } from '../lib/typen';
import { Icon } from '../components/Icon';
import { FeldHinweise, FeldTeilenZusammenfuehren } from '../components/FeldWerkzeuge';
import { Verlauf } from '../components/Verlauf';
import { parzellenblaetterLaden } from '../lib/kontrolle';
import { parzellenblaetterPdf } from '../lib/kontrollePdf';
import { pdfHerunterladen } from '../lib/auftragPdf';
import { csvHerunterladen, csvZahl } from '../lib/export';
import { BFF_TYPEN, schnittAb, tagMonatText, type BffTyp } from '../lib/bff';

const schema = z.object({
  feldnummer: z.string().trim().min(1, 'Feldnummer fehlt').max(20),
  name: z.string().trim().min(1, 'Name fehlt').max(80),
  flaeche_m2: z.number({ invalid_type_error: 'Fläche in ha eingeben, z. B. 2.4' }).positive('Fläche muss grösser als 0 sein').max(5_000_000),
  gemeinde: z.string().trim().max(80).nullable(),
  nutzungsart: z.enum(NUTZUNGSARTEN),
  bodenart: z.string().trim().max(80).nullable(),
  hangneigung_prozent: z.number().min(0).max(100).nullable(),
  status: z.enum(FELDSTATUS),
  bemerkungen: z.string().trim().max(2000).nullable(),
  korrektur_p2o5: z.number().min(0, 'Korrekturfaktor zwischen 0 und 3').max(3, 'Korrekturfaktor zwischen 0 und 3').nullable(),
  korrektur_k2o: z.number().min(0, 'Korrekturfaktor zwischen 0 und 3').max(3, 'Korrekturfaktor zwischen 0 und 3').nullable(),
  korrektur_mg: z.number().min(0, 'Korrekturfaktor zwischen 0 und 3').max(3, 'Korrekturfaktor zwischen 0 und 3').nullable(),
  bodenprobe_jahr: z.number().int('Jahr der Bodenprobe ungültig').min(1990, 'Jahr der Bodenprobe ungültig').max(2100).nullable(),
});

const zahlOderNull = (s: string) => (s.trim() === '' ? null : Number(s.trim().replace(',', '.')));

const leer = (s: string) => (s.trim() === '' ? null : s.trim());

export function FeldFormular() {
  const { id } = useParams();
  const neu = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profil, darfVerwalten } = useAuth();
  const felder = useFelder();
  const feld = felder.data?.find((f) => f.id === id);

  const [w, setW] = useState({
    feldnummer: '',
    name: '',
    flaeche: '',
    gemeinde: '',
    nutzungsart: 'Ackerland' as Feld['nutzungsart'],
    bodenart: '',
    hang: '',
    status: 'bewirtschaftet' as Feld['status'],
    bemerkungen: '',
    kp: '',
    kk: '',
    kmg: '',
    probe: '',
    bff: '' as string,
    bffQ: '' as string,
    vernetzung: false,
    schnittAbTag: '', // TT.MM
  });
  const [fehler, setFehler] = useState<string | null>(null);
  const betrieb = useBetrieb();

  useEffect(() => {
    if (feld)
      setW({
        feldnummer: feld.feldnummer,
        name: feld.name,
        flaeche: String(Number(feld.flaeche_m2) / 10000),
        gemeinde: feld.gemeinde ?? '',
        nutzungsart: feld.nutzungsart,
        bodenart: feld.bodenart ?? '',
        hang: feld.hangneigung_prozent == null ? '' : String(feld.hangneigung_prozent),
        status: feld.status,
        bemerkungen: feld.bemerkungen ?? '',
        kp: feld.korrektur_p2o5 == null ? '' : String(feld.korrektur_p2o5),
        kk: feld.korrektur_k2o == null ? '' : String(feld.korrektur_k2o),
        kmg: feld.korrektur_mg == null ? '' : String(feld.korrektur_mg),
        probe: feld.bodenprobe_jahr == null ? '' : String(feld.bodenprobe_jahr),
        bff: feld.bff_typ ?? '',
        bffQ: feld.bff_qualitaet ? String(feld.bff_qualitaet) : '',
        vernetzung: !!feld.bff_vernetzung,
        schnittAbTag: feld.schnitt_ab ? tagMonatText(feld.schnitt_ab).slice(0, 5) : '',
      });
    else if (neu && felder.data) {
      const naechste = felder.data.reduce((m, f) => Math.max(m, Number(f.feldnummer) || 0), 0) + 1;
      setW((x) => ({ ...x, feldnummer: x.feldnummer || String(naechste) }));
    }
  }, [feld, neu, felder.data]);

  // Historie inkl. der Felder, aus denen dieses Feld entstanden ist (Teilen/Zusammenführen)
  const historie = useQuery({
    queryKey: ['anbau-feld', id, feld?.vorgaenger?.join(',')],
    enabled: !!id && !!feld,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('anbau')
        .select('id, feld_id, kultur_id, jahr, art, status, version, kulturen(name, farbe), felder(name)')
        .in('feld_id', [id!, ...(feld?.vorgaenger ?? [])])
        .order('jahr', { ascending: false })
        .order('art');
      if (error) throw error;
      return data as unknown as (Anbau & { felder: { name: string } | null })[];
    },
  });

  const speichern = useMutation({
    mutationFn: async () => {
      const roh = {
        feldnummer: w.feldnummer,
        name: w.name,
        flaeche_m2: haZuM2(w.flaeche) ?? NaN,
        gemeinde: leer(w.gemeinde),
        nutzungsart: w.nutzungsart,
        bodenart: leer(w.bodenart),
        hangneigung_prozent: w.hang.trim() === '' ? null : Number(w.hang.replace(',', '.')),
        status: w.status,
        bemerkungen: leer(w.bemerkungen),
        korrektur_p2o5: zahlOderNull(w.kp),
        korrektur_k2o: zahlOderNull(w.kk),
        korrektur_mg: zahlOderNull(w.kmg),
        bodenprobe_jahr: zahlOderNull(w.probe),
      };
      const geprueft = schema.safeParse(roh);
      if (!geprueft.success) throw new Error(geprueft.error.issues[0].message);
      // BFF nur mitsenden, wenn gesetzt oder vorher gesetzt (ältere Datenbank ohne Migration 25)
      const tm = w.schnittAbTag.trim().match(/^(\d{1,2})\.(\d{1,2})\.?$/);
      if (w.schnittAbTag.trim() && !tm) throw new Error('Schnitt frühestens: als TT.MM eingeben, z. B. 01.07');
      const bff = {
        bff_typ: w.bff || null,
        bff_qualitaet: w.bff && w.bffQ ? Number(w.bffQ) : null,
        bff_vernetzung: !!w.bff && w.vernetzung,
        schnitt_ab: w.bff && tm ? `${tm[2].padStart(2, '0')}-${tm[1].padStart(2, '0')}` : null,
      };
      const mitBff = w.bff || feld?.bff_typ ? bff : {};
      if (neu) {
        const { error } = await supabase.from('felder').insert({ ...geprueft.data, ...mitBff, betrieb_id: profil!.betrieb_id });
        if (error) throw error;
      } else {
        const { error } = await supabase.from('felder').update({ ...geprueft.data, ...mitBff, version: feld!.version }).eq('id', id!);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['felder'] });
      qc.invalidateQueries({ queryKey: ['flaeche_je_kultur'] });
      navigate('/felder');
    },
    onError: (e) => {
      const m = fehlertext(e);
      setFehler(/bff_|schnitt_ab/.test(m) ? 'Für BFF bitte zuerst Migration 25 in Supabase einspielen.' : m);
    },
  });

  async function grenzeZuruecksetzen() {
    if (!feld || !confirm(`Grenze von «${feld.name}» entfernen? Das Feld und seine Daten bleiben erhalten, nur die Zeichnung wird gelöscht.`)) return;
    setFehler(null);
    const { error } = await supabase.from('felder').update({ geometrie: null, flaeche_gezeichnet_m2: null, version: feld.version }).eq('id', feld.id);
    if (error) return setFehler(fehlertext(error));
    qc.invalidateQueries({ queryKey: ['felder'] });
  }

  async function loeschen() {
    if (!feld) return;
    setFehler(null);
    const { data } = await supabase.rpc('feld_aufzeichnungen', { p_id: feld.id });
    const a = (data ?? {}) as { arbeiten?: number; ernten?: number; auftraege?: number };
    const teile = [
      a.arbeiten ? `${a.arbeiten} Arbeiten` : '',
      a.ernten ? `${a.ernten} Ernten` : '',
      a.auftraege ? `${a.auftraege} Aufträge` : '',
    ].filter(Boolean);
    const text =
      `«${feld.name}» löschen?\n\nDas Feld kommt in den Papierkorb und lässt sich 24 Stunden lang wiederherstellen.` +
      (teile.length
        ? `\n\nZu diesem Feld gibt es ${teile.join(', ')}. Diese Aufzeichnungen bleiben erhalten; das Feld wird darum nur archiviert, nicht ganz entfernt.`
        : '\n\nDanach wird es mit Fruchtfolge und Hinweisen endgültig entfernt.');
    if (!confirm(text)) return;
    const { error } = await supabase.rpc('feld_loeschen', { p_id: feld.id });
    if (error) return setFehler(fehlertext(error));
    ['felder', 'anbau', 'flaeche_je_kultur'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    navigate('/felder');
  }

  function absenden(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    speichern.mutate();
  }

  const nurLesen = !darfVerwalten;
  const set = (k: keyof typeof w) => (e: { target: { value: string } }) => setW({ ...w, [k]: e.target.value });

  if (!neu && felder.isSuccess && !feld) return <p>Feld nicht gefunden.</p>;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <Link to="/felder" aria-label="Zurück" className="knopf-leise h-11 w-11 px-0">
          <Icon name="zurueck" />
        </Link>
        <h1 className="m-0 text-2xl font-extrabold text-hof">{neu ? 'Neues Feld' : w.name || 'Feld'}</h1>
      </header>

      <form onSubmit={absenden} className="karte flex flex-col gap-3">
        <fieldset disabled={nurLesen} className="m-0 flex flex-col gap-3 border-0 p-0">
          <div className="grid grid-cols-[100px_1fr] gap-3">
            <label className="feld-label">
              Nr.
              <input className="eingabe" required value={w.feldnummer} onChange={set('feldnummer')} />
            </label>
            <label className="feld-label">
              Name
              <input className="eingabe" required value={w.name} onChange={set('name')} placeholder="z. B. Oberacker" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="feld-label">
              Fläche (ha)
              <input className="eingabe" inputMode="decimal" required value={w.flaeche} onChange={set('flaeche')} placeholder="2.40" />
              <span className="font-semibold">{haZuM2(w.flaeche) ? `= ${ha(haZuM2(w.flaeche))}` : ' '}</span>
            </label>
            <label className="feld-label">
              Gemeinde
              <input className="eingabe" value={w.gemeinde} onChange={set('gemeinde')} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="feld-label">
              Nutzungsart
              <select className="eingabe" value={w.nutzungsart} onChange={set('nutzungsart')}>
                {NUTZUNGSARTEN.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="feld-label">
              Status
              <select className="eingabe" value={w.status} onChange={set('status')}>
                {FELDSTATUS.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-col gap-3 rounded-2xl bg-grund p-3">
            <label className="feld-label">
              Biodiversitätsförderfläche (BFF / «öko»)
              <select className="eingabe" value={w.bff} onChange={(e) => setW({ ...w, bff: e.target.value })}>
                <option value="">keine BFF</option>
                {BFF_TYPEN.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            {w.bff && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <label className="feld-label">
                    Qualitätsstufe
                    <select className="eingabe" value={w.bffQ} onChange={(e) => setW({ ...w, bffQ: e.target.value })}>
                      <option value="">–</option>
                      <option value="1">Q I</option>
                      <option value="2">Q II</option>
                    </select>
                  </label>
                  <label className="feld-label">
                    Schnitt frühestens (TT.MM)
                    <input
                      className="eingabe"
                      inputMode="decimal"
                      value={w.schnittAbTag}
                      onChange={(e) => setW({ ...w, schnittAbTag: e.target.value })}
                      placeholder={(() => {
                        const ab = schnittAb({ bff_typ: w.bff as BffTyp, schnitt_ab: null }, betrieb.data?.zone);
                        return ab ? `Vorgabe ${tagMonatText(ab).slice(0, 5)}` : 'kein Termin';
                      })()}
                    />
                  </label>
                </div>
                <label className="flex min-h-10 items-center gap-2 text-sm font-bold">
                  <input type="checkbox" className="h-5 w-5 accent-hof" checked={w.vernetzung} onChange={(e) => setW({ ...w, vernetzung: e.target.checked })} />
                  Im Vernetzungsprojekt (eigene Termine, z. B. Rückzugsstreifen)
                </label>
                <span className="text-xs text-leise">
                  {(() => {
                    const ab = schnittAb({ bff_typ: w.bff as BffTyp, schnitt_ab: null }, betrieb.data?.zone);
                    return ab
                      ? `Richtwert nach DZV für ${betrieb.data?.zone ?? 'Tal- und Hügelzone'}: Schnitt ab ${tagMonatText(ab)} Weicht dein Termin ab (Vernetzung, Vereinbarung), trag ihn oben ein.`
                      : 'Für diesen Typ hinterlegt die App keinen Schnitttermin.';
                  })()}{' '}
                  Die App warnt bei Arbeiten vor dem Termin, bei Düngung und Pflanzenschutz. Massgebend sind DZV, Kanton und Vereinbarungen.
                </span>
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="feld-label">
              Bodenart
              <input className="eingabe" value={w.bodenart} onChange={set('bodenart')} placeholder="z. B. sandiger Lehm" />
            </label>
            <label className="feld-label">
              Hangneigung (%)
              <input className="eingabe" inputMode="decimal" value={w.hang} onChange={set('hang')} />
            </label>
          </div>
          <div className="flex flex-col gap-2 rounded-2xl bg-grund p-3">
            <span className="text-sm font-extrabold">Bodenprobe – Korrekturfaktoren</span>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="feld-label">
                P₂O₅
                <input className="eingabe" inputMode="decimal" value={w.kp} onChange={set('kp')} placeholder="z. B. 0.8" />
              </label>
              <label className="feld-label">
                K₂O
                <input className="eingabe" inputMode="decimal" value={w.kk} onChange={set('kk')} placeholder="z. B. 1.0" />
              </label>
              <label className="feld-label">
                Mg
                <input className="eingabe" inputMode="decimal" value={w.kmg} onChange={set('kmg')} />
              </label>
              <label className="feld-label">
                Jahr der Probe
                <input className="eingabe" inputMode="numeric" value={w.probe} onChange={set('probe')} />
              </label>
            </div>
            <span className="text-xs text-leise">Faktor gemäss Bodenanalyse (1.0 = Versorgung genügend). Dient nur als Notiz für die Düngungsplanung.</span>
          </div>
          <label className="feld-label">
            Bemerkungen
            <textarea className="eingabe min-h-24 py-2" value={w.bemerkungen} onChange={set('bemerkungen')} />
          </label>
        </fieldset>
        {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
        {!nurLesen && (
          <button className="knopf" disabled={speichern.isPending}>
            {speichern.isPending ? 'Speichere …' : 'Speichern'}
          </button>
        )}
      </form>

      {!neu && feld && (
        <section className="karte flex flex-col gap-2">
          <h2 className="m-0 text-lg font-extrabold">Feldgrenze</h2>
          <p className="m-0 text-sm text-leise">
            {feld.geometrie
              ? `Auf der Karte eingezeichnet: ${ha(Number(feld.flaeche_gezeichnet_m2))}${
                  feld.flaeche_gezeichnet_m2 && Math.abs(Number(feld.flaeche_gezeichnet_m2) - Number(feld.flaeche_m2)) > 100
                    ? ` (erfasst sind ${ha(Number(feld.flaeche_m2))})`
                    : ''
                }`
              : 'Noch nicht auf der Karte eingezeichnet.'}
          </p>
          {darfVerwalten && (
            <div className="flex flex-wrap gap-2">
              <Link to={`/felder?zeichnen=${feld.id}`} className="knopf-leise no-underline">
                {feld.geometrie ? 'Neu zeichnen' : 'Auf der Karte zeichnen'}
              </Link>
              {feld.geometrie && (
                <button type="button" className="knopf-leise text-fehler" onClick={grenzeZuruecksetzen}>
                  Grenze zurücksetzen
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {!neu && feld && <FeldHinweise feldId={feld.id} />}

      {!neu && feld && <Verlauf art="feld" id={feld.id} titel="Arbeiten, Aufträge und Ernten" />}

      {!neu && feld && <FeldWeide feldId={feld.id} />}
      {!neu && feld && <FeldExport feldId={feld.id} name={`${feld.feldnummer}_${feld.name}`} />}

      {!neu && (
        <section className="karte flex flex-col gap-2">
          <h2 className="m-0 text-lg font-extrabold">Feldhistorie</h2>
          {historie.data?.length === 0 && <p className="m-0 text-sm text-leise">Noch keine Kulturen erfasst.</p>}
          {historie.data?.map((a) => (
            <div key={a.id} className="flex items-center gap-3">
              <span className="w-12 font-extrabold">{a.jahr}</span>
              <span className="rounded-lg px-2 py-1 text-sm font-bold" style={{ background: a.kulturen?.farbe }}>
                {a.kulturen?.name}
              </span>
              <span className="text-xs text-leise">
                {a.art !== 'Hauptkultur' ? `${a.art} · ` : ''}
                {a.status === 'ist' ? 'Ist' : 'Plan'}
                {a.feld_id !== id && a.felder && ` · auf ${a.felder.name}`}
              </span>
            </div>
          ))}
          <span className="flex flex-wrap gap-4">
            <Link to="/fruchtfolge" className="text-sm font-bold text-hof">
              In der Fruchtfolge bearbeiten
            </Link>
            <Link to={`/ernte/neu?feld=${id}`} className="text-sm font-bold text-hof">
              Ernte erfassen
            </Link>
          </span>
        </section>
      )}

      {!neu && feld && darfVerwalten && <FeldTeilenZusammenfuehren feld={feld} />}

      {!neu && feld && darfVerwalten && (
        <section className="karte flex flex-col gap-2">
          <h2 className="m-0 text-lg font-extrabold">Feld löschen</h2>
          <p className="m-0 text-sm text-leise">
            Das Feld kommt in den Papierkorb (unten in der Felderliste) und ist 24 Stunden wiederherstellbar. Wird es nur nicht mehr bewirtschaftet,
            besser den Status auf «aufgegeben» setzen; dann bleibt die Historie sichtbar.
          </p>
          <button type="button" className="knopf-leise self-start text-fehler" onClick={loeschen}>
            Feld löschen
          </button>
        </section>
      )}
    </div>
  );
}

/** Export eines Feldes: Parzellenblatt (PDF) und alle Einträge eines Jahres (CSV) */
/** Weidegäste auf diesem Feld */
function FeldWeide({ feldId }: { feldId: string }) {
  const { darfVerwalten } = useAuth();
  const weiden = useBeweidungen({ feld_id: feldId });
  const partner = usePartner();
  const liste = weiden.data ?? [];
  if (!liste.length && !darfVerwalten) return null;
  return (
    <section className="karte flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-lg font-extrabold">Weidegäste</h2>
        {darfVerwalten && (
          <Link to={`/weide/neu?feld=${feldId}`} className="knopf-leise min-h-10 no-underline">
            <Icon name="plus" /> Weide
          </Link>
        )}
      </div>
      {!liste.length && <span className="text-sm text-leise">Keine Tiere anderer Betriebe auf diesem Feld erfasst.</span>}
      {liste.slice(0, 8).flatMap((b) =>
        b.beweidung_felder
          .filter((a): a is typeof a & { von: string } => a.feld_id === feldId && a.von != null)
          .map((a) => (
            <Link key={`${b.id}-${a.id ?? a.von}`} to={`/weide/${b.id}`} className="rounded-xl bg-grund p-2 text-sm font-bold text-text no-underline">
              {b.anzahl} {b.tierart} · {partner.data?.find((p) => p.id === b.partner_id)?.name ?? ''} · {datum(a.von)} – {a.bis ? datum(a.bis) : 'offen'}
              {aktiv(a) && <span className="ml-2 rounded-lg bg-hof-hell px-2 py-0.5 text-xs text-hof">jetzt hier</span>}
            </Link>
          )),
      )}
    </section>
  );
}

function FeldExport({ feldId, name }: { feldId: string; name: string }) {
  const aktuell = new Date().getFullYear();
  const [jahr, setJahr] = useState(aktuell);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const datei = name.replace(/[^A-Za-z0-9ÄÖÜäöüéèà_-]+/g, '_');

  async function pdf() {
    setFehler(null);
    setLaeuft(true);
    try {
      const d = await parzellenblaetterLaden(jahr, feldId);
      pdfHerunterladen(await parzellenblaetterPdf(d), `Parzellenblatt_${datei}_${jahr}.pdf`);
    } catch (e) {
      setFehler(fehlertext(e));
    } finally {
      setLaeuft(false);
    }
  }

  async function csv() {
    setFehler(null);
    setLaeuft(true);
    try {
      const d = await parzellenblaetterLaden(jahr, feldId);
      const b = d.blaetter[0];
      if (!b) throw new Error('Feld nicht gefunden.');
      const zeilen: (string | number | null)[][] = [];
      for (const a of b.arbeiten) {
        const basis = [a.datum.split('-').reverse().join('.'), a.arbeitsart, csvZahl(a.teil_ha), a.dauer_h != null ? csvZahl(a.dauer_h) : '', a.geraet ?? '', a.person ?? '', a.partner ?? ''];
        if (!a.mittel.length) zeilen.push([...basis, '', '', '', '', '', '', [a.bemerkungen, a.beobachtung].filter(Boolean).join(' · ')]);
        for (const m of a.mittel)
          zeilen.push([...basis, m.bezeichnung, csvZahl(m.menge_je_ha), m.einheit, csvZahl(m.gesamt), csvZahl(m.n, 1), csvZahl(m.p2o5, 1), [a.bemerkungen, a.beobachtung].filter(Boolean).join(' · ')]);
      }
      for (const e of b.ernten)
        for (const p of e.produkte)
          zeilen.push([e.datum.split('-').reverse().join('.'), `Ernte ${p.produkt}${e.schnitt ? ` ${e.schnitt}. Schnitt` : ''}`, csvZahl(e.teil_ha), '', '', '', '', '', p.ballen ?? '', p.ballenart ?? '', p.kg != null ? csvZahl(p.kg, 0) : '', '', '', '']);
      for (const w of b.weiden ?? [])
        zeilen.push([w.von.split('-').reverse().join('.'), `Weide (Gasttiere) bis ${w.bis ? w.bis.split('-').reverse().join('.') : 'offen'}`, csvZahl(w.ha), '', '', '', w.partner,
          `${w.anzahl} ${w.tierart}`, w.gve != null ? `${csvZahl(w.gve)} GVE` : '', '', '', '', '', '']);
      zeilen.sort((x, y) => String(x[0]).split('.').reverse().join('').localeCompare(String(y[0]).split('.').reverse().join('')));
      csvHerunterladen(
        `Feld_${datei}_${jahr}.csv`,
        `${name.replace(/_/g, ' ')} – ${jahr}: ${[b.hauptkultur, b.sorte].filter(Boolean).join(' ') || 'keine Kultur'} (Vorkultur ${b.vorkultur ?? '–'})`,
        ['Datum', 'Arbeit', 'Fläche ha', 'Dauer h', 'Gerät', 'Person', 'Partner', 'Mittel / Ballen', 'Menge je ha / Ballenart', 'Einheit / kg', 'Gesamt', 'N kg/ha', 'P2O5 kg/ha', 'Bemerkungen'],
        zeilen,
      );
    } catch (e) {
      setFehler(fehlertext(e));
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <section className="karte flex flex-col gap-2">
      <h2 className="m-0 text-lg font-extrabold">Export</h2>
      <div className="flex flex-wrap items-end gap-2">
        <label className="feld-label w-28">
          Jahr
          <select className="eingabe" value={jahr} onChange={(e) => setJahr(Number(e.target.value))}>
            {Array.from({ length: 8 }, (_, i) => aktuell + 1 - i).map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="knopf" onClick={pdf} disabled={laeuft}>
          Parzellenblatt (PDF)
        </button>
        <button type="button" className="knopf-leise" onClick={csv} disabled={laeuft}>
          Alle Einträge (Excel/CSV)
        </button>
      </div>
      <Link to="/kontrolle" className="text-sm font-bold">
        Alle Felder und Fruchtfolge: Kontrolle
      </Link>
      {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
    </section>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useBetrieb, useErnten, useFelder, useLager, usePartner, useVerkaeufe, useVerkauf, useVerrechneteAbgaben } from '../lib/daten';
import { chf, datum, heuteIso, menge, zahlAus } from '../lib/format';
import { belegPdf, belegSummen, qrMoeglich, type BelegDruck } from '../lib/belegPdf';
import { pdfHerunterladen, pdfPerMail } from '../lib/auftragPdf';
import { csvHerunterladen, csvZahl } from '../lib/export';
import type { Verkauf } from '../lib/typen';
import { Icon } from '../components/Icon';
import { NEU, NeuerPartnerDialog } from '../components/Schnellanlage';

const plusTage = (iso: string, tage: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + tage);
  return d.toISOString().slice(0, 10);
};

function Status({ v }: { v: Verkauf }) {
  const [text, farbe] = v.storniert
    ? ['storniert', 'bg-[#EEE] text-leise']
    : v.bezahlt
      ? ['bezahlt', 'bg-hof-hell text-hof']
      : v.faellig_am && v.faellig_am < heuteIso()
        ? ['überfällig', 'bg-fehler-hell text-fehler']
        : ['offen', 'bg-warn-hell text-warn'];
  return <span className={`rounded-lg px-2 py-0.5 text-xs font-extrabold ${farbe}`}>{text}</span>;
}

// ---------------------------------------------------------------- Liste

export function VerkaufListe() {
  const { darfVerwalten } = useAuth();
  const [jahr, setJahr] = useState(new Date().getFullYear());
  const verkaeufe = useVerkaeufe(jahr);
  const partner = usePartner();
  const ernten = useErnten();
  const verrechnet = useVerrechneteAbgaben();
  const felder = useFelder();
  const kunde = (v: Verkauf) => (v.partner_id ? (partner.data?.find((p) => p.id === v.partner_id)?.name ?? '') : (v.kunde_name ?? ''));
  const liste = verkaeufe.data ?? [];
  const gueltig = liste.filter((v) => !v.storniert);
  const total = gueltig.reduce((s, v) => s + Number(v.total_chf), 0);
  const offen = gueltig.filter((v) => !v.bezahlt).reduce((s, v) => s + Number(v.total_chf), 0);

  // Ernte-Verkäufe ohne Beleg
  const ohneBeleg = (ernten.data ?? []).flatMap((e) =>
    e.ernte_abnehmer
      .filter((a) => a.art === 'Verkauf' && a.id && !verrechnet.data?.has(a.id))
      .map((a) => ({ e, a, produkt: e.ernte_produkte.find((p) => p.id === a.produkt_id)?.produkt ?? '' })),
  );

  function exportieren() {
    csvHerunterladen(
      `verkaeufe_${jahr}.csv`,
      `Verkäufe ${jahr}`,
      ['Nr.', 'Art', 'Datum', 'Kunde', 'Total CHF', 'Status', 'Bezahlt am', 'Positionen'],
      liste.map((v) => [
        v.nummer, v.art, datum(v.datum), kunde(v), csvZahl(v.total_chf), v.storniert ? 'storniert' : v.bezahlt ? 'bezahlt' : 'offen',
        v.bezahlt_am ? datum(v.bezahlt_am) : '', v.verkauf_positionen.map((p) => `${p.menge} ${p.einheit} ${p.bezeichnung}`).join('; '),
      ]),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-leise">Rechnungen und Quittungen</span>
          <h1 className="m-0 text-3xl font-extrabold text-hof">Verkauf {jahr}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="knopf-leise h-11 w-11 px-0" aria-label="Vorjahr" onClick={() => setJahr(jahr - 1)}>
            <Icon name="zurueck" />
          </button>
          <button className="knopf-leise h-11 w-11 px-0" aria-label="Folgejahr" onClick={() => setJahr(jahr + 1)} disabled={jahr >= new Date().getFullYear()}>
            <Icon name="weiter" />
          </button>
          {liste.length > 0 && (
            <button className="knopf-leise" onClick={exportieren}>
              Export (CSV)
            </button>
          )}
          {darfVerwalten && (
            <>
              <Link to="/verkauf/neu?art=Quittung" className="knopf-leise no-underline">
                <Icon name="plus" /> Quittung
              </Link>
              <Link to="/verkauf/neu?art=Rechnung" className="knopf no-underline">
                <Icon name="plus" /> Rechnung
              </Link>
            </>
          )}
        </div>
      </header>

      {gueltig.length > 0 && (
        <section className="grid grid-cols-2 gap-3">
          <div className="karte flex flex-col p-3">
            <span className="text-xs font-extrabold text-leise">VERKAUFT {jahr}</span>
            <span className="text-2xl font-extrabold text-hof">{chf(total)}</span>
          </div>
          <div className="karte flex flex-col p-3">
            <span className="text-xs font-extrabold text-leise">OFFEN</span>
            <span className={`text-2xl font-extrabold ${offen ? 'text-fehler' : 'text-hof'}`}>{chf(offen)}</span>
          </div>
        </section>
      )}

      {darfVerwalten && ohneBeleg.length > 0 && (
        <section className="karte flex flex-col gap-2">
          <h2 className="m-0 text-lg font-extrabold">Ernte-Verkäufe ohne Beleg</h2>
          {ohneBeleg.slice(0, 12).map(({ e, a, produkt }) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-rand pt-2 text-sm">
              <span>
                <strong>{partner.data?.find((p) => p.id === a.partner_id)?.name}</strong> · {produkt}
                {a.ballen ? ` ${a.ballen} Ballen` : ''}
                {a.menge_kg ? ` ${Number(a.menge_kg).toLocaleString('de-CH')} kg` : ''} · {felder.data?.find((f) => f.id === e.feld_id)?.name} {datum(e.datum)}
                {a.preis_chf ? ` · ${chf(Number(a.preis_chf))}` : ''}
              </span>
              <span className="flex gap-2">
                <Link to={`/verkauf/neu?art=Rechnung&abgabe=${a.id}`} className="knopf-leise min-h-10 no-underline">
                  Rechnung
                </Link>
                <Link to={`/verkauf/neu?art=Quittung&abgabe=${a.id}`} className="knopf-leise min-h-10 no-underline">
                  Quittung
                </Link>
              </span>
            </div>
          ))}
        </section>
      )}

      {verkaeufe.isSuccess && liste.length === 0 && (
        <p className="karte m-0 text-leise">Für {jahr} gibt es noch keine Belege. Verkaufe Material aus dem Lager oder aus der Ernte mit Rechnung oder Quittung.</p>
      )}
      {liste.map((v) => (
        <Link key={v.id} to={`/verkauf/${v.id}`} className={`karte flex items-center gap-3 p-3 text-text no-underline ${v.storniert ? 'opacity-60' : ''}`}>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-extrabold">
              {v.art} {v.nummer} · {kunde(v)}
            </span>
            <span className="truncate text-xs text-leise">
              {datum(v.datum)} · {v.verkauf_positionen.map((p) => `${menge(Number(p.menge))} ${p.einheit} ${p.bezeichnung}`).join(', ')}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <span className="font-extrabold">{chf(Number(v.total_chf))}</span>
            <Status v={v} />
          </span>
        </Link>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Formular

interface Zeile {
  bezeichnung: string;
  menge: string;
  einheit: string;
  preis: string;
  artikel_id: string | null;
  vom_lager: boolean;
  ernte_abnehmer_id: string | null;
  quelle: 'frei' | 'lager' | 'ernte';
}

const leereZeile = (): Zeile => ({ bezeichnung: '', menge: '1', einheit: 'Stk', preis: '', artikel_id: null, vom_lager: false, ernte_abnehmer_id: null, quelle: 'frei' });

export function VerkaufFormular() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const neu = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profil, darfVerwalten } = useAuth();
  const vorhanden = useVerkauf(id);
  const betrieb = useBetrieb();
  const partner = usePartner();
  const lager = useLager();
  const ernten = useErnten();
  const felder = useFelder();
  const verrechnet = useVerrechneteAbgaben();
  const [art, setArt] = useState<Verkauf['art']>((params.get('art') as Verkauf['art']) || 'Rechnung');
  const [partnerId, setPartnerId] = useState(params.get('partner') ?? '');
  const [kundeName, setKundeName] = useState('');
  const [kundeAdresse, setKundeAdresse] = useState('');
  const [datumBeleg, setDatumBeleg] = useState(heuteIso());
  const [faellig, setFaellig] = useState('');
  const [zahlungsart, setZahlungsart] = useState<string>(art === 'Quittung' ? 'Bar' : 'Überweisung');
  const [mitMwst, setMitMwst] = useState(false);
  const [mwst, setMwst] = useState('2.6');
  const [bemerkungen, setBemerkungen] = useState('');
  const [zeilen, setZeilen] = useState<Zeile[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);
  const [arbeitet, setArbeitet] = useState(false);
  const [neuerPartner, setNeuerPartner] = useState(false);
  const [ernteWahl, setErnteWahl] = useState(false);
  const geladen = useMemo(() => ({ id: '', abgabe: '' }), []);

  // Bestehenden Beleg laden
  useEffect(() => {
    const v = vorhanden.data;
    if (!v || geladen.id === v.id) return;
    geladen.id = v.id;
    setArt(v.art);
    setPartnerId(v.partner_id ?? '');
    setKundeName(v.kunde_name ?? '');
    setKundeAdresse(v.kunde_adresse ?? '');
    setDatumBeleg(v.datum);
    setFaellig(v.faellig_am ?? '');
    setZahlungsart(v.zahlungsart ?? '');
    setMitMwst(v.mwst_satz != null);
    if (v.mwst_satz != null) setMwst(String(v.mwst_satz));
    setBemerkungen(v.bemerkungen ?? '');
    setZeilen(
      v.verkauf_positionen.map((p) => ({
        bezeichnung: p.bezeichnung, menge: String(Number(p.menge)), einheit: p.einheit, preis: String(Number(p.preis_je_einheit)),
        artikel_id: p.artikel_id, vom_lager: p.vom_lager, ernte_abnehmer_id: p.ernte_abnehmer_id,
        quelle: p.ernte_abnehmer_id ? 'ernte' : p.artikel_id ? 'lager' : 'frei',
      })),
    );
  }, [vorhanden.data, geladen]);

  // Fälligkeit vorschlagen
  useEffect(() => {
    if (neu && art === 'Rechnung') setFaellig(plusTage(datumBeleg, betrieb.data?.zahlungsfrist_tage ?? 30));
    if (neu && art === 'Quittung') setFaellig('');
  }, [neu, art, datumBeleg, betrieb.data?.zahlungsfrist_tage]);

  // Offene Ernte-Verkäufe (noch ohne Beleg)
  const ernteAbgaben = useMemo(
    () =>
      (ernten.data ?? []).flatMap((e) =>
        e.ernte_abnehmer
          .filter((a) => a.art === 'Verkauf' && a.id && (!verrechnet.data?.has(a.id) || zeilen.some((z) => z.ernte_abnehmer_id === a.id)))
          .map((a) => {
            const p = e.ernte_produkte.find((x) => x.id === a.produkt_id);
            const mengeAbg = a.ballen ?? (a.menge_kg != null ? Number(a.menge_kg) : 1);
            const einheit = a.ballen != null ? (p?.ballenart ?? 'Ballen') : a.menge_kg != null ? 'kg' : 'Stk';
            return {
              a,
              titel: `${p?.produkt ?? 'Ernte'}${a.ballen != null && p?.ballenart ? ` ${p.ballenart}` : ''} (${felder.data?.find((f) => f.id === e.feld_id)?.name ?? ''}, ${datum(e.datum)})`,
              menge: mengeAbg,
              einheit,
              preis: a.preis_chf != null && mengeAbg ? Math.round((Number(a.preis_chf) / mengeAbg) * 10000) / 10000 : 0,
            };
          }),
      ),
    [ernten.data, verrechnet.data, felder.data, zeilen],
  );

  // Aus der Ernte: ?abgabe=<id>
  useEffect(() => {
    const abgabe = params.get('abgabe');
    if (!neu || !abgabe || geladen.abgabe === abgabe) return;
    const x = ernteAbgaben.find((e) => e.a.id === abgabe);
    if (!x) return;
    geladen.abgabe = abgabe;
    if (x.a.partner_id) setPartnerId(x.a.partner_id);
    setZeilen([{ bezeichnung: x.titel, menge: String(x.menge), einheit: x.einheit, preis: String(x.preis), artikel_id: null, vom_lager: false, ernte_abnehmer_id: x.a.id!, quelle: 'ernte' }]);
  }, [neu, params, ernteAbgaben, geladen]);

  const aendere = (i: number, teil: Partial<Zeile>) => setZeilen(zeilen.map((z, j) => (j === i ? { ...z, ...teil } : z)));
  const gewaehlterPartner = partner.data?.find((p) => p.id === partnerId);
  const positionen = zeilen.map((z) => {
    const m = zahlAus(z.menge) ?? 0;
    const p = zahlAus(z.preis) ?? 0;
    return { bezeichnung: z.bezeichnung, menge: m, einheit: z.einheit, preis: p, betrag: Math.round(m * p * 100) / 100 };
  });
  const summen = belegSummen(positionen, mitMwst ? zahlAus(mwst) : null);
  const storniert = vorhanden.data?.storniert ?? false;
  const nurLesen = !darfVerwalten || storniert;

  function nutzlast() {
    if (!partnerId && !kundeName.trim()) throw new Error('Bitte Kunde wählen oder Namen eingeben.');
    if (!zeilen.length) throw new Error('Bitte mindestens eine Position erfassen.');
    for (const [i, z] of zeilen.entries()) {
      if (!z.bezeichnung.trim()) throw new Error(`Position ${i + 1}: Bezeichnung fehlt.`);
      const m = zahlAus(z.menge);
      const p = zahlAus(z.preis);
      if (m == null || m <= 0) throw new Error(`Position ${i + 1}: Menge grösser als 0 eingeben.`);
      if (p == null || p < 0) throw new Error(`Position ${i + 1}: Preis fehlt.`);
      if (z.quelle === 'lager' && z.vom_lager) {
        const a = lager.data?.find((x) => x.id === z.artikel_id);
        const vorher = vorhanden.data?.verkauf_positionen.filter((v) => v.artikel_id === z.artikel_id && v.vom_lager).reduce((s, v) => s + Number(v.menge), 0) ?? 0;
        if (a?.lagerfuehrung && m > Number(a.bestand) + vorher && !confirm(`Im Lager sind nur ${menge(Number(a.bestand), a.einheit)} «${a.bezeichnung}». Trotzdem verkaufen?`))
          throw new Error('Abgebrochen.');
      }
    }
    const satz = mitMwst ? zahlAus(mwst) : null;
    if (mitMwst && (satz == null || satz < 0 || satz > 20)) throw new Error('MWST-Satz ungültig.');
    return {
      id: id ?? null,
      version: vorhanden.data?.version,
      art,
      datum: datumBeleg,
      partner_id: partnerId || null,
      kunde_name: partnerId ? null : kundeName.trim(),
      kunde_adresse: partnerId ? null : kundeAdresse.trim() || null,
      zahlungsart: zahlungsart || null,
      faellig_am: art === 'Rechnung' ? faellig || null : null,
      mwst_satz: satz,
      bemerkungen: bemerkungen.trim() || null,
      positionen: zeilen.map((z) => ({
        bezeichnung: z.bezeichnung.trim(),
        menge: zahlAus(z.menge),
        einheit: z.einheit.trim() || 'Stk',
        preis_je_einheit: zahlAus(z.preis),
        artikel_id: z.artikel_id,
        vom_lager: z.vom_lager,
        ernte_abnehmer_id: z.ernte_abnehmer_id,
      })),
    };
  }

  async function speichern(): Promise<string | null> {
    setFehler(null);
    setMeldung(null);
    let p;
    try {
      p = nutzlast();
    } catch (e) {
      return (setFehler((e as Error).message), null);
    }
    const { data, error } = await supabase.rpc('verkauf_speichern', { p });
    if (error) return (setFehler(fehlertext(error)), null);
    ['verkaeufe', 'lager', 'lagerjournal', 'ernten'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    return data as string;
  }

  async function druck(belegId: string): Promise<{ blob: Blob; name: string; betreff: string }> {
    const { data: v } = await supabase.from('verkaeufe').select('*, verkauf_positionen(*)').eq('id', belegId).single();
    const beleg = v as Verkauf;
    beleg.verkauf_positionen.sort((a, b) => a.position - b.position);
    const b = betrieb.data!;
    const d: BelegDruck = {
      betrieb: {
        name: b.name, strasse: b.strasse ?? null, hausnummer: b.hausnummer ?? null, plz: b.plz ?? null, ort: b.ort ?? null, adresse: b.adresse,
        telefon: b.telefon, email: b.email, iban: b.iban ?? null, mwst_nr: b.mwst_nr ?? null,
      },
      absender: profil?.name ?? null,
      kunde: beleg.partner_id
        ? { name: gewaehlterPartner?.name ?? '', adresse: [gewaehlterPartner?.kontaktperson, gewaehlterPartner?.adresse].filter(Boolean).join('\n') || null }
        : { name: beleg.kunde_name ?? '', adresse: beleg.kunde_adresse },
      beleg: {
        art: beleg.art, nummer: beleg.nummer, datum: beleg.datum, faellig_am: beleg.faellig_am, zahlungsart: beleg.zahlungsart,
        bezahlt_am: beleg.bezahlt_am, mwst_satz: beleg.mwst_satz != null ? Number(beleg.mwst_satz) : null, bemerkungen: beleg.bemerkungen, storniert: beleg.storniert,
      },
      positionen: beleg.verkauf_positionen.map((p) => ({
        bezeichnung: p.bezeichnung, menge: Number(p.menge), einheit: p.einheit, preis: Number(p.preis_je_einheit), betrag: Number(p.betrag),
      })),
    };
    const blob = await belegPdf(d);
    return { blob, name: `${beleg.art}_${beleg.nummer}.pdf`, betreff: `${beleg.art} ${beleg.nummer} – ${b.name}` };
  }

  async function pdf(aktion: 'ansehen' | 'senden') {
    setArbeitet(true);
    try {
      const belegId = storniert ? id! : await speichern();
      if (!belegId) return;
      const { blob, name, betreff } = await druck(belegId);
      if (aktion === 'ansehen') pdfHerunterladen(blob, name);
      else {
        const text = `Guten Tag\n\nIm Anhang finden Sie unsere ${art} ${name.replace(/^.*_|\.pdf$/g, '')}.\n\nFreundliche Grüsse\n${profil?.name ?? ''}\n${betrieb.data?.name ?? ''}`;
        const r = await pdfPerMail(blob, name, gewaehlterPartner?.email ?? null, betreff, text);
        if (r === 'mailto') setMeldung('PDF heruntergeladen und Mail vorbereitet: bitte das PDF anhängen.');
      }
      if (neu) navigate(`/verkauf/${belegId}`, { replace: true });
    } catch (e) {
      setFehler(fehlertext(e));
    } finally {
      setArbeitet(false);
    }
  }

  async function bezahlt(wert: boolean) {
    if (!id) return;
    const { error } = await supabase.rpc('verkauf_bezahlt', { p_id: id, p_bezahlt: wert, p_datum: heuteIso() });
    if (error) return setFehler(fehlertext(error));
    ['verkaeufe', 'ernten'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  }

  async function stornieren() {
    if (!id || !confirm('Beleg stornieren? Die Nummer bleibt erhalten, Lagerbuchungen werden zurückgenommen.')) return;
    const { error } = await supabase.rpc('verkauf_stornieren', { p_id: id });
    if (error) return setFehler(fehlertext(error));
    ['verkaeufe', 'lager', 'lagerjournal', 'ernten'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  }

  if (!darfVerwalten && neu) return <p>Belege können Administratoren und Betriebsleiter erstellen.</p>;
  const qrHinweis = betrieb.data ? qrMoeglich({ ...betrieb.data, strasse: betrieb.data.strasse ?? null, hausnummer: betrieb.data.hausnummer ?? null, plz: betrieb.data.plz ?? null, ort: betrieb.data.ort ?? null, iban: betrieb.data.iban ?? null, mwst_nr: null }) : null;
  const artikelListe = (lager.data ?? []).filter((a) => a.aktiv);

  return (
    <div className="flex flex-col gap-4 pb-8">
      <header className="flex items-center gap-3">
        <Link to="/verkauf" aria-label="Zurück" className="knopf-leise h-11 w-11 px-0">
          <Icon name="zurueck" />
        </Link>
        <div className="min-w-0">
          <h1 className="m-0 truncate text-2xl font-extrabold text-hof">{vorhanden.data ? `${vorhanden.data.art} ${vorhanden.data.nummer}` : `Neue ${art}`}</h1>
          {vorhanden.data && (
            <span className="flex items-center gap-2 text-sm text-leise">
              <Status v={vorhanden.data} />
              {vorhanden.data.bezahlt_am && `bezahlt ${datum(vorhanden.data.bezahlt_am)}`}
            </span>
          )}
        </div>
      </header>

      <fieldset disabled={nurLesen} className="m-0 flex flex-col gap-4 border-0 p-0">
        <section className="karte flex flex-col gap-3">
          {neu && (
            <div className="grid grid-cols-2 gap-1 rounded-2xl bg-[#E7E1D0] p-1">
              {(['Rechnung', 'Quittung'] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  aria-pressed={art === a}
                  onClick={() => {
                    setArt(a);
                    setZahlungsart(a === 'Quittung' ? 'Bar' : 'Überweisung');
                  }}
                  className={`min-h-10 rounded-xl text-sm font-extrabold ${art === a ? 'bg-white text-hof' : 'text-[#4D5B50]'}`}
                >
                  {a === 'Rechnung' ? 'Rechnung (wird später bezahlt)' : 'Quittung (bezahlt)'}
                </button>
              ))}
            </div>
          )}
          <label className="feld-label">
            Kunde
            <select
              className="eingabe"
              value={partnerId}
              onChange={(e) => (e.target.value === NEU ? setNeuerPartner(true) : setPartnerId(e.target.value))}
            >
              <option value="">– andere Person (Name eintippen) –</option>
              <option value={NEU}>+ Neuer Partner …</option>
              {(partner.data ?? [])
                .filter((p) => p.aktiv || p.id === partnerId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.art})
                  </option>
                ))}
            </select>
          </label>
          {!partnerId && (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="feld-label">
                Name
                <input className="eingabe" value={kundeName} onChange={(e) => setKundeName(e.target.value)} placeholder="z. B. Familie Muster" />
              </label>
              <label className="feld-label">
                Adresse (optional)
                <input className="eingabe" value={kundeAdresse} onChange={(e) => setKundeAdresse(e.target.value)} placeholder="Strasse Nr., PLZ Ort" />
              </label>
            </div>
          )}
          {gewaehlterPartner && !gewaehlterPartner.adresse && art === 'Rechnung' && (
            <span className="text-xs font-bold text-warn">
              Für «{gewaehlterPartner.name}» ist keine Adresse erfasst. <Link to={`/partner/${gewaehlterPartner.id}`}>Ergänzen</Link>
            </span>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <label className="feld-label">
              Datum
              <input className="eingabe" type="date" value={datumBeleg} onChange={(e) => setDatumBeleg(e.target.value)} />
            </label>
            {art === 'Rechnung' && (
              <label className="feld-label">
                Zahlbar bis
                <input className="eingabe" type="date" value={faellig} onChange={(e) => setFaellig(e.target.value)} />
              </label>
            )}
            <label className="feld-label">
              Zahlungsart
              <select className="eingabe" value={zahlungsart} onChange={(e) => setZahlungsart(e.target.value)}>
                <option value="">–</option>
                <option>Bar</option>
                <option>TWINT</option>
                <option>Überweisung</option>
                <option>Andere</option>
              </select>
            </label>
          </div>
        </section>

        <section className="karte flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="m-0 text-lg font-extrabold">Positionen</h2>
            {!nurLesen && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="knopf-leise"
                  onClick={() => setZeilen([...zeilen, { ...leereZeile(), quelle: 'lager', vom_lager: true, einheit: '' }])}
                >
                  <Icon name="lager" /> Aus Lager
                </button>
                <button type="button" className="knopf-leise" onClick={() => setErnteWahl(!ernteWahl)}>
                  <Icon name="ernte" /> Aus Ernte
                </button>
                <button type="button" className="knopf-leise" onClick={() => setZeilen([...zeilen, leereZeile()])}>
                  <Icon name="plus" /> Frei
                </button>
              </div>
            )}
          </div>
          {ernteWahl && !nurLesen && (
            <div className="flex flex-col gap-1 rounded-2xl bg-grund p-3">
              <span className="text-sm font-extrabold">Ernte-Verkäufe ohne Beleg{partnerId ? ' (dieser Kunde zuerst)' : ''}</span>
              {ernteAbgaben.filter((x) => !zeilen.some((z) => z.ernte_abnehmer_id === x.a.id)).length === 0 && (
                <span className="text-sm text-leise">Keine offenen Ernte-Verkäufe. In der Ernte die Abgabe «Verkauf» erfassen.</span>
              )}
              {[...ernteAbgaben]
                .filter((x) => !zeilen.some((z) => z.ernte_abnehmer_id === x.a.id))
                .sort((x, y) => Number(y.a.partner_id === partnerId) - Number(x.a.partner_id === partnerId))
                .map((x) => (
                  <button
                    key={x.a.id}
                    type="button"
                    className="flex min-h-10 items-center justify-between gap-2 rounded-xl bg-white px-3 text-left text-sm"
                    onClick={() => {
                      setZeilen([
                        ...zeilen,
                        { bezeichnung: x.titel, menge: String(x.menge), einheit: x.einheit, preis: String(x.preis), artikel_id: null, vom_lager: false, ernte_abnehmer_id: x.a.id!, quelle: 'ernte' },
                      ]);
                      if (!partnerId && x.a.partner_id) setPartnerId(x.a.partner_id);
                      setErnteWahl(false);
                    }}
                  >
                    <span>
                      <strong>{partner.data?.find((p) => p.id === x.a.partner_id)?.name}</strong> · {x.titel}
                    </span>
                    <span className="shrink-0 font-bold">
                      {menge(x.menge)} {x.einheit}
                    </span>
                  </button>
                ))}
            </div>
          )}
          {zeilen.length === 0 && <p className="m-0 text-sm text-leise">Noch keine Positionen. Material aus dem Lager, aus der Ernte oder eine freie Position hinzufügen.</p>}
          {zeilen.map((z, i) => (
            <div key={i} className="grid gap-2 rounded-2xl border-2 border-rand p-3 sm:grid-cols-6">
              {z.quelle === 'lager' ? (
                <label className="feld-label sm:col-span-6">
                  Artikel aus dem Lager
                  <select
                    className="eingabe"
                    value={z.artikel_id ?? ''}
                    onChange={(e) => {
                      const a = artikelListe.find((x) => x.id === e.target.value);
                      aendere(i, { artikel_id: a?.id ?? null, bezeichnung: a?.bezeichnung ?? '', einheit: a?.einheit ?? '', vom_lager: !!a?.lagerfuehrung });
                    }}
                  >
                    <option value="">– wählen –</option>
                    {artikelListe.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.bezeichnung}
                        {a.lagerfuehrung ? ` · Bestand ${menge(Number(a.bestand), a.einheit)}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="feld-label sm:col-span-6">
                Bezeichnung {z.quelle === 'ernte' && <span className="font-normal text-leise">(aus der Ernte)</span>}
                <input className="eingabe" value={z.bezeichnung} onChange={(e) => aendere(i, { bezeichnung: e.target.value })} />
              </label>
              <label className="feld-label sm:col-span-2">
                Menge
                <input className="eingabe" inputMode="decimal" value={z.menge} onChange={(e) => aendere(i, { menge: e.target.value })} />
              </label>
              <label className="feld-label">
                Einheit
                <input className="eingabe" value={z.einheit} onChange={(e) => aendere(i, { einheit: e.target.value })} disabled={z.quelle === 'lager'} />
              </label>
              <label className="feld-label sm:col-span-2">
                Preis CHF je {z.einheit || 'Einheit'}
                <input className="eingabe" inputMode="decimal" value={z.preis} onChange={(e) => aendere(i, { preis: e.target.value })} />
              </label>
              <span className="self-end pb-3 text-right font-extrabold">{chf(positionen[i].betrag)}</span>
              {z.quelle === 'lager' && z.artikel_id && (
                <label className="flex items-center gap-2 text-sm font-bold sm:col-span-4">
                  <input type="checkbox" className="h-5 w-5 accent-hof" checked={z.vom_lager} onChange={(e) => aendere(i, { vom_lager: e.target.checked })} />
                  Vom Lager abbuchen
                </label>
              )}
              {!nurLesen && (
                <button type="button" className="justify-self-start text-sm font-bold text-fehler sm:col-span-2" onClick={() => setZeilen(zeilen.filter((_, j) => j !== i))}>
                  Entfernen
                </button>
              )}
            </div>
          ))}
          <div className="flex flex-col items-end gap-1 border-t-2 border-hof pt-2">
            <label className="flex items-center gap-2 text-sm font-bold">
              <input type="checkbox" className="h-5 w-5 accent-hof" checked={mitMwst} onChange={(e) => setMitMwst(e.target.checked)} />
              MWST ausweisen
              {mitMwst && <input className="eingabe h-9 w-20 px-2" inputMode="decimal" value={mwst} onChange={(e) => setMwst(e.target.value)} aria-label="MWST-Satz in Prozent" />}
              {mitMwst && '%'}
            </label>
            {mitMwst && (
              <span className="text-sm">
                Zwischentotal {chf(summen.netto)} · MWST {chf(summen.steuer)}
              </span>
            )}
            <span className="text-xl font-extrabold text-hof">Total {chf(summen.total)}</span>
          </div>
        </section>

        <label className="feld-label karte">
          Bemerkung auf dem Beleg (optional)
          <textarea className="eingabe min-h-16 py-2" value={bemerkungen} onChange={(e) => setBemerkungen(e.target.value)} placeholder="z. B. Abgeholt ab Hof" />
        </label>
      </fieldset>

      {art === 'Rechnung' && qrHinweis && !storniert && (
        <p className="m-0 rounded-xl bg-warn-hell p-3 text-sm font-semibold text-[#5C3D00]">
          Ohne QR-Zahlteil: {qrHinweis}. <Link to="/mehr">Betriebsangaben ergänzen</Link>
        </p>
      )}
      {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
      {meldung && <p className="m-0 rounded-xl bg-hof-hell p-3 text-sm font-semibold text-hof">{meldung}</p>}

      {darfVerwalten && (
        <div className="flex flex-wrap gap-2">
          {!storniert && (
            <button className="knopf" disabled={arbeitet} onClick={() => pdf('senden')}>
              {arbeitet ? 'Erstelle PDF …' : 'Speichern und senden (PDF)'}
            </button>
          )}
          <button className="knopf-leise" disabled={arbeitet} onClick={() => pdf('ansehen')}>
            {storniert ? 'PDF ansehen' : 'Speichern und PDF ansehen'}
          </button>
          {!storniert && (
            <button
              className="knopf-leise"
              disabled={arbeitet}
              onClick={async () => {
                const neueId = await speichern();
                if (neueId) navigate(neu ? `/verkauf/${neueId}` : '/verkauf');
              }}
            >
              Nur speichern
            </button>
          )}
          {vorhanden.data && !storniert && vorhanden.data.art === 'Rechnung' && (
            <button className="knopf-leise" onClick={() => bezahlt(!vorhanden.data!.bezahlt)}>
              {vorhanden.data.bezahlt ? 'Als offen markieren' : '✓ Als bezahlt markieren'}
            </button>
          )}
          {vorhanden.data && !storniert && (
            <button className="ml-auto text-sm font-bold text-fehler" onClick={stornieren}>
              Stornieren
            </button>
          )}
        </div>
      )}

      {neuerPartner && (
        <NeuerPartnerDialog
          art="Abnehmer/Käufer"
          onFertig={(neuId) => {
            if (neuId) setPartnerId(neuId);
            setNeuerPartner(false);
          }}
        />
      )}
    </div>
  );
}

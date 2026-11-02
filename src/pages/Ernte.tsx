import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useAnbau, useErnten, useFelder, usePartner } from '../lib/daten';
import { chf, datum, ha, heuteIso, menge, zahlAus } from '../lib/format';
import { csvHerunterladen, csvZahl } from '../lib/export';
import { ABGABEARTEN, BALLENARTEN, ERNTEPRODUKTE, type Ernte, type ErnteAbnehmer } from '../lib/typen';
import { Icon } from '../components/Icon';

const BALLENPRODUKTE = new Set(['Heu', 'Emd', 'Grassilage', 'Stroh']);

/** Vorschlag Ernteprodukt aus dem Kulturnamen */
export function produktAusKultur(name: string | undefined, schnitt = 1): Ernte['produkt'] {
  const n = (name ?? '').toLowerCase();
  if (/wiese|kleegras|weide|gras/.test(n)) return schnitt > 1 ? 'Emd' : 'Heu';
  if (n.includes('silomais')) return 'Silomais';
  if (n.includes('mais')) return 'Körnermais';
  if (/weizen|gerste|triticale|dinkel|roggen|hafer|emmer/.test(n)) return 'Getreide';
  if (n.includes('raps')) return 'Raps';
  if (n.includes('erbse')) return 'Eiweisserbsen';
  if (n.includes('kartoffel')) return 'Kartoffeln';
  if (n.includes('rübe') || n.includes('ruebe')) return 'Zuckerrüben';
  return 'Andere';
}

// ---------------------------------------------------------------- Liste

export function ErnteListe() {
  const { profil } = useAuth();
  const aktuell = new Date().getFullYear();
  const [jahr, setJahr] = useState(aktuell);
  const ernten = useErnten(jahr);
  const felder = useFelder();
  const partner = usePartner();
  const feldName = useMemo(() => new Map((felder.data ?? []).map((f) => [f.id, `${f.feldnummer} ${f.name}`])), [felder.data]);
  const partnerName = useMemo(() => new Map((partner.data ?? []).map((p) => [p.id, p.name])), [partner.data]);
  const liste = ernten.data ?? [];

  // Summen je Produkt
  const jeProdukt = new Map<string, { ballen: number; kg: number; m2: number; anzahl: number }>();
  for (const e of liste) {
    const s = jeProdukt.get(e.produkt) ?? { ballen: 0, kg: 0, m2: 0, anzahl: 0 };
    s.ballen += e.ballen ?? 0;
    s.kg += Number(e.menge_kg ?? 0);
    s.m2 += Number(e.flaeche_m2);
    s.anzahl++;
    jeProdukt.set(e.produkt, s);
  }
  // Summen je Abnehmer
  const jePartner = new Map<string, { ballen: number; kg: number; erloes: number; offen: number }>();
  for (const e of liste)
    for (const a of e.ernte_abnehmer) {
      const k = a.partner_id ? (partnerName.get(a.partner_id) ?? 'Unbekannt') : a.art;
      const s = jePartner.get(k) ?? { ballen: 0, kg: 0, erloes: 0, offen: 0 };
      s.ballen += a.ballen ?? 0;
      s.kg += Number(a.menge_kg ?? 0);
      if (a.art === 'Verkauf') {
        s.erloes += Number(a.preis_chf ?? 0);
        if (!a.bezahlt) s.offen += Number(a.preis_chf ?? 0);
      }
      jePartner.set(k, s);
    }

  function exportieren() {
    const zeilen: (string | number | null)[][] = [];
    for (const e of liste) {
      const basis = [datum(e.datum), feldName.get(e.feld_id) ?? '', e.produkt, e.schnitt, csvZahl(e.flaeche_m2 / 10000), e.ballen, e.ballenart, csvZahl(e.menge_kg, 0)];
      if (!e.ernte_abnehmer.length) zeilen.push([...basis, '', '', '', '', '', '']);
      for (const a of e.ernte_abnehmer)
        zeilen.push([
          ...basis, a.art, a.partner_id ? (partnerName.get(a.partner_id) ?? '') : '', a.ballen, csvZahl(a.menge_kg, 0), csvZahl(a.preis_chf), a.bezahlt ? 'ja' : 'nein',
        ]);
    }
    csvHerunterladen(
      `ernte_${jahr}.csv`,
      `Ernte ${jahr}`,
      ['Datum', 'Feld', 'Produkt', 'Schnitt', 'Fläche ha', 'Ballen', 'Ballenart', 'kg', 'Abgabe', 'Abnehmer', 'Ballen', 'kg', 'CHF', 'bezahlt'],
      zeilen,
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-leise">Erträge und wer sie übernommen hat</span>
          <h1 className="m-0 text-3xl font-extrabold text-hof">Ernte {jahr}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="knopf-leise h-11 w-11 px-0" aria-label="Vorjahr" onClick={() => setJahr(jahr - 1)}>
            <Icon name="zurueck" />
          </button>
          <button className="knopf-leise h-11 w-11 px-0" aria-label="Folgejahr" onClick={() => setJahr(jahr + 1)} disabled={jahr >= aktuell}>
            <Icon name="weiter" />
          </button>
          {liste.length > 0 && (
            <button className="knopf-leise" onClick={exportieren}>
              Export (CSV)
            </button>
          )}
          {profil?.rolle !== 'lesen' && (
            <Link to="/ernte/neu" className="knopf no-underline">
              <Icon name="plus" /> Ernte
            </Link>
          )}
        </div>
      </header>

      {ernten.isSuccess && liste.length === 0 && (
        <p className="karte m-0 text-leise">
          Für {jahr} ist noch keine Ernte erfasst. Erfasse jeden Schnitt bzw. jede Ernte mit Ballen oder kg und trage ein, an wen sie verkauft oder abgegeben wurde.
        </p>
      )}

      {jeProdukt.size > 0 && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...jeProdukt].map(([p, s]) => (
            <div key={p} className="karte flex flex-col gap-1 p-3">
              <span className="text-xs font-extrabold text-leise">{p.toUpperCase()}</span>
              <span className="text-2xl font-extrabold text-hof">
                {s.ballen ? `${s.ballen.toLocaleString('de-CH')} Ballen` : menge(s.kg / 1000, 't')}
              </span>
              <span className="text-xs text-leise">
                {s.anzahl} Ernten · {ha(s.m2)}
                {s.kg > 0 && ` · ${menge(s.kg / 1000, 't')} · ${Math.round(s.kg / (s.m2 / 10000)).toLocaleString('de-CH')} kg/ha`}
                {s.ballen > 0 && ` · ${(s.ballen / (s.m2 / 10000)).toFixed(1)} Ballen/ha`}
              </span>
            </div>
          ))}
        </section>
      )}

      {jePartner.size > 0 && (
        <section className="karte flex flex-col gap-2">
          <h2 className="m-0 text-lg font-extrabold">Abnehmer {jahr}</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px] text-sm">
              <thead>
                <tr className="text-left text-xs text-leise">
                  <th className="py-1">Abnehmer</th>
                  <th className="py-1 text-right">Ballen</th>
                  <th className="py-1 text-right">kg</th>
                  <th className="py-1 text-right">Erlös</th>
                  <th className="py-1 text-right">offen</th>
                </tr>
              </thead>
              <tbody>
                {[...jePartner].map(([n, s]) => (
                  <tr key={n} className="border-t border-rand">
                    <td className="py-2 font-bold">{n}</td>
                    <td className="py-2 text-right">{s.ballen || ''}</td>
                    <td className="py-2 text-right">{s.kg ? s.kg.toLocaleString('de-CH') : ''}</td>
                    <td className="py-2 text-right">{s.erloes ? chf(s.erloes) : ''}</td>
                    <td className={`py-2 text-right font-bold ${s.offen ? 'text-fehler' : ''}`}>{s.offen ? chf(s.offen) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {liste.map((e) => {
        const abgegeben = e.ernte_abnehmer.reduce((s, a) => s + (a.ballen ?? 0), 0);
        return (
          <Link key={e.id} to={`/ernte/${e.id}`} className="karte flex flex-col gap-1 p-3 text-text no-underline">
            <span className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-extrabold">
                {e.produkt}
                {e.schnitt ? ` · ${e.schnitt}. Schnitt` : ''} · {feldName.get(e.feld_id) ?? 'Feld'}
              </span>
              <span className="text-sm text-leise">{datum(e.datum)}</span>
            </span>
            <span className="text-sm">
              {e.ballen != null && `${e.ballen} ${e.ballenart ?? 'Ballen'}`}
              {e.ballen != null && e.menge_kg != null && ' · '}
              {e.menge_kg != null && `${Number(e.menge_kg).toLocaleString('de-CH')} kg`}
              {' · '}
              {ha(Number(e.flaeche_m2))}
            </span>
            {e.ernte_abnehmer.length > 0 && (
              <span className="text-xs text-leise">
                {e.ernte_abnehmer
                  .map((a) => `${a.art}${a.partner_id ? ` an ${partnerName.get(a.partner_id) ?? '?'}` : ''}${a.ballen ? ` ${a.ballen} B.` : ''}${a.menge_kg ? ` ${Number(a.menge_kg).toLocaleString('de-CH')} kg` : ''}${a.preis_chf ? ` ${chf(Number(a.preis_chf))}${a.bezahlt ? ' ✓' : ' offen'}` : ''}`)
                  .join(' · ')}
                {e.ballen != null && abgegeben < e.ballen && ` · noch ${e.ballen - abgegeben} Ballen nicht zugeteilt`}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- Formular

type AbnehmerZeile = {
  partner_id: string;
  art: ErnteAbnehmer['art'];
  ballen: string;
  menge_kg: string;
  preis: string;
  preis_einheit: NonNullable<ErnteAbnehmer['preis_einheit']>;
  bezahlt: boolean;
  bemerkung: string;
};

const neueZeile = (): AbnehmerZeile => ({
  partner_id: '', art: 'Verkauf', ballen: '', menge_kg: '', preis: '', preis_einheit: 'je Ballen', bezahlt: false, bemerkung: '',
});

/** Gesamtbetrag einer Abgabe aus Preis und Einheit */
function betrag(z: AbnehmerZeile): number | null {
  const p = zahlAus(z.preis);
  if (p == null) return null;
  const b = zahlAus(z.ballen) ?? 0;
  const kg = zahlAus(z.menge_kg) ?? 0;
  switch (z.preis_einheit) {
    case 'je Ballen': return Math.round(p * b * 100) / 100;
    case 'je 100 kg': return Math.round((p * kg) / 100 * 100) / 100;
    case 'je t': return Math.round((p * kg) / 1000 * 100) / 100;
    default: return p;
  }
}

export function ErnteFormular() {
  const { id } = useParams();
  const [suche] = useSearchParams();
  const neu = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profil, darfVerwalten } = useAuth();
  const felder = useFelder();
  const partner = usePartner();
  const ernten = useErnten();
  const bestehend = ernten.data?.find((e) => e.id === id);
  const [w, setW] = useState({
    feld_id: suche.get('feld') ?? '',
    datum: heuteIso(),
    produkt: '' as Ernte['produkt'] | '',
    schnitt: '',
    flaeche_ha: '',
    ballen: '',
    ballenart: 'Rundballen' as string,
    kg_je_ballen: '',
    menge_kg: '',
    feuchte: '',
    qualitaet: '',
    lohnunternehmen_id: '',
    bemerkungen: '',
  });
  const [abnehmer, setAbnehmer] = useState<AbnehmerZeile[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [speichert, setSpeichert] = useState(false);

  const jahr = Number(w.datum.slice(0, 4)) || new Date().getFullYear();
  const anbau = useAnbau(jahr, jahr);
  const feld = felder.data?.find((f) => f.id === w.feld_id);
  const kulturName = anbau.data?.find((a) => a.feld_id === w.feld_id && a.art === 'Hauptkultur')?.kulturen?.name;

  useEffect(() => {
    if (!bestehend) return;
    const e = bestehend;
    setW({
      feld_id: e.feld_id, datum: e.datum, produkt: e.produkt, schnitt: e.schnitt ? String(e.schnitt) : '',
      flaeche_ha: (Number(e.flaeche_m2) / 10000).toFixed(2).replace(/\.?0+$/, ''), ballen: e.ballen != null ? String(e.ballen) : '',
      ballenart: e.ballenart ?? 'Rundballen', kg_je_ballen: '', menge_kg: e.menge_kg != null ? String(e.menge_kg) : '',
      feuchte: e.feuchte_prozent != null ? String(e.feuchte_prozent) : '', qualitaet: e.qualitaet ?? '',
      lohnunternehmen_id: e.lohnunternehmen_id ?? '', bemerkungen: e.bemerkungen ?? '',
    });
    setAbnehmer(
      e.ernte_abnehmer.map((a) => ({
        partner_id: a.partner_id ?? '', art: a.art, ballen: a.ballen != null ? String(a.ballen) : '', menge_kg: a.menge_kg != null ? String(a.menge_kg) : '',
        preis: a.preis_chf != null ? String(a.preis_chf) : '', preis_einheit: 'total', bezahlt: a.bezahlt, bemerkung: a.bemerkung ?? '',
      })),
    );
  }, [bestehend]);

  // Feldfläche und Produkt vorschlagen
  useEffect(() => {
    if (!neu || !feld) return;
    setW((v) => ({
      ...v,
      flaeche_ha: (Number(feld.flaeche_m2) / 10000).toFixed(2).replace(/\.?0+$/, ''),
      produkt: v.produkt || produktAusKultur(kulturName, Number(v.schnitt) || 1),
    }));
  }, [feld, kulturName, neu]);

  const set = (k: keyof typeof w) => (e: { target: { value: string } }) => setW({ ...w, [k]: e.target.value });
  const ballenProdukt = BALLENPRODUKTE.has(w.produkt);
  const ballenTotal = zahlAus(w.ballen);
  const kgTotal = zahlAus(w.menge_kg);
  const zugeteiltB = abnehmer.reduce((s, a) => s + (zahlAus(a.ballen) ?? 0), 0);
  const zugeteiltKg = abnehmer.reduce((s, a) => s + (zahlAus(a.menge_kg) ?? 0), 0);
  const erloes = abnehmer.filter((a) => a.art === 'Verkauf').reduce((s, a) => s + (betrag(a) ?? 0), 0);

  function kgAusBallen(kgJe: string, ballen = w.ballen) {
    const k = zahlAus(kgJe);
    const b = zahlAus(ballen);
    setW((v) => ({ ...v, ballen, kg_je_ballen: kgJe, menge_kg: k != null && b != null ? String(Math.round(k * b)) : v.menge_kg }));
  }

  const aendereZeile = (i: number, teil: Partial<AbnehmerZeile>) => setAbnehmer(abnehmer.map((a, j) => (j === i ? { ...a, ...teil } : a)));

  async function speichern(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    if (!w.feld_id) return setFehler('Bitte ein Feld wählen.');
    if (!w.produkt) return setFehler('Bitte das Produkt wählen.');
    if (ballenTotal == null && kgTotal == null) return setFehler('Bitte Anzahl Ballen oder Gewicht in kg angeben.');
    if (ballenTotal != null && zugeteiltB > ballenTotal) return setFehler(`Es sind ${zugeteiltB} Ballen zugeteilt, geerntet wurden ${ballenTotal}.`);
    if (kgTotal != null && zugeteiltKg > kgTotal) return setFehler(`Es sind ${zugeteiltKg} kg zugeteilt, geerntet wurden ${kgTotal}.`);
    for (const a of abnehmer) {
      if ((a.art === 'Verkauf' || a.art === 'Abgabe') && !a.partner_id) return setFehler(`Bei «${a.art}» bitte den Partner wählen.`);
      if (!a.ballen && !a.menge_kg) return setFehler('Bei jeder Abgabe Ballen oder kg angeben.');
    }
    const flaecheHa = zahlAus(w.flaeche_ha);
    setSpeichert(true);
    const { error } = await supabase.rpc('ernte_speichern', {
      p: {
        id: id ?? null,
        version: bestehend?.version,
        feld_id: w.feld_id,
        datum: w.datum,
        produkt: w.produkt,
        schnitt: w.schnitt || null,
        flaeche_m2: flaecheHa != null ? Math.round(flaecheHa * 10000) : null,
        ballen: ballenTotal,
        ballenart: ballenTotal != null ? w.ballenart : null,
        menge_kg: kgTotal,
        feuchte_prozent: zahlAus(w.feuchte),
        qualitaet: w.qualitaet.trim() || null,
        lohnunternehmen_id: w.lohnunternehmen_id || null,
        bemerkungen: w.bemerkungen.trim() || null,
        abnehmer: abnehmer.map((a) => ({
          partner_id: a.partner_id || null,
          art: a.art,
          ballen: zahlAus(a.ballen),
          menge_kg: zahlAus(a.menge_kg),
          preis_chf: a.art === 'Verkauf' ? betrag(a) : null,
          preis_einheit: a.art === 'Verkauf' && a.preis ? a.preis_einheit : null,
          bezahlt: a.bezahlt,
          bemerkung: a.bemerkung.trim() || null,
        })),
      },
    });
    setSpeichert(false);
    if (error) return setFehler(fehlertext(error));
    qc.invalidateQueries({ queryKey: ['ernten'] });
    navigate('/ernte');
  }

  async function loeschen() {
    if (!id || !confirm('Diese Ernte mit allen Abgaben löschen?')) return;
    const { error } = await supabase.rpc('ernte_loeschen', { p_id: id });
    if (error) return setFehler(fehlertext(error));
    qc.invalidateQueries({ queryKey: ['ernten'] });
    navigate('/ernte');
  }

  if (!neu && ernten.isSuccess && !bestehend) return <p className="karte">Ernte nicht gefunden. <Link to="/ernte">Zur Übersicht</Link></p>;
  const feldListe = (felder.data ?? []).filter((f) => (f.status !== 'aufgegeben' && f.status !== 'zusammengeführt') || f.id === w.feld_id);
  const lohn = (partner.data ?? []).filter((p) => p.aktiv && (p.art === 'Lohnunternehmen' || p.id === w.lohnunternehmen_id));
  const aktivePartner = (partner.data ?? []).filter((p) => p.aktiv || abnehmer.some((a) => a.partner_id === p.id));

  return (
    <form onSubmit={speichern} className="flex flex-col gap-4">
      <header>
        <Link to="/ernte" className="text-sm font-bold">
          ← Ernte
        </Link>
        <h1 className="m-0 text-3xl font-extrabold text-hof">{neu ? 'Ernte erfassen' : 'Ernte bearbeiten'}</h1>
      </header>

      <section className="karte grid gap-3 sm:grid-cols-2">
        <label className="feld-label sm:col-span-2">
          Feld
          <select className="eingabe" value={w.feld_id} onChange={set('feld_id')} required>
            <option value="">– wählen –</option>
            {feldListe.map((f) => (
              <option key={f.id} value={f.id}>
                {f.feldnummer} {f.name} ({ha(Number(f.flaeche_m2))})
              </option>
            ))}
          </select>
          {kulturName && <span className="text-xs font-semibold text-leise">Kultur {jahr}: {kulturName}</span>}
        </label>
        <label className="feld-label">
          Datum
          <input className="eingabe" type="date" value={w.datum} max={heuteIso()} onChange={set('datum')} required />
        </label>
        <label className="feld-label">
          Produkt
          <select className="eingabe" value={w.produkt} onChange={set('produkt')} required>
            <option value="">– wählen –</option>
            {ERNTEPRODUKTE.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        {/wiese|gras|kleegras|weide/i.test(kulturName ?? '') || ['Heu', 'Emd', 'Grassilage', 'Gras frisch'].includes(w.produkt) ? (
          <label className="feld-label">
            Schnitt
            <select
              className="eingabe"
              value={w.schnitt}
              onChange={(e) => {
                const s = e.target.value;
                setW({ ...w, schnitt: s, produkt: w.produkt === 'Heu' && Number(s) > 1 ? 'Emd' : w.produkt === 'Emd' && s === '1' ? 'Heu' : w.produkt });
              }}
            >
              <option value="">–</option>
              {[1, 2, 3, 4, 5, 6].map((s) => (
                <option key={s} value={s}>
                  {s}. Schnitt
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="feld-label">
          Geerntete Fläche (ha)
          <input className="eingabe" inputMode="decimal" value={w.flaeche_ha} onChange={set('flaeche_ha')} />
        </label>
      </section>

      <section className="karte flex flex-col gap-3">
        <h2 className="m-0 text-lg font-extrabold">Ertrag</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="feld-label">
            Anzahl Ballen {ballenProdukt ? '' : '(falls gepresst)'}
            <input className="eingabe" inputMode="numeric" value={w.ballen} onChange={(e) => kgAusBallen(w.kg_je_ballen, e.target.value)} />
          </label>
          <label className="feld-label">
            Ballenart
            <select className="eingabe" value={w.ballenart} onChange={set('ballenart')} disabled={!w.ballen}>
              {BALLENARTEN.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </label>
          <label className="feld-label">
            kg je Ballen (Schätzung, optional)
            <input className="eingabe" inputMode="decimal" value={w.kg_je_ballen} onChange={(e) => kgAusBallen(e.target.value)} placeholder="z. B. 250" />
          </label>
          <label className="feld-label">
            Gewicht total (kg)
            <input className="eingabe" inputMode="decimal" value={w.menge_kg} onChange={set('menge_kg')} placeholder={ballenProdukt ? 'optional' : 'z. B. Waage'} />
          </label>
          <label className="feld-label">
            Feuchte / TS-Hinweis (%)
            <input className="eingabe" inputMode="decimal" value={w.feuchte} onChange={set('feuchte')} />
          </label>
          <label className="feld-label">
            Qualität
            <input className="eingabe" value={w.qualitaet} onChange={set('qualitaet')} placeholder="z. B. gut, verregnet" />
          </label>
          <label className="feld-label sm:col-span-2">
            Lohnunternehmen (falls ausgeführt)
            <select className="eingabe" value={w.lohnunternehmen_id} onChange={set('lohnunternehmen_id')}>
              <option value="">– selbst –</option>
              {lohn.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {feld && kgTotal != null && zahlAus(w.flaeche_ha) ? (
          <p className="m-0 text-sm font-bold text-hof">
            ≈ {Math.round(kgTotal / zahlAus(w.flaeche_ha)!).toLocaleString('de-CH')} kg/ha
            {ballenTotal ? ` · ${(ballenTotal / zahlAus(w.flaeche_ha)!).toFixed(1)} Ballen/ha` : ''}
          </p>
        ) : null}
      </section>

      <section className="karte flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="m-0 text-lg font-extrabold">Wer hat übernommen?</h2>
          <button type="button" className="knopf-leise" onClick={() => setAbnehmer([...abnehmer, neueZeile()])}>
            <Icon name="plus" /> Abnehmer
          </button>
        </div>
        {abnehmer.length === 0 && (
          <p className="m-0 text-sm text-leise">Noch nichts zugeteilt. Füge Verkäufe, Abgaben, Eigenbedarf oder Einlagerung hinzu, auch in mehreren Teilen.</p>
        )}
        {abnehmer.map((a, i) => (
          <div key={i} className="grid gap-2 rounded-2xl border-2 border-rand p-3 sm:grid-cols-6">
            <label className="feld-label sm:col-span-2">
              Art
              <select className="eingabe" value={a.art} onChange={(e) => aendereZeile(i, { art: e.target.value as AbnehmerZeile['art'] })}>
                {ABGABEARTEN.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className="feld-label sm:col-span-4">
              Partner {a.art === 'Eigenbedarf' || a.art === 'Lager' ? '(optional)' : ''}
              <select className="eingabe" value={a.partner_id} onChange={(e) => aendereZeile(i, { partner_id: e.target.value })}>
                <option value="">– wählen –</option>
                {aktivePartner.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.art})
                  </option>
                ))}
              </select>
            </label>
            <label className="feld-label sm:col-span-2">
              Ballen
              <input className="eingabe" inputMode="numeric" value={a.ballen} onChange={(e) => aendereZeile(i, { ballen: e.target.value })} />
            </label>
            <label className="feld-label sm:col-span-2">
              kg
              <input className="eingabe" inputMode="decimal" value={a.menge_kg} onChange={(e) => aendereZeile(i, { menge_kg: e.target.value })} />
            </label>
            {a.art === 'Verkauf' && (
              <>
                <label className="feld-label sm:col-span-1">
                  Preis CHF
                  <input className="eingabe" inputMode="decimal" value={a.preis} onChange={(e) => aendereZeile(i, { preis: e.target.value })} />
                </label>
                <label className="feld-label sm:col-span-1">
                  Einheit
                  <select
                    className="eingabe"
                    value={a.preis_einheit}
                    onChange={(e) => aendereZeile(i, { preis_einheit: e.target.value as AbnehmerZeile['preis_einheit'] })}
                  >
                    <option>je Ballen</option>
                    <option>je 100 kg</option>
                    <option>je t</option>
                    <option>total</option>
                  </select>
                </label>
                <span className="text-sm font-bold sm:col-span-3">Betrag: {betrag(a) != null ? chf(betrag(a)) : '–'}</span>
                <label className="flex items-center gap-2 text-sm font-bold sm:col-span-2">
                  <input type="checkbox" className="h-5 w-5 accent-hof" checked={a.bezahlt} onChange={(e) => aendereZeile(i, { bezahlt: e.target.checked })} />
                  bezahlt
                </label>
              </>
            )}
            <label className="feld-label sm:col-span-5">
              Bemerkung
              <input className="eingabe" value={a.bemerkung} onChange={(e) => aendereZeile(i, { bemerkung: e.target.value })} placeholder="z. B. abgeholt, Lieferschein" />
            </label>
            <button type="button" className="self-end text-sm font-bold text-fehler" onClick={() => setAbnehmer(abnehmer.filter((_, j) => j !== i))}>
              Entfernen
            </button>
          </div>
        ))}
        {abnehmer.length > 0 && (
          <p className="m-0 text-sm font-semibold">
            {ballenTotal != null && `Zugeteilt ${zugeteiltB} von ${ballenTotal} Ballen (noch ${Math.max(0, ballenTotal - zugeteiltB)}). `}
            {kgTotal != null && `Zugeteilt ${zugeteiltKg.toLocaleString('de-CH')} von ${kgTotal.toLocaleString('de-CH')} kg. `}
            {erloes > 0 && `Erlös ${chf(erloes)}.`}
          </p>
        )}
      </section>

      <label className="feld-label karte">
        Bemerkungen
        <textarea className="eingabe min-h-20" value={w.bemerkungen} onChange={set('bemerkungen')} />
      </label>

      {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="knopf" disabled={speichert}>
          {speichert ? 'Speichert …' : 'Speichern'}
        </button>
        {!neu && (darfVerwalten || bestehend?.erstellt_von === profil?.id) && (
          <button type="button" className="ml-auto text-sm font-bold text-fehler" onClick={loeschen}>
            Löschen
          </button>
        )}
      </div>
    </form>
  );
}

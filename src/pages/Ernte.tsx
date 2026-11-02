import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useAnbau, useErnten, useFelder, useHofobjekte, useLager, usePartner } from '../lib/daten';
import { chf, datum, ha, heuteIso, menge, zahlAus } from '../lib/format';
import { csvHerunterladen, csvZahl } from '../lib/export';
import { ABGABEARTEN, BALLENARTEN, ERNTEPRODUKTE, LEISTUNGEN, type Ernte, type ErnteAbnehmer, type ErnteProdukt } from '../lib/typen';
import { Icon } from '../components/Icon';

const BALLENPRODUKTE = new Set(['Heu', 'Emd', 'Grassilage', 'Stroh']);
const GRAS = new Set(['Heu', 'Emd', 'Grassilage', 'Gras frisch']);
/** Produkte, bei denen zusätzlich Stroh anfällt */
const MIT_STROH = new Set(['Getreide', 'Raps', 'Eiweisserbsen']);

/** Vorschlag Ernteprodukt aus dem Kulturnamen */
export function produktAusKultur(name: string | undefined, schnitt = 1): ErnteProdukt['produkt'] {
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

const zahl = (n: number) => n.toLocaleString('de-CH');

// ---------------------------------------------------------------- Liste

export function ErnteListe() {
  const { profil } = useAuth();
  const aktuell = new Date().getFullYear();
  const [jahr, setJahr] = useState(aktuell);
  const ernten = useErnten(jahr);
  const felder = useFelder();
  const partner = usePartner();
  const orte = useHofobjekte();
  const feldName = useMemo(() => new Map((felder.data ?? []).map((f) => [f.id, `${f.feldnummer} ${f.name}`])), [felder.data]);
  const partnerName = useMemo(() => new Map((partner.data ?? []).map((p) => [p.id, p.name])), [partner.data]);
  const ortName = useMemo(() => new Map((orte.data ?? []).map((o) => [o.id, o.name])), [orte.data]);
  const liste = ernten.data ?? [];

  const abnehmerName = (a: ErnteAbnehmer) =>
    a.partner_id ? (partnerName.get(a.partner_id) ?? 'Unbekannt') : a.art === 'Lager' ? `Lager${a.lagerort_id ? ` ${ortName.get(a.lagerort_id) ?? ''}` : ''}` : a.art;

  // Summen je Produkt
  const jeProdukt = new Map<string, { ballen: number; kg: number; m2: number; anzahl: number }>();
  for (const e of liste)
    for (const p of e.ernte_produkte) {
      const s = jeProdukt.get(p.produkt) ?? { ballen: 0, kg: 0, m2: 0, anzahl: 0 };
      s.ballen += p.ballen ?? 0;
      s.kg += Number(p.menge_kg ?? 0);
      s.m2 += Number(e.flaeche_m2);
      s.anzahl++;
      jeProdukt.set(p.produkt, s);
    }
  // Summen je Abnehmer
  const jeAbnehmer = new Map<string, { ballen: number; kg: number; erloes: number; offen: number }>();
  for (const e of liste)
    for (const a of e.ernte_abnehmer) {
      const k = abnehmerName(a);
      const s = jeAbnehmer.get(k) ?? { ballen: 0, kg: 0, erloes: 0, offen: 0 };
      s.ballen += a.ballen ?? 0;
      s.kg += Number(a.menge_kg ?? 0);
      if (a.art === 'Verkauf') {
        s.erloes += Number(a.preis_chf ?? 0);
        if (!a.bezahlt) s.offen += Number(a.preis_chf ?? 0);
      }
      jeAbnehmer.set(k, s);
    }
  const kosten = liste.reduce((s, e) => s + e.ernte_dienstleister.reduce((t, d) => t + Number(d.kosten_chf ?? 0), 0), 0);

  function exportieren() {
    const zeilen: (string | number | null)[][] = [];
    for (const e of liste) {
      const dl = e.ernte_dienstleister.map((d) => `${d.leistung}: ${partnerName.get(d.partner_id) ?? ''}`).join(', ');
      for (const p of e.ernte_produkte) {
        const basis = [datum(e.datum), feldName.get(e.feld_id) ?? '', p.produkt, e.schnitt, csvZahl(e.flaeche_m2 / 10000), p.ballen, p.ballenart, csvZahl(p.menge_kg, 0), dl];
        const abg = e.ernte_abnehmer.filter((a) => a.produkt_id === p.id);
        if (!abg.length) zeilen.push([...basis, '', '', '', '', '', '']);
        for (const a of abg) zeilen.push([...basis, a.art, abnehmerName(a), a.ballen, csvZahl(a.menge_kg, 0), csvZahl(a.preis_chf), a.bezahlt ? 'ja' : 'nein']);
      }
    }
    csvHerunterladen(
      `ernte_${jahr}.csv`,
      `Ernte ${jahr}`,
      ['Datum', 'Feld', 'Produkt', 'Schnitt', 'Fläche ha', 'Ballen', 'Ballenart', 'kg', 'Dienstleister', 'Abgabe', 'Abnehmer', 'Ballen', 'kg', 'CHF', 'bezahlt'],
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
          Für {jahr} ist noch keine Ernte erfasst. Erfasse jeden Schnitt bzw. Drusch mit den Produkten (z. B. Getreide und Stroh), den Dienstleistern und wer was übernommen hat.
        </p>
      )}

      {jeProdukt.size > 0 && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...jeProdukt].map(([p, s]) => (
            <div key={p} className="karte flex flex-col gap-1 p-3">
              <span className="text-xs font-extrabold text-leise">{p.toUpperCase()}</span>
              <span className="text-2xl font-extrabold text-hof">{s.ballen ? `${zahl(s.ballen)} Ballen` : menge(s.kg / 1000, 't')}</span>
              <span className="text-xs text-leise">
                {s.anzahl} Ernten · {ha(s.m2)}
                {s.kg > 0 && ` · ${menge(s.kg / 1000, 't')} · ${zahl(Math.round(s.kg / (s.m2 / 10000)))} kg/ha`}
                {s.ballen > 0 && ` · ${(s.ballen / (s.m2 / 10000)).toFixed(1)} Ballen/ha`}
              </span>
            </div>
          ))}
        </section>
      )}

      {jeAbnehmer.size > 0 && (
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
                {[...jeAbnehmer].map(([n, s]) => (
                  <tr key={n} className="border-t border-rand">
                    <td className="py-2 font-bold">{n}</td>
                    <td className="py-2 text-right">{s.ballen || ''}</td>
                    <td className="py-2 text-right">{s.kg ? zahl(s.kg) : ''}</td>
                    <td className="py-2 text-right">{s.erloes ? chf(s.erloes) : ''}</td>
                    <td className={`py-2 text-right font-bold ${s.offen ? 'text-fehler' : ''}`}>{s.offen ? chf(s.offen) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {kosten > 0 && <p className="m-0 text-sm text-leise">Kosten Dienstleister {jahr}: {chf(kosten)}</p>}
        </section>
      )}

      {liste.map((e) => (
        <Link key={e.id} to={`/ernte/${e.id}`} className="karte flex flex-col gap-1 p-3 text-text no-underline">
          <span className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-extrabold">
              {e.ernte_produkte.map((p) => p.produkt).join(' + ')}
              {e.schnitt ? ` · ${e.schnitt}. Schnitt` : ''} · {feldName.get(e.feld_id) ?? 'Feld'}
            </span>
            <span className="text-sm text-leise">{datum(e.datum)}</span>
          </span>
          {e.ernte_produkte.map((p) => {
            const abg = e.ernte_abnehmer.filter((a) => a.produkt_id === p.id);
            const zugeteilt = abg.reduce((s, a) => s + (a.ballen ?? 0), 0);
            return (
              <span key={p.id} className="text-sm">
                <strong>{p.produkt}:</strong> {p.ballen != null && `${p.ballen} ${p.ballenart ?? 'Ballen'}`}
                {p.ballen != null && p.menge_kg != null && ' · '}
                {p.menge_kg != null && `${zahl(Number(p.menge_kg))} kg`}
                {abg.length > 0 && (
                  <span className="text-xs text-leise">
                    {' → '}
                    {abg
                      .map(
                        (a) =>
                          `${a.art === 'Verkauf' || a.art === 'Abgabe' ? `${a.art} an ` : ''}${abnehmerName(a)}${a.ballen ? ` ${a.ballen} B.` : ''}${
                            a.menge_kg ? ` ${zahl(Number(a.menge_kg))} kg` : ''
                          }${a.preis_chf ? ` ${chf(Number(a.preis_chf))}${a.bezahlt ? ' ✓' : ' offen'}` : ''}`,
                      )
                      .join(' · ')}
                    {p.ballen != null && zugeteilt < p.ballen && ` · noch ${p.ballen - zugeteilt} Ballen offen`}
                  </span>
                )}
              </span>
            );
          })}
          {e.ernte_dienstleister.length > 0 && (
            <span className="text-xs text-leise">
              {e.ernte_dienstleister.map((d) => `${d.leistung}: ${partnerName.get(d.partner_id) ?? '?'}${d.kosten_chf ? ` (${chf(Number(d.kosten_chf))})` : ''}`).join(' · ')}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Formular

type ProduktZeile = {
  produkt: ErnteProdukt['produkt'];
  ballen: string;
  ballenart: string;
  kg_je_ballen: string;
  menge_kg: string;
  feuchte: string;
  qualitaet: string;
};

type DienstZeile = { partner_id: string; leistung: string; kosten: string; bemerkung: string };

type AbnehmerZeile = {
  produkt_index: number;
  partner_id: string;
  art: ErnteAbnehmer['art'];
  ballen: string;
  menge_kg: string;
  preis: string;
  preis_einheit: NonNullable<ErnteAbnehmer['preis_einheit']>;
  bezahlt: boolean;
  bemerkung: string;
  lagerort_id: string;
  lagerartikel_id: string;
};

const neuesProdukt = (produkt: ErnteProdukt['produkt']): ProduktZeile => ({
  produkt, ballen: '', ballenart: produkt === 'Stroh' ? 'Quaderballen' : 'Rundballen', kg_je_ballen: '', menge_kg: '', feuchte: '', qualitaet: '',
});

const neueAbgabe = (produkt_index: number): AbnehmerZeile => ({
  produkt_index, partner_id: '', art: 'Verkauf', ballen: '', menge_kg: '', preis: '', preis_einheit: 'je Ballen', bezahlt: false, bemerkung: '',
  lagerort_id: '', lagerartikel_id: '',
});

/** Gesamtbetrag einer Abgabe aus Preis und Einheit */
function betrag(z: AbnehmerZeile): number | null {
  const p = zahlAus(z.preis);
  if (p == null) return null;
  const b = zahlAus(z.ballen) ?? 0;
  const kg = zahlAus(z.menge_kg) ?? 0;
  switch (z.preis_einheit) {
    case 'je Ballen': return Math.round(p * b * 100) / 100;
    case 'je 100 kg': return Math.round(((p * kg) / 100) * 100) / 100;
    case 'je t': return Math.round(((p * kg) / 1000) * 100) / 100;
    default: return p;
  }
}

const zuText = (n: number | null | undefined) => (n == null ? '' : String(n));

export function ErnteFormular() {
  const { id } = useParams();
  const [suche] = useSearchParams();
  const neu = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profil, darfVerwalten } = useAuth();
  const felder = useFelder();
  const partner = usePartner();
  const orte = useHofobjekte();
  const lager = useLager();
  const ernten = useErnten();
  const bestehend = ernten.data?.find((e) => e.id === id);
  const [w, setW] = useState({ feld_id: suche.get('feld') ?? '', datum: heuteIso(), schnitt: '', flaeche_ha: '', bemerkungen: '' });
  const [produkte, setProdukte] = useState<ProduktZeile[]>([]);
  const [dienste, setDienste] = useState<DienstZeile[]>([]);
  const [abnehmer, setAbnehmer] = useState<AbnehmerZeile[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [speichert, setSpeichert] = useState(false);

  const jahr = Number(w.datum.slice(0, 4)) || new Date().getFullYear();
  const anbau = useAnbau(jahr, jahr);
  const feld = felder.data?.find((f) => f.id === w.feld_id);
  const kulturName = anbau.data?.find((a) => a.feld_id === w.feld_id)?.kulturen?.name;

  useEffect(() => {
    if (!bestehend) return;
    const e = bestehend;
    setW({
      feld_id: e.feld_id, datum: e.datum, schnitt: zuText(e.schnitt),
      flaeche_ha: (Number(e.flaeche_m2) / 10000).toFixed(2).replace(/\.?0+$/, ''), bemerkungen: e.bemerkungen ?? '',
    });
    setProdukte(
      e.ernte_produkte.map((p) => ({
        produkt: p.produkt, ballen: zuText(p.ballen), ballenart: p.ballenart ?? 'Rundballen', kg_je_ballen: '', menge_kg: zuText(p.menge_kg),
        feuchte: zuText(p.feuchte_prozent), qualitaet: p.qualitaet ?? '',
      })),
    );
    setDienste(e.ernte_dienstleister.map((d) => ({ partner_id: d.partner_id, leistung: d.leistung, kosten: zuText(d.kosten_chf), bemerkung: d.bemerkung ?? '' })));
    setAbnehmer(
      e.ernte_abnehmer.map((a) => ({
        produkt_index: Math.max(0, e.ernte_produkte.findIndex((p) => p.id === a.produkt_id)),
        partner_id: a.partner_id ?? '', art: a.art, ballen: zuText(a.ballen), menge_kg: zuText(a.menge_kg), preis: zuText(a.preis_chf),
        preis_einheit: 'total', bezahlt: a.bezahlt, bemerkung: a.bemerkung ?? '', lagerort_id: a.lagerort_id ?? '', lagerartikel_id: a.lagerartikel_id ?? '',
      })),
    );
  }, [bestehend]);

  // Feldfläche und erstes Produkt vorschlagen
  useEffect(() => {
    if (!neu || !feld) return;
    setW((v) => ({ ...v, flaeche_ha: (Number(feld.flaeche_m2) / 10000).toFixed(2).replace(/\.?0+$/, '') }));
    setProdukte((p) => (p.length ? p : [neuesProdukt(produktAusKultur(kulturName, 1))]));
  }, [feld, kulturName, neu]);

  const setKopf = (k: keyof typeof w) => (e: { target: { value: string } }) => setW({ ...w, [k]: e.target.value });
  const aendereProdukt = (i: number, teil: Partial<ProduktZeile>) =>
    setProdukte(
      produkte.map((p, j) => {
        if (j !== i) return p;
        const n = { ...p, ...teil };
        // kg aus Ballen × kg je Ballen
        if (('ballen' in teil || 'kg_je_ballen' in teil) && zahlAus(n.kg_je_ballen) != null && zahlAus(n.ballen) != null)
          n.menge_kg = String(Math.round(zahlAus(n.kg_je_ballen)! * zahlAus(n.ballen)!));
        return n;
      }),
    );
  const aendereAbgabe = (i: number, teil: Partial<AbnehmerZeile>) => setAbnehmer(abnehmer.map((a, j) => (j === i ? { ...a, ...teil } : a)));
  const aendereDienst = (i: number, teil: Partial<DienstZeile>) => setDienste(dienste.map((d, j) => (j === i ? { ...d, ...teil } : d)));

  function produktEntfernen(i: number) {
    if (abnehmer.some((a) => a.produkt_index === i) && !confirm('Zu diesem Produkt gibt es Abgaben. Diese werden ebenfalls entfernt.')) return;
    setProdukte(produkte.filter((_, j) => j !== i));
    setAbnehmer(abnehmer.filter((a) => a.produkt_index !== i).map((a) => (a.produkt_index > i ? { ...a, produkt_index: a.produkt_index - 1 } : a)));
  }

  const flaecheHa = zahlAus(w.flaeche_ha);
  const istGras = /wiese|gras|weide/i.test(kulturName ?? '') || produkte.some((p) => GRAS.has(p.produkt));

  async function speichern(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    if (!w.feld_id) return setFehler('Bitte ein Feld wählen.');
    if (!produkte.length) return setFehler('Bitte mindestens ein Produkt erfassen.');
    for (const p of produkte) if (zahlAus(p.ballen) == null && zahlAus(p.menge_kg) == null) return setFehler(`Bei «${p.produkt}» Anzahl Ballen oder kg angeben.`);
    for (const [i, p] of produkte.entries()) {
      const abg = abnehmer.filter((a) => a.produkt_index === i);
      const b = abg.reduce((s, a) => s + (zahlAus(a.ballen) ?? 0), 0);
      const kg = abg.reduce((s, a) => s + (zahlAus(a.menge_kg) ?? 0), 0);
      if (zahlAus(p.ballen) != null && b > zahlAus(p.ballen)!) return setFehler(`Bei «${p.produkt}» sind ${b} Ballen zugeteilt, geerntet wurden ${p.ballen}.`);
      if (zahlAus(p.menge_kg) != null && kg > zahlAus(p.menge_kg)! * 1.001)
        return setFehler(`Bei «${p.produkt}» sind ${zahl(kg)} kg zugeteilt, geerntet wurden ${p.menge_kg} kg.`);
    }
    for (const a of abnehmer) {
      if ((a.art === 'Verkauf' || a.art === 'Abgabe') && !a.partner_id) return setFehler(`Bei «${a.art}» bitte den Partner wählen.`);
      if (!a.ballen && !a.menge_kg) return setFehler('Bei jeder Abgabe Ballen oder kg angeben.');
    }
    for (const d of dienste) if (!d.partner_id) return setFehler('Bitte bei jedem Dienstleister den Partner wählen.');
    setSpeichert(true);
    const { error } = await supabase.rpc('ernte_speichern', {
      p: {
        id: id ?? null,
        version: bestehend?.version,
        feld_id: w.feld_id,
        datum: w.datum,
        schnitt: w.schnitt || null,
        flaeche_m2: flaecheHa != null ? Math.round(flaecheHa * 10000) : null,
        bemerkungen: w.bemerkungen.trim() || null,
        produkte: produkte.map((p) => ({
          produkt: p.produkt,
          ballen: zahlAus(p.ballen),
          ballenart: zahlAus(p.ballen) != null ? p.ballenart : null,
          menge_kg: zahlAus(p.menge_kg),
          feuchte_prozent: zahlAus(p.feuchte),
          qualitaet: p.qualitaet.trim() || null,
        })),
        dienstleister: dienste.map((d) => ({ partner_id: d.partner_id, leistung: d.leistung, kosten_chf: zahlAus(d.kosten), bemerkung: d.bemerkung.trim() || null })),
        abnehmer: abnehmer.map((a) => ({
          produkt_index: a.produkt_index,
          partner_id: a.art === 'Lager' ? null : a.partner_id || null,
          art: a.art,
          ballen: zahlAus(a.ballen),
          menge_kg: zahlAus(a.menge_kg),
          preis_chf: a.art === 'Verkauf' ? betrag(a) : null,
          preis_einheit: a.art === 'Verkauf' && a.preis ? a.preis_einheit : null,
          bezahlt: a.bezahlt,
          bemerkung: a.bemerkung.trim() || null,
          lagerort_id: a.art === 'Lager' ? a.lagerort_id || null : null,
          lagerartikel_id: a.art === 'Lager' ? a.lagerartikel_id || null : null,
        })),
      },
    });
    setSpeichert(false);
    if (error) return setFehler(fehlertext(error));
    ['ernten', 'lager', 'lagerjournal'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    navigate('/ernte');
  }

  async function loeschen() {
    if (!id || !confirm('Diese Ernte mit allen Abgaben löschen? Eingelagerte Mengen werden aus dem Lager ausgebucht.')) return;
    const { error } = await supabase.rpc('ernte_loeschen', { p_id: id });
    if (error) return setFehler(fehlertext(error));
    ['ernten', 'lager', 'lagerjournal'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    navigate('/ernte');
  }

  if (!neu && ernten.isSuccess && !bestehend)
    return (
      <p className="karte">
        Ernte nicht gefunden. <Link to="/ernte">Zur Übersicht</Link>
      </p>
    );
  const feldListe = (felder.data ?? []).filter((f) => (f.status !== 'aufgegeben' && f.status !== 'zusammengeführt') || f.id === w.feld_id);
  const aktivePartner = (partner.data ?? []).filter((p) => p.aktiv || abnehmer.some((a) => a.partner_id === p.id) || dienste.some((d) => d.partner_id === p.id));
  const dienstPartner = [...aktivePartner].sort((a, b) => Number(b.art === 'Lohnunternehmen') - Number(a.art === 'Lohnunternehmen'));
  const lagerorte = [...(orte.data ?? [])].sort(
    (a, b) => Number(['Lager', 'Scheune', 'Silo'].includes(b.typ)) - Number(['Lager', 'Scheune', 'Silo'].includes(a.typ)),
  );
  const erzeugnisse = (lager.data ?? []).filter((l) => l.kategorie === 'Erzeugnisse' && ['Ballen', 'Stk', 'kg', 't'].includes(l.einheit));

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
          <select className="eingabe" value={w.feld_id} onChange={setKopf('feld_id')} required>
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
          <input className="eingabe" type="date" value={w.datum} max={heuteIso()} onChange={setKopf('datum')} required />
        </label>
        <label className="feld-label">
          Geerntete Fläche (ha)
          <input className="eingabe" inputMode="decimal" value={w.flaeche_ha} onChange={setKopf('flaeche_ha')} />
        </label>
        {istGras && (
          <label className="feld-label">
            Schnitt
            <select
              className="eingabe"
              value={w.schnitt}
              onChange={(e) => {
                const s = e.target.value;
                setW({ ...w, schnitt: s });
                setProdukte(produkte.map((p) => ({ ...p, produkt: p.produkt === 'Heu' && Number(s) > 1 ? 'Emd' : p.produkt === 'Emd' && s === '1' ? 'Heu' : p.produkt })));
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
        )}
      </section>

      {/* Produkte */}
      <section className="karte flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-lg font-extrabold">Produkte und Ertrag</h2>
          <div className="flex flex-wrap gap-2">
            {produkte.some((p) => MIT_STROH.has(p.produkt)) && !produkte.some((p) => p.produkt === 'Stroh') && (
              <button type="button" className="knopf-leise" onClick={() => setProdukte([...produkte, neuesProdukt('Stroh')])}>
                <Icon name="plus" /> Stroh
              </button>
            )}
            <button type="button" className="knopf-leise" onClick={() => setProdukte([...produkte, neuesProdukt('Andere')])}>
              <Icon name="plus" /> Produkt
            </button>
          </div>
        </div>
        {produkte.length === 0 && <p className="m-0 text-sm text-leise">Zuerst ein Feld wählen oder ein Produkt hinzufügen.</p>}
        {produkte.map((p, i) => {
          const kg = zahlAus(p.menge_kg);
          const b = zahlAus(p.ballen);
          return (
            <div key={i} className="grid gap-2 rounded-2xl border-2 border-rand p-3 sm:grid-cols-4">
              <label className="feld-label sm:col-span-2">
                Produkt
                <select className="eingabe" value={p.produkt} onChange={(e) => aendereProdukt(i, { produkt: e.target.value as ProduktZeile['produkt'] })}>
                  {ERNTEPRODUKTE.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label className="feld-label">
                Ballen {BALLENPRODUKTE.has(p.produkt) ? '' : '(falls gepresst)'}
                <input className="eingabe" inputMode="numeric" value={p.ballen} onChange={(e) => aendereProdukt(i, { ballen: e.target.value })} />
              </label>
              <label className="feld-label">
                Ballenart
                <select className="eingabe" value={p.ballenart} onChange={(e) => aendereProdukt(i, { ballenart: e.target.value })} disabled={!p.ballen}>
                  {BALLENARTEN.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label className="feld-label">
                kg je Ballen (optional)
                <input className="eingabe" inputMode="decimal" value={p.kg_je_ballen} onChange={(e) => aendereProdukt(i, { kg_je_ballen: e.target.value })} placeholder="z. B. 250" />
              </label>
              <label className="feld-label">
                Gewicht total (kg)
                <input className="eingabe" inputMode="decimal" value={p.menge_kg} onChange={(e) => aendereProdukt(i, { menge_kg: e.target.value })} />
              </label>
              <label className="feld-label">
                Feuchte (%)
                <input className="eingabe" inputMode="decimal" value={p.feuchte} onChange={(e) => aendereProdukt(i, { feuchte: e.target.value })} />
              </label>
              <label className="feld-label">
                Qualität
                <input className="eingabe" value={p.qualitaet} onChange={(e) => aendereProdukt(i, { qualitaet: e.target.value })} placeholder="z. B. gut" />
              </label>
              <span className="self-center text-sm font-bold text-hof sm:col-span-3">
                {flaecheHa && kg != null ? `≈ ${zahl(Math.round(kg / flaecheHa))} kg/ha` : ''}
                {flaecheHa && b ? ` · ${(b / flaecheHa).toFixed(1)} Ballen/ha` : ''}
              </span>
              {produkte.length > 1 && (
                <button type="button" className="justify-self-end text-sm font-bold text-fehler" onClick={() => produktEntfernen(i)}>
                  Entfernen
                </button>
              )}
            </div>
          );
        })}
      </section>

      {/* Dienstleister */}
      <section className="karte flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="m-0 text-lg font-extrabold">Dienstleister</h2>
          <button
            type="button"
            className="knopf-leise"
            onClick={() =>
              setDienste([
                ...dienste,
                { partner_id: '', leistung: produkte.some((p) => MIT_STROH.has(p.produkt) || p.produkt === 'Körnermais') && !dienste.length ? 'Dreschen' : 'Pressen', kosten: '', bemerkung: '' },
              ])
            }
          >
            <Icon name="plus" /> Dienstleister
          </button>
        </div>
        {dienste.length === 0 && <p className="m-0 text-sm text-leise">Selbst geerntet. Füge z. B. Dreschen und Pressen mit je einem Lohnunternehmen hinzu.</p>}
        {dienste.map((d, i) => (
          <div key={i} className="grid gap-2 rounded-2xl border-2 border-rand p-3 sm:grid-cols-6">
            <label className="feld-label sm:col-span-2">
              Leistung
              <select className="eingabe" value={d.leistung} onChange={(e) => aendereDienst(i, { leistung: e.target.value })}>
                {LEISTUNGEN.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className="feld-label sm:col-span-2">
              Partner
              <select className="eingabe" value={d.partner_id} onChange={(e) => aendereDienst(i, { partner_id: e.target.value })}>
                <option value="">– wählen –</option>
                {dienstPartner.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.art})
                  </option>
                ))}
              </select>
            </label>
            <label className="feld-label">
              Kosten CHF
              <input className="eingabe" inputMode="decimal" value={d.kosten} onChange={(e) => aendereDienst(i, { kosten: e.target.value })} />
            </label>
            <button type="button" className="self-end text-sm font-bold text-fehler" onClick={() => setDienste(dienste.filter((_, j) => j !== i))}>
              Entfernen
            </button>
          </div>
        ))}
      </section>

      {/* Abnehmer */}
      <section className="karte flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="m-0 text-lg font-extrabold">Wer hat übernommen?</h2>
          <button type="button" className="knopf-leise" disabled={!produkte.length} onClick={() => setAbnehmer([...abnehmer, neueAbgabe(0)])}>
            <Icon name="plus" /> Abnehmer
          </button>
        </div>
        {abnehmer.length === 0 && (
          <p className="m-0 text-sm text-leise">Noch nichts zugeteilt. Füge Verkäufe, Abgaben, Eigenbedarf oder Einlagerung hinzu, auch in mehreren Teilen.</p>
        )}
        {abnehmer.map((a, i) => (
          <div key={i} className="grid gap-2 rounded-2xl border-2 border-rand p-3 sm:grid-cols-6">
            {produkte.length > 1 && (
              <label className="feld-label sm:col-span-2">
                Produkt
                <select className="eingabe" value={a.produkt_index} onChange={(e) => aendereAbgabe(i, { produkt_index: Number(e.target.value) })}>
                  {produkte.map((p, j) => (
                    <option key={j} value={j}>
                      {p.produkt}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="feld-label sm:col-span-2">
              Art
              <select className="eingabe" value={a.art} onChange={(e) => aendereAbgabe(i, { art: e.target.value as AbnehmerZeile['art'] })}>
                {ABGABEARTEN.map((x) => (
                  <option key={x} value={x}>
                    {x === 'Lager' ? 'Ins Lager' : x}
                  </option>
                ))}
              </select>
            </label>
            {a.art === 'Lager' ? (
              <>
                <label className="feld-label sm:col-span-2">
                  Lagerort
                  <select className="eingabe" value={a.lagerort_id} onChange={(e) => aendereAbgabe(i, { lagerort_id: e.target.value })}>
                    <option value="">– ohne –</option>
                    {lagerorte.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} ({o.typ})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="feld-label sm:col-span-6">
                  Lagerartikel
                  <select className="eingabe" value={a.lagerartikel_id} onChange={(e) => aendereAbgabe(i, { lagerartikel_id: e.target.value })}>
                    <option value="">Automatisch: «{lagerName(produkte[a.produkt_index], a, jahr, lagerorte.find((o) => o.id === a.lagerort_id)?.name)}»</option>
                    {erzeugnisse.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.bezeichnung} ({l.einheit}, Bestand {menge(Number(l.bestand))})
                      </option>
                    ))}
                  </select>
                  <span className="text-xs font-normal text-leise">Wird als Eingang ins Lager gebucht. Ändern oder Löschen der Ernte bucht automatisch nach.</span>
                </label>
              </>
            ) : (
              <label className="feld-label sm:col-span-4">
                Partner {a.art === 'Eigenbedarf' ? '(optional)' : ''}
                <select className="eingabe" value={a.partner_id} onChange={(e) => aendereAbgabe(i, { partner_id: e.target.value })}>
                  <option value="">– wählen –</option>
                  {aktivePartner.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.art})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="feld-label sm:col-span-2">
              Ballen
              <input className="eingabe" inputMode="numeric" value={a.ballen} onChange={(e) => aendereAbgabe(i, { ballen: e.target.value })} />
            </label>
            <label className="feld-label sm:col-span-2">
              kg
              <input className="eingabe" inputMode="decimal" value={a.menge_kg} onChange={(e) => aendereAbgabe(i, { menge_kg: e.target.value })} />
            </label>
            {a.art === 'Verkauf' && (
              <>
                <label className="feld-label sm:col-span-1">
                  Preis CHF
                  <input className="eingabe" inputMode="decimal" value={a.preis} onChange={(e) => aendereAbgabe(i, { preis: e.target.value })} />
                </label>
                <label className="feld-label sm:col-span-1">
                  Einheit
                  <select className="eingabe" value={a.preis_einheit} onChange={(e) => aendereAbgabe(i, { preis_einheit: e.target.value as AbnehmerZeile['preis_einheit'] })}>
                    <option>je Ballen</option>
                    <option>je 100 kg</option>
                    <option>je t</option>
                    <option>total</option>
                  </select>
                </label>
                <span className="text-sm font-bold sm:col-span-3">Betrag: {betrag(a) != null ? chf(betrag(a)) : '–'}</span>
                <label className="flex items-center gap-2 text-sm font-bold sm:col-span-2">
                  <input type="checkbox" className="h-5 w-5 accent-hof" checked={a.bezahlt} onChange={(e) => aendereAbgabe(i, { bezahlt: e.target.checked })} />
                  bezahlt
                </label>
              </>
            )}
            <label className="feld-label sm:col-span-5">
              Bemerkung
              <input className="eingabe" value={a.bemerkung} onChange={(e) => aendereAbgabe(i, { bemerkung: e.target.value })} placeholder="z. B. abgeholt, Lieferschein" />
            </label>
            <button type="button" className="self-end text-sm font-bold text-fehler" onClick={() => setAbnehmer(abnehmer.filter((_, j) => j !== i))}>
              Entfernen
            </button>
          </div>
        ))}
        {abnehmer.length > 0 &&
          produkte.map((p, j) => {
            const abg = abnehmer.filter((a) => a.produkt_index === j);
            const b = abg.reduce((s, a) => s + (zahlAus(a.ballen) ?? 0), 0);
            const kg = abg.reduce((s, a) => s + (zahlAus(a.menge_kg) ?? 0), 0);
            const erloes = abg.filter((a) => a.art === 'Verkauf').reduce((s, a) => s + (betrag(a) ?? 0), 0);
            const pb = zahlAus(p.ballen);
            const pkg = zahlAus(p.menge_kg);
            return (
              <p key={j} className="m-0 text-sm font-semibold">
                {p.produkt}: {pb != null && `zugeteilt ${b} von ${pb} Ballen (noch ${Math.max(0, pb - b)}). `}
                {pkg != null && `zugeteilt ${zahl(kg)} von ${zahl(pkg)} kg. `}
                {erloes > 0 && `Erlös ${chf(erloes)}.`}
              </p>
            );
          })}
      </section>

      <label className="feld-label karte">
        Bemerkungen
        <textarea className="eingabe min-h-20" value={w.bemerkungen} onChange={setKopf('bemerkungen')} />
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

/** Name des automatisch angelegten Lagerartikels (wie in der Datenbank) */
function lagerName(p: ProduktZeile | undefined, a: AbnehmerZeile, jahr: number, ort?: string) {
  if (!p) return '';
  const ballen = zahlAus(a.ballen) != null && zahlAus(p.ballen) != null;
  return `${p.produkt}${ballen ? ` ${p.ballenart}` : ''} ${jahr}${ort ? ` – ${ort}` : ''}`;
}

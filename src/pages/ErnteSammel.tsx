import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useAnbau, useErnten, useFelder, useHofobjekte, usePartner } from '../lib/daten';
import { chf, ha, heuteIso, zahlAus } from '../lib/format';
import { ABGABEARTEN, BALLENARTEN, ERNTEPRODUKTE, LEISTUNGEN, type Ernte, type ErnteProdukt } from '../lib/typen';
import { Icon } from '../components/Icon';
import { NEU, NeuerPartnerDialog } from '../components/Schnellanlage';
import { produktAusKultur } from './Ernte';

const MIT_STROH = new Set(['Getreide', 'Raps', 'Eiweisserbsen']);
const zahl = (n: number) => n.toLocaleString('de-CH');
const zuText = (n: number | null | undefined) => (n == null ? '' : String(n));
const haText = (m2: number) => (m2 / 10000).toFixed(2).replace(/\.?0+$/, '');

type Abgabemodus = 'keine' | (typeof ABGABEARTEN)[number];
interface Spalte {
  produkt: ErnteProdukt['produkt'];
  ballenart: string;
  kg_je_ballen: string;
  abgabe: Abgabemodus;
  partner_id: string;
  lagerort_id: string;
  preis: string;
  preis_einheit: 'je Ballen' | 'je 100 kg' | 'je t';
}
interface Zeile {
  ernte?: Ernte;
  feld_id: string;
  datum: string;
  flaeche_ha: string;
  werte: { ballen: string; kg: string }[];
}
interface Dienst {
  partner_id: string;
  leistung: string;
  kosten_ha: string;
}

const neueSpalte = (produkt: ErnteProdukt['produkt'], ballenart?: string | null): Spalte => ({
  produkt, ballenart: ballenart ?? (produkt === 'Stroh' ? 'Quaderballen' : 'Rundballen'), kg_je_ballen: '', abgabe: 'keine', partner_id: '', lagerort_id: '',
  preis: '', preis_einheit: 'je Ballen',
});

/** Mehrere Ernten auf einmal erfassen oder gemeinsam bearbeiten */
export function ErnteSammel() {
  const [params] = useSearchParams();
  const ids = useMemo(() => (params.get('ids') ?? '').split(',').filter(Boolean), [params]);
  const bearbeiten = ids.length > 0;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profil, darfVerwalten } = useAuth();
  const felder = useFelder();
  const partner = usePartner();
  const orte = useHofobjekte();
  const ernten = useErnten();
  const [datum, setDatum] = useState(heuteIso());
  const [schnitt, setSchnitt] = useState('');
  const [spalten, setSpalten] = useState<Spalte[]>([]);
  const [zeilen, setZeilen] = useState<Zeile[]>([]);
  const [dienste, setDienste] = useState<Dienst[]>([]);
  const [diensteErsetzen, setDiensteErsetzen] = useState(!bearbeiten);
  const [fehler, setFehler] = useState<string | null>(null);
  const [speichert, setSpeichert] = useState(false);
  const [neuerPartner, setNeuerPartner] = useState<{ ziel: 'dienst' | 'spalte'; i: number } | null>(null);
  const jahr = Number(datum.slice(0, 4)) || new Date().getFullYear();
  const anbau = useAnbau(jahr, jahr);
  const kulturJeFeld = useMemo(() => new Map((anbau.data ?? []).map((a) => [a.feld_id, a.kulturen?.name])), [anbau.data]);

  // Bearbeiten: ausgewählte Ernten laden
  const geladen = useMemo(() => (ernten.data ?? []).filter((e) => ids.includes(e.id)), [ernten.data, ids]);
  const initialisiert = useRef(false);
  useEffect(() => {
    if (!bearbeiten || !geladen.length || initialisiert.current) return;
    initialisiert.current = true;
    const namen: Spalte[] = [];
    for (const e of geladen)
      for (const p of e.ernte_produkte) if (!namen.some((s) => s.produkt === p.produkt)) namen.push(neueSpalte(p.produkt, p.ballenart));
    setSpalten(namen);
    setZeilen(
      geladen.map((e) => ({
        ernte: e,
        feld_id: e.feld_id,
        datum: e.datum,
        flaeche_ha: haText(Number(e.flaeche_m2)),
        werte: namen.map((s) => {
          const p = e.ernte_produkte.find((x) => x.produkt === s.produkt);
          return { ballen: zuText(p?.ballen), kg: zuText(p?.menge_kg) };
        }),
      })),
    );
    const s = new Set(geladen.map((e) => e.schnitt));
    setSchnitt(s.size === 1 ? zuText([...s][0]) : '');
    setDatum(geladen[0].datum);
  }, [bearbeiten, geladen]);

  const aktiveFelder = (felder.data ?? []).filter((f) => f.status !== 'aufgegeben' && f.status !== 'zusammengeführt');
  const feld = (id: string) => felder.data?.find((f) => f.id === id);

  function feldUmschalten(id: string) {
    if (zeilen.some((z) => z.feld_id === id)) return setZeilen(zeilen.filter((z) => z.feld_id !== id));
    const f = feld(id);
    let sp = spalten;
    if (!sp.length) {
      sp = [neueSpalte(produktAusKultur(kulturJeFeld.get(id) ?? undefined, Number(schnitt) || 1))];
      setSpalten(sp);
    }
    setZeilen([...zeilen, { feld_id: id, datum, flaeche_ha: f ? haText(Number(f.flaeche_m2)) : '', werte: sp.map(() => ({ ballen: '', kg: '' })) }]);
  }

  function spalteHinzu(produkt: ErnteProdukt['produkt']) {
    if (spalten.length >= 3) return;
    setSpalten([...spalten, neueSpalte(produkt)]);
    setZeilen(zeilen.map((z) => ({ ...z, werte: [...z.werte, { ballen: '', kg: '' }] })));
  }
  function spalteEntfernen(j: number) {
    if (bearbeiten && zeilen.some((z) => z.ernte?.ernte_produkte.some((p) => p.produkt === spalten[j].produkt)))
      return setFehler(`«${spalten[j].produkt}» ist in bestehenden Ernten erfasst. Mengen dort einzeln entfernen.`);
    setSpalten(spalten.filter((_, k) => k !== j));
    setZeilen(zeilen.map((z) => ({ ...z, werte: z.werte.filter((_, k) => k !== j) })));
  }
  const aendereSpalte = (j: number, teil: Partial<Spalte>) => setSpalten(spalten.map((s, k) => (k === j ? { ...s, ...teil } : s)));
  const aendereWert = (i: number, j: number, teil: Partial<Zeile['werte'][number]>) =>
    setZeilen(zeilen.map((z, k) => (k === i ? { ...z, werte: z.werte.map((w, l) => (l === j ? { ...w, ...teil } : w)) } : z)));
  const aendereDienst = (i: number, teil: Partial<Dienst>) => setDienste(dienste.map((d, k) => (k === i ? { ...d, ...teil } : d)));

  /** kg der Zelle: eingegeben oder aus Ballen × kg je Ballen */
  const kgVon = (z: Zeile, j: number) => {
    const kg = zahlAus(z.werte[j]?.kg ?? '');
    if (kg != null) return kg;
    const b = zahlAus(z.werte[j]?.ballen ?? '');
    const je = zahlAus(spalten[j]?.kg_je_ballen ?? '');
    return b != null && je != null ? Math.round(b * je) : null;
  };

  function nutzlast() {
    const liste = [];
    for (const [i, z] of zeilen.entries()) {
      const f = feld(z.feld_id);
      const name = f?.name ?? `Zeile ${i + 1}`;
      const flaeche = zahlAus(z.flaeche_ha);
      if (flaeche == null || flaeche <= 0) throw new Error(`${name}: Fläche fehlt.`);
      if (z.datum > heuteIso()) throw new Error(`${name}: Datum liegt in der Zukunft.`);
      const index: number[] = []; // Spalte → Produktindex in dieser Ernte
      const produkte = [];
      for (const [j, s] of spalten.entries()) {
        const b = zahlAus(z.werte[j].ballen);
        const kg = kgVon(z, j);
        if (b == null && kg == null) {
          index.push(-1);
          continue;
        }
        const alt = z.ernte?.ernte_produkte.find((p) => p.produkt === s.produkt);
        index.push(produkte.length);
        produkte.push({
          produkt: s.produkt,
          ballen: b,
          ballenart: b != null ? s.ballenart : null,
          menge_kg: kg,
          feuchte_prozent: alt?.feuchte_prozent ?? null,
          qualitaet: alt?.qualitaet ?? null,
        });
      }
      if (!produkte.length) throw new Error(`${name}: Bitte Ballen oder kg eintragen (oder Feld abwählen).`);

      const abnehmer = [];
      // Bestehende Abgaben behalten
      for (const a of z.ernte?.ernte_abnehmer ?? []) {
        const pname = z.ernte!.ernte_produkte.find((p) => p.id === a.produkt_id)?.produkt;
        const j = spalten.findIndex((s) => s.produkt === pname);
        if (j < 0 || index[j] < 0) throw new Error(`${name}: Für «${pname}» gibt es Abgaben, die Menge darf nicht leer sein.`);
        abnehmer.push({ ...a, id: undefined, produkt_id: undefined, produkt_index: index[j] });
      }
      // Gemeinsame Abgabe je Produkt (nur wo noch nichts zugeteilt ist)
      for (const [j, s] of spalten.entries()) {
        if (s.abgabe === 'keine' || index[j] < 0) continue;
        const pname = s.produkt;
        if (z.ernte?.ernte_abnehmer.some((a) => z.ernte!.ernte_produkte.find((p) => p.id === a.produkt_id)?.produkt === pname)) continue;
        if ((s.abgabe === 'Verkauf' || s.abgabe === 'Abgabe') && !s.partner_id) throw new Error(`Bei «${pname}» bitte den Abnehmer wählen.`);
        const b = zahlAus(z.werte[j].ballen);
        const kg = kgVon(z, j);
        const p = zahlAus(s.preis);
        const preis =
          s.abgabe !== 'Verkauf' || p == null
            ? null
            : s.preis_einheit === 'je Ballen'
              ? (b ?? 0) * p
              : s.preis_einheit === 'je 100 kg'
                ? ((kg ?? 0) * p) / 100
                : ((kg ?? 0) * p) / 1000;
        abnehmer.push({
          produkt_index: index[j],
          art: s.abgabe,
          partner_id: s.abgabe === 'Lager' ? null : s.partner_id || null,
          lagerort_id: s.abgabe === 'Lager' ? s.lagerort_id || null : null,
          ballen: b,
          menge_kg: kg,
          preis_chf: preis != null ? Math.round(preis * 100) / 100 : null,
          preis_einheit: preis != null ? s.preis_einheit : null,
          bezahlt: false,
        });
      }

      const dienstleister =
        diensteErsetzen || !z.ernte
          ? dienste.map((d) => {
              const k = zahlAus(d.kosten_ha);
              return { partner_id: d.partner_id, leistung: d.leistung, kosten_chf: k != null ? Math.round(k * flaeche * 100) / 100 : null };
            })
          : z.ernte.ernte_dienstleister.map((d) => ({ partner_id: d.partner_id, leistung: d.leistung, kosten_chf: d.kosten_chf, bemerkung: d.bemerkung }));

      liste.push({
        id: z.ernte?.id ?? null,
        version: z.ernte?.version,
        feld_id: z.feld_id,
        datum: z.datum,
        schnitt: schnitt || (z.ernte?.schnitt ?? null),
        flaeche_m2: Math.round(flaeche * 10000),
        bemerkungen: z.ernte?.bemerkungen ?? null,
        produkte,
        dienstleister,
        abnehmer,
      });
    }
    return liste;
  }

  async function speichern() {
    setFehler(null);
    if (!zeilen.length) return setFehler('Bitte mindestens ein Feld wählen.');
    if (dienste.some((d) => !d.partner_id)) return setFehler('Bitte bei jedem Dienstleister den Partner wählen.');
    let liste;
    try {
      liste = nutzlast();
    } catch (e) {
      return setFehler((e as Error).message);
    }
    setSpeichert(true);
    const { error } = await supabase.rpc('ernten_speichern', { p: { ernten: liste } });
    setSpeichert(false);
    if (error) return setFehler(fehlertext(error));
    ['ernten', 'lager', 'lagerjournal'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    navigate('/ernte');
  }

  if (profil?.rolle === 'lesen') return <p>Mit der Rolle «Lesen» können keine Ernten erfasst werden.</p>;
  const lagerorte = [...(orte.data ?? [])].sort(
    (a, b) => Number(['Lager', 'Scheune', 'Silo'].includes(b.typ)) - Number(['Lager', 'Scheune', 'Silo'].includes(a.typ)),
  );
  const aktivePartner = (partner.data ?? []).filter((p) => p.aktiv);
  const summeHa = zeilen.reduce((s, z) => s + (zahlAus(z.flaeche_ha) ?? 0), 0);

  return (
    <div className="flex flex-col gap-4 pb-24">
      <header>
        <Link to="/ernte" className="text-sm font-bold">
          ← Ernte
        </Link>
        <h1 className="m-0 text-3xl font-extrabold text-hof">{bearbeiten ? `${zeilen.length} Ernten bearbeiten` : 'Ernte mehrerer Felder'}</h1>
        <span className="text-sm text-leise">
          {bearbeiten
            ? 'Mengen, Fläche und Datum je Feld anpassen. Bestehende Abgaben bleiben erhalten.'
            : 'Gleiche Arbeit auf mehreren Feldern, z. B. 2. Schnitt: Felder antippen, Mengen je Feld eintragen.'}
        </span>
      </header>

      <section className="karte grid gap-3 sm:grid-cols-2">
        <label className="feld-label">
          Datum {bearbeiten ? '(für alle setzen)' : ''}
          <input
            className="eingabe"
            type="date"
            max={heuteIso()}
            value={datum}
            onChange={(e) => {
              setDatum(e.target.value);
              setZeilen(zeilen.map((z) => ({ ...z, datum: e.target.value })));
            }}
          />
        </label>
        <label className="feld-label">
          Schnitt (Grasland)
          <select className="eingabe" value={schnitt} onChange={(e) => setSchnitt(e.target.value)}>
            <option value="">{bearbeiten ? '– unverändert –' : '–'}</option>
            {[1, 2, 3, 4, 5, 6].map((s) => (
              <option key={s} value={s}>
                {s}. Schnitt
              </option>
            ))}
          </select>
        </label>
      </section>

      {!bearbeiten && (
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <h2 className="m-0 text-[15px] font-extrabold text-[#3E4C41]">Felder</h2>
            <span className="text-sm font-extrabold text-hof">
              {zeilen.length} Felder · {summeHa.toLocaleString('de-CH')} ha
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {aktiveFelder.map((f) => {
              const an = zeilen.some((z) => z.feld_id === f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={an}
                  onClick={() => feldUmschalten(f.id)}
                  className={`min-h-11 rounded-full border-2 px-4 text-sm font-extrabold ${an ? 'border-hof bg-hof text-white' : 'border-linie bg-white text-text'}`}
                >
                  {f.name}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Produkte (Spalten) mit gemeinsamer Abgabe */}
      {spalten.length > 0 && (
        <section className="karte flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="m-0 text-lg font-extrabold">Produkte</h2>
            <div className="flex flex-wrap gap-2">
              {spalten.some((s) => MIT_STROH.has(s.produkt)) && !spalten.some((s) => s.produkt === 'Stroh') && spalten.length < 3 && (
                <button type="button" className="knopf-leise" onClick={() => spalteHinzu('Stroh')}>
                  <Icon name="plus" /> Stroh
                </button>
              )}
              {spalten.length < 3 && (
                <button type="button" className="knopf-leise" onClick={() => spalteHinzu('Andere')}>
                  <Icon name="plus" /> Produkt
                </button>
              )}
            </div>
          </div>
          {spalten.map((s, j) => (
            <div key={j} className="grid gap-2 rounded-2xl border-2 border-rand p-3 sm:grid-cols-4">
              <label className="feld-label">
                Produkt
                <select
                  className="eingabe"
                  value={s.produkt}
                  disabled={bearbeiten && zeilen.some((z) => z.ernte?.ernte_produkte.some((p) => p.produkt === s.produkt))}
                  onChange={(e) => aendereSpalte(j, { produkt: e.target.value as Spalte['produkt'] })}
                >
                  {ERNTEPRODUKTE.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label className="feld-label">
                Ballenart
                <select className="eingabe" value={s.ballenart} onChange={(e) => aendereSpalte(j, { ballenart: e.target.value })}>
                  {BALLENARTEN.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label className="feld-label">
                kg je Ballen (optional)
                <input className="eingabe" inputMode="decimal" value={s.kg_je_ballen} onChange={(e) => aendereSpalte(j, { kg_je_ballen: e.target.value })} placeholder="rechnet kg" />
              </label>
              <label className="feld-label">
                {bearbeiten ? 'Abgabe (wo noch keine)' : 'Alles geht an'}
                <select className="eingabe" value={s.abgabe} onChange={(e) => aendereSpalte(j, { abgabe: e.target.value as Abgabemodus })}>
                  <option value="keine">– nichts / später –</option>
                  <option value="Lager">Ins Lager</option>
                  <option value="Verkauf">Verkauf an …</option>
                  <option value="Abgabe">Abgabe an …</option>
                  <option value="Eigenbedarf">Eigenbedarf</option>
                </select>
              </label>
              {s.abgabe === 'Lager' && (
                <label className="feld-label sm:col-span-2">
                  Lagerort
                  <select className="eingabe" value={s.lagerort_id} onChange={(e) => aendereSpalte(j, { lagerort_id: e.target.value })}>
                    <option value="">– ohne –</option>
                    {lagerorte.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} ({o.typ})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {(s.abgabe === 'Verkauf' || s.abgabe === 'Abgabe') && (
                <label className="feld-label sm:col-span-2">
                  Abnehmer
                  <select
                    className="eingabe"
                    value={s.partner_id}
                    onChange={(e) => (e.target.value === NEU ? setNeuerPartner({ ziel: 'spalte', i: j }) : aendereSpalte(j, { partner_id: e.target.value }))}
                  >
                    <option value="">– wählen –</option>
                    {darfVerwalten && <option value={NEU}>+ Neuer Partner …</option>}
                    {aktivePartner.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.art})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {s.abgabe === 'Verkauf' && (
                <div className="grid grid-cols-2 gap-2 sm:col-span-2">
                  <label className="feld-label">
                    Preis CHF
                    <input className="eingabe" inputMode="decimal" value={s.preis} onChange={(e) => aendereSpalte(j, { preis: e.target.value })} />
                  </label>
                  <label className="feld-label">
                    Einheit
                    <select className="eingabe" value={s.preis_einheit} onChange={(e) => aendereSpalte(j, { preis_einheit: e.target.value as Spalte['preis_einheit'] })}>
                      <option>je Ballen</option>
                      <option>je 100 kg</option>
                      <option>je t</option>
                    </select>
                  </label>
                </div>
              )}
              {spalten.length > 1 && (
                <button type="button" className="justify-self-start text-sm font-bold text-fehler sm:col-span-4" onClick={() => spalteEntfernen(j)}>
                  Produkt entfernen
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Mengen je Feld */}
      {zeilen.length > 0 && (
        <section className="karte flex flex-col gap-2">
          <h2 className="m-0 text-lg font-extrabold">Mengen je Feld</h2>
          {zeilen.map((z, i) => {
            const f = feld(z.feld_id);
            return (
              <div key={`${z.feld_id}-${i}`} className="flex flex-col gap-2 border-t border-rand pt-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-extrabold">
                    {f?.feldnummer} {f?.name}
                    <span className="ml-2 text-xs font-semibold text-leise">{kulturJeFeld.get(z.feld_id) ?? ''}</span>
                  </span>
                  {bearbeiten && z.ernte && z.ernte.ernte_abnehmer.length > 0 && (
                    <span className="text-xs font-bold text-leise">{z.ernte.ernte_abnehmer.length} Abgaben bleiben</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {bearbeiten && (
                    <label className="feld-label">
                      Datum
                      <input
                        className="eingabe"
                        type="date"
                        max={heuteIso()}
                        value={z.datum}
                        onChange={(e) => setZeilen(zeilen.map((x, k) => (k === i ? { ...x, datum: e.target.value } : x)))}
                      />
                    </label>
                  )}
                  <label className="feld-label">
                    Fläche ha
                    <input
                      className="eingabe"
                      inputMode="decimal"
                      value={z.flaeche_ha}
                      onChange={(e) => setZeilen(zeilen.map((x, k) => (k === i ? { ...x, flaeche_ha: e.target.value } : x)))}
                    />
                  </label>
                  {spalten.map((s, j) => (
                    <div key={j} className="contents">
                      <label className="feld-label">
                        {s.produkt} Ballen
                        <input className="eingabe" inputMode="numeric" value={z.werte[j]?.ballen ?? ''} onChange={(e) => aendereWert(i, j, { ballen: e.target.value })} />
                      </label>
                      <label className="feld-label">
                        {s.produkt} kg
                        <input
                          className="eingabe"
                          inputMode="decimal"
                          value={z.werte[j]?.kg ?? ''}
                          onChange={(e) => aendereWert(i, j, { kg: e.target.value })}
                          placeholder={kgVon(z, j) != null && !z.werte[j]?.kg ? `≈ ${zahl(kgVon(z, j)!)}` : ''}
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="flex flex-col gap-1 border-t-2 border-hof pt-2 text-sm font-extrabold text-hof">
            {spalten.map((s, j) => {
              const b = zeilen.reduce((t, z) => t + (zahlAus(z.werte[j]?.ballen ?? '') ?? 0), 0);
              const kg = zeilen.reduce((t, z) => t + (kgVon(z, j) ?? 0), 0);
              return (
                <span key={j}>
                  Total {s.produkt}: {b ? `${zahl(b)} Ballen` : ''}
                  {b && kg ? ' · ' : ''}
                  {kg ? `${zahl(kg)} kg` : ''}
                  {summeHa > 0 && b ? ` · ${(b / summeHa).toFixed(1)} Ballen/ha` : ''}
                  {summeHa > 0 && kg ? ` · ${zahl(Math.round(kg / summeHa))} kg/ha` : ''}
                </span>
              );
            })}
            <span className="text-xs font-semibold text-leise">{ha(summeHa * 10000)} total</span>
          </div>
        </section>
      )}

      {/* Dienstleister */}
      {zeilen.length > 0 && (
        <section className="karte flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 text-lg font-extrabold">Dienstleister {bearbeiten ? '' : '(für alle Felder)'}</h2>
            <button
              type="button"
              className="knopf-leise"
              onClick={() => {
                setDienste([...dienste, { partner_id: '', leistung: spalten.some((s) => MIT_STROH.has(s.produkt)) && !dienste.length ? 'Dreschen' : 'Pressen', kosten_ha: '' }]);
                setDiensteErsetzen(true);
              }}
            >
              <Icon name="plus" /> Dienstleister
            </button>
          </div>
          {bearbeiten && (
            <label className="flex min-h-10 items-center gap-2 text-sm font-bold">
              <input type="checkbox" className="h-5 w-5 accent-hof" checked={diensteErsetzen} onChange={(e) => setDiensteErsetzen(e.target.checked)} />
              Dienstleister bei allen ausgewählten Ernten durch diese Liste ersetzen
            </label>
          )}
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
                <select
                  className="eingabe"
                  value={d.partner_id}
                  onChange={(e) => (e.target.value === NEU ? setNeuerPartner({ ziel: 'dienst', i }) : aendereDienst(i, { partner_id: e.target.value }))}
                >
                  <option value="">– wählen –</option>
                  {darfVerwalten && <option value={NEU}>+ Neuer Partner …</option>}
                  {[...aktivePartner]
                    .sort((a, b) => Number(b.art === 'Lohnunternehmen') - Number(a.art === 'Lohnunternehmen'))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.art})
                      </option>
                    ))}
                </select>
              </label>
              <label className="feld-label">
                CHF / ha
                <input className="eingabe" inputMode="decimal" value={d.kosten_ha} onChange={(e) => aendereDienst(i, { kosten_ha: e.target.value })} />
              </label>
              <button type="button" className="self-end text-sm font-bold text-fehler" onClick={() => setDienste(dienste.filter((_, k) => k !== i))}>
                Entfernen
              </button>
              {zahlAus(d.kosten_ha) != null && summeHa > 0 && (
                <span className="text-xs text-leise sm:col-span-6">Total {chf((zahlAus(d.kosten_ha) ?? 0) * summeHa)}, je Feld nach Fläche verteilt</span>
              )}
            </div>
          ))}
        </section>
      )}

      {neuerPartner && (
        <NeuerPartnerDialog
          art={neuerPartner.ziel === 'dienst' ? 'Lohnunternehmen' : 'Abnehmer/Käufer'}
          onFertig={(neuId) => {
            if (neuId) {
              if (neuerPartner.ziel === 'dienst') aendereDienst(neuerPartner.i, { partner_id: neuId });
              else aendereSpalte(neuerPartner.i, { partner_id: neuId });
            }
            setNeuerPartner(null);
          }}
        />
      )}

      {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
      <div className="fixed inset-x-0 bottom-0 z-10 bg-grund/95 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 md:static md:bg-transparent md:p-0">
        <button className="knopf h-14 w-full text-lg" onClick={speichern} disabled={speichert || !zeilen.length}>
          {speichert ? 'Speichere …' : `${zeilen.length} ${zeilen.length === 1 ? 'Ernte' : 'Ernten'} speichern`}
        </button>
      </div>
    </div>
  );
}

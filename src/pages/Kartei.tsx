import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMitarbeiter, useBetrieb, useFeldarbeiten, useFeldarbeitGeraete, useFelder, useMaschinen, usePartner } from '../lib/daten';
import { datum, ha, menge } from '../lib/format';
import { csvHerunterladen, csvZahl } from '../lib/export';
import { ARBEITSGRUPPEN, arbeitsgruppe } from '../lib/typen';
import { Icon } from '../components/Icon';

export function Kartei() {
  const betrieb = useBetrieb();
  const [jahr, setJahr] = useState(new Date().getFullYear());
  const [feldFilter, setFeldFilter] = useState('');
  const [artFilter, setArtFilter] = useState('');
  const [personFilter, setPersonFilter] = useState('');
  const [kulturFilter, setKulturFilter] = useState('');
  const arbeiten = useFeldarbeiten(jahr);
  const felder = useFelder();
  const mitarbeiter = useMitarbeiter();
  const maschinen = useMaschinen();
  const partner = usePartner();
  const maschinenName = (id: string | null, text: string | null) => (id ? (maschinen.data?.find((m) => m.id === id)?.name ?? text) : text);
  const geraeteListe = useFeldarbeitGeraete();
  // alle Geräte einer Arbeit (mehrere am Traktor), sonst das eine Gerät
  const geraeteName = (a: { id: string; geraet_id: string | null; geraet: string | null }) => {
    const ids = geraeteListe.data?.get(a.id);
    return ids?.length ? ids.map((g) => maschinenName(g, null)).filter(Boolean).join(' + ') : maschinenName(a.geraet_id, a.geraet);
  };
  const partnerName = (id: string | null) => (id ? partner.data?.find((p) => p.id === id)?.name : undefined);

  const feldName = useMemo(() => new Map((felder.data ?? []).map((f) => [f.id, f.name])), [felder.data]);
  const personName = useMemo(() => new Map((mitarbeiter.data ?? []).map((m) => [m.id, m.name])), [mitarbeiter.data]);
  /** Person einer Arbeit: Mitarbeiter/in, sonst das App-Konto, das sie erfasst hat */
  const wer = (a: { mitarbeiter_id?: string | null; ausgefuehrt_von: string | null }) =>
    a.mitarbeiter_id ?? mitarbeiter.data?.find((m) => m.benutzer_id === a.ausgefuehrt_von)?.id ?? null;
  const kulturen = [
    ...new Set((arbeiten.data ?? []).flatMap((a) => a.feldarbeit_felder.map((f) => f.anbau?.kulturen?.name).filter(Boolean) as string[])),
  ].sort();

  const liste = (arbeiten.data ?? []).filter(
    (a) =>
      (!feldFilter || a.feldarbeit_felder.some((f) => f.feld_id === feldFilter)) &&
      (!artFilter || a.arbeitsart === artFilter || (artFilter.startsWith('gruppe:') && arbeitsgruppe(a.arbeitsart) === artFilter.slice(7))) &&
      (!personFilter || wer(a) === personFilter) &&
      (!kulturFilter || a.feldarbeit_felder.some((f) => f.anbau?.kulturen?.name === kulturFilter)),
  );

  function exportieren() {
    // Eine Zeile je Arbeit × Feld × Mittel: so lässt sich in Excel nach Feld filtern und summieren.
    const zeilen: (string | number | null)[][] = [];
    for (const a of [...liste].reverse()) {
      for (const f of a.feldarbeit_felder) {
        const mittel = a.feldarbeit_mittel.length ? a.feldarbeit_mittel : [null];
        for (const m of mittel) {
          const anteil = m ? (Number(m.menge_je_ha) * Number(f.flaeche_m2)) / 10000 : null;
          zeilen.push([
            datum(a.datum),
            feldName.get(f.feld_id) ?? '',
            f.anbau?.kulturen?.name ?? '',
            a.arbeitsart,
            a.status,
            csvZahl(Number(f.flaeche_m2) / 10000),
            m?.lagerartikel?.bezeichnung ?? '',
            m ? csvZahl(m.menge_je_ha) : '',
            m ? csvZahl(anteil) : '',
            m?.lagerartikel?.einheit ?? '',
            a.ausbringung ?? '',
            maschinenName(a.maschine_id, a.maschine) ?? '',
            geraeteName(a) ?? '',
            partnerName(a.partner_id) ?? '',
            wer(a) ? (personName.get(wer(a)!) ?? '') : '',
            csvZahl(a.dauer_h),
            a.bemerkungen ?? '',
          ]);
        }
      }
    }
    csvHerunterladen(
      `ackerschlagkartei_${jahr}.csv`,
      `${betrieb.data?.name ?? 'Betrieb'} · Ackerschlagkartei ${jahr}`,
      ['Datum', 'Feld', 'Kultur', 'Arbeit', 'Status', 'Fläche ha', 'Mittel', 'Menge/ha', 'Menge Feld', 'Einheit', 'Ausbringung', 'Maschine', 'Gerät', 'Lohnunternehmen/Partner', 'Person', 'Dauer h', 'Bemerkungen'],
      zeilen,
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <span className="text-sm font-semibold text-leise">{liste.length} Einträge</span>
          <h1 className="m-0 text-3xl font-extrabold text-hof">Ackerschlagkartei</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="knopf-leise" onClick={exportieren}>
            Excel (CSV)
          </button>
          <button className="knopf-leise" onClick={() => window.print()}>
            Drucken / PDF
          </button>
          <Link to="/erfassen" className="knopf no-underline">
            <Icon name="plus" /> Erfassen
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5 print:hidden">
        <label className="feld-label">
          Jahr
          <select className="eingabe" value={jahr} onChange={(e) => setJahr(Number(e.target.value))}>
            {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() + 1 - i).map((j) => (
              <option key={j}>{j}</option>
            ))}
          </select>
        </label>
        <label className="feld-label">
          Feld
          <select className="eingabe" value={feldFilter} onChange={(e) => setFeldFilter(e.target.value)}>
            <option value="">Alle</option>
            {(felder.data ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="feld-label">
          Kultur
          <select className="eingabe" value={kulturFilter} onChange={(e) => setKulturFilter(e.target.value)}>
            <option value="">Alle</option>
            {kulturen.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label className="feld-label">
          Arbeit
          <select className="eingabe" value={artFilter} onChange={(e) => setArtFilter(e.target.value)}>
            <option value="">Alle</option>
            {ARBEITSGRUPPEN.map((g) =>
              g.arten.length === 1 ? (
                <option key={g.name} value={g.arten[0]}>
                  {g.arten[0]}
                </option>
              ) : (
                <optgroup key={g.name} label={g.name}>
                  <option value={`gruppe:${g.name}`}>Alle {g.name}</option>
                  {g.arten.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </optgroup>
              ),
            )}
          </select>
        </label>
        <label className="feld-label">
          Person
          <select className="eingabe" value={personFilter} onChange={(e) => setPersonFilter(e.target.value)}>
            <option value="">Alle</option>
            {(mitarbeiter.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <h2 className="hidden print:block">
        {betrieb.data?.name}{betrieb.data?.betriebsnummer && ` · Betriebsnr. ${betrieb.data.betriebsnummer}`} · Ackerschlagkartei {jahr} · erstellt {datum(new Date())}
      </h2>

      {arbeiten.isLoading && <p className="text-leise">Lade …</p>}
      {arbeiten.isSuccess && liste.length === 0 && <p className="karte m-0 text-leise">Keine Arbeiten für diese Auswahl.</p>}

      {liste.map((a) => (
        <Link key={a.id} to={`/arbeiten/${a.id}`} className="karte flex flex-col gap-1 p-3 text-text no-underline break-inside-avoid">
          <div className="flex items-center justify-between gap-2">
            <span className="text-base font-extrabold">
              {a.arbeitsart}
              {a.status === 'geplant' && <span className="ml-2 rounded-lg bg-warn-hell px-2 py-0.5 text-xs text-warn">geplant</span>}
            </span>
            <span className="text-sm font-bold text-leise">{datum(a.datum)}</span>
          </div>
          <span className="text-sm">
            {a.feldarbeit_felder
              .map((f) => `${feldName.get(f.feld_id) ?? '?'}${f.anbau?.kulturen?.name ? ` (${f.anbau.kulturen.name})` : ''}`)
              .join(', ')}{' '}
            · {ha(a.feldarbeit_felder.reduce((s, f) => s + Number(f.flaeche_m2), 0))}
          </span>
          {a.feldarbeit_mittel.map((m) => (
            <span key={m.artikel_id} className="text-sm text-[#3E4C41]">
              {m.lagerartikel?.bezeichnung}: {menge(m.menge_je_ha, `${m.lagerartikel?.einheit}/ha`)} · total {menge(m.gesamtmenge, m.lagerartikel?.einheit)}
            </span>
          ))}
          {(a.maschine || a.geraet || a.maschine_id || a.geraet_id || a.partner_id || wer(a) || a.dauer_h) && (
            <span className="text-xs text-leise">
              {[wer(a) && personName.get(wer(a)!), partnerName(a.partner_id), maschinenName(a.maschine_id, a.maschine), geraeteName(a), a.dauer_h && `${menge(a.dauer_h)} h`]
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
          {a.bemerkungen && <span className="text-xs italic text-leise">{a.bemerkungen}</span>}
        </Link>
      ))}
      <p className="m-0 text-xs text-leise">
        Der Export dient der Vorbereitung von Kontrollen. Ob er alle kantonalen und ÖLN-Anforderungen abdeckt, bitte mit der Kontrollstelle abklären.
      </p>
    </div>
  );
}

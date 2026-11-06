import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { ABHAENGIGE_DATEN } from '../lib/daten';
import { chf, heuteIso, zahlAus } from '../lib/format';
import { ABRECHNUNG_EINHEIT, ERNTEARBEITEN, type Auftrag } from '../lib/typen';
import { ernteLink } from '../lib/ernteWeiter';
import { ErnteWeiter } from './ErnteWeiter';

const MENGE_TEXT: Record<string, string> = { Stunde: 'Stunden', Hektare: 'Bearbeitete Fläche (ha)', Ballen: 'Anzahl Ballen', Stück: 'Anzahl Stück' };

/** Kosten wie in der Datenbank (auftrag_kosten): Pauschale = Preis, sonst Menge × Preis, ohne Preis von Hand */
export function auftragKosten(art: string | null | undefined, preis: number | null | undefined, menge: number | null, vonHand: number | null) {
  if (art === 'Pauschale' && preis != null) return Number(preis);
  if (art && preis != null && menge != null) return Math.round(menge * Number(preis) * 100) / 100;
  return vonHand;
}

/**
 * Lohn- oder Werkstattauftrag abschliessen – derselbe Ablauf in «Aufträge» und «Aufgaben».
 * Bei Lohnarbeit werden keine eigenen Maschinenstunden oder Arbeitszeiten verlangt; die Kosten ergeben sich aus der
 * erfassten Menge (Stunden, ha, Ballen, Stück) × Preis oder pauschal. Nach einer Erntearbeit geht es auf Wunsch zur Ernte.
 */
export function AuftragAbschluss({
  auftrag,
  flaecheM2,
  felder,
  vorSpeichern,
  onFertig,
  onAbbrechen,
}: {
  auftrag: Auftrag;
  /** bearbeitete Fläche (Vorschlag bei Abrechnung je ha) */
  flaecheM2: number;
  /** Felder mit Fläche für die Ernte-Erfassung */
  felder: { feld_id: string; flaeche_m2: number | null }[];
  /** z. B. ungespeicherte Änderungen im Auftrag zuerst sichern */
  vorSpeichern?: () => Promise<boolean>;
  onFertig: (zielId: string) => void;
  onAbbrechen: () => void;
}) {
  const qc = useQueryClient();
  const art = auftrag.abrechnung ?? null;
  const preis = auftrag.preis_je_einheit != null ? Number(auftrag.preis_je_einheit) : null;
  const mitMenge = !!art && art !== 'Pauschale' && preis != null;
  const [w, setW] = useState({
    datum: auftrag.termin_von && auftrag.termin_von < heuteIso() ? auftrag.termin_von : heuteIso(),
    menge: art === 'Hektare' && flaecheM2 > 0 ? String(Math.round((flaecheM2 / 10000) * 100) / 100) : '',
    kosten: '',
    bemerkung: '',
  });
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [weiter, setWeiter] = useState<{ link: string; ziel: string } | null>(null);
  const menge = zahlAus(w.menge);
  const kosten = auftragKosten(art, preis, menge, zahlAus(w.kosten));

  async function abschliessen() {
    setFehler(null);
    if (!w.datum || w.datum > heuteIso()) return setFehler('Das Datum fehlt oder liegt in der Zukunft.');
    if (mitMenge && (menge == null || menge < 0)) return setFehler(`Bitte ${MENGE_TEXT[art!] ?? 'die Menge'} angeben.`);
    if (w.kosten.trim() && (zahlAus(w.kosten) == null || zahlAus(w.kosten)! < 0)) return setFehler('Kosten ungültig.');
    setLaeuft(true);
    try {
      if (vorSpeichern && !(await vorSpeichern())) return;
      const p = { datum: w.datum, menge: mitMenge ? menge : null, kosten: zahlAus(w.kosten), bemerkung: w.bemerkung.trim() || null };
      let { data, error } = await supabase.rpc('auftrag_abschliessen_abrechnung', { p_id: auftrag.id, p });
      // ältere Datenbank ohne Migration 24
      if (error && /auftrag_abschliessen_abrechnung/.test(error.message))
        ({ data, error } = await supabase.rpc('auftrag_abschliessen', { p_id: auftrag.id, p_datum: w.datum, p_kosten: kosten, p_bemerkung: p.bemerkung }));
      if (error) return setFehler(fehlertext(error));
      ABHAENGIGE_DATEN.concat([['auftraege'], ['hinweise']]).forEach((k) => qc.invalidateQueries({ queryKey: k }));
      const ziel = data as string;
      if (auftrag.art === 'Lohnarbeit' && auftrag.arbeitsart && ERNTEARBEITEN.includes(auftrag.arbeitsart) && felder.length)
        setWeiter({ ziel, link: ernteLink({ felder, datum: w.datum, arbeitsart: auftrag.arbeitsart, partner_id: auftrag.partner_id, kosten }) });
      else onFertig(ziel);
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-grund p-3">
      <span className="text-sm">
        {auftrag.art === 'Lohnarbeit'
          ? 'Die Arbeit wird mit Feldern und Betriebsmitteln in die Ackerschlagkartei übernommen. Eigene Maschinenstunden und Arbeitszeit braucht es dafür nicht.'
          : 'Bei der Maschine wird eine Reparatur erfasst, die gewählten Beobachtungen gelten als behoben.'}
      </span>
      <div className="grid grid-cols-2 gap-3">
        <label className="feld-label">
          Erledigt am
          <input className="eingabe" type="date" max={heuteIso()} value={w.datum} onChange={(e) => setW({ ...w, datum: e.target.value })} />
        </label>
        {mitMenge && (
          <label className="feld-label">
            {MENGE_TEXT[art!]}
            <input className="eingabe" inputMode="decimal" value={w.menge} onChange={(e) => setW({ ...w, menge: e.target.value })} autoFocus />
          </label>
        )}
        {!art || preis == null ? (
          <label className="feld-label">
            Kosten (CHF)
            <input className="eingabe" inputMode="decimal" value={w.kosten} onChange={(e) => setW({ ...w, kosten: e.target.value })} placeholder="optional" />
          </label>
        ) : null}
      </div>
      {art && preis != null && (
        <span className="text-sm font-extrabold">
          {art === 'Pauschale'
            ? `Pauschal ${chf(preis)}`
            : `${menge != null ? w.menge : '…'} ${ABRECHNUNG_EINHEIT[art]} × ${chf(preis)} = ${kosten != null ? chf(kosten) : '–'}`}
        </span>
      )}
      <label className="feld-label">
        Bemerkung
        <input className="eingabe" value={w.bemerkung} onChange={(e) => setW({ ...w, bemerkung: e.target.value })} />
      </label>
      {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
      <div className="flex gap-2">
        <button className="knopf flex-1" onClick={abschliessen} disabled={laeuft}>
          {laeuft ? 'Schliesse ab …' : 'Abschliessen'}
        </button>
        <button className="knopf-leise" onClick={onAbbrechen} disabled={laeuft}>
          Abbrechen
        </button>
      </div>
      {weiter && <ErnteWeiter titel={auftrag.titel} link={weiter.link} onSpaeter={() => onFertig(weiter.ziel)} />}
    </div>
  );
}

/** Abrechnung eines erledigten Auftrags nachtragen oder korrigieren (z. B. wenn die Rechnung kommt) */
export function AbrechnungNachtragen({ auftrag, flaecheM2 }: { auftrag: Auftrag; flaecheM2: number }) {
  const qc = useQueryClient();
  const [w, setW] = useState({
    art: (auftrag.abrechnung ?? '') as string,
    preis: auftrag.preis_je_einheit != null ? String(auftrag.preis_je_einheit) : '',
    menge:
      auftrag.menge_abgerechnet != null
        ? String(auftrag.menge_abgerechnet)
        : auftrag.abrechnung === 'Hektare' && flaecheM2 > 0
          ? String(Math.round((flaecheM2 / 10000) * 100) / 100)
          : '',
    kosten: auftrag.kosten_chf != null && (!auftrag.abrechnung || auftrag.preis_je_einheit == null) ? String(auftrag.kosten_chf) : '',
  });
  const [meldung, setMeldung] = useState<{ text: string; fehler: boolean } | null>(null);
  const preis = zahlAus(w.preis);
  const menge = zahlAus(w.menge);
  const kosten = auftragKosten(w.art || null, w.art ? preis : null, menge, zahlAus(w.kosten));

  async function speichern() {
    setMeldung(null);
    const { error } = await supabase.rpc('auftrag_abrechnung_nachtragen', {
      p_id: auftrag.id,
      p: { abrechnung: w.art || null, preis_je_einheit: w.art ? preis : null, menge: w.art && w.art !== 'Pauschale' ? menge : null, kosten: zahlAus(w.kosten) },
    });
    if (error) {
      const m = fehlertext(error);
      return setMeldung({ text: /auftrag_abrechnung_nachtragen/.test(m) ? 'Bitte zuerst Migration 24 in Supabase einspielen.' : m, fehler: true });
    }
    qc.invalidateQueries({ queryKey: ['auftraege'] });
    setMeldung({ text: 'Abrechnung gespeichert.', fehler: false });
  }

  return (
    <section className="karte flex flex-col gap-3">
      <h2 className="m-0 text-lg font-extrabold">Abrechnung</h2>
      <div className="grid grid-cols-3 gap-2">
        <label className="feld-label">
          Nach
          <select className="eingabe" value={w.art} onChange={(e) => setW({ ...w, art: e.target.value })}>
            <option value="">Betrag</option>
            {Object.keys(ABRECHNUNG_EINHEIT).map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        {w.art ? (
          <>
            <label className="feld-label">
              {w.art === 'Pauschale' ? 'Betrag CHF' : `CHF je ${ABRECHNUNG_EINHEIT[w.art as keyof typeof ABRECHNUNG_EINHEIT]}`}
              <input className="eingabe" inputMode="decimal" value={w.preis} onChange={(e) => setW({ ...w, preis: e.target.value })} />
            </label>
            {w.art !== 'Pauschale' && (
              <label className="feld-label">
                Menge
                <input className="eingabe" inputMode="decimal" value={w.menge} onChange={(e) => setW({ ...w, menge: e.target.value })} />
              </label>
            )}
          </>
        ) : (
          <label className="feld-label col-span-2">
            Kosten CHF
            <input className="eingabe" inputMode="decimal" value={w.kosten} onChange={(e) => setW({ ...w, kosten: e.target.value })} />
          </label>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="font-extrabold">Kosten: {kosten != null ? chf(kosten) : '–'}</span>
        <button className="knopf-leise" onClick={speichern}>
          Speichern
        </button>
      </div>
      {meldung && <p className={`m-0 rounded-xl p-3 text-sm font-semibold ${meldung.fehler ? 'bg-fehler-hell text-fehler' : 'bg-hof-hell text-hof'}`}>{meldung.text}</p>}
    </section>
  );
}

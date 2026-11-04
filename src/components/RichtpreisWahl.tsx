import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useRichtpreise } from '../lib/daten';
import { chf, menge, zahlAus } from '../lib/format';
import { RICHTPREIS_BEREICHE, type Richtpreis } from '../lib/typen';
import { Fenster } from './Schnellanlage';

/**
 * Richtpreis auswählen. Mit «mitMenge» wird zusätzlich nach der Menge gefragt (z. B. 3.5 h, 2 ha) und der Betrag berechnet.
 */
export function RichtpreisWahl({
  bereiche,
  mitMenge = false,
  titel = 'Richtpreis wählen',
  onWahl,
  onSchliessen,
}: {
  bereiche?: Richtpreis['bereich'][];
  mitMenge?: boolean;
  titel?: string;
  onWahl: (r: Richtpreis, mengeWert: number) => void;
  onSchliessen: () => void;
}) {
  const preise = useRichtpreise();
  const [suche, setSuche] = useState('');
  const [bereich, setBereich] = useState<string>(bereiche?.length === 1 ? bereiche[0] : '');
  const [gewaehlt, setGewaehlt] = useState<Richtpreis | null>(null);
  const [anzahl, setAnzahl] = useState('1');
  const liste = (preise.data ?? []).filter(
    (r) =>
      r.aktiv &&
      (!bereiche || bereiche.includes(r.bereich)) &&
      (!bereich || r.bereich === bereich) &&
      `${r.bezeichnung} ${r.einheit} ${r.bemerkung ?? ''}`.toLowerCase().includes(suche.toLowerCase()),
  );
  const zeigeBereiche = RICHTPREIS_BEREICHE.filter((b) => (!bereiche || bereiche.includes(b)) && (preise.data ?? []).some((r) => r.bereich === b));
  const m = zahlAus(anzahl);

  return (
    <Fenster titel={titel} onSchliessen={onSchliessen}>
      {gewaehlt && mitMenge ? (
        <>
          <span className="font-extrabold">{gewaehlt.bezeichnung}</span>
          <span className="text-sm text-leise">
            {chf(gewaehlt.preis_chf)} je {gewaehlt.einheit}
            {gewaehlt.quelle && ` · ${gewaehlt.quelle}`}
          </span>
          <label className="feld-label">
            Menge ({gewaehlt.einheit})
            <input className="eingabe" inputMode="decimal" value={anzahl} onChange={(e) => setAnzahl(e.target.value)} autoFocus />
          </label>
          <span className="text-lg font-extrabold">= {m != null ? chf(Math.round(m * gewaehlt.preis_chf * 100) / 100) : '–'}</span>
          <div className="flex gap-2">
            <button type="button" className="knopf flex-1" disabled={m == null || m <= 0} onClick={() => onWahl(gewaehlt, m ?? 1)}>
              Übernehmen
            </button>
            <button type="button" className="knopf-leise" onClick={() => setGewaehlt(null)}>
              Zurück
            </button>
          </div>
        </>
      ) : (
        <>
          <input className="eingabe" placeholder="Suchen, z. B. Traktor, Heu, Pressen" value={suche} onChange={(e) => setSuche(e.target.value)} />
          {zeigeBereiche.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {['', ...zeigeBereiche].map((b) => (
                <button
                  key={b || 'alle'}
                  type="button"
                  onClick={() => setBereich(b)}
                  aria-pressed={bereich === b}
                  className={`min-h-9 rounded-full border-2 px-3 text-xs font-bold ${bereich === b ? 'border-hof bg-hof text-white' : 'border-linie bg-white'}`}
                >
                  {b || 'Alle'}
                </button>
              ))}
            </div>
          )}
          <div className="flex max-h-[50dvh] flex-col gap-1 overflow-y-auto">
            {liste.map((r) => (
              <button
                key={r.id}
                type="button"
                className="flex items-center justify-between gap-2 rounded-xl bg-grund p-2 text-left"
                onClick={() => (mitMenge ? setGewaehlt(r) : onWahl(r, 1))}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-bold">{r.bezeichnung}</span>
                  <span className="truncate text-xs text-leise">{[r.bereich, r.quelle, r.bemerkung].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="shrink-0 text-sm font-extrabold">
                  {menge(r.preis_chf)} / {r.einheit}
                </span>
              </button>
            ))}
            {preise.isSuccess && !liste.length && (
              <p className="m-0 text-sm text-leise">
                Keine passenden Richtpreise. <Link to="/richtpreise">Richtpreise verwalten</Link>
              </p>
            )}
          </div>
        </>
      )}
    </Fenster>
  );
}

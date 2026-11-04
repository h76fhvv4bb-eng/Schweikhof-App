import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { zahlAus } from '../lib/format';
import { DUENGER_KATALOG } from '../lib/duengerKatalog';
import { EINHEITEN, LAGERKATEGORIEN, PARTNERARTEN, type Lagerartikel, type Partner } from '../lib/typen';

/** Wert der Auswahl-Option «+ Neu …» in Dropdowns */
export const NEU = '__neu__';

export function Fenster({ titel, children, onSchliessen }: { titel: string; children: ReactNode; onSchliessen: () => void }) {
  return (
    <div className="fixed inset-0 z-[2100] flex items-end justify-center bg-black/30 p-3 md:items-center" onClick={onSchliessen}>
      <div className="karte flex max-h-[92dvh] w-full max-w-md flex-col gap-3 overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={titel}>
        <div className="flex items-start justify-between gap-2">
          <h2 className="m-0 text-xl font-extrabold">{titel}</h2>
          <button type="button" className="h-11 w-11 shrink-0 text-leise" onClick={onSchliessen} aria-label="Schliessen">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const STANDARD_EINHEIT: Partial<Record<Lagerartikel['kategorie'], Lagerartikel['einheit']>> = {
  Dünger: 'kg',
  Saatgut: 'kg',
  Pflanzenschutzmittel: 'l',
  Ersatzteile: 'Stk',
  Betriebsstoffe: 'l',
  Erzeugnisse: 'kg',
};

/** Neuen Lagerartikel direkt aus einem Dropdown anlegen (z. B. Saatgut, Dünger). Gibt die neue ID zurück. */
export function NeuerArtikelDialog({
  kategorie,
  onFertig,
}: {
  kategorie?: Lagerartikel['kategorie'];
  onFertig: (id: string | null) => void;
}) {
  const { profil } = useAuth();
  const qc = useQueryClient();
  const [w, setW] = useState({
    bezeichnung: '',
    kategorie: kategorie ?? ('Saatgut' as Lagerartikel['kategorie']),
    einheit: STANDARD_EINHEIT[kategorie ?? 'Saatgut'] ?? 'kg',
    lagerfuehrung: true,
    preis: '',
    n: '',
    p: '',
    k: '',
    mg: '',
  });
  const [fehler, setFehler] = useState<string | null>(null);
  const duenger = w.kategorie === 'Dünger';
  const gehaltProzent = duenger && (w.einheit === 'kg' || w.einheit === 't');

  function bezeichnungSetzen(text: string) {
    const v = DUENGER_KATALOG.find((d) => d.bezeichnung.toLowerCase() === text.trim().toLowerCase());
    setW((x) =>
      v && duenger
        ? { ...x, bezeichnung: text, einheit: 'kg', n: v.n != null ? String(v.n) : '', p: v.p2o5 != null ? String(v.p2o5) : '', k: v.k2o != null ? String(v.k2o) : '', mg: v.mg != null ? String(v.mg) : '' }
        : { ...x, bezeichnung: text },
    );
  }

  /** Gehalt: in % bei kg/t, sonst kg je Einheit (z. B. kg N je m³) */
  const jeEinheit = (s: string) => {
    const z = zahlAus(s);
    if (z == null) return null;
    if (!gehaltProzent) return z;
    return w.einheit === 't' ? z * 10 : z / 100;
  };

  async function speichern() {
    setFehler(null);
    if (!w.bezeichnung.trim()) return setFehler('Bitte eine Bezeichnung eingeben.');
    for (const s of [w.preis, w.n, w.p, w.k, w.mg]) if (s.trim() && (zahlAus(s) == null || zahlAus(s)! < 0)) return setFehler('Bitte nur Zahlen ≥ 0 eingeben.');
    const katalog = DUENGER_KATALOG.some((d) => d.bezeichnung.toLowerCase() === w.bezeichnung.trim().toLowerCase());
    const { data, error } = await supabase
      .from('lagerartikel')
      .insert({
        betrieb_id: profil!.betrieb_id,
        bezeichnung: w.bezeichnung.trim(),
        kategorie: w.kategorie,
        einheit: w.einheit,
        lagerfuehrung: w.lagerfuehrung,
        einkaufspreis: zahlAus(w.preis),
        ...(duenger
          ? {
              n_je_einheit: jeEinheit(w.n),
              p2o5_je_einheit: jeEinheit(w.p),
              k2o_je_einheit: jeEinheit(w.k),
              mg_je_einheit: jeEinheit(w.mg),
              naehrstoffquelle: w.n || w.p || w.k || w.mg ? (katalog ? 'Richtwert' : 'Deklaration') : null,
            }
          : {}),
      })
      .select('id')
      .single();
    if (error) return setFehler(fehlertext(error));
    qc.invalidateQueries({ queryKey: ['lager'] });
    onFertig((data as { id: string }).id);
  }

  return (
    <Fenster titel={`Neu: ${w.kategorie}`} onSchliessen={() => onFertig(null)}>
      <label className="feld-label">
        Bezeichnung
        <input
          className="eingabe"
          value={w.bezeichnung}
          onChange={(e) => bezeichnungSetzen(e.target.value)}
          list={duenger ? 'duenger-katalog' : undefined}
          placeholder={duenger ? 'z. B. Ammonsalpeter 27.5 % N' : w.kategorie === 'Saatgut' ? 'z. B. Winterweizen Arina' : ''}
          autoFocus
        />
        {duenger && (
          <datalist id="duenger-katalog">
            {DUENGER_KATALOG.map((d) => (
              <option key={d.bezeichnung} value={d.bezeichnung} />
            ))}
          </datalist>
        )}
      </label>
      <div className="grid grid-cols-2 gap-2">
        {!kategorie && (
          <label className="feld-label">
            Kategorie
            <select
              className="eingabe"
              value={w.kategorie}
              onChange={(e) => {
                const k = e.target.value as Lagerartikel['kategorie'];
                setW({ ...w, kategorie: k, einheit: STANDARD_EINHEIT[k] ?? w.einheit });
              }}
            >
              {LAGERKATEGORIEN.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
        )}
        <label className="feld-label">
          Einheit
          <select className="eingabe" value={w.einheit} onChange={(e) => setW({ ...w, einheit: e.target.value as Lagerartikel['einheit'] })}>
            {EINHEITEN.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label className="feld-label">
          Preis CHF je {w.einheit} (optional)
          <input className="eingabe" inputMode="decimal" value={w.preis} onChange={(e) => setW({ ...w, preis: e.target.value })} />
        </label>
      </div>
      {duenger && (
        <div className="flex flex-col gap-2 rounded-2xl bg-grund p-3">
          <span className="text-sm font-extrabold">Gehalt {gehaltProzent ? 'in %' : `in kg je ${w.einheit}`} (gemäss Deklaration)</span>
          <div className="grid grid-cols-4 gap-2">
            {(
              [
                ['n', 'N'],
                ['p', 'P₂O₅'],
                ['k', 'K₂O'],
                ['mg', 'Mg'],
              ] as const
            ).map(([k, t]) => (
              <label key={k} className="feld-label">
                {t}
                <input className="eingabe px-2" inputMode="decimal" value={w[k]} onChange={(e) => setW({ ...w, [k]: e.target.value })} />
              </label>
            ))}
          </div>
          <span className="text-xs text-leise">Tipp: Namen aus der Liste wählen füllt die Gehalte gängiger Dünger aus.</span>
        </div>
      )}
      <label className="flex min-h-10 items-center gap-2 text-sm font-bold">
        <input type="checkbox" className="h-5 w-5 accent-hof" checked={w.lagerfuehrung} onChange={(e) => setW({ ...w, lagerfuehrung: e.target.checked })} />
        Bestand im Lager führen
      </label>
      {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
      <button type="button" className="knopf" onClick={speichern}>
        Anlegen und wählen
      </button>
      <span className="text-xs text-leise">Weitere Angaben (Lieferant, Mindestbestand …) später im Lager ergänzen.</span>
    </Fenster>
  );
}

/** Neuen Partner direkt aus einem Dropdown anlegen. Gibt die neue ID zurück. */
export function NeuerPartnerDialog({ art, onFertig }: { art?: Partner['art']; onFertig: (id: string | null) => void }) {
  const { profil } = useAuth();
  const qc = useQueryClient();
  const [w, setW] = useState({ name: '', art: art ?? ('Abnehmer/Käufer' as Partner['art']), telefon: '' });
  const [fehler, setFehler] = useState<string | null>(null);
  async function speichern() {
    setFehler(null);
    if (!w.name.trim()) return setFehler('Bitte einen Namen eingeben.');
    const { data, error } = await supabase
      .from('partner')
      .insert({ betrieb_id: profil!.betrieb_id, name: w.name.trim(), art: w.art, mobile: w.telefon.trim() || null })
      .select('id')
      .single();
    if (error) return setFehler(fehlertext(error));
    qc.invalidateQueries({ queryKey: ['partner'] });
    onFertig((data as { id: string }).id);
  }
  return (
    <Fenster titel="Neuer Partner" onSchliessen={() => onFertig(null)}>
      <label className="feld-label">
        Name / Firma
        <input className="eingabe" value={w.name} onChange={(e) => setW({ ...w, name: e.target.value })} autoFocus />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="feld-label">
          Art
          <select className="eingabe" value={w.art} onChange={(e) => setW({ ...w, art: e.target.value as Partner['art'] })}>
            {PARTNERARTEN.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="feld-label">
          Telefon (optional)
          <input className="eingabe" type="tel" value={w.telefon} onChange={(e) => setW({ ...w, telefon: e.target.value })} />
        </label>
      </div>
      {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
      <button type="button" className="knopf" onClick={speichern}>
        Anlegen und wählen
      </button>
    </Fenster>
  );
}

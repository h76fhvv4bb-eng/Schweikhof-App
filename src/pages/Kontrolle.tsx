import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useKulturen } from '../lib/daten';
import { fehlertext } from '../lib/supabase';
import { aufzeichnungenPruefen, parzellenblaetterLaden, type Pruefpunkt } from '../lib/kontrolle';
import { fruchtfolgePdf, parzellenblaetterPdf } from '../lib/kontrollePdf';
import { pdfHerunterladen } from '../lib/auftragPdf';
import { Icon } from '../components/Icon';

/** Unterlagen für eine Kontrolle zusammenstellen und die Aufzeichnungen auf Lücken prüfen */
export function Kontrolle() {
  const aktuell = new Date().getFullYear();
  const [jahr, setJahr] = useState(aktuell);
  const [von, setVon] = useState(String(aktuell - 3));
  const [bis, setBis] = useState(String(aktuell + 3));
  const [nurMitInhalt, setNurMitInhalt] = useState(false);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [punkte, setPunkte] = useState<Pruefpunkt[] | null>(null);
  const kulturen = useKulturen();

  async function mit(name: string, f: () => Promise<void>) {
    setFehler(null);
    setLaeuft(name);
    try {
      await f();
    } catch (e) {
      setFehler(fehlertext(e));
    } finally {
      setLaeuft(null);
    }
  }

  const fruchtfolge = () =>
    mit('ff', async () => {
      const a = Number(von);
      const b = Number(bis);
      if (!Number.isInteger(a) || !Number.isInteger(b) || b < a || b - a > 12) throw new Error('Zeitraum ungültig (höchstens 13 Jahre).');
      pdfHerunterladen(await fruchtfolgePdf(a, b), `Fruchtfolge_${a}-${b}.pdf`);
    });
  const blaetter = () =>
    mit('pb', async () => {
      const d = await parzellenblaetterLaden(jahr);
      pdfHerunterladen(await parzellenblaetterPdf(d, nurMitInhalt), `Parzellenblaetter_${jahr}.pdf`);
    });
  const pruefen = () => mit('pr', async () => setPunkte(await aufzeichnungenPruefen(jahr, kulturen.data ?? [])));

  const farbe = { fehlt: 'bg-fehler-hell text-fehler', pruefen: 'bg-warn-hell text-[#5C3D00]', info: 'bg-[#E6F0F8] text-[#2D5F86]' };
  const titel = { fehlt: 'Fehlt', pruefen: 'Prüfen', info: 'Hinweis' };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-leise">Unterlagen zusammenstellen und Aufzeichnungen prüfen</span>
          <h1 className="m-0 text-3xl font-extrabold text-hof">Kontrolle {jahr}</h1>
        </div>
        <div className="flex gap-2">
          <button className="knopf-leise h-11 w-11 px-0" aria-label="Vorjahr" onClick={() => setJahr(jahr - 1)}>
            <Icon name="zurueck" />
          </button>
          <button className="knopf-leise h-11 w-11 px-0" aria-label="Folgejahr" onClick={() => setJahr(jahr + 1)} disabled={jahr >= aktuell}>
            <Icon name="weiter" />
          </button>
        </div>
      </header>

      <section className="karte flex flex-col gap-3">
        <h2 className="m-0 text-lg font-extrabold">Unterlagen als PDF</h2>
        <div className="flex flex-col gap-2 rounded-2xl bg-grund p-3">
          <span className="font-extrabold">Fruchtfolge (farbig)</span>
          <span className="text-sm text-leise">Alle Felder ohne Dauergrünland, Hauptkultur farbig, Saat/Ernte, Zwischenkulturen, Flächen je Kultur.</span>
          <div className="flex flex-wrap items-end gap-2">
            <label className="feld-label w-24">
              von
              <input className="eingabe" inputMode="numeric" value={von} onChange={(e) => setVon(e.target.value)} />
            </label>
            <label className="feld-label w-24">
              bis
              <input className="eingabe" inputMode="numeric" value={bis} onChange={(e) => setBis(e.target.value)} />
            </label>
            <button className="knopf" onClick={fruchtfolge} disabled={!!laeuft}>
              {laeuft === 'ff' ? 'Erstelle …' : 'Fruchtfolge-PDF'}
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-2 rounded-2xl bg-grund p-3">
          <span className="font-extrabold">Parzellenblätter {jahr}</span>
          <span className="text-sm text-leise">
            Je Feld ein Blatt: Bodenbearbeitung, Saat, Düngung mit Nährstoffen, Pflege/Pflanzenschutz, Ernte/Nutzung, Zwischenkultur. Leere Zeilen zum
            Nachtragen von Hand.
          </span>
          <label className="flex min-h-10 items-center gap-2 text-sm font-bold">
            <input type="checkbox" className="h-5 w-5 accent-hof" checked={nurMitInhalt} onChange={(e) => setNurMitInhalt(e.target.checked)} />
            Nur Felder mit Kultur oder Einträgen
          </label>
          <button className="knopf self-start" onClick={blaetter} disabled={!!laeuft}>
            {laeuft === 'pb' ? 'Erstelle …' : 'Parzellenblätter-PDF'}
          </button>
        </div>
        <div className="flex flex-wrap gap-3 text-sm font-bold">
          <Link to="/kartei">Ackerschlagkartei (Excel/Druck)</Link>
          <Link to="/naehrstoffe">Nährstoffe je Feld</Link>
          <Link to="/ernte">Ernte und Erträge</Link>
          <Link to="/lager">Lagerbestand</Link>
        </div>
      </section>

      <section className="karte flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-lg font-extrabold">Aufzeichnungen prüfen</h2>
          <button className="knopf" onClick={pruefen} disabled={!!laeuft}>
            {laeuft === 'pr' ? 'Prüfe …' : punkte ? 'Erneut prüfen' : 'Jetzt prüfen'}
          </button>
        </div>
        <p className="m-0 text-sm text-leise">
          Sucht Lücken und Unstimmigkeiten in den erfassten Daten (z. B. Düngung ohne Menge, Feld ohne Kultur, alte Bodenprobe). Das sind Hinweise
          zur Vollständigkeit, keine Prüfung der Vorschriften.
        </p>
        {punkte && punkte.length === 0 && <p className="m-0 rounded-xl bg-hof-hell p-3 text-sm font-bold text-hof">Keine Lücken gefunden.</p>}
        {punkte?.map((p, i) => (
          <div key={i} className="flex items-start gap-2 text-sm">
            <span className={`shrink-0 rounded-lg px-2 py-0.5 text-xs font-extrabold ${farbe[p.stufe]}`}>{titel[p.stufe]}</span>
            {p.link ? (
              <Link to={p.link} className="text-text">
                {p.text}
              </Link>
            ) : (
              <span>{p.text}</span>
            )}
          </div>
        ))}
      </section>
      {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
    </div>
  );
}

import { useState, type MouseEvent } from 'react';
import { useAnbauAlle, useFelder } from '../lib/daten';
import { ha } from '../lib/format';
import type { Anbau } from '../lib/typen';
import { AnbauDialog } from './AnbauDialog';

const MONATE = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONATSNAMEN = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const BREITE = 18; // px je Monat

/** Monatsindex ab Startjahr (0 = Januar des Startjahrs) */
const index = (iso: string, start: number) => (Number(iso.slice(0, 4)) - start) * 12 + Number(iso.slice(5, 7)) - 1 + (Number(iso.slice(8, 10)) - 1) / 31;

function zeitraum(a: Anbau): [string, string] {
  const von = a.saatdatum ?? (a.art === 'Zwischenkultur' ? `${a.jahr}-08-01` : `${a.jahr}-01-01`);
  const bis = a.erntedatum ?? (a.art === 'Zwischenkultur' ? `${a.jahr + 1}-04-01` : `${a.jahr + 1}-01-01`);
  return [von, bis];
}

const monatText = (iso: string | null | undefined, nurMonat?: boolean) => {
  if (!iso) return '';
  const m = MONATSNAMEN[Number(iso.slice(5, 7)) - 1];
  return nurMonat ? `${m} ${iso.slice(0, 4)}` : `${Number(iso.slice(8, 10))}. ${m} ${iso.slice(0, 4)}`;
};

/** Fruchtfolge als Zeitachse: Saat bis Ernte je Kultur, Hauptkulturen oben, Zwischenkulturen darunter */
export function FruchtfolgeZeitachse({ start, jahre }: { start: number; jahre: number }) {
  const felder = useFelder();
  const anbau = useAnbauAlle(start - 1, start + jahre);
  const [dialog, setDialog] = useState<{ eintrag: Anbau | null; feldId: string; feldName: string; jahr: number } | null>(null);
  const monate = jahre * 12;
  const heute = new Date().toISOString().slice(0, 10);
  const heuteX = index(heute, start) * BREITE;
  const sichtbar = (felder.data ?? []).filter((f) => f.status !== 'aufgegeben');

  function leerKlick(e: MouseEvent<HTMLDivElement>, feldId: string, feldName: string) {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const m = Math.floor(x / BREITE);
    const jahr = start + Math.floor(m / 12);
    setDialog({ eintrag: null, feldId, feldName, jahr: (m % 12) >= 7 ? jahr + 1 : jahr });
  }

  return (
    <div className="karte overflow-x-auto p-2">
      <div style={{ width: 150 + monate * BREITE }}>
        {/* Kopf: Jahre und Monate */}
        <div className="flex">
          <div className="w-[150px] shrink-0" />
          {Array.from({ length: jahre }, (_, j) => (
            <div key={j} className="border-l border-rand text-center text-xs font-extrabold text-leise" style={{ width: 12 * BREITE }}>
              {start + j}
            </div>
          ))}
        </div>
        <div className="flex">
          <div className="w-[150px] shrink-0" />
          {Array.from({ length: monate }, (_, m) => (
            <div key={m} className={`text-center text-[10px] text-leise ${m % 12 === 0 ? 'border-l border-rand' : ''}`} style={{ width: BREITE }}>
              {MONATE[m % 12]}
            </div>
          ))}
        </div>

        {sichtbar.map((f) => {
          const eintraege = (anbau.data ?? []).filter((a) => a.feld_id === f.id);
          return (
            <div key={f.id} className="flex items-stretch border-t border-rand">
              <div className="flex w-[150px] shrink-0 flex-col justify-center py-1 pr-2">
                <span className="truncate text-sm font-extrabold">{f.name}</span>
                <span className="text-[11px] text-leise">
                  {f.feldnummer} · {ha(Number(f.flaeche_m2))}
                </span>
              </div>
              <div
                className="relative h-[52px] cursor-copy"
                style={{
                  width: monate * BREITE,
                  backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${12 * BREITE - 1}px, var(--color-rand) ${12 * BREITE - 1}px, var(--color-rand) ${12 * BREITE}px)`,
                }}
                onClick={(e) => leerKlick(e, f.id, f.name)}
                title="Klicken, um eine Kultur zu planen"
              >
                {heuteX > 0 && heuteX < monate * BREITE && (
                  <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-fehler/60" style={{ left: heuteX }} />
                )}
                {eintraege.map((a) => {
                  const [von, bis] = zeitraum(a);
                  const x1 = Math.max(0, index(von, start) * BREITE);
                  const x2 = Math.min(monate * BREITE, index(bis, start) * BREITE);
                  if (x2 <= 0 || x1 >= monate * BREITE || x2 - x1 < 2) return null;
                  const zk = a.art === 'Zwischenkultur';
                  return (
                    <button
                      key={a.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDialog({ eintrag: a, feldId: f.id, feldName: f.name, jahr: a.jahr });
                      }}
                      className={`absolute overflow-hidden whitespace-nowrap rounded-md px-1 text-left text-[11px] font-extrabold text-text ${
                        a.status === 'geplant' ? 'border-2 border-dashed border-white/80' : ''
                      }`}
                      style={{
                        left: x1,
                        width: x2 - x1 - 1,
                        top: zk ? 32 : 4,
                        height: zk ? 16 : 26,
                        background: a.kulturen?.farbe ?? '#ccc',
                        opacity: a.status === 'geplant' ? 0.75 : 1,
                      }}
                      title={`${a.kulturen?.name} ${a.jahr}${a.saatdatum ? ` · Saat ${monatText(a.saatdatum, a.nur_monat)}` : ''}${
                        a.erntedatum ? ` · Ernte/Umbruch ${monatText(a.erntedatum, a.nur_monat)}` : ''
                      } · ${a.status}`}
                    >
                      {a.kulturen?.name}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="m-0 mt-2 text-xs text-leise">
        Balken = Saat bis Ernte bzw. Umbruch. Oben Hauptkulturen, unten Zwischenkulturen. Gestrichelt = geplant. Rote Linie = heute. Auf eine freie Stelle klicken, um eine
        Kultur zu planen.
      </p>
      {dialog && (
        <AnbauDialog eintrag={dialog.eintrag} feldId={dialog.feldId} feldName={dialog.feldName} jahr={dialog.jahr} onFertig={() => setDialog(null)} />
      )}
    </div>
  );
}

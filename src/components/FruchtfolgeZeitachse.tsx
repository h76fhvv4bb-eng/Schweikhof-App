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

const istZwischen = (a: Anbau) => a.art === 'Zwischenkultur' || a.art === 'Untersaat';

function zeitraum(a: Anbau): [string, string] {
  const von = a.saatdatum ?? (istZwischen(a) ? `${a.jahr}-08-01` : `${a.jahr}-01-01`);
  const bis = a.erntedatum ?? (istZwischen(a) ? `${a.jahr + 1}-04-01` : `${a.jahr + 1}-01-01`);
  return [von, bis];
}

const HOCH_HAUPT = 26;
const HOCH_ZWISCHEN = 16;

/** Überlappende Balken auf mehrere Spuren verteilen */
function spuren(liste: { a: Anbau; x1: number; x2: number }[]) {
  const enden: number[] = [];
  return [...liste]
    .sort((p, q) => p.x1 - q.x1)
    .map((b) => {
      let s = enden.findIndex((e) => e <= b.x1 + 0.5);
      if (s < 0) {
        s = enden.length;
        enden.push(b.x2);
      } else enden[s] = b.x2;
      return { ...b, spur: s };
    })
    .map((b, _, alle) => ({ ...b, spuren: Math.max(1, ...alle.map((x) => x.spur + 1)) }));
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
  const [dialog, setDialog] = useState<{ eintrag: Anbau | null; feldId: string; feldName: string; feldM2: number; jahr: number; art?: Anbau['art'] } | null>(null);
  const monate = jahre * 12;
  const heute = new Date().toISOString().slice(0, 10);
  const heuteX = index(heute, start) * BREITE;
  const sichtbar = (felder.data ?? []).filter((f) => f.status !== 'aufgegeben');

  function leerKlick(e: MouseEvent<HTMLDivElement>, feldId: string, feldName: string, feldM2: number, grenzeY: number) {
    const r = e.currentTarget.getBoundingClientRect();
    const m = Math.floor((e.clientX - r.left) / BREITE);
    const jahr = start + Math.floor(m / 12);
    const unten = e.clientY - r.top > grenzeY;
    setDialog({ eintrag: null, feldId, feldName, feldM2, jahr: m % 12 >= 7 && !unten ? jahr + 1 : jahr, art: unten ? 'Zwischenkultur' : undefined });
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
          const breite = monate * BREITE;
          const balken = (anbau.data ?? [])
            .filter((a) => a.feld_id === f.id)
            .map((a) => {
              const [von, bis] = zeitraum(a);
              return { a, x1: Math.max(0, index(von, start) * BREITE), x2: Math.min(breite, index(bis, start) * BREITE) };
            })
            .filter((b) => b.x2 > 0 && b.x1 < breite && b.x2 - b.x1 >= 2);
          const oben = spuren(balken.filter((b) => !istZwischen(b.a)));
          const unten = spuren(balken.filter((b) => istZwischen(b.a)));
          const nOben = oben[0]?.spuren ?? 1;
          const nUnten = Math.max(1, unten[0]?.spuren ?? 1);
          const grenze = 4 + nOben * (HOCH_HAUPT + 2);
          const hoehe = grenze + nUnten * (HOCH_ZWISCHEN + 2) + 2;
          return (
            <div key={f.id} className="flex items-stretch border-t border-rand">
              <div className="flex w-[150px] shrink-0 flex-col justify-center py-1 pr-2">
                <span className="truncate text-sm font-extrabold">{f.name}</span>
                <span className="text-[11px] text-leise">
                  {f.feldnummer} · {ha(Number(f.flaeche_m2))}
                </span>
              </div>
              <div
                className="relative cursor-copy"
                style={{
                  width: breite,
                  height: hoehe,
                  backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${12 * BREITE - 1}px, var(--color-rand) ${12 * BREITE - 1}px, var(--color-rand) ${12 * BREITE}px)`,
                }}
                onClick={(e) => leerKlick(e, f.id, f.name, Number(f.flaeche_m2), grenze)}
                title="Klicken, um eine Kultur zu planen (unten: Zwischenkultur)"
              >
                <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-rand" style={{ top: grenze - 1 }} />
                {heuteX > 0 && heuteX < breite && <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-fehler/60" style={{ left: heuteX }} />}
                {[...oben.map((b) => ({ ...b, y: 4 + b.spur * (HOCH_HAUPT + 2), h: HOCH_HAUPT })),
                  ...unten.map((b) => ({ ...b, y: grenze + b.spur * (HOCH_ZWISCHEN + 2), h: HOCH_ZWISCHEN }))].map(({ a, x1, x2, y, h }) => (
                  <button
                    key={a.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDialog({ eintrag: a, feldId: f.id, feldName: f.name, feldM2: Number(f.flaeche_m2), jahr: a.jahr });
                    }}
                    className={`absolute overflow-hidden whitespace-nowrap rounded-md px-1 text-left text-[11px] font-extrabold text-text ${
                      a.status === 'geplant' ? 'border-2 border-dashed border-white/80' : ''
                    }`}
                    style={{
                      left: x1,
                      width: x2 - x1 - 1,
                      top: y,
                      height: h,
                      background: a.kulturen?.farbe ?? '#ccc',
                      opacity: a.status === 'geplant' ? 0.75 : 1,
                    }}
                    title={`${a.kulturen?.name} (${a.art}) ${a.jahr}${a.flaeche_m2 ? ` · ${ha(Number(a.flaeche_m2))}` : ''}${
                      a.saatdatum ? ` · Saat ${monatText(a.saatdatum, a.nur_monat)}` : ''
                    }${a.erntedatum ? ` · Ernte/Umbruch ${monatText(a.erntedatum, a.nur_monat)}` : ''} · ${a.status}`}
                  >
                    {a.art === 'Untersaat' ? '↳ ' : ''}
                    {a.kulturen?.name}
                    {a.flaeche_m2 ? ` (${ha(Number(a.flaeche_m2))})` : ''}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="m-0 mt-2 text-xs text-leise">
        Balken = Saat bis Ernte bzw. Umbruch. Oben Haupt- und Zweitkulturen, unten Zwischenkulturen und Untersaaten; überlappende Kulturen
        stehen untereinander. Gestrichelt = geplant. Rote Linie = heute. Auf eine freie Stelle klicken, um eine Kultur zu planen (untere Hälfte: Zwischenkultur).
      </p>
      {dialog && (
        <AnbauDialog
          eintrag={dialog.eintrag}
          feldId={dialog.feldId}
          feldName={dialog.feldName}
          feldM2={dialog.feldM2}
          jahr={dialog.jahr}
          art={dialog.art}
          onFertig={() => setDialog(null)}
        />
      )}
    </div>
  );
}

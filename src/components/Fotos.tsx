import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { fotoLoeschen, fotosHochladen, type FotoZiel } from '../lib/fotos';
import type { Foto } from '../lib/typen';
import { datum } from '../lib/format';

type FotoMitUrl = Foto & { url: string };

/** Knopf «Foto» (Kamera oder Fotomediathek). Liefert die gewählten Dateien. */
export function FotoKnopf({ onDateien, text = 'Foto', klein = false }: { onDateien: (d: File[]) => void; text?: string; klein?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={klein ? 'text-sm font-bold text-hof' : 'knopf-leise'} onClick={() => ref.current?.click()}>
        📷 {text}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const d = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (d.length) onDateien(d);
        }}
      />
    </>
  );
}

/** Vorschau noch nicht gespeicherter Fotos (z. B. bei einem neuen Eintrag) */
export function FotoVorschau({ dateien, onEntfernen }: { dateien: File[]; onEntfernen: (i: number) => void }) {
  if (!dateien.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {dateien.map((d, i) => (
        <div key={`${d.name}-${i}`} className="relative">
          <img src={URL.createObjectURL(d)} alt="" className="h-20 w-20 rounded-xl object-cover" />
          <button type="button" className="absolute -right-2 -top-2 h-7 w-7 rounded-full bg-white text-sm font-bold shadow" onClick={() => onEntfernen(i)} aria-label="Foto entfernen">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

/** Fotoraster mit Hochladen, Grossansicht und Löschen */
export function FotoGalerie({
  fotos,
  ziel,
  titel,
  leerText = 'Noch keine Fotos.',
  mitHochladen = true,
}: {
  fotos: FotoMitUrl[];
  ziel: FotoZiel;
  titel?: string;
  leerText?: string;
  mitHochladen?: boolean;
}) {
  const { profil, darfVerwalten } = useAuth();
  const qc = useQueryClient();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [gross, setGross] = useState<FotoMitUrl | null>(null);
  const darf = profil && profil.rolle !== 'lesen';

  async function hochladen(dateien: File[]) {
    setFehler(null);
    setLaeuft(true);
    try {
      await fotosHochladen(dateien, ziel, profil!.betrieb_id);
      qc.invalidateQueries({ queryKey: ['fotos'] });
    } catch (e) {
      setFehler(fehlertext(e));
    } finally {
      setLaeuft(false);
    }
  }

  async function loeschen(f: FotoMitUrl) {
    if (!confirm('Dieses Foto löschen?')) return;
    try {
      await fotoLoeschen(f.id, f.pfad);
      setGross(null);
      qc.invalidateQueries({ queryKey: ['fotos'] });
    } catch (e) {
      setFehler(fehlertext(e));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {(titel || (darf && mitHochladen)) && (
        <div className="flex items-center justify-between gap-2">
          {titel && <h2 className="m-0 text-lg font-extrabold">{titel}</h2>}
          {darf && mitHochladen && (laeuft ? <span className="text-sm text-leise">Lade hoch …</span> : <FotoKnopf onDateien={hochladen} text="Foto hinzufügen" />)}
        </div>
      )}
      {fotos.length === 0 && titel && <p className="m-0 text-sm text-leise">{leerText}</p>}
      {fotos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {fotos.map((f) => (
            <button key={f.id} type="button" onClick={() => setGross(f)} className="overflow-hidden rounded-xl" aria-label="Foto gross anzeigen">
              <img src={f.url} alt={f.beschreibung ?? ''} loading="lazy" className="h-24 w-24 object-cover" />
            </button>
          ))}
        </div>
      )}
      {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
      {gross && (
        <div className="fixed inset-0 z-[2200] flex flex-col items-center justify-center gap-3 bg-black/85 p-3" onClick={() => setGross(null)}>
          <img src={gross.url} alt={gross.beschreibung ?? ''} className="max-h-[80dvh] max-w-full rounded-xl object-contain" />
          <div className="flex items-center gap-4 text-sm text-white" onClick={(e) => e.stopPropagation()}>
            <span>{datum(gross.erstellt_am)}</span>
            <a href={gross.url} target="_blank" rel="noopener" className="font-bold text-white">
              Original öffnen
            </a>
            {(darfVerwalten || gross.erstellt_von === profil?.id) && (
              <button className="font-bold text-[#FFB4A8]" onClick={() => loeschen(gross)}>
                Löschen
              </button>
            )}
            <button className="font-bold text-white" onClick={() => setGross(null)}>
              Schliessen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

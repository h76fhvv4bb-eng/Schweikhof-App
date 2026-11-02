import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { usePapierkorb } from '../lib/daten';
import { ha } from '../lib/format';

/** Restzeit bis zum endgültigen Entfernen, z. B. «noch 17 h» */
function restzeit(geloescht: string) {
  const ms = new Date(geloescht).getTime() + 24 * 3600 * 1000 - Date.now();
  const h = Math.floor(ms / 3600000);
  return h >= 1 ? `noch ${h} h` : `noch ${Math.max(1, Math.round(ms / 60000))} min`;
}

/** Gelöschte Felder, 24 Stunden wiederherstellbar */
export function Papierkorb() {
  const { darfVerwalten } = useAuth();
  const qc = useQueryClient();
  const korb = usePapierkorb();
  const [offen, setOffen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const liste = korb.data ?? [];
  if (!darfVerwalten || liste.length === 0) return null;

  const neuLaden = () => ['felder', 'anbau', 'flaeche_je_kultur', 'hinweise'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  async function wiederherstellen(id: string) {
    setFehler(null);
    const { error } = await supabase.rpc('feld_wiederherstellen', { p_id: id });
    if (error) return setFehler(fehlertext(error));
    neuLaden();
  }

  async function endgueltig(id: string, name: string) {
    if (!confirm(`«${name}» jetzt endgültig löschen? Das kann nicht rückgängig gemacht werden.`)) return;
    setFehler(null);
    const { error } = await supabase.rpc('papierkorb_leeren', { p_id: id });
    if (error) return setFehler(fehlertext(error));
    neuLaden();
  }

  return (
    <section className="karte flex flex-col gap-2 border-2 border-dashed border-linie p-3">
      <button className="flex min-h-10 items-center justify-between gap-2 text-left font-extrabold" onClick={() => setOffen(!offen)} aria-expanded={offen}>
        <span>
          🗑 Papierkorb: {liste.length} {liste.length === 1 ? 'Feld' : 'Felder'}
        </span>
        <span className="text-sm text-hof">{offen ? 'zuklappen' : 'anzeigen'}</span>
      </button>
      {offen && (
        <>
          <p className="m-0 text-xs text-leise">
            Gelöschte Felder lassen sich 24 Stunden lang wiederherstellen. Danach werden sie mit Fruchtfolge und Hinweisen entfernt. Felder mit
            Arbeiten, Ernten oder Aufträgen bleiben archiviert, damit die Aufzeichnungen erhalten bleiben.
          </p>
          {liste.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center gap-2 border-t border-rand pt-2">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-bold">
                  {f.feldnummer} {f.name}
                </span>
                <span className="text-xs text-leise">
                  {ha(Number(f.flaeche_m2))} · {restzeit(f.geloescht_am!)}
                </span>
              </span>
              <button className="knopf-leise min-h-10" onClick={() => wiederherstellen(f.id)}>
                Wiederherstellen
              </button>
              <button className="text-sm font-bold text-fehler" onClick={() => endgueltig(f.id, f.name)}>
                Endgültig löschen
              </button>
            </div>
          ))}
          {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
        </>
      )}
    </section>
  );
}

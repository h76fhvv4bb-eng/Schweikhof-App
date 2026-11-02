import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { APP_NAME, BETRIEB_VORGABE } from '../lib/marke';

/**
 * Erscheint nach der Anmeldung, solange das Konto keinem Betrieb zugeordnet ist:
 * - Gibt es eine Einladung für diese E-Mail, wird sie automatisch angenommen.
 * - Gibt es noch gar keinen Betrieb, legt der erste Benutzer ihn an und wird Administrator.
 */
export function Einrichten() {
  const { abmelden, session } = useAuth();
  const qc = useQueryClient();
  const [zustand, setZustand] = useState<'pruefe' | 'neu' | 'ohne_einladung'>('pruefe');
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [betrieb, setBetrieb] = useState(BETRIEB_VORGABE);
  const [name, setName] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);

  async function pruefen() {
    setZustand('pruefe');
    const { error } = await supabase.rpc('einladung_annehmen');
    if (!error) {
      qc.invalidateQueries({ queryKey: ['profil'] });
      return;
    }
    const vorhanden = await supabase.rpc('betrieb_vorhanden');
    if (vorhanden.data === false) setZustand('neu');
    else {
      setHinweis(fehlertext(error));
      setZustand('ohne_einladung');
    }
  }
  useEffect(() => {
    pruefen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function anlegen(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    const { error } = await supabase.rpc('betrieb_einrichten', { p_betriebsname: betrieb, p_name: name });
    if (error) setFehler(fehlertext(error));
    else qc.invalidateQueries({ queryKey: ['profil'] });
  }

  if (zustand === 'pruefe') return <p className="p-6 text-leise">Prüfe Einladung …</p>;

  if (zustand === 'ohne_einladung')
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="karte flex w-full max-w-sm flex-col gap-4">
          <h1 className="m-0 text-2xl font-extrabold text-hof">{APP_NAME}</h1>
          <p className="m-0">Du bist als {session?.user.email} angemeldet, aber noch keinem Betrieb zugeordnet.</p>
          {hinweis && <p className="m-0 rounded-xl bg-warn-hell p-3 text-sm font-semibold text-[#5C3D00]">{hinweis}</p>}
          <button className="knopf" onClick={pruefen}>
            Nochmals prüfen
          </button>
          <button className="text-sm font-bold text-hof" onClick={abmelden}>
            Abmelden
          </button>
        </div>
      </div>
    );

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={anlegen} className="karte flex w-full max-w-sm flex-col gap-4">
        <h1 className="m-0 text-2xl font-extrabold text-hof">Betrieb einrichten</h1>
        <p className="m-0 text-sm text-leise">
          Du bist die erste Person. Lege den Betrieb an, du wirst Administrator. Weitere Personen lädst du danach unter Mehr › Benutzer ein.
        </p>
        <label className="feld-label">
          Name des Betriebs
          <input className="eingabe" required value={betrieb} onChange={(e) => setBetrieb(e.target.value)} />
        </label>
        <label className="feld-label">
          Dein Name
          <input className="eingabe" required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
        <button className="knopf">Betrieb anlegen</button>
        <button type="button" className="text-sm font-bold text-hof" onClick={abmelden}>
          Abmelden
        </button>
      </form>
    </div>
  );
}

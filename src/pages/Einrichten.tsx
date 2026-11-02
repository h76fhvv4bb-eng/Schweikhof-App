import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';

/** Erscheint nach der ersten Anmeldung, solange das Konto keinem Betrieb zugeordnet ist. */
export function Einrichten() {
  const { abmelden } = useAuth();
  const qc = useQueryClient();
  const [betrieb, setBetrieb] = useState('Schweikhof');
  const [name, setName] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);

  async function absenden(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    const { error } = await supabase.rpc('betrieb_einrichten', { p_betriebsname: betrieb, p_name: name });
    if (error) setFehler(fehlertext(error));
    else qc.invalidateQueries({ queryKey: ['profil'] });
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={absenden} className="karte flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-2xl font-extrabold text-hof">Betrieb einrichten</h1>
        <p className="text-sm text-leise">
          Dein Konto ist noch keinem Betrieb zugeordnet. Der erste Benutzer legt den Betrieb an und wird Administrator. Weitere
          Personen lädst du später ein.
        </p>
        <label className="feld-label">
          Name des Betriebs
          <input className="eingabe" required value={betrieb} onChange={(e) => setBetrieb(e.target.value)} />
        </label>
        <label className="feld-label">
          Dein Name
          <input className="eingabe" required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {fehler && <p className="rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
        <button className="knopf">Betrieb anlegen</button>
        <button type="button" className="text-sm font-bold text-hof" onClick={abmelden}>
          Abmelden
        </button>
      </form>
    </div>
  );
}

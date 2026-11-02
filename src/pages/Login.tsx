import { useState, type FormEvent } from 'react';
import { supabase, fehlertext } from '../lib/supabase';

export function Login() {
  const [modus, setModus] = useState<'anmelden' | 'registrieren'>('anmelden');
  const [email, setEmail] = useState('');
  const [passwort, setPasswort] = useState('');
  const [meldung, setMeldung] = useState<{ text: string; fehler: boolean } | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  async function absenden(e: FormEvent) {
    e.preventDefault();
    setMeldung(null);
    if (passwort.length < 10) {
      setMeldung({ text: 'Das Passwort braucht mindestens 10 Zeichen.', fehler: true });
      return;
    }
    setLaeuft(true);
    const { error } =
      modus === 'anmelden'
        ? await supabase.auth.signInWithPassword({ email, password: passwort })
        : await supabase.auth.signUp({ email, password: passwort });
    setLaeuft(false);
    if (error) setMeldung({ text: fehlertext(error), fehler: true });
    else if (modus === 'registrieren')
      setMeldung({ text: 'Konto erstellt. Bitte bestätige die E-Mail und melde dich dann an.', fehler: false });
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={absenden} className="karte flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-2xl font-extrabold text-hof">Hofmanager</h1>
        <label className="feld-label">
          E-Mail
          <input className="eingabe" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="feld-label">
          Passwort
          <input
            className="eingabe"
            type="password"
            autoComplete={modus === 'anmelden' ? 'current-password' : 'new-password'}
            required
            value={passwort}
            onChange={(e) => setPasswort(e.target.value)}
          />
        </label>
        {meldung && (
          <p className={`rounded-xl p-3 text-sm font-semibold ${meldung.fehler ? 'bg-fehler-hell text-fehler' : 'bg-hof-hell text-hof'}`}>
            {meldung.text}
          </p>
        )}
        <button className="knopf" disabled={laeuft}>
          {modus === 'anmelden' ? 'Anmelden' : 'Konto erstellen'}
        </button>
        <button
          type="button"
          className="text-sm font-bold text-hof"
          onClick={() => setModus(modus === 'anmelden' ? 'registrieren' : 'anmelden')}
        >
          {modus === 'anmelden' ? 'Noch kein Konto? Registrieren' : 'Schon ein Konto? Anmelden'}
        </button>
      </form>
    </div>
  );
}

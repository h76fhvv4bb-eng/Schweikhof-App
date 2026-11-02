import { useState, type FormEvent } from 'react';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { APP_NAME } from '../lib/marke';

export function Login() {
  const [modus, setModus] = useState<'anmelden' | 'registrieren' | 'vergessen'>('anmelden');
  const [email, setEmail] = useState('');
  const [passwort, setPasswort] = useState('');
  const [meldung, setMeldung] = useState<{ text: string; fehler: boolean } | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  async function absenden(e: FormEvent) {
    e.preventDefault();
    setMeldung(null);
    if (modus !== 'vergessen' && passwort.length < 10) {
      setMeldung({ text: 'Das Passwort braucht mindestens 10 Zeichen.', fehler: true });
      return;
    }
    setLaeuft(true);
    const ziel = window.location.origin;
    const { error } =
      modus === 'anmelden'
        ? await supabase.auth.signInWithPassword({ email, password: passwort })
        : modus === 'registrieren'
          ? await supabase.auth.signUp({ email, password: passwort, options: { emailRedirectTo: ziel } })
          : await supabase.auth.resetPasswordForEmail(email, { redirectTo: ziel });
    setLaeuft(false);
    if (error) setMeldung({ text: fehlertext(error), fehler: true });
    else if (modus === 'registrieren') setMeldung({ text: 'Konto erstellt. Bitte bestätige die E-Mail und melde dich dann an.', fehler: false });
    else if (modus === 'vergessen') setMeldung({ text: 'Falls ein Konto existiert, ist eine E-Mail zum Zurücksetzen unterwegs.', fehler: false });
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={absenden} className="karte flex w-full max-w-sm flex-col gap-4">
        <div className="flex items-center gap-3">
          <img src="/icon.svg" alt="" width={44} height={44} className="rounded-xl" />
          <h1 className="m-0 text-2xl font-extrabold leading-tight text-hof">{APP_NAME}</h1>
        </div>
        {modus === 'registrieren' && (
          <p className="m-0 text-sm text-leise">Wurdest du eingeladen? Registriere dich mit genau der E-Mail-Adresse aus der Einladung.</p>
        )}
        <label className="feld-label">
          E-Mail
          <input className="eingabe" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {modus !== 'vergessen' && (
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
        )}
        {meldung && (
          <p className={`m-0 rounded-xl p-3 text-sm font-semibold ${meldung.fehler ? 'bg-fehler-hell text-fehler' : 'bg-hof-hell text-hof'}`}>{meldung.text}</p>
        )}
        <button className="knopf" disabled={laeuft}>
          {modus === 'anmelden' ? 'Anmelden' : modus === 'registrieren' ? 'Konto erstellen' : 'Link zum Zurücksetzen senden'}
        </button>
        <div className="flex flex-wrap justify-between gap-2">
          <button type="button" className="min-h-11 text-sm font-bold text-hof" onClick={() => setModus(modus === 'registrieren' ? 'anmelden' : 'registrieren')}>
            {modus === 'registrieren' ? 'Schon ein Konto? Anmelden' : 'Registrieren'}
          </button>
          {modus !== 'vergessen' ? (
            <button type="button" className="min-h-11 text-sm font-bold text-leise" onClick={() => setModus('vergessen')}>
              Passwort vergessen?
            </button>
          ) : (
            <button type="button" className="min-h-11 text-sm font-bold text-leise" onClick={() => setModus('anmelden')}>
              Zurück zur Anmeldung
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/** Nach dem Klick auf den Link in der «Passwort zurücksetzen»-Mail */
export function NeuesPasswort() {
  const { passwortGesetzt } = useAuth();
  const [passwort, setPasswort] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  async function speichern(e: FormEvent) {
    e.preventDefault();
    if (passwort.length < 10) return setFehler('Das Passwort braucht mindestens 10 Zeichen.');
    const { error } = await supabase.auth.updateUser({ password: passwort });
    if (error) return setFehler(fehlertext(error));
    passwortGesetzt();
  }
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={speichern} className="karte flex w-full max-w-sm flex-col gap-4">
        <h1 className="m-0 text-2xl font-extrabold text-hof">Neues Passwort</h1>
        <label className="feld-label">
          Neues Passwort (mind. 10 Zeichen)
          <input className="eingabe" type="password" autoComplete="new-password" value={passwort} onChange={(e) => setPasswort(e.target.value)} />
        </label>
        {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
        <button className="knopf">Passwort speichern</button>
      </form>
    </div>
  );
}

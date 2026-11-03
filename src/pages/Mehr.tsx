import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { NAVIGATION } from '../components/AppShell';
import { Icon } from '../components/Icon';

export function Mehr() {
  const { profil, abmelden } = useAuth();
  return (
    <div className="flex flex-col gap-3">
      <h1 className="m-0 text-3xl font-extrabold text-hof">Mehr</h1>
      {NAVIGATION.filter((n) => n.pfad !== '/').map((n) => (
        <Link key={n.pfad} to={n.pfad} className="karte flex min-h-14 items-center gap-3 p-3 font-extrabold text-text no-underline">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-hof-hell text-hof">
            <Icon name={n.icon} />
          </span>
          <span className="flex-1">{n.text}</span>
          <Icon name="weiter" groesse={18} className="text-[#9AA59C]" />
        </Link>
      ))}
      {profil?.rolle === 'administrator' && (
        <Link to="/benutzer" className="karte flex min-h-14 items-center gap-3 p-3 font-extrabold text-text no-underline">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-hof-hell text-hof">
            <Icon name="partner" />
          </span>
          <span className="flex-1">Benutzer verwalten</span>
          <Icon name="weiter" groesse={18} className="text-[#9AA59C]" />
        </Link>
      )}
      <MeinKonto />
      <div className="karte flex flex-col gap-2">
        <span className="text-sm text-leise">
          Angemeldet als {profil?.name} ({profil?.rolle})
        </span>
        <button className="knopf-leise" onClick={abmelden}>
          <Icon name="abmelden" /> Abmelden
        </button>
      </div>
    </div>
  );
}

function MeinKonto() {
  const { profil, session } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState(profil?.name ?? '');
  const [passwort, setPasswort] = useState('');
  const [meldung, setMeldung] = useState<{ text: string; fehler: boolean } | null>(null);
  async function nameSpeichern(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc('mein_name', { p_name: name });
    setMeldung(error ? { text: fehlertext(error), fehler: true } : { text: 'Name gespeichert.', fehler: false });
    qc.invalidateQueries({ queryKey: ['profil'] });
    qc.invalidateQueries({ queryKey: ['benutzer'] });
    qc.invalidateQueries({ queryKey: ['mitarbeiter'] });
  }
  async function passwortSpeichern(e: FormEvent) {
    e.preventDefault();
    if (passwort.length < 10) return setMeldung({ text: 'Das Passwort braucht mindestens 10 Zeichen.', fehler: true });
    const { error } = await supabase.auth.updateUser({ password: passwort });
    setMeldung(error ? { text: fehlertext(error), fehler: true } : { text: 'Passwort geändert.', fehler: false });
    if (!error) setPasswort('');
  }
  return (
    <section className="karte flex flex-col gap-3">
      <h2 className="m-0 text-lg font-extrabold">Mein Konto</h2>
      <span className="text-sm text-leise">{session?.user.email}</span>
      <form onSubmit={nameSpeichern} className="grid grid-cols-[1fr_auto] items-end gap-2">
        <label className="feld-label">
          Mein Name
          <input className="eingabe" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="knopf-leise">Speichern</button>
      </form>
      <form onSubmit={passwortSpeichern} className="grid grid-cols-[1fr_auto] items-end gap-2">
        <label className="feld-label">
          Neues Passwort (mind. 10 Zeichen)
          <input className="eingabe" type="password" autoComplete="new-password" value={passwort} onChange={(e) => setPasswort(e.target.value)} />
        </label>
        <button className="knopf-leise">Ändern</button>
      </form>
      {meldung && <p className={`m-0 rounded-xl p-3 text-sm font-semibold ${meldung.fehler ? 'bg-fehler-hell text-fehler' : 'bg-hof-hell text-hof'}`}>{meldung.text}</p>}
    </section>
  );
}

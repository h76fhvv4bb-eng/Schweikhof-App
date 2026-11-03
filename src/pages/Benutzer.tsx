import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useBetrieb } from '../lib/daten';
import { datum } from '../lib/format';
import { APP_NAME } from '../lib/marke';
import type { Rolle } from '../lib/typen';
import { Icon } from '../components/Icon';

const ROLLEN: { wert: Rolle; text: string; beschreibung: string }[] = [
  { wert: 'administrator', text: 'Administrator', beschreibung: 'Alles, inkl. Benutzer verwalten' },
  { wert: 'betriebsleiter', text: 'Betriebsleiter', beschreibung: 'Alle Betriebsdaten bearbeiten' },
  { wert: 'mitarbeiter', text: 'Mitarbeiter', beschreibung: 'Arbeiten, Beobachtungen und Hinweise erfassen, alles ansehen' },
  { wert: 'lesen', text: 'Nur lesen', beschreibung: 'Alles ansehen, nichts ändern' },
];
const rollenText = (r: string) => ROLLEN.find((x) => x.wert === r)?.text ?? r;

interface Einladung {
  id: string;
  email: string;
  name: string | null;
  rolle: Rolle;
  erstellt_am: string;
  angenommen_am: string | null;
  widerrufen: boolean;
}

export function Benutzer() {
  const { profil } = useAuth();
  const qc = useQueryClient();
  const betrieb = useBetrieb();
  const [fehler, setFehler] = useState<string | null>(null);

  const benutzer = useQuery({
    queryKey: ['benutzer-verwaltung'],
    queryFn: async () => {
      const { data, error } = await supabase.from('benutzer_profile').select('id, name, rolle, aktiv, erstellt_am').order('name');
      if (error) throw error;
      return data as { id: string; name: string; rolle: Rolle; aktiv: boolean; erstellt_am: string }[];
    },
  });
  const aktivitaet = useQuery({
    queryKey: ['benutzer-aktivitaet'],
    queryFn: async () => {
      const { data, error } = await supabase.from('benutzer_aktivitaet').select('*');
      if (error) throw error;
      return data as { benutzer_id: string; aenderungen: number; zuletzt: string }[];
    },
  });
  const einladungen = useQuery({
    queryKey: ['einladungen'],
    queryFn: async () => {
      const { data, error } = await supabase.from('einladungen').select('*').order('erstellt_am', { ascending: false });
      if (error) throw error;
      return data as Einladung[];
    },
  });

  async function aendern(id: string, rolle: Rolle, aktiv: boolean) {
    setFehler(null);
    const { error } = await supabase.rpc('benutzer_aendern', { p_id: id, p_rolle: rolle, p_aktiv: aktiv });
    if (error) setFehler(fehlertext(error));
    qc.invalidateQueries({ queryKey: ['benutzer-verwaltung'] });
    qc.invalidateQueries({ queryKey: ['benutzer'] });
    qc.invalidateQueries({ queryKey: ['mitarbeiter'] });
  }
  async function widerrufen(e: Einladung) {
    if (!confirm(`Einladung an ${e.email} widerrufen?`)) return;
    const { error } = await supabase.from('einladungen').update({ widerrufen: true }).eq('id', e.id);
    if (error) setFehler(fehlertext(error));
    qc.invalidateQueries({ queryKey: ['einladungen'] });
  }

  if (profil?.rolle !== 'administrator') return <p>Nur Administratoren können Benutzer verwalten.</p>;
  const offen = (einladungen.data ?? []).filter((e) => !e.angenommen_am && !e.widerrufen);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <Link to="/mehr" aria-label="Zurück" className="knopf-leise h-11 w-11 px-0">
          <Icon name="zurueck" />
        </Link>
        <div>
          <span className="text-sm font-semibold text-leise">{benutzer.data?.filter((b) => b.aktiv).length ?? 0} aktive Benutzer</span>
          <h1 className="m-0 text-3xl font-extrabold text-hof">Benutzer</h1>
        </div>
      </header>

      <Einladen betriebName={betrieb.data?.name ?? APP_NAME} onFehler={setFehler} />

      {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}

      {offen.length > 0 && (
        <section className="karte flex flex-col gap-2">
          <h2 className="m-0 text-lg font-extrabold">Offene Einladungen</h2>
          {offen.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-2 border-b border-rand py-2 text-sm last:border-0">
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-bold">{e.name ? `${e.name} · ${e.email}` : e.email}</span>
                <span className="text-xs text-leise">
                  {rollenText(e.rolle)} · eingeladen am {datum(e.erstellt_am)}
                </span>
              </span>
              <span className="flex shrink-0 gap-1">
                <EinladungTeilen email={e.email} name={e.name} betriebName={betrieb.data?.name ?? APP_NAME} klein />
                <button className="knopf-leise h-11 px-3 text-xs text-fehler" onClick={() => widerrufen(e)}>
                  Widerrufen
                </button>
              </span>
            </div>
          ))}
        </section>
      )}

      <section className="karte flex flex-col gap-1">
        <h2 className="m-0 mb-1 text-lg font-extrabold">Personen</h2>
        {(benutzer.data ?? []).map((b) => {
          const akt = aktivitaet.data?.find((a) => a.benutzer_id === b.id);
          const ich = b.id === profil.id;
          return (
            <div key={b.id} className={`flex flex-col gap-2 border-b border-rand py-3 last:border-0 ${b.aktiv ? '' : 'opacity-60'}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-extrabold">
                  {b.name}
                  {ich && <span className="ml-2 text-xs font-bold text-leise">(du)</span>}
                  {!b.aktiv && <span className="ml-2 rounded-lg bg-fehler-hell px-2 py-0.5 text-xs text-fehler">deaktiviert</span>}
                </span>
                <span className="text-xs text-leise">{akt ? `zuletzt aktiv ${datum(akt.zuletzt)} · ${akt.aenderungen} Änderungen` : 'noch keine Änderungen'}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="eingabe min-h-11 flex-1"
                  value={b.rolle}
                  onChange={(e) => aendern(b.id, e.target.value as Rolle, b.aktiv)}
                  aria-label={`Rolle von ${b.name}`}
                >
                  {ROLLEN.map((r) => (
                    <option key={r.wert} value={r.wert}>
                      {r.text} – {r.beschreibung}
                    </option>
                  ))}
                </select>
                {!ich && (
                  <button className="knopf-leise" onClick={() => aendern(b.id, b.rolle, !b.aktiv)}>
                    {b.aktiv ? 'Deaktivieren' : 'Wieder aktivieren'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </section>
      <p className="m-0 text-xs text-leise">
        Deaktivierte Personen können sich noch anmelden, sehen aber keine Betriebsdaten mehr. Ihre Einträge bleiben erhalten. Es bleibt immer mindestens ein
        aktiver Administrator.
      </p>
    </div>
  );
}

function Einladen({ betriebName, onFehler }: { betriebName: string; onFehler: (t: string) => void }) {
  const { profil } = useAuth();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [rolle, setRolle] = useState<Rolle>('mitarbeiter');
  const [erstellt, setErstellt] = useState<{ email: string; name: string } | null>(null);

  async function einladen(e: FormEvent) {
    e.preventDefault();
    const adresse = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adresse)) return onFehler('Bitte eine gültige E-Mail-Adresse eingeben.');
    const { error } = await supabase.from('einladungen').insert({ betrieb_id: profil!.betrieb_id, email: adresse, name: name.trim() || null, rolle });
    if (error) return onFehler(error.message.includes('einladung_offen') ? 'Für diese Adresse gibt es schon eine offene Einladung.' : fehlertext(error));
    setErstellt({ email: adresse, name: name.trim() });
    setEmail('');
    setName('');
    qc.invalidateQueries({ queryKey: ['einladungen'] });
  }

  return (
    <form onSubmit={einladen} className="karte flex flex-col gap-3">
      <h2 className="m-0 text-lg font-extrabold">Person einladen</h2>
      <div className="grid grid-cols-2 gap-3">
        <label className="feld-label col-span-2">
          E-Mail-Adresse
          <input className="eingabe" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@beispiel.ch" />
        </label>
        <label className="feld-label">
          Name
          <input className="eingabe" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="feld-label">
          Rolle
          <select className="eingabe" value={rolle} onChange={(e) => setRolle(e.target.value as Rolle)}>
            {ROLLEN.map((r) => (
              <option key={r.wert} value={r.wert}>
                {r.text}
              </option>
            ))}
          </select>
        </label>
      </div>
      <span className="text-xs text-leise">{ROLLEN.find((r) => r.wert === rolle)?.beschreibung}</span>
      <button className="knopf">Einladung erstellen</button>
      {erstellt && (
        <div className="flex flex-col gap-2 rounded-2xl bg-hof-hell p-3 text-sm">
          <span className="font-bold text-hof">Einladung für {erstellt.email} erstellt. Jetzt die Person benachrichtigen:</span>
          <EinladungTeilen email={erstellt.email} name={erstellt.name} betriebName={betriebName} />
        </div>
      )}
    </form>
  );
}

function einladungsText(betriebName: string, name: string | null, email: string) {
  const url = window.location.origin;
  return `Hallo${name ? ` ${name}` : ''}\n\ndu bist zum ${APP_NAME} (${betriebName}) eingeladen.\n\n1. Öffne ${url}\n2. Tippe auf «Registrieren» und verwende genau diese E-Mail-Adresse: ${email}\n3. Bestätige den Link in der E-Mail, die du erhältst, und melde dich an.\n\nAuf dem iPhone: in Safari öffnen › Teilen › «Zum Home-Bildschirm», dann startet die App wie eine normale App.`;
}

function EinladungTeilen({ email, name, betriebName, klein }: { email: string; name: string | null; betriebName: string; klein?: boolean }) {
  const [kopiert, setKopiert] = useState(false);
  const text = einladungsText(betriebName, name, email);
  const betreff = `Einladung zum ${APP_NAME}`;
  async function teilen() {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: betreff, text });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(text)}`;
  }
  async function kopieren() {
    try {
      await navigator.clipboard.writeText(text);
      setKopiert(true);
      setTimeout(() => setKopiert(false), 2000);
    } catch {
      /* Zwischenablage nicht verfügbar */
    }
  }
  return (
    <span className="flex flex-wrap gap-2">
      <button type="button" className={klein ? 'knopf h-11 px-3 text-xs' : 'knopf'} onClick={teilen}>
        <Icon name="auftrag" groesse={18} /> {klein ? 'Senden' : 'Per Mail oder Nachricht senden'}
      </button>
      {!klein && (
        <button type="button" className="knopf-leise" onClick={kopieren}>
          {kopiert ? 'Kopiert' : 'Text kopieren'}
        </button>
      )}
    </span>
  );
}

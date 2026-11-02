import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useBetrieb } from '../lib/daten';
import { useAuth } from '../lib/auth';
import { NAVIGATION } from '../components/AppShell';
import { ibanGueltig, istQrIban } from '../lib/belegPdf';
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
      {profil?.rolle === 'administrator' && <Betriebsangaben />}
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

/** Name, Adresse und Bankverbindung des Betriebs (Briefkopf der Aufträge, Rechnungen und Quittungen) */
function Betriebsangaben() {
  const betrieb = useBetrieb();
  const qc = useQueryClient();
  const [w, setW] = useState({ name: '', strasse: '', hausnummer: '', plz: '', ort: '', telefon: '', email: '', iban: '', mwst_nr: '', frist: '30' });
  const [meldung, setMeldung] = useState<{ text: string; fehler: boolean } | null>(null);
  useEffect(() => {
    const b = betrieb.data;
    if (!b) return;
    // Alte Freitext-Adresse («Strasse Nr.\nPLZ Ort») als Vorschlag zerlegen
    const zeilen = (b.adresse ?? '').split('\n');
    const s1 = zeilen[0]?.match(/^(.*?)\s+(\d+\w*)$/);
    const s2 = zeilen[1]?.match(/^(\d{4})\s+(.+)$/);
    setW({
      name: b.name,
      strasse: b.strasse ?? s1?.[1] ?? zeilen[0] ?? '',
      hausnummer: b.hausnummer ?? s1?.[2] ?? '',
      plz: b.plz ?? s2?.[1] ?? '',
      ort: b.ort ?? s2?.[2] ?? '',
      telefon: b.telefon ?? '',
      email: b.email ?? '',
      iban: b.iban ? b.iban.replace(/(.{4})/g, '$1 ').trim() : '',
      mwst_nr: b.mwst_nr ?? '',
      frist: String(b.zahlungsfrist_tage ?? 30),
    });
  }, [betrieb.data]);
  async function speichern(e: FormEvent) {
    e.preventDefault();
    setMeldung(null);
    if (!betrieb.data || !w.name.trim()) return;
    const iban = w.iban.replace(/\s/g, '').toUpperCase();
    if (iban && !ibanGueltig(iban)) return setMeldung({ text: 'Die IBAN ist ungültig (nur CH/LI). Bitte prüfen.', fehler: true });
    if (iban && istQrIban(iban)) return setMeldung({ text: 'Das ist eine QR-IBAN. Bitte die normale IBAN des Kontos eintragen.', fehler: true });
    if (w.plz && !/^\d{4}$/.test(w.plz.trim())) return setMeldung({ text: 'PLZ: vier Ziffern.', fehler: true });
    const frist = Number(w.frist);
    if (!Number.isInteger(frist) || frist < 0 || frist > 120) return setMeldung({ text: 'Zahlungsfrist: 0 bis 120 Tage.', fehler: true });
    const adresse = [[w.strasse.trim(), w.hausnummer.trim()].filter(Boolean).join(' '), [w.plz.trim(), w.ort.trim()].filter(Boolean).join(' ')].filter(Boolean).join('\n');
    const { error } = await supabase
      .from('betriebe')
      .update({
        name: w.name.trim(), adresse: adresse || null, strasse: w.strasse.trim() || null, hausnummer: w.hausnummer.trim() || null,
        plz: w.plz.trim() || null, ort: w.ort.trim() || null, telefon: w.telefon.trim() || null, email: w.email.trim() || null,
        iban: iban || null, mwst_nr: w.mwst_nr.trim() || null, zahlungsfrist_tage: frist, version: betrieb.data.version,
      })
      .eq('id', betrieb.data.id);
    setMeldung(error ? { text: fehlertext(error), fehler: true } : { text: 'Gespeichert.', fehler: false });
    qc.invalidateQueries({ queryKey: ['betrieb'] });
  }
  const set = (k: keyof typeof w) => (e: { target: { value: string } }) => setW({ ...w, [k]: e.target.value });
  return (
    <form onSubmit={speichern} className="karte flex flex-col gap-3">
      <h2 className="m-0 text-lg font-extrabold">Betriebsangaben</h2>
      <span className="text-sm text-leise">Erscheinen im Briefkopf von Aufträgen, Rechnungen und Quittungen. Adresse und IBAN braucht es für die QR-Rechnung.</span>
      <label className="feld-label">
        Name
        <input className="eingabe" value={w.name} onChange={set('name')} />
      </label>
      <div className="grid grid-cols-[1fr_90px] gap-3">
        <label className="feld-label">
          Strasse
          <input className="eingabe" value={w.strasse} onChange={set('strasse')} />
        </label>
        <label className="feld-label">
          Nr.
          <input className="eingabe" value={w.hausnummer} onChange={set('hausnummer')} />
        </label>
      </div>
      <div className="grid grid-cols-[90px_1fr] gap-3">
        <label className="feld-label">
          PLZ
          <input className="eingabe" inputMode="numeric" value={w.plz} onChange={set('plz')} />
        </label>
        <label className="feld-label">
          Ort
          <input className="eingabe" value={w.ort} onChange={set('ort')} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="feld-label">
          Telefon
          <input className="eingabe" type="tel" value={w.telefon} onChange={set('telefon')} />
        </label>
        <label className="feld-label">
          E-Mail
          <input className="eingabe" type="email" value={w.email} onChange={set('email')} />
        </label>
      </div>
      <label className="feld-label">
        IBAN (für die QR-Rechnung)
        <input className="eingabe" value={w.iban} onChange={set('iban')} placeholder="CH00 0000 0000 0000 0000 0" autoComplete="off" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="feld-label">
          MWST-Nr. (falls vorhanden)
          <input className="eingabe" value={w.mwst_nr} onChange={set('mwst_nr')} placeholder="CHE-123.456.789 MWST" />
        </label>
        <label className="feld-label">
          Zahlungsfrist (Tage)
          <input className="eingabe" inputMode="numeric" value={w.frist} onChange={set('frist')} />
        </label>
      </div>
      {meldung && <p className={`m-0 rounded-xl p-3 text-sm font-semibold ${meldung.fehler ? 'bg-fehler-hell text-fehler' : 'bg-hof-hell text-hof'}`}>{meldung.text}</p>}
      <button className="knopf">Speichern</button>
    </form>
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

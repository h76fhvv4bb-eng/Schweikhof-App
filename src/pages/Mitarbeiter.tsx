import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useArbeitenVon, useAufgaben, useBenutzer, useFelder, useGeplanteArbeiten, useMitarbeiter, useMitarbeiterStunden } from '../lib/daten';
import { chf, datum, menge, zahlAus } from '../lib/format';
import type { Mitarbeiter } from '../lib/typen';
import { Icon } from '../components/Icon';

/** Mitarbeitende verwalten: mit oder ohne App-Zugang, Stunden, offene Aufgaben */
export function MitarbeiterSeite() {
  const { darfVerwalten } = useAuth();
  const jahr = new Date().getFullYear();
  const mitarbeiter = useMitarbeiter();
  const stunden = useMitarbeiterStunden(jahr);
  const benutzer = useBenutzer();
  const geplant = useGeplanteArbeiten();
  const aufgaben = useAufgaben('offen');
  const [bearbeiten, setBearbeiten] = useState<Mitarbeiter | 'neu' | null>(null);
  const [offen, setOffen] = useState<string | null>(null);
  const [alle, setAlle] = useState(false);
  const liste = (mitarbeiter.data ?? []).filter((m) => alle || m.aktiv);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-leise">Personen, die auf dem Betrieb arbeiten</span>
          <h1 className="m-0 text-3xl font-extrabold text-hof">Mitarbeitende</h1>
        </div>
        {darfVerwalten && (
          <button className="knopf" onClick={() => setBearbeiten('neu')}>
            <Icon name="plus" /> Person
          </button>
        )}
      </header>
      <p className="m-0 text-sm text-leise">
        Wer ein App-Konto hat, erscheint hier automatisch. Weitere Personen (Aushilfen, Familie, Lernende) brauchen kein Konto; ihnen können trotzdem
        Arbeiten und Aufgaben zugeteilt werden. App-Zugänge verwaltest du unter <Link to="/benutzer">Benutzer</Link>.
      </p>

      {liste.map((m) => {
        const h = stunden.data?.find((s) => s.mitarbeiter_id === m.id);
        const anzahlOffen =
          (geplant.data ?? []).filter((a) => a.mitarbeiter_id === m.id).length + (aufgaben.data ?? []).filter((a) => a.mitarbeiter_id === m.id).length;
        const konto = benutzer.data?.find((b) => b.id === m.benutzer_id);
        return (
          <div key={m.id} className="karte flex flex-col gap-2 p-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-hof-hell text-lg font-extrabold text-hof">
                {m.name.slice(0, 1).toUpperCase()}
              </span>
              <button className="flex min-w-0 flex-1 flex-col text-left" onClick={() => setOffen(offen === m.id ? null : m.id)}>
                <span className="truncate font-extrabold">
                  {m.name}
                  {!m.aktiv && <span className="ml-2 text-xs font-bold text-leise">inaktiv</span>}
                </span>
                <span className="text-xs text-leise">
                  {[m.funktion, konto ? `App: ${konto.rolle}` : 'ohne App-Konto', h ? `${menge(Number(h.stunden))} h ${jahr}` : null, anzahlOffen ? `${anzahlOffen} offen` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
              {m.telefon && (
                <a href={`tel:${m.telefon.replace(/\s/g, '')}`} className="knopf-leise h-11 px-3 no-underline">
                  Anrufen
                </a>
              )}
              {darfVerwalten && (
                <button className="knopf-leise h-11 px-3" onClick={() => setBearbeiten(m)}>
                  Bearbeiten
                </button>
              )}
            </div>
            {offen === m.id && <PersonDetails person={m} />}
          </div>
        );
      })}
      <button className="self-start text-sm font-bold text-hof" onClick={() => setAlle(!alle)}>
        {alle ? 'Nur aktive anzeigen' : 'Auch inaktive anzeigen'}
      </button>

      {bearbeiten && <PersonFormular person={bearbeiten === 'neu' ? null : bearbeiten} onFertig={() => setBearbeiten(null)} />}
    </div>
  );
}

function PersonDetails({ person }: { person: Mitarbeiter }) {
  const arbeiten = useArbeitenVon('mitarbeiter', person.id);
  const aufgaben = useAufgaben('offen');
  const felder = useFelder();
  const feldName = (id: string) => felder.data?.find((f) => f.id === id)?.name ?? '';
  const offen = (arbeiten.data ?? []).filter((a) => a.status === 'geplant');
  const erledigt = (arbeiten.data ?? []).filter((a) => a.status === 'erledigt').slice(0, 8);
  const offeneAufgaben = (aufgaben.data ?? []).filter((a) => a.mitarbeiter_id === person.id);
  const kosten = person.stundenansatz_chf ? erledigt.reduce((s, a) => s + Number(a.dauer_h ?? 0), 0) * Number(person.stundenansatz_chf) : 0;
  return (
    <div className="flex flex-col gap-2 border-t border-rand pt-2 text-sm">
      {(offen.length > 0 || offeneAufgaben.length > 0) && (
        <>
          <span className="text-xs font-extrabold text-leise">OFFEN</span>
          {offen.map((a) => (
            <Link key={a.id} to={`/arbeiten/${a.id}`} className="text-text no-underline">
              {datum(a.datum)} · {a.arbeitsart} · {a.feldarbeit_felder.map((f) => feldName(f.feld_id)).join(', ')}
            </Link>
          ))}
          {offeneAufgaben.map((a) => (
            <Link key={a.id} to="/aufgaben" className="text-text no-underline">
              {a.faellig_am ? `${datum(a.faellig_am)} · ` : ''}
              {a.titel}
            </Link>
          ))}
        </>
      )}
      <span className="text-xs font-extrabold text-leise">ZULETZT ERLEDIGT</span>
      {erledigt.length === 0 && <span className="text-leise">Noch keine erfassten Arbeiten.</span>}
      {erledigt.map((a) => (
        <Link key={a.id} to={`/arbeiten/${a.id}`} className="text-text no-underline">
          {datum(a.datum)} · {a.arbeitsart} · {a.feldarbeit_felder.map((f) => feldName(f.feld_id)).join(', ')}
          {a.dauer_h != null && ` · ${menge(Number(a.dauer_h))} h`}
        </Link>
      ))}
      {kosten > 0 && <span className="text-xs text-leise">Lohnkosten dieser Einsätze ca. {chf(kosten)}</span>}
    </div>
  );
}

function PersonFormular({ person, onFertig }: { person: Mitarbeiter | null; onFertig: () => void }) {
  const { profil } = useAuth();
  const qc = useQueryClient();
  const [w, setW] = useState({
    name: person?.name ?? '',
    funktion: person?.funktion ?? '',
    telefon: person?.telefon ?? '',
    email: person?.email ?? '',
    ansatz: person?.stundenansatz_chf != null ? String(person.stundenansatz_chf) : '',
    aktiv: person?.aktiv ?? true,
    bemerkungen: person?.bemerkungen ?? '',
  });
  const [fehler, setFehler] = useState<string | null>(null);
  const set = (k: keyof typeof w) => (e: { target: { value: string } }) => setW({ ...w, [k]: e.target.value });

  async function speichern() {
    setFehler(null);
    if (!w.name.trim()) return setFehler('Bitte einen Namen eingeben.');
    const ansatz = zahlAus(w.ansatz);
    if (w.ansatz.trim() && (ansatz == null || ansatz < 0)) return setFehler('Stundenansatz ungültig.');
    if (w.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(w.email.trim())) return setFehler('E-Mail-Adresse ungültig.');
    const daten = {
      name: w.name.trim(),
      funktion: w.funktion.trim() || null,
      telefon: w.telefon.trim() || null,
      email: w.email.trim() || null,
      stundenansatz_chf: ansatz,
      aktiv: w.aktiv,
      bemerkungen: w.bemerkungen.trim() || null,
    };
    const { error } = person
      ? await supabase.from('mitarbeiter').update({ ...daten, version: person.version }).eq('id', person.id)
      : await supabase.from('mitarbeiter').insert({ ...daten, betrieb_id: profil!.betrieb_id });
    if (error) return setFehler(fehlertext(error));
    qc.invalidateQueries({ queryKey: ['mitarbeiter'] });
    onFertig();
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-end justify-center bg-black/30 p-3 md:items-center" onClick={onFertig}>
      <div className="karte flex max-h-[92dvh] w-full max-w-md flex-col gap-3 overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Person">
        <div className="flex items-start justify-between">
          <h2 className="m-0 text-xl font-extrabold">{person ? person.name : 'Neue Person'}</h2>
          <button className="h-11 w-11 text-leise" onClick={onFertig} aria-label="Schliessen">
            ✕
          </button>
        </div>
        <label className="feld-label">
          Name
          <input className="eingabe" value={w.name} onChange={set('name')} autoFocus={!person} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="feld-label">
            Funktion
            <input className="eingabe" value={w.funktion} onChange={set('funktion')} placeholder="z. B. Aushilfe" />
          </label>
          <label className="feld-label">
            Stundenansatz CHF
            <input className="eingabe" inputMode="decimal" value={w.ansatz} onChange={set('ansatz')} />
          </label>
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
          Bemerkungen
          <input className="eingabe" value={w.bemerkungen} onChange={set('bemerkungen')} placeholder="z. B. Fahrausweis G, nur Samstag" />
        </label>
        <label className="flex min-h-10 items-center gap-2 text-sm font-bold">
          <input type="checkbox" className="h-5 w-5 accent-hof" checked={w.aktiv} onChange={(e) => setW({ ...w, aktiv: e.target.checked })} />
          Aktiv (in Auswahllisten anzeigen)
        </label>
        {person?.benutzer_id && <span className="text-xs text-leise">Hat ein App-Konto. Rolle und Zugang unter «Benutzer».</span>}
        {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
        <button className="knopf" onClick={speichern}>
          Speichern
        </button>
      </div>
    </div>
  );
}

/** Auswahlfeld «Wer?» mit allen aktiven Mitarbeitenden */
export function PersonAuswahl({ wert, onWahl, leer = '– offen –' }: { wert: string; onWahl: (id: string) => void; leer?: string }) {
  const mitarbeiter = useMitarbeiter();
  return (
    <select className="eingabe" value={wert} onChange={(e) => onWahl(e.target.value)}>
      <option value="">{leer}</option>
      {(mitarbeiter.data ?? [])
        .filter((m) => m.aktiv || m.id === wert)
        .map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
            {m.funktion ? ` (${m.funktion})` : ''}
          </option>
        ))}
    </select>
  );
}

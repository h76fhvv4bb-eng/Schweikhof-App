import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useBetrieb, useBeweidungen, useFelder, usePartner, useSperrungen } from '../lib/daten';
import { datum, heuteIso } from '../lib/format';
import { SPERRGRUENDE, type Sperrung } from '../lib/typen';
import { tagVerschieben } from '../lib/weide';
import { pdfHerunterladen, pdfPerMail } from '../lib/auftragPdf';
import { Icon } from '../components/Icon';

/** Die Sperrungen gelten nur für die Hundeschule und haben keinen Einfluss auf andere Funktionen der App */
const FUER = 'Hundeschule';
const istAktiv = (s: Sperrung, tag = heuteIso()) => s.von <= tag && (s.bis == null || s.bis >= tag);

/** Hundeschule: Felder für das Hundetraining sperren und als Plan mit Karte weitergeben */
export function SperrungenListe() {
  const darfErfassen = !!useAuth().profil;
  const sperrungen = useSperrungen();
  const felder = useFelder();
  const weiden = useBeweidungen();
  const partner = usePartner();
  const betrieb = useBetrieb();
  const [stichtag, setStichtag] = useState(heuteIso());
  const [laeuft, setLaeuft] = useState<'' | 'pdf' | 'mail'>('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [alteZeigen, setAlteZeigen] = useState(false);

  const alle = sperrungen.data ?? [];
  const heute = heuteIso();
  const aktuell = alle.filter((s) => s.bis == null || s.bis >= heute).sort((a, b) => a.von.localeCompare(b.von));
  const vorbei = alle.filter((s) => s.bis != null && s.bis < heute);
  const feldNamen = (s: Sperrung) =>
    s.sperrung_felder
      .map((x) => felder.data?.find((f) => f.id === x.feld_id))
      .filter(Boolean)
      .sort((a, b) => a!.feldnummer.localeCompare(b!.feldnummer, 'de-CH', { numeric: true }))
      .map((f) => `${f!.feldnummer} ${f!.name}`);

  async function plan(wie: 'pdf' | 'mail') {
    setFehler(null);
    setLaeuft(wie);
    try {
      const { sperrplanPdf } = await import('../lib/sperrplanPdf');
      const pdf = await sperrplanPdf({
        betrieb: betrieb.data ?? null,
        felder: felder.data ?? [],
        sperrungen: alle,
        weiden: weiden.data ?? [],
        partnerName: (id) => partner.data?.find((p) => p.id === id)?.name ?? null,
        stichtag,
        fuer: null,
      });
      const name = `Hundeschule_Sperrplan_${stichtag}.pdf`;
      if (wie === 'pdf') {
        const url = URL.createObjectURL(pdf);
        if (!window.open(url, '_blank')) pdfHerunterladen(pdf, name);
      } else
        await pdfPerMail(
          pdf, name, null, `Gesperrte Flächen ab ${datum(stichtag)}`,
          `Grüezi\n\nIm Anhang die für das Hundetraining gesperrten Flächen und die Weiden mit Tieren (Stand ${datum(stichtag)}). Bitte diese Flächen nicht betreten.\n\nFreundliche Grüsse\n${betrieb.data?.name ?? ''}`,
        );
    } catch (e) {
      setFehler(`Plan konnte nicht erstellt werden: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLaeuft('');
    }
  }

  if (sperrungen.isSuccess && sperrungen.data === null)
    return (
      <div className="flex flex-col gap-4">
        <h1 className="m-0 text-3xl font-extrabold text-hof">Hundeschule</h1>
        <p className="karte m-0">Bitte zuerst Migration 32 in Supabase einspielen.</p>
      </div>
    );

  const karte = (s: Sperrung) => (
    <Link key={s.id} to={`/sperrungen/${s.id}`} className="karte flex flex-col gap-1 p-3 text-text no-underline">
      <div className="flex items-start justify-between gap-2">
        <b>{s.grund}</b>
        <span
          className={`shrink-0 rounded-lg px-2 py-0.5 text-xs font-extrabold ${istAktiv(s) ? 'bg-fehler-hell text-fehler' : s.von > heute ? 'bg-[#FFF3C4] text-[#7A5B00]' : 'bg-grund text-leise'}`}
        >
          {istAktiv(s) ? 'gesperrt' : s.von > heute ? 'geplant' : 'aufgehoben'}
        </span>
      </div>
      <span className="text-sm text-leise">
        {datum(s.von)} – {s.bis ? datum(s.bis) : 'bis auf Weiteres'}
      </span>
      <span className="text-sm">{feldNamen(s).join(', ')}</span>
    </Link>
  );

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-leise">Gesperrte Felder für das Hundetraining</span>
          <h1 className="m-0 text-3xl font-extrabold text-hof">Hundeschule</h1>
        </div>
        {darfErfassen && (
          <Link to="/sperrungen/neu" className="knopf no-underline">
            <Icon name="plus" /> Sperren
          </Link>
        )}
      </header>

      <section className="karte flex flex-col gap-3">
        <h2 className="m-0 text-lg font-extrabold">Plan mit Karte</h2>
        <span className="text-sm text-leise">
          Für die Hundeschule: gesperrte Felder rot schraffiert, Weiden mit Tieren orange, dazu die Liste. Sperrungen der nächsten 14 Tage sind als «bald gesperrt» eingezeichnet.
        </span>
        <label className="feld-label">
          Stand am
          <input className="eingabe" type="date" value={stichtag} onChange={(e) => setStichtag(e.target.value || heuteIso())} />
        </label>
        <div className="flex gap-2">
          <button className="knopf flex-1" onClick={() => plan('pdf')} disabled={!!laeuft}>
            {laeuft === 'pdf' ? 'Erstelle …' : 'PDF'}
          </button>
          <button className="knopf-leise flex-1" onClick={() => plan('mail')} disabled={!!laeuft}>
            {laeuft === 'mail' ? 'Erstelle …' : 'Senden'}
          </button>
        </div>
        {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
      </section>

      <h2 className="m-0 text-lg font-extrabold">Aktuell und geplant</h2>
      {aktuell.length === 0 && <p className="karte m-0 text-leise">Zurzeit ist kein Feld gesperrt.</p>}
      {aktuell.map(karte)}

      {vorbei.length > 0 && (
        <button className="inline-flex min-h-10 items-center self-start text-sm font-bold text-hof" onClick={() => setAlteZeigen(!alteZeigen)}>
          {alteZeigen ? 'Aufgehobene ausblenden' : `Aufgehobene anzeigen (${vorbei.length})`}
        </button>
      )}
      {alteZeigen && vorbei.map(karte)}
    </div>
  );
}

export function SperrungFormular() {
  const { id } = useParams();
  const neu = !id || id === 'neu';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const darfErfassen = !!useAuth().profil;
  const sperrungen = useSperrungen();
  const felder = useFelder();
  const vorhanden = neu ? null : (sperrungen.data ?? []).find((s) => s.id === id);
  const [w, setW] = useState({ grund: '', von: heuteIso(), bis: '', bemerkungen: '' });
  const [wahl, setWahl] = useState<string[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  useEffect(() => {
    if (!vorhanden) return;
    setW({ grund: vorhanden.grund, von: vorhanden.von, bis: vorhanden.bis ?? '', bemerkungen: vorhanden.bemerkungen ?? '' });
    setWahl(vorhanden.sperrung_felder.map((x) => x.feld_id));
  }, [vorhanden]);

  const liste = (felder.data ?? [])
    .filter((f) => f.status !== 'aufgegeben')
    .sort((a, b) => a.feldnummer.localeCompare(b.feldnummer, 'de-CH', { numeric: true }));
  const fertig = () => {
    qc.invalidateQueries({ queryKey: ['sperrungen'] });
    navigate('/sperrungen');
  };

  async function speichern(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    if (!w.grund.trim()) return setFehler('Bitte den Grund angeben.');
    if (!wahl.length) return setFehler('Bitte mindestens ein Feld wählen.');
    if (w.bis && w.bis < w.von) return setFehler('Das Ende liegt vor dem Beginn.');
    setLaeuft(true);
    const { error } = await supabase.rpc('sperrung_speichern', { p: { id: neu ? null : id, ...w, fuer: FUER, felder: wahl } });
    setLaeuft(false);
    if (error) {
      const m = fehlertext(error);
      return setFehler(/sperrung_speichern/.test(m) ? 'Bitte zuerst Migration 32 in Supabase einspielen.' : m);
    }
    fertig();
  }

  async function beenden(loeschen: boolean) {
    if (loeschen && !confirm('Diese Sperrung ganz löschen?')) return;
    const { error } = await supabase.rpc('sperrung_beenden', { p_id: id, p_ende: loeschen ? null : heuteIso() });
    if (error) return setFehler(fehlertext(error));
    fertig();
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <Link to="/sperrungen" aria-label="Zurück" className="knopf-leise h-11 w-11 shrink-0 px-0">
          <Icon name="zurueck" />
        </Link>
        <h1 className="m-0 text-2xl font-extrabold text-hof">{neu ? 'Felder für die Hundeschule sperren' : 'Sperrung bearbeiten'}</h1>
      </header>

      <form onSubmit={speichern} className="flex flex-col gap-4">
        <fieldset disabled={!darfErfassen} className="m-0 flex flex-col gap-4 border-0 p-0">
          <section className="karte flex flex-col gap-3">
            <span className="feld-label">Grund</span>
            <div className="flex flex-wrap gap-2">
              {SPERRGRUENDE.map((g) => (
                <button
                  key={g}
                  type="button"
                  aria-pressed={w.grund === g}
                  onClick={() => setW({ ...w, grund: g })}
                  className={`min-h-10 rounded-full border-2 px-3 text-sm font-bold ${w.grund === g ? 'border-hof bg-hof text-white' : 'border-linie bg-white'}`}
                >
                  {g}
                </button>
              ))}
            </div>
            <input className="eingabe" value={w.grund} onChange={(e) => setW({ ...w, grund: e.target.value })} placeholder="oder eigener Grund" aria-label="Grund" />
            <div className="grid grid-cols-2 gap-3">
              <label className="feld-label">
                Gesperrt ab
                <input className="eingabe" type="date" value={w.von} onChange={(e) => setW({ ...w, von: e.target.value })} />
              </label>
              <label className="feld-label">
                bis (leer = bis auf Weiteres)
                <input className="eingabe" type="date" min={w.von} value={w.bis} onChange={(e) => setW({ ...w, bis: e.target.value })} />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              {[7, 14, 30].map((t) => (
                <button key={t} type="button" className="knopf-leise min-h-9 px-3 text-sm" onClick={() => setW({ ...w, bis: tagVerschieben(w.von, t - 1) })}>
                  {t} Tage
                </button>
              ))}
            </div>

          </section>

          <section className="karte flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="feld-label">Felder ({wahl.length})</span>
              {wahl.length > 0 && (
                <button type="button" className="inline-flex min-h-9 items-center text-sm font-bold text-hof" onClick={() => setWahl([])}>
                  Auswahl leeren
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {liste.map((f) => {
                const an = wahl.includes(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={an}
                    onClick={() => setWahl(an ? wahl.filter((x) => x !== f.id) : [...wahl, f.id])}
                    className={`flex min-h-11 items-center gap-2 rounded-full border-2 pl-1.5 pr-4 text-sm font-extrabold ${an ? 'border-fehler bg-fehler text-white' : 'border-linie bg-white text-text'}`}
                  >
                    <span className={`flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-xs ${an ? 'bg-white text-fehler' : 'bg-hof-hell text-hof'}`}>
                      {f.feldnummer}
                    </span>
                    {f.name}
                  </button>
                );
              })}
            </div>
          </section>

          <label className="feld-label karte">
            Bemerkung (steht im Plan)
            <input className="eingabe" value={w.bemerkungen} onChange={(e) => setW({ ...w, bemerkungen: e.target.value })} placeholder="z. B. Wegrand darf benutzt werden" />
          </label>

          {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
          {darfErfassen && (
            <button className="knopf" disabled={laeuft}>
              {laeuft ? 'Speichere …' : 'Speichern'}
            </button>
          )}
        </fieldset>
      </form>

      {!neu && vorhanden && darfErfassen && (
        <div className="flex flex-wrap gap-2">
          {istAktiv(vorhanden) && (
            <button className="knopf-leise flex-1" onClick={() => beenden(false)}>
              Heute aufheben
            </button>
          )}
          <button className="knopf-leise flex-1 text-fehler" onClick={() => beenden(true)}>
            Löschen
          </button>
        </div>
      )}
    </div>
  );
}

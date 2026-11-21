import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useBetrieb, useFelder, useHundeschule } from '../lib/daten';
import { ha, heuteIso } from '../lib/format';
import type { HundeschuleFeld } from '../lib/typen';
import { pdfHerunterladen, pdfPerMail, pdfPerWhatsapp } from '../lib/auftragPdf';

/**
 * Hundeschule: pro Feld einfach «frei» (grün) oder «gesperrt» (rot). Unabhängig vom Rest der App.
 * Felder ohne Eintrag gelten als gesperrt. Jede Änderung wird sofort gespeichert.
 */
export function HundeschuleSeite() {
  const qc = useQueryClient();
  const darf = !!useAuth().profil;
  const felder = useFelder();
  const status = useHundeschule();
  const betrieb = useBetrieb();
  const [notizOffen, setNotizOffen] = useState<string | null>(null);
  const [hinweis, setHinweis] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState<'' | 'pdf' | 'mail' | 'whatsapp'>('');

  useEffect(() => setHinweis(betrieb.data?.hundeschule_hinweis ?? ''), [betrieb.data?.hundeschule_hinweis]);

  const liste = (felder.data ?? [])
    .filter((f) => f.status !== 'aufgegeben')
    .sort((a, b) => a.feldnummer.localeCompare(b.feldnummer, 'de-CH', { numeric: true }));
  const st = (id: string) => status.data?.find((s) => s.feld_id === id);
  const anzahlFrei = liste.filter((f) => st(f.id)?.frei).length;

  async function setzen(p: { felder?: { feld_id: string; frei: boolean; bemerkung?: string }[]; hinweis?: string }) {
    setFehler(null);
    // sofort anzeigen, dann speichern
    if (p.felder)
      qc.setQueryData<HundeschuleFeld[] | null>(['hundeschule'], (alt) => {
        const m = new Map((alt ?? []).map((s) => [s.feld_id, s]));
        for (const x of p.felder!)
          m.set(x.feld_id, { feld_id: x.feld_id, frei: x.frei, bemerkung: x.bemerkung !== undefined ? x.bemerkung || null : (m.get(x.feld_id)?.bemerkung ?? null), geaendert_am: new Date().toISOString() });
        return [...m.values()];
      });
    const { error } = await supabase.rpc('hundeschule_setzen', { p });
    if (error) {
      const t = fehlertext(error);
      setFehler(/hundeschule_setzen/.test(t) ? 'Bitte zuerst Migration 33 in Supabase einspielen.' : t);
    }
    qc.invalidateQueries({ queryKey: ['hundeschule'] });
    if (p.hinweis !== undefined) qc.invalidateQueries({ queryKey: ['betrieb'] });
  }

  async function plan(wie: 'pdf' | 'mail' | 'whatsapp') {
    setFehler(null);
    setLaeuft(wie);
    try {
      const { hundeschulePdf } = await import('../lib/hundeschulePdf');
      const stand = heuteIso();
      const pdf = await hundeschulePdf({ betrieb: betrieb.data ?? null, felder: felder.data ?? [], status: status.data ?? [], stand });
      const name = `Hundeschule_Felder_${stand}.pdf`;
      if (wie === 'pdf') {
        const url = URL.createObjectURL(pdf);
        if (!window.open(url, '_blank')) pdfHerunterladen(pdf, name);
      } else if (wie === 'whatsapp') {
        const freiListe = liste.filter((f) => st(f.id)?.frei).map((f) => `${f.feldnummer} ${f.name}`);
        await pdfPerWhatsapp(
          pdf, name,
          `Hallo 🐕 Hier der aktuelle Plan vom ${stand.split('-').reverse().join('.')}: Frei sind ${freiListe.length ? freiListe.join(', ') : 'zurzeit keine Felder'}. Alle anderen Felder sind gesperrt (rot im Plan). Danke und viel Spass beim Training!${betrieb.data?.name ? ` – ${betrieb.data.name}` : ''}`,
        );
      } else
        await pdfPerMail(
          pdf, name, null, 'Hundeschule: freie und gesperrte Felder',
          `Grüezi\n\nIm Anhang der aktuelle Plan: grün = frei, rot = gesperrt.\n\nFreundliche Grüsse\n${betrieb.data?.name ?? ''}`,
        );
    } catch (e) {
      setFehler(`Plan konnte nicht erstellt werden: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLaeuft('');
    }
  }

  if (status.isSuccess && status.data === null)
    return (
      <div className="flex flex-col gap-4">
        <h1 className="m-0 text-3xl font-extrabold text-hof">Hundeschule</h1>
        <p className="karte m-0">Bitte zuerst Migration 33 in Supabase einspielen.</p>
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <header>
        <span className="text-sm font-semibold text-leise">Welche Felder die Hundeschule nutzen darf</span>
        <h1 className="m-0 text-3xl font-extrabold text-hof">Hundeschule</h1>
      </header>

      <section className="karte flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl bg-[#DCF3E2] p-2">
            <b className="block text-2xl text-[#15803D]">{anzahlFrei}</b>
            <span className="text-sm font-bold text-[#15803D]">frei</span>
          </div>
          <div className="rounded-xl bg-fehler-hell p-2">
            <b className="block text-2xl text-fehler">{liste.length - anzahlFrei}</b>
            <span className="text-sm font-bold text-fehler">gesperrt</span>
          </div>
        </div>
        <button className="knopf bg-[#25D366] text-white shadow-[0_3px_0_#128C4A]" onClick={() => plan('whatsapp')} disabled={!!laeuft}>
          {laeuft === 'whatsapp' ? 'Erstelle …' : 'Per WhatsApp senden'}
        </button>
        <div className="flex gap-2">
          <button className="knopf-leise flex-1" onClick={() => plan('pdf')} disabled={!!laeuft}>
            {laeuft === 'pdf' ? 'Erstelle …' : 'Plan (PDF)'}
          </button>
          <button className="knopf-leise flex-1" onClick={() => plan('mail')} disabled={!!laeuft}>
            {laeuft === 'mail' ? 'Erstelle …' : 'E-Mail'}
          </button>
        </div>
        <span className="text-xs text-leise">Plan mit Luftbild: freie Felder grün, gesperrte rot. Felder ohne Angabe gelten als gesperrt.</span>
      </section>

      {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="m-0 text-lg font-extrabold">Felder</h2>
            <span className="text-xs text-leise">Namen antippen für eine Bemerkung</span>
          </div>
          {darf && (
            <div className="flex gap-2">
              <button className="knopf-leise min-h-9 px-3 text-sm" onClick={() => setzen({ felder: liste.map((f) => ({ feld_id: f.id, frei: true })) })}>
                Alle frei
              </button>
              <button className="knopf-leise min-h-9 px-3 text-sm" onClick={() => setzen({ felder: liste.map((f) => ({ feld_id: f.id, frei: false })) })}>
                Alle sperren
              </button>
            </div>
          )}
        </div>
        {liste.map((f) => {
          const s = st(f.id);
          const frei = !!s?.frei;
          return (
            <div key={f.id} className={`karte flex flex-col gap-2 border-l-[6px] p-3 ${frei ? 'border-l-[#16A34A]' : 'border-l-fehler'}`}>
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-9 min-w-9 shrink-0 items-center justify-center rounded-full px-1.5 text-sm font-extrabold text-white ${frei ? 'bg-[#16A34A]' : 'bg-fehler'}`}
                >
                  {f.feldnummer}
                </span>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col text-left"
                  onClick={() => setNotizOffen(notizOffen === f.id ? null : f.id)}
                  aria-label={`${f.name}: Bemerkung`}
                >
                  <b className="line-clamp-2 leading-tight">{f.name}</b>
                  <span className={`text-xs ${s?.bemerkung ? 'font-semibold text-text' : 'text-leise'}`}>{s?.bemerkung || ha(Number(f.flaeche_m2))}</span>
                </button>
                <div className="grid shrink-0 grid-cols-2 overflow-hidden rounded-xl border-2 border-linie" role="group" aria-label={`${f.name}: frei oder gesperrt`}>
                  <button
                    type="button"
                    disabled={!darf}
                    aria-pressed={frei}
                    onClick={() => !frei && setzen({ felder: [{ feld_id: f.id, frei: true }] })}
                    className={`min-h-11 px-2.5 text-[13px] font-extrabold ${frei ? 'bg-[#16A34A] text-white' : 'bg-white text-leise'}`}
                  >
                    Frei
                  </button>
                  <button
                    type="button"
                    disabled={!darf}
                    aria-pressed={!frei}
                    onClick={() => frei && setzen({ felder: [{ feld_id: f.id, frei: false }] })}
                    className={`min-h-11 px-2.5 text-[13px] font-extrabold ${!frei ? 'bg-fehler text-white' : 'bg-white text-leise'}`}
                  >
                    Gesperrt
                  </button>
                </div>
              </div>
              {notizOffen === f.id && darf && (
                <Notiz
                  wert={s?.bemerkung ?? ''}
                  onSpeichern={(t) => {
                    setNotizOffen(null);
                    setzen({ felder: [{ feld_id: f.id, frei, bemerkung: t }] });
                  }}
                />
              )}
            </div>
          );
        })}
      </section>

      <label className="feld-label karte">
        Hinweis an die Hundeschule (steht im Plan)
        <textarea
          className="eingabe min-h-20 py-2"
          value={hinweis}
          disabled={!darf}
          onChange={(e) => setHinweis(e.target.value)}
          onBlur={() => hinweis !== (betrieb.data?.hundeschule_hinweis ?? '') && setzen({ hinweis })}
          placeholder="z. B. Bitte Hundekot aufnehmen, Autos beim Hof parkieren"
          maxLength={1000}
        />
      </label>
    </div>
  );
}

function Notiz({ wert, onSpeichern }: { wert: string; onSpeichern: (t: string) => void }) {
  const [t, setT] = useState(wert);
  return (
    <div className="flex gap-2">
      <input
        className="eingabe"
        value={t}
        onChange={(e) => setT(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSpeichern(t.trim())}
        placeholder="z. B. nur Wegrand, frisch gesät"
        maxLength={200}
        autoFocus
      />
      <button type="button" className="knopf shrink-0 px-4" onClick={() => onSpeichern(t.trim())}>
        OK
      </button>
    </div>
  );
}

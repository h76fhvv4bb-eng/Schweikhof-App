import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useFelder, useHinweise } from '../lib/daten';
import { ha, haZuM2 } from '../lib/format';
import { felderVereinigen, HINWEIS_FARBE } from '../lib/karte';
import { NUTZUNGSARTEN, type Feld, type FeldHinweis } from '../lib/typen';
import { Icon } from './Icon';

/** Wichtige Hinweise eines Feldes, z. B. «Achtung: 3 Metallschächte» */
export function FeldHinweise({ feldId, ohneRahmen }: { feldId: string; ohneRahmen?: boolean }) {
  const { profil } = useAuth();
  const qc = useQueryClient();
  const hinweise = useHinweise();
  const [text, setText] = useState('');
  const [art, setArt] = useState<FeldHinweis['art']>('Gefahr');
  const [fehler, setFehler] = useState<string | null>(null);
  const liste = (hinweise.data ?? []).filter((h) => h.feld_id === feldId);
  const darf = profil?.rolle !== 'lesen';

  async function hinzufuegen(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    if (!text.trim()) return;
    const { error } = await supabase.from('feld_hinweise').insert({ betrieb_id: profil!.betrieb_id, feld_id: feldId, art, text: text.trim() });
    if (error) return setFehler(fehlertext(error));
    setText('');
    qc.invalidateQueries({ queryKey: ['hinweise'] });
  }
  async function erledigen(h: FeldHinweis) {
    if (!confirm(`Hinweis «${h.text}» entfernen?`)) return;
    const { error } = await supabase.from('feld_hinweise').update({ aktiv: false, version: h.version }).eq('id', h.id);
    if (error) return setFehler(fehlertext(error));
    qc.invalidateQueries({ queryKey: ['hinweise'] });
  }

  return (
    <section className={ohneRahmen ? 'flex flex-col gap-2' : 'karte flex flex-col gap-2'}>
      {!ohneRahmen && <h2 className="m-0 text-lg font-extrabold">Hinweise zum Feld</h2>}
      {liste.length === 0 && !ohneRahmen && <p className="m-0 text-sm text-leise">Keine Hinweise. Hier gehören Gefahren wie Schächte, Leitungen oder Steine hin.</p>}
      <HinweisListe hinweise={liste} onEntfernen={darf ? erledigen : undefined} />
      {darf && (
        <form onSubmit={hinzufuegen} className="grid grid-cols-[110px_1fr_auto] gap-2">
          <select className="eingabe px-2" value={art} onChange={(e) => setArt(e.target.value as FeldHinweis['art'])} aria-label="Art">
            <option>Gefahr</option>
            <option>Hinweis</option>
            <option>Info</option>
          </select>
          <input className="eingabe" value={text} onChange={(e) => setText(e.target.value)} placeholder="z. B. Achtung: 3 Metallschächte" aria-label="Hinweis" />
          <button className="knopf h-12 w-12 px-0" aria-label="Hinweis hinzufügen">
            <Icon name="plus" />
          </button>
        </form>
      )}
      {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
    </section>
  );
}

export function HinweisListe({ hinweise, onEntfernen }: { hinweise: FeldHinweis[]; onEntfernen?: (h: FeldHinweis) => void }) {
  return (
    <>
      {hinweise.map((h) => (
        <div
          key={h.id}
          className="flex items-start gap-2 rounded-xl p-2.5 text-sm font-semibold"
          style={{ background: `${HINWEIS_FARBE[h.art]}1F`, color: h.art === 'Gefahr' ? '#8E2318' : h.art === 'Hinweis' ? '#5C3D00' : '#1E4566' }}
        >
          <Icon name="warnung" groesse={18} className="mt-0.5 shrink-0" />
          <span className="flex-1">
            <strong>{h.art}:</strong> {h.text}
            {h.breite != null && <span className="ml-1 text-xs opacity-80">(auf Karte markiert)</span>}
          </span>
          {onEntfernen && (
            <button onClick={() => onEntfernen(h)} className="text-xs font-bold opacity-70" aria-label={`Hinweis ${h.text} entfernen`}>
              ✕
            </button>
          )}
        </div>
      ))}
    </>
  );
}

/** Feld teilen (z. B. Teil wird Weide) oder mit anderen Feldern zusammenführen */
export function FeldTeilenZusammenfuehren({ feld }: { feld: Feld }) {
  const [modus, setModus] = useState<'teilen' | 'zusammen' | null>(null);
  return (
    <section className="karte flex flex-col gap-3">
      <h2 className="m-0 text-lg font-extrabold">Feld teilen oder zusammenführen</h2>
      <p className="m-0 text-sm text-leise">
        Zum Beispiel wenn ein Teil künftig Weide oder Grasland ist. Die bisherige Historie bleibt bei beiden Feldern sichtbar.
      </p>
      <div className="flex flex-wrap gap-2">
        <button className={modus === 'teilen' ? 'knopf' : 'knopf-leise'} onClick={() => setModus(modus === 'teilen' ? null : 'teilen')}>
          Teilen
        </button>
        <button className={modus === 'zusammen' ? 'knopf' : 'knopf-leise'} onClick={() => setModus(modus === 'zusammen' ? null : 'zusammen')}>
          Zusammenführen
        </button>
      </div>
      {modus === 'teilen' && <Teilen feld={feld} />}
      {modus === 'zusammen' && <Zusammenfuehren feld={feld} />}
    </section>
  );
}

function Teilen({ feld }: { feld: Feld }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(`${feld.name} Teil`);
  const [nutzung, setNutzung] = useState<string>(feld.nutzungsart === 'Ackerland' ? 'Weide' : feld.nutzungsart);
  const [flaeche, setFlaeche] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);

  async function teilen(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    const m2 = haZuM2(flaeche);
    if (!m2) return setFehler('Fläche des abgetrennten Teils in ha eingeben.');
    if (m2 >= Number(feld.flaeche_m2)) return setFehler('Der Teil muss kleiner sein als das Feld.');
    const { data, error } = await supabase.rpc('feld_teilen', {
      p_feld: feld.id, p_name: name.trim(), p_nutzungsart: nutzung, p_teil_m2: m2,
    });
    if (error) return setFehler(fehlertext(error));
    qc.invalidateQueries({ queryKey: ['felder'] });
    qc.invalidateQueries({ queryKey: ['anbau'] });
    qc.invalidateQueries({ queryKey: ['flaeche_je_kultur'] });
    navigate(`/felder/${data as string}`);
  }

  return (
    <form onSubmit={teilen} className="flex flex-col gap-3 rounded-2xl bg-grund p-3">
      {feld.geometrie && (
        <p className="m-0 text-sm">
          Dieses Feld hat eine Grenze auf der Karte. Am genauesten teilst du es dort:{' '}
          <Link to={`/felder?teilen=${feld.id}`} className="font-bold">
            Auf der Karte teilen
          </Link>
          . Hier ohne Karte geteilt, musst du die Grenzen danach neu zeichnen.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="feld-label">
          Name des neuen Teils
          <input className="eingabe" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="feld-label">
          Nutzung des Teils
          <select className="eingabe" value={nutzung} onChange={(e) => setNutzung(e.target.value)}>
            {NUTZUNGSARTEN.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className="feld-label">
          Fläche des Teils (ha)
          <input className="eingabe" inputMode="decimal" value={flaeche} onChange={(e) => setFlaeche(e.target.value)} placeholder="z. B. 0.8" />
        </label>
        <div className="feld-label">
          Bleibt bei «{feld.name}»
          <span className="flex min-h-12 items-center rounded-xl bg-white px-3 text-base font-extrabold text-text">
            {haZuM2(flaeche) ? ha(Number(feld.flaeche_m2) - haZuM2(flaeche)!) : ha(Number(feld.flaeche_m2))}
          </span>
        </div>
      </div>
      {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
      <button className="knopf">Feld teilen</button>
    </form>
  );
}

function Zusammenfuehren({ feld }: { feld: Feld }) {
  const qc = useQueryClient();
  const felder = useFelder();
  const [wahl, setWahl] = useState<string[]>([]);
  const [name, setName] = useState(feld.name);
  const [fehler, setFehler] = useState<string | null>(null);
  const andere = (felder.data ?? []).filter((f) => f.id !== feld.id && f.status !== 'aufgegeben');
  const gewaehlt = andere.filter((f) => wahl.includes(f.id));
  const alleMitGrenze = !!feld.geometrie && gewaehlt.every((f) => f.geometrie);
  const vereinigt = alleMitGrenze && gewaehlt.length ? felderVereinigen([feld.geometrie!, ...gewaehlt.map((f) => f.geometrie!)]) : null;
  const summe = Number(feld.flaeche_m2) + gewaehlt.reduce((s, f) => s + Number(f.flaeche_m2), 0);

  async function zusammenfuehren() {
    setFehler(null);
    if (!gewaehlt.length) return setFehler('Mindestens ein Feld wählen.');
    if (!confirm(`${gewaehlt.map((f) => f.name).join(', ')} in «${name}» zusammenführen?`)) return;
    const { error } = await supabase.rpc('felder_zusammenfuehren', {
      p_ziel: feld.id,
      p_andere: gewaehlt.map((f) => f.id),
      p_geometrie: vereinigt?.geometrie ?? null,
      p_flaeche_m2: vereinigt?.m2 ?? summe,
      p_name: name,
    });
    if (error) return setFehler(fehlertext(error));
    setWahl([]);
    qc.invalidateQueries({ queryKey: ['felder'] });
    qc.invalidateQueries({ queryKey: ['anbau'] });
    qc.invalidateQueries({ queryKey: ['flaeche_je_kultur'] });
    qc.invalidateQueries({ queryKey: ['hinweise'] });
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-grund p-3">
      <span className="text-sm font-bold">Welche Felder gehen in «{feld.name}» auf?</span>
      <div className="flex flex-wrap gap-2">
        {andere.map((f) => {
          const an = wahl.includes(f.id);
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={an}
              onClick={() => setWahl(an ? wahl.filter((x) => x !== f.id) : [...wahl, f.id])}
              className={`min-h-11 rounded-full border-2 px-4 text-sm font-extrabold ${an ? 'border-hof bg-hof text-white' : 'border-linie bg-white'}`}
            >
              {f.name} ({ha(Number(f.flaeche_m2), 1)})
            </button>
          );
        })}
      </div>
      <label className="feld-label">
        Name des zusammengeführten Feldes
        <input className="eingabe" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {gewaehlt.length > 0 && (
        <p className="m-0 text-sm">
          Neue Fläche: <strong>{ha(vereinigt?.m2 ?? summe)}</strong>
          {!alleMitGrenze && ' · Die Grenze muss danach auf der Karte neu gezeichnet werden.'}
        </p>
      )}
      {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
      <button className="knopf self-start" onClick={zusammenfuehren}>
        Zusammenführen
      </button>
    </div>
  );
}

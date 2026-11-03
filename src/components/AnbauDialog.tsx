import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useKulturen } from '../lib/daten';
import { ANBAUARTEN, ANBAUART_TEXT, type Anbau } from '../lib/typen';
import { zahlAus } from '../lib/format';

/** Anbau (Kultur je Feld und Jahr) mit Saat und Ernte planen oder bearbeiten */
export function AnbauDialog({
  eintrag,
  feldId,
  feldName,
  feldM2,
  jahr,
  art,
  onFertig,
}: {
  eintrag: Anbau | null;
  feldId: string;
  feldName: string;
  feldM2?: number;
  jahr: number;
  art?: Anbau['art'];
  onFertig: () => void;
}) {
  const { profil, darfVerwalten } = useAuth();
  const qc = useQueryClient();
  const kulturen = useKulturen();
  const aktuell = new Date().getFullYear();
  const [w, setW] = useState({
    kultur_id: eintrag?.kultur_id ?? '',
    art: eintrag?.art ?? art ?? 'Hauptkultur',
    jahr: String(eintrag?.jahr ?? jahr),
    status: eintrag?.status ?? (jahr <= aktuell ? 'ist' : 'geplant'),
    nur_monat: eintrag?.nur_monat ?? !eintrag,
    saat: eintrag?.saatdatum ?? '',
    ernte: eintrag?.erntedatum ?? '',
    bemerkungen: eintrag?.bemerkungen ?? '',
    sorte: eintrag?.sorte ?? '',
    teil_ha: eintrag?.flaeche_m2 ? String(Number(eintrag.flaeche_m2) / 10000) : '',
  });
  const [fehler, setFehler] = useState<string | null>(null);
  const monat = (d: string) => (d ? d.slice(0, 7) : '');
  const ausMonat = (m: string) => (m ? `${m}-01` : '');

  async function speichern() {
    setFehler(null);
    const j = Number(w.jahr);
    if (!w.kultur_id) return setFehler('Bitte eine Kultur wählen.');
    if (!Number.isInteger(j) || j < 1990 || j > 2100) return setFehler('Jahr ungültig.');
    if (w.saat && w.ernte && w.ernte < w.saat) return setFehler('Die Ernte kann nicht vor der Saat liegen.');
    const teil = zahlAus(w.teil_ha);
    if (w.teil_ha.trim() && (teil == null || teil <= 0)) return setFehler('Teilfläche in ha eingeben, z. B. 0.4');
    if (teil != null && feldM2 && teil * 10000 > feldM2) return setFehler('Die Teilfläche ist grösser als das Feld.');
    const daten = {
      kultur_id: w.kultur_id,
      art: w.art,
      jahr: j,
      status: w.status,
      nur_monat: w.nur_monat,
      saatdatum: w.saat || null,
      erntedatum: w.ernte || null,
      bemerkungen: w.bemerkungen.trim() || null,
      sorte: w.sorte.trim() || null,
      flaeche_m2: teil != null ? Math.round(teil * 10000) : null,
    };
    const { error } = eintrag
      ? await supabase.from('anbau').update({ ...daten, version: eintrag.version }).eq('id', eintrag.id)
      : await supabase.from('anbau').insert({ ...daten, betrieb_id: profil!.betrieb_id, feld_id: feldId });
    if (error) {
      if (error.message.includes('anbau_hauptkultur'))
        return setFehler(`Für ${j} hat dieses Feld schon eine Hauptkultur. Für eine weitere Kultur «Zweitkultur», «Zwischenkultur» oder «Untersaat» wählen.`);
      if (error.message.includes('anbau_kultur_je_jahr')) return setFehler(`Diese Kultur ist für ${j} auf diesem Feld schon als ${w.art} eingetragen.`);
      return setFehler(fehlertext(error));
    }
    ['anbau', 'flaeche_je_kultur', 'anbau-feld'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    onFertig();
  }

  async function loeschen() {
    if (!eintrag) return;
    if (eintrag.status === 'ist') return setFehler('Erfasste Ist-Kulturen werden nicht gelöscht. Bitte die Kultur korrigieren.');
    if (!confirm('Diese geplante Kultur entfernen?')) return;
    const { error } = await supabase.from('anbau').delete().eq('id', eintrag.id);
    if (error) return setFehler(fehlertext(error));
    ['anbau', 'flaeche_je_kultur', 'anbau-feld'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    onFertig();
  }

  const set = (k: keyof typeof w) => (e: { target: { value: string } }) => setW({ ...w, [k]: e.target.value });
  const gruppen = [...new Set((kulturen.data ?? []).map((k) => k.kulturgruppe))];

  return (
    <div className="fixed inset-0 z-[2000] flex items-end justify-center bg-black/30 p-3 md:items-center" onClick={onFertig}>
      <div className="karte flex max-h-[90dvh] w-full max-w-md flex-col gap-3 overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Kultur planen">
        <div className="flex items-start justify-between gap-2">
          <h2 className="m-0 text-xl font-extrabold">
            {feldName} · {w.jahr}
          </h2>
          <button className="h-11 w-11 text-leise" onClick={onFertig} aria-label="Schliessen">
            ✕
          </button>
        </div>
        <fieldset disabled={!darfVerwalten} className="m-0 flex flex-col gap-3 border-0 p-0">
          <div className="grid grid-cols-2 gap-3">
            <label className="feld-label col-span-2">
              Kultur
              <select className="eingabe" value={w.kultur_id} onChange={set('kultur_id')}>
                <option value="">– wählen –</option>
                {gruppen.map((g) => (
                  <optgroup key={g} label={g}>
                    {(kulturen.data ?? [])
                      .filter((k) => k.kulturgruppe === g)
                      .map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="feld-label col-span-2">
              Art
              <select className="eingabe" value={w.art} onChange={set('art')}>
                {ANBAUARTEN.map((a) => (
                  <option key={a} value={a}>
                    {ANBAUART_TEXT[a]}
                  </option>
                ))}
              </select>
            </label>
            <label className="feld-label">
              Anbaujahr
              <input className="eingabe" inputMode="numeric" value={w.jahr} onChange={set('jahr')} />
            </label>
            <label className="feld-label">
              Status
              <select className="eingabe" value={w.status} onChange={set('status')}>
                <option value="geplant">geplant</option>
                <option value="ist">ist (erfolgt)</option>
              </select>
            </label>
            <label className="flex min-h-12 items-end gap-2 pb-2 text-sm font-bold">
              <input type="checkbox" className="h-5 w-5 accent-hof" checked={w.nur_monat} onChange={(e) => setW({ ...w, nur_monat: e.target.checked })} />
              nur Monat
            </label>
            <label className="feld-label">
              Saat
              {w.nur_monat ? (
                <input className="eingabe" type="month" value={monat(w.saat)} onChange={(e) => setW({ ...w, saat: ausMonat(e.target.value) })} />
              ) : (
                <input className="eingabe" type="date" value={w.saat} onChange={set('saat')} />
              )}
            </label>
            <label className="feld-label">
              {w.art === 'Zwischenkultur' || w.art === 'Untersaat' ? 'Umbruch / Ende' : 'Ernte / Umbruch'}
              {w.nur_monat ? (
                <input className="eingabe" type="month" value={monat(w.ernte)} onChange={(e) => setW({ ...w, ernte: ausMonat(e.target.value) })} />
              ) : (
                <input className="eingabe" type="date" value={w.ernte} onChange={set('ernte')} />
              )}
            </label>
          </div>
          <label className="feld-label">
            Teilfläche (ha) – leer = ganzes Feld{feldM2 ? ` (${(feldM2 / 10000).toLocaleString('de-CH')} ha)` : ''}
            <input className="eingabe" inputMode="decimal" value={w.teil_ha} onChange={set('teil_ha')} placeholder="z. B. 0.4" />
          </label>
          <label className="feld-label">
            Sorte
            <input className="eingabe" value={w.sorte} onChange={set('sorte')} placeholder="z. B. Arina, Fabio" />
          </label>
          <label className="feld-label">
            Bemerkungen
            <input className="eingabe" value={w.bemerkungen} onChange={set('bemerkungen')} placeholder="z. B. Saatmenge, Besonderheiten" />
          </label>
        </fieldset>
        <p className="m-0 text-xs text-leise">
          Das Anbaujahr ist das Jahr der Hauptnutzung: Winterweizen, im Oktober gesät, zählt zum Erntejahr. Mehrjährige Kunstwiesen haben pro Jahr einen Eintrag. Pro Jahr gibt es eine Hauptkultur; weitere Kulturen (z. B. Silomais nach
          Grünschnittroggen, Kleegras-Untersaat, zwei Zwischenkulturen nacheinander oder zwei Kulturen auf Teilflächen) als Zweitkultur, Zwischenkultur oder
          Untersaat erfassen.
        </p>
        {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
        {darfVerwalten && (
          <div className="flex flex-wrap gap-2">
            <button className="knopf" onClick={speichern}>
              Speichern
            </button>
            {eintrag && (
              <button className="ml-auto text-sm font-bold text-fehler" onClick={loeschen}>
                Entfernen
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useMaschinen, useRichtpreise } from '../lib/daten';
import { chf, zahlAus } from '../lib/format';
import { RICHTPREIS_BEREICHE, type Richtpreis } from '../lib/typen';
import { VORLAGEN, type RichtpreisVorlage } from '../lib/richtpreisVorlagen';
import { csvHerunterladen, csvZahl } from '../lib/export';
import { Icon } from '../components/Icon';

const leer = { bereich: 'Dienstleistung' as Richtpreis['bereich'], bezeichnung: '', einheit: 'h', preis: '', quelle: '', jahr: String(new Date().getFullYear()), bemerkung: '' };

/** Richtpreis-Katalog: Maschinen, Dienstleistungen, Futter und Arbeit – aus Vorlagen oder selbst erfasst */
export function RichtpreiseSeite() {
  const { darfVerwalten, profil } = useAuth();
  const qc = useQueryClient();
  const preise = useRichtpreise();
  const maschinen = useMaschinen();
  const [suche, setSuche] = useState('');
  const [bereich, setBereich] = useState('');
  const [form, setForm] = useState<typeof leer & { id?: string; version?: number }>(leer);
  const [formOffen, setFormOffen] = useState(false);
  const [csvOffen, setCsvOffen] = useState(false);
  const [csv, setCsv] = useState('');
  const [meldung, setMeldung] = useState<{ text: string; fehler: boolean } | null>(null);
  const liste = (preise.data ?? []).filter(
    (r) => (!bereich || r.bereich === bereich) && `${r.bezeichnung} ${r.quelle ?? ''} ${r.bemerkung ?? ''}`.toLowerCase().includes(suche.toLowerCase()),
  );
  const genutzt = (id: string) => (maschinen.data ?? []).filter((m) => m.richtpreis_id === id).map((m) => m.name);

  const neuLaden = () => qc.invalidateQueries({ queryKey: ['richtpreise'] });
  const fehlerText = (e: unknown) => {
    const m = fehlertext(e);
    return /richtpreise/.test(m) && /exist|find|schema/i.test(m) ? 'Bitte zuerst Migration 23 in Supabase einspielen.' : m;
  };

  async function importieren(rows: RichtpreisVorlage[], text: string) {
    setMeldung(null);
    const { data, error } = await supabase.rpc('richtpreise_importieren', { p: { preise: rows } });
    if (error) return setMeldung({ text: fehlerText(error), fehler: true });
    setMeldung({ text: `${data as number} Preise ${text}.`, fehler: false });
    neuLaden();
  }

  /** CSV/Excel einfügen: Bereich; Bezeichnung; Einheit; Preis [; Quelle; Jahr; Bemerkung] – Semikolon oder Tab */
  function csvUebernehmen() {
    const zeilen = csv.split(/\r?\n/).map((z) => z.trim()).filter(Boolean);
    const rows: RichtpreisVorlage[] = [];
    for (const [i, z] of zeilen.entries()) {
      const t = z.split(/\t|;/).map((x) => x.trim().replace(/^"|"$/g, ''));
      if (i === 0 && /bezeichnung/i.test(z)) continue; // Kopfzeile
      const [b, bez, einh, preisText, quelle, jahr, bem] = t;
      const preis = zahlAus(preisText ?? '');
      const ber = RICHTPREIS_BEREICHE.find((x) => x.toLowerCase() === (b ?? '').toLowerCase()) ?? 'Andere';
      if (!bez || !einh || preis == null) return setMeldung({ text: `Zeile ${i + 1}: «${z}» – erwartet: Bereich; Bezeichnung; Einheit; Preis`, fehler: true });
      rows.push({ bereich: ber, bezeichnung: bez, einheit: einh, preis_chf: preis, quelle: quelle || null, jahr: jahr ? Number(jahr) || null : null, bemerkung: bem || null });
    }
    if (!rows.length) return setMeldung({ text: 'Keine Zeilen gefunden.', fehler: true });
    importieren(rows, 'übernommen').then(() => {
      setCsv('');
      setCsvOffen(false);
    });
  }

  async function speichern(e: FormEvent) {
    e.preventDefault();
    setMeldung(null);
    const preis = zahlAus(form.preis);
    if (!form.bezeichnung.trim() || !form.einheit.trim()) return setMeldung({ text: 'Bezeichnung und Einheit nötig.', fehler: true });
    if (preis == null || preis < 0) return setMeldung({ text: 'Preis ungültig.', fehler: true });
    const daten = {
      bereich: form.bereich, bezeichnung: form.bezeichnung.trim(), einheit: form.einheit.trim(), preis_chf: preis,
      quelle: form.quelle.trim() || null, jahr: form.jahr ? Number(form.jahr) || null : null, bemerkung: form.bemerkung.trim() || null,
    };
    const { error } = form.id
      ? await supabase.from('richtpreise').update({ ...daten, version: form.version }).eq('id', form.id)
      : await supabase.from('richtpreise').insert({ ...daten, betrieb_id: profil!.betrieb_id });
    if (error) return setMeldung({ text: fehlerText(error), fehler: true });
    setForm(leer);
    setFormOffen(false);
    neuLaden();
  }

  async function loeschen(r: Richtpreis) {
    if (!confirm(`«${r.bezeichnung}» löschen?`)) return;
    const { error } = await supabase.from('richtpreise').delete().eq('id', r.id);
    if (error) return setMeldung({ text: fehlerText(error), fehler: true });
    neuLaden();
  }

  function exportieren() {
    csvHerunterladen(
      'Richtpreise.csv',
      'Richtpreise',
      ['Bereich', 'Bezeichnung', 'Einheit', 'Preis CHF', 'Quelle', 'Jahr', 'Bemerkung'],
      (preise.data ?? []).map((r) => [r.bereich, r.bezeichnung, r.einheit, csvZahl(r.preis_chf), r.quelle ?? '', r.jahr ?? '', r.bemerkung ?? '']),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-leise">Maschinen, Dienstleistungen, Futter und Arbeit</span>
          <h1 className="m-0 text-3xl font-extrabold text-hof">Richtpreise</h1>
        </div>
        {darfVerwalten && (
          <div className="flex flex-wrap gap-2">
            {(preise.data ?? []).length > 0 && (
              <button className="knopf-leise" onClick={exportieren}>
                Export (CSV)
              </button>
            )}
            <button className="knopf-leise" onClick={() => setCsvOffen(!csvOffen)}>
              CSV einfügen
            </button>
            <button
              className="knopf"
              onClick={() => {
                setForm(leer);
                setFormOffen(true);
              }}
            >
              <Icon name="plus" /> Eigener Preis
            </button>
          </div>
        )}
      </header>

      {darfVerwalten && (
        <section className="karte flex flex-col gap-2">
          <h2 className="m-0 text-lg font-extrabold">Vorlagen übernehmen</h2>
          <span className="text-sm text-leise">
            Richtwerte aus öffentlich zugänglichen Schweizer Quellen. Nach der Übernahme kannst du jeden Preis anpassen. Den vollständigen Katalog mit Geräten
            (z. B. Pflug, Kreiselegge, Pressen je Ballen) bietet Agroscope unter kostenkatalog.ch an; ihn kannst du mit «CSV einfügen» übernehmen.
          </span>
          {VORLAGEN.map((v) => (
            <div key={v.titel} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-grund p-3">
              <span className="flex min-w-0 flex-col">
                <span className="font-extrabold">{v.titel}</span>
                <span className="text-xs text-leise">
                  {v.beschreibung} {v.preise.length} Preise.
                </span>
              </span>
              <button className="knopf-leise min-h-10" onClick={() => importieren(v.preise, 'übernommen')}>
                Übernehmen
              </button>
            </div>
          ))}
        </section>
      )}

      {csvOffen && (
        <section className="karte flex flex-col gap-2">
          <h2 className="m-0 text-lg font-extrabold">CSV oder Excel einfügen</h2>
          <span className="text-sm text-leise">
            Eine Zeile je Preis, Spalten mit Semikolon oder Tabulator (direkt aus Excel kopiert): Bereich; Bezeichnung; Einheit; Preis; Quelle; Jahr; Bemerkung.
            Bereich ist Maschine, Dienstleistung, Futter, Arbeit oder Andere. Gleiche Bezeichnung und Einheit werden aktualisiert.
          </span>
          <textarea
            className="eingabe min-h-32 py-2 font-mono text-xs"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={'Dienstleistung;Pressen Rundballen;Ballen;14;Lohnunternehmer Muster;2026\nMaschine;Kreiselegge 3 m;ha;45;Kostenkatalog;2025'}
          />
          <button className="knopf self-start" onClick={csvUebernehmen} disabled={!csv.trim()}>
            Übernehmen
          </button>
        </section>
      )}

      {formOffen && (
        <form onSubmit={speichern} className="karte flex flex-col gap-3">
          <h2 className="m-0 text-lg font-extrabold">{form.id ? 'Preis bearbeiten' : 'Eigener Preis'}</h2>
          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <label className="feld-label">
              Bereich
              <select className="eingabe" value={form.bereich} onChange={(e) => setForm({ ...form, bereich: e.target.value as Richtpreis['bereich'] })}>
                {RICHTPREIS_BEREICHE.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </label>
            <label className="feld-label">
              Bezeichnung
              <input className="eingabe" value={form.bezeichnung} onChange={(e) => setForm({ ...form, bezeichnung: e.target.value })} placeholder="z. B. Pressen Rundballen" />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="feld-label">
              Preis CHF
              <input className="eingabe" inputMode="decimal" value={form.preis} onChange={(e) => setForm({ ...form, preis: e.target.value })} />
            </label>
            <label className="feld-label">
              je Einheit
              <input className="eingabe" list="rp-einheiten" value={form.einheit} onChange={(e) => setForm({ ...form, einheit: e.target.value })} />
              <datalist id="rp-einheiten">
                {['h', 'ha', 'Ballen', 'dt', 't', 'm3', 'km', 'Stk', 'Pauschal', 'Akh'].map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
            </label>
            <label className="feld-label">
              Jahr
              <input className="eingabe" inputMode="numeric" value={form.jahr} onChange={(e) => setForm({ ...form, jahr: e.target.value })} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="feld-label">
              Quelle
              <input className="eingabe" value={form.quelle} onChange={(e) => setForm({ ...form, quelle: e.target.value })} placeholder="z. B. eigener Ansatz, LU Muster" />
            </label>
            <label className="feld-label">
              Bemerkung
              <input className="eingabe" value={form.bemerkung} onChange={(e) => setForm({ ...form, bemerkung: e.target.value })} placeholder="z. B. inkl. Fahrer" />
            </label>
          </div>
          <div className="flex gap-2">
            <button className="knopf flex-1">Speichern</button>
            <button type="button" className="knopf-leise" onClick={() => setFormOffen(false)}>
              Abbrechen
            </button>
          </div>
        </form>
      )}

      {meldung && <p className={`m-0 rounded-xl p-3 text-sm font-semibold ${meldung.fehler ? 'bg-fehler-hell text-fehler' : 'bg-hof-hell text-hof'}`}>{meldung.text}</p>}

      <section className="karte flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <input className="eingabe min-w-48 flex-1" placeholder="Suchen" value={suche} onChange={(e) => setSuche(e.target.value)} />
          <select className="eingabe" value={bereich} onChange={(e) => setBereich(e.target.value)} aria-label="Bereich">
            <option value="">Alle Bereiche</option>
            {RICHTPREIS_BEREICHE.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </div>
        {preise.isSuccess && !(preise.data ?? []).length && (
          <p className="m-0 text-sm text-leise">Noch keine Richtpreise. Übernimm eine Vorlage oder erfasse eigene Preise.</p>
        )}
        {RICHTPREIS_BEREICHE.filter((b) => liste.some((r) => r.bereich === b)).map((b) => (
          <div key={b} className="flex flex-col">
            <h3 className="m-0 mb-1 mt-2 text-sm font-extrabold text-leise">{b}</h3>
            {liste
              .filter((r) => r.bereich === b)
              .map((r) => (
                <div key={r.id} className="flex items-center gap-2 border-b border-rand py-2 last:border-0">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-bold">{r.bezeichnung}</span>
                    <span className="text-xs text-leise">
                      {[r.quelle, r.jahr, r.bemerkung].filter(Boolean).join(' · ')}
                      {genutzt(r.id).length > 0 && ` · Ansatz für ${genutzt(r.id).join(', ')}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-right font-extrabold">
                    {chf(r.preis_chf)}
                    <span className="block text-xs font-semibold text-leise">je {r.einheit}</span>
                  </span>
                  {darfVerwalten && (
                    <>
                      <button
                        className="knopf-leise h-10 px-2 text-xs"
                        onClick={() => {
                          setForm({
                            id: r.id, version: r.version, bereich: r.bereich, bezeichnung: r.bezeichnung, einheit: r.einheit, preis: String(r.preis_chf),
                            quelle: r.quelle ?? '', jahr: r.jahr ? String(r.jahr) : '', bemerkung: r.bemerkung ?? '',
                          });
                          setFormOffen(true);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                      >
                        Ändern
                      </button>
                      <button className="h-10 w-8 text-fehler" aria-label={`${r.bezeichnung} löschen`} onClick={() => loeschen(r)}>
                        ×
                      </button>
                    </>
                  )}
                </div>
              ))}
          </div>
        ))}
      </section>
      <p className="m-0 text-xs text-leise">
        Richtpreise sind Orientierungswerte. In der Praxis gelten die vereinbarten Preise; Rüst-, Weg- und Wartezeiten sind in den Agroscope-Ansätzen nicht
        enthalten.
      </p>
    </div>
  );
}

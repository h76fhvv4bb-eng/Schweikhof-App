import { useEffect, useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useBeweidungen, useBetrieb, useFelder, useMaschinen, useMitarbeiter, usePartner } from '../lib/daten';
import { useAuth } from '../lib/auth';
import { ibanGueltig, istQrIban } from '../lib/belegPdf';
import { ha } from '../lib/format';
import { aktiv } from '../lib/weide';
import { NUTZUNGSARTEN } from '../lib/typen';

const KANTONE = ['AG', 'AI', 'AR', 'BE', 'BL', 'BS', 'FR', 'GE', 'GL', 'GR', 'JU', 'LU', 'NE', 'NW', 'OW', 'SG', 'SH', 'SO', 'SZ', 'TG', 'TI', 'UR', 'VD', 'VS', 'ZG', 'ZH'];

/** Betriebsverwaltung: alle Angaben des Betriebs auf einen Blick, bearbeitbar für Administratoren */
export function BetriebSeite() {
  const { profil } = useAuth();
  const admin = profil?.rolle === 'administrator';
  const betrieb = useBetrieb();
  const felder = useFelder();
  const maschinen = useMaschinen();
  const mitarbeiter = useMitarbeiter();
  const partner = usePartner();
  const weiden = useBeweidungen();
  const [bearbeiten, setBearbeiten] = useState(false);
  const b = betrieb.data;

  const bewirtschaftet = (felder.data ?? []).filter((f) => f.status === 'bewirtschaftet');
  const totalM2 = bewirtschaftet.reduce((s, f) => s + Number(f.flaeche_m2), 0);
  const jeNutzung = NUTZUNGSARTEN.map((n) => ({ n, m2: bewirtschaftet.filter((f) => f.nutzungsart === n).reduce((s, f) => s + Number(f.flaeche_m2), 0) })).filter((x) => x.m2 > 0);
  const adresse = b?.plz && b?.ort ? `${[b.strasse, b.hausnummer].filter(Boolean).join(' ')}, ${b.plz} ${b.ort}` : b?.adresse?.replace(/\n/g, ', ');
  const fehlt = [!b?.betriebsnummer && 'Betriebsnummer', !b?.bewirtschafter && 'Bewirtschafter/in', !(b?.plz && b?.ort) && 'Adresse', !b?.iban && 'IBAN'].filter(Boolean) as string[];

  const zeile = (titel: string, wert: string | null | undefined) => (
    <div className="flex flex-col border-b border-rand py-2 last:border-0 sm:flex-row sm:gap-3">
      <span className="text-xs font-bold text-leise sm:w-40 sm:shrink-0 sm:pt-0.5">{titel}</span>
      <span className={`font-semibold ${wert ? '' : 'text-leise'}`}>{wert || '–'}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-leise">Betriebsverwaltung</span>
          <h1 className="m-0 text-3xl font-extrabold text-hof">{b?.name ?? 'Betrieb'}</h1>
        </div>
        {admin && !bearbeiten && (
          <button className="knopf" onClick={() => setBearbeiten(true)}>
            Bearbeiten
          </button>
        )}
      </header>

      {fehlt.length > 0 && !bearbeiten && (
        <p className="m-0 rounded-xl bg-warn-hell p-3 text-sm font-semibold text-[#5C3D00]">
          Noch nicht erfasst: {fehlt.join(', ')}. {fehlt.includes('Betriebsnummer') && 'Die Betriebsnummer erscheint auf allen PDFs und Exporten.'}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['Fläche', ha(totalM2), '/felder'],
          ['Felder', String(bewirtschaftet.length), '/felder'],
          ['Maschinen', String((maschinen.data ?? []).filter((m) => m.status === 'in Betrieb').length), '/maschinen'],
          ['Weidegäste aktiv', String((weiden.data ?? []).filter(aktiv).length), '/weide'],
        ].map(([t, w, l]) => (
          <Link key={t} to={l} className="karte flex flex-col p-3 text-text no-underline">
            <span className="text-xs font-bold text-leise">{t}</span>
            <span className="text-2xl font-extrabold">{w}</span>
          </Link>
        ))}
      </div>

      {bearbeiten && b ? (
        <BetriebFormular onFertig={() => setBearbeiten(false)} />
      ) : (
        <>
          <section className="karte flex flex-col">
            <h2 className="m-0 mb-1 text-lg font-extrabold">Angaben</h2>
            {zeile('Betriebsnummer', b?.betriebsnummer)}
            {zeile('Bewirtschafter/in', b?.bewirtschafter)}
            {zeile('Adresse', adresse)}
            {zeile('Gemeinde / Kanton', [b?.gemeinde, b?.kanton].filter(Boolean).join(' / '))}
            {zeile('Telefon', b?.telefon)}
            {zeile('E-Mail', b?.email)}
            {zeile('Website', b?.website)}
          </section>
          <section className="karte flex flex-col">
            <h2 className="m-0 mb-1 text-lg font-extrabold">Bank und Rechnungen</h2>
            {zeile('IBAN', b?.iban ? b.iban.replace(/(.{4})/g, '$1 ').trim() : null)}
            {zeile('Bank', b?.bank)}
            {zeile('MWST-Nr.', b?.mwst_nr)}
            {zeile('Zahlungsfrist', b?.zahlungsfrist_tage != null ? `${b.zahlungsfrist_tage} Tage` : null)}
          </section>
        </>
      )}

      <section className="karte flex flex-col gap-2">
        <h2 className="m-0 text-lg font-extrabold">Flächen nach Nutzung</h2>
        {jeNutzung.map((x) => (
          <div key={x.n} className="flex items-center gap-3 text-sm">
            <span className="w-32 shrink-0 font-bold">{x.n}</span>
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-grund">
              <div className="h-full bg-hof" style={{ width: `${(x.m2 / Math.max(totalM2, 1)) * 100}%` }} />
            </div>
            <span className="w-20 text-right font-extrabold">{ha(x.m2)}</span>
          </div>
        ))}
        {!jeNutzung.length && <span className="text-sm text-leise">Noch keine Felder.</span>}
      </section>

      <section className="karte flex flex-wrap gap-3 text-sm font-bold">
        <Link to="/mitarbeiter">Mitarbeitende ({(mitarbeiter.data ?? []).filter((m) => m.aktiv).length})</Link>
        <Link to="/partner">Partner ({(partner.data ?? []).filter((p) => p.aktiv).length})</Link>
        {admin && <Link to="/benutzer">Benutzer verwalten</Link>}
        <Link to="/kontrolle">Kontrolle und Unterlagen</Link>
      </section>
    </div>
  );
}

function BetriebFormular({ onFertig }: { onFertig: () => void }) {
  const betrieb = useBetrieb();
  const qc = useQueryClient();
  const leer = { betriebsnummer: '', name: '', bewirtschafter: '', strasse: '', hausnummer: '', plz: '', ort: '', gemeinde: '', kanton: 'ZH', telefon: '', email: '', website: '', iban: '', bank: '', mwst_nr: '', frist: '30' };
  const [w, setW] = useState(leer);
  const [fehler, setFehler] = useState<string | null>(null);
  useEffect(() => {
    const b = betrieb.data;
    if (!b) return;
    // Alte Freitext-Adresse («Strasse Nr.\nPLZ Ort») als Vorschlag zerlegen
    const zeilen = (b.adresse ?? '').split('\n');
    const s1 = zeilen[0]?.match(/^(.*?)\s+(\d+\w*)$/);
    const s2 = zeilen[1]?.match(/^(\d{4})\s+(.+)$/);
    setW({
      betriebsnummer: b.betriebsnummer ?? '',
      name: b.name,
      bewirtschafter: b.bewirtschafter ?? '',
      strasse: b.strasse ?? s1?.[1] ?? zeilen[0] ?? '',
      hausnummer: b.hausnummer ?? s1?.[2] ?? '',
      plz: b.plz ?? s2?.[1] ?? '',
      ort: b.ort ?? s2?.[2] ?? '',
      gemeinde: b.gemeinde ?? '',
      kanton: b.kanton ?? 'ZH',
      telefon: b.telefon ?? '',
      email: b.email ?? '',
      website: b.website ?? '',
      iban: b.iban ? b.iban.replace(/(.{4})/g, '$1 ').trim() : '',
      bank: b.bank ?? '',
      mwst_nr: b.mwst_nr ?? '',
      frist: String(b.zahlungsfrist_tage ?? 30),
    });
  }, [betrieb.data]);

  async function speichern(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    if (!betrieb.data) return;
    if (!w.name.trim()) return setFehler('Name des Betriebs fehlt.');
    const iban = w.iban.replace(/\s/g, '').toUpperCase();
    if (iban && !ibanGueltig(iban)) return setFehler('Die IBAN ist ungültig (nur CH/LI). Bitte prüfen.');
    if (iban && istQrIban(iban)) return setFehler('Das ist eine QR-IBAN. Bitte die normale IBAN des Kontos eintragen.');
    if (w.plz && !/^\d{4}$/.test(w.plz.trim())) return setFehler('PLZ: vier Ziffern.');
    if (w.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(w.email.trim())) return setFehler('E-Mail-Adresse ungültig.');
    const frist = Number(w.frist);
    if (!Number.isInteger(frist) || frist < 0 || frist > 120) return setFehler('Zahlungsfrist: 0 bis 120 Tage.');
    const t = (x: string) => x.trim() || null;
    const adresse = [[w.strasse.trim(), w.hausnummer.trim()].filter(Boolean).join(' '), [w.plz.trim(), w.ort.trim()].filter(Boolean).join(' ')].filter(Boolean).join('\n');
    const { error } = await supabase
      .from('betriebe')
      .update({
        betriebsnummer: t(w.betriebsnummer), name: w.name.trim(), bewirtschafter: t(w.bewirtschafter), adresse: adresse || null,
        strasse: t(w.strasse), hausnummer: t(w.hausnummer), plz: t(w.plz), ort: t(w.ort), gemeinde: t(w.gemeinde), kanton: w.kanton,
        telefon: t(w.telefon), email: t(w.email), website: t(w.website), iban: iban || null, bank: t(w.bank), mwst_nr: t(w.mwst_nr),
        zahlungsfrist_tage: frist, version: betrieb.data.version,
      })
      .eq('id', betrieb.data.id);
    if (error) {
      const m = fehlertext(error);
      return setFehler(/bewirtschafter|gemeinde|bank|website/.test(m) ? 'Bitte zuerst Migration 18 in Supabase einspielen.' : m);
    }
    await qc.invalidateQueries({ queryKey: ['betrieb'] });
    onFertig();
  }

  const set = (k: keyof typeof w) => (e: { target: { value: string } }) => setW({ ...w, [k]: e.target.value });
  const feld = (k: keyof typeof w, titel: string, extra: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="feld-label">
      {titel}
      <input className="eingabe" value={w[k]} onChange={set(k)} {...extra} />
    </label>
  );

  return (
    <form onSubmit={speichern} className="flex flex-col gap-4">
      <section className="karte flex flex-col gap-3">
        <h2 className="m-0 text-lg font-extrabold">Betrieb</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
          {feld('name', 'Name des Betriebs')}
          {feld('betriebsnummer', 'Betriebsnummer', { placeholder: 'z. B. 0004/1/71' })}
        </div>
        {feld('bewirtschafter', 'Bewirtschafter/in')}
        <div className="grid grid-cols-[1fr_90px] gap-3">
          {feld('strasse', 'Strasse')}
          {feld('hausnummer', 'Nr.')}
        </div>
        <div className="grid grid-cols-[90px_1fr] gap-3">
          {feld('plz', 'PLZ', { inputMode: 'numeric' })}
          {feld('ort', 'Ort')}
        </div>
        <div className="grid grid-cols-[1fr_110px] gap-3">
          {feld('gemeinde', 'Politische Gemeinde')}
          <label className="feld-label">
            Kanton
            <select className="eingabe" value={w.kanton} onChange={set('kanton')}>
              {KANTONE.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {feld('telefon', 'Telefon', { type: 'tel' })}
          {feld('email', 'E-Mail', { type: 'email' })}
          {feld('website', 'Website')}
        </div>
      </section>
      <section className="karte flex flex-col gap-3">
        <h2 className="m-0 text-lg font-extrabold">Bank und Rechnungen</h2>
        <span className="text-sm text-leise">Für die QR-Rechnung braucht es Adresse (PLZ und Ort) und IBAN.</span>
        {feld('iban', 'IBAN', { placeholder: 'CH00 0000 0000 0000 0000 0', autoComplete: 'off' })}
        {feld('bank', 'Bank (Name)')}
        <div className="grid grid-cols-2 gap-3">
          {feld('mwst_nr', 'MWST-Nr. (falls vorhanden)', { placeholder: 'CHE-123.456.789 MWST' })}
          {feld('frist', 'Zahlungsfrist (Tage)', { inputMode: 'numeric' })}
        </div>
      </section>
      {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
      <div className="flex gap-2">
        <button className="knopf flex-1">Speichern</button>
        <button type="button" className="knopf-leise" onClick={onFertig}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}

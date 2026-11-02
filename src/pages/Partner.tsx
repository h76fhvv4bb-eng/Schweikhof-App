import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useAuftraege, useErnten, useFelder, usePartner } from '../lib/daten';
import { AuftragStatus } from './Auftraege';
import { chf, datum } from '../lib/format';
import { PARTNERARTEN, type Partner } from '../lib/typen';
import { Icon } from '../components/Icon';

export function PartnerListe() {
  const { darfVerwalten } = useAuth();
  const partner = usePartner();
  const [art, setArt] = useState('');
  const liste = (partner.data ?? []).filter((p) => p.aktiv && (!art || p.art === art));
  const arten = [...new Set((partner.data ?? []).map((p) => p.art))];

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-end justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-leise">{liste.length} Kontakte</span>
          <h1 className="m-0 text-3xl font-extrabold text-hof">Partner</h1>
        </div>
        {darfVerwalten && (
          <Link to="/partner/neu" className="knopf no-underline">
            <Icon name="plus" /> Partner
          </Link>
        )}
      </header>
      {arten.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {['', ...arten].map((a) => (
            <button
              key={a || 'alle'}
              onClick={() => setArt(a)}
              aria-pressed={art === a}
              className={`min-h-10 rounded-full border-2 px-3 text-sm font-bold ${art === a ? 'border-hof bg-hof text-white' : 'border-linie bg-white'}`}
            >
              {a || 'Alle'}
            </button>
          ))}
        </div>
      )}
      {partner.isSuccess && liste.length === 0 && (
        <p className="karte m-0 text-leise">Noch keine Partner. Erfasse hier Lohnunternehmen, Mechaniker, Händler und weitere Kontakte.</p>
      )}
      {liste.map((p) => (
        <div key={p.id} className="karte flex items-center gap-3 p-3">
          <Link to={`/partner/${p.id}`} className="flex min-w-0 flex-1 flex-col text-text no-underline">
            <span className="truncate font-extrabold">{p.name}</span>
            <span className="text-xs text-leise">
              {p.art}
              {p.kontaktperson && ` · ${p.kontaktperson}`}
              {p.leistungen && ` · ${p.leistungen}`}
            </span>
          </Link>
          {(p.mobile || p.telefon) && (
            <a href={`tel:${(p.mobile || p.telefon)!.replace(/\s/g, '')}`} className="knopf h-11 w-11 px-0" aria-label={`${p.name} anrufen`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
              </svg>
            </a>
          )}
          {p.email && (
            <a href={`mailto:${p.email}`} className="knopf-leise h-11 w-11 px-0" aria-label={`${p.name} E-Mail schreiben`}>
              @
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

const leer = (s: string) => (s.trim() === '' ? null : s.trim());

export function PartnerFormular() {
  const { id } = useParams();
  const neu = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profil, darfVerwalten } = useAuth();
  const partner = usePartner();
  const p = partner.data?.find((x) => x.id === id);
  const [w, setW] = useState({
    name: '', art: 'Lohnunternehmen' as Partner['art'], kontaktperson: '', telefon: '', mobile: '', email: '', adresse: '', leistungen: '', bemerkungen: '',
  });
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    if (p)
      setW({
        name: p.name, art: p.art, kontaktperson: p.kontaktperson ?? '', telefon: p.telefon ?? '', mobile: p.mobile ?? '',
        email: p.email ?? '', adresse: p.adresse ?? '', leistungen: p.leistungen ?? '', bemerkungen: p.bemerkungen ?? '',
      });
  }, [p]);

  async function speichern(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    if (!w.name.trim()) return setFehler('Name fehlt.');
    if (w.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(w.email.trim())) return setFehler('E-Mail-Adresse ungültig.');
    const daten = {
      name: w.name.trim(), art: w.art, kontaktperson: leer(w.kontaktperson), telefon: leer(w.telefon), mobile: leer(w.mobile),
      email: leer(w.email), adresse: leer(w.adresse), leistungen: leer(w.leistungen), bemerkungen: leer(w.bemerkungen),
    };
    const { error } = neu
      ? await supabase.from('partner').insert({ ...daten, betrieb_id: profil!.betrieb_id })
      : await supabase.from('partner').update({ ...daten, version: p!.version }).eq('id', id!);
    if (error) return setFehler(fehlertext(error));
    qc.invalidateQueries({ queryKey: ['partner'] });
    navigate('/partner');
  }

  async function archivieren() {
    if (!p || !confirm(`«${p.name}» archivieren? Bestehende Einträge bleiben verknüpft.`)) return;
    const { error } = await supabase.from('partner').update({ aktiv: false, version: p.version }).eq('id', p.id);
    if (error) return setFehler(fehlertext(error));
    qc.invalidateQueries({ queryKey: ['partner'] });
    navigate('/partner');
  }

  const set = (k: keyof typeof w) => (e: { target: { value: string } }) => setW({ ...w, [k]: e.target.value });
  if (!neu && partner.isSuccess && !p) return <p>Partner nicht gefunden.</p>;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <Link to="/partner" aria-label="Zurück" className="knopf-leise h-11 w-11 px-0">
          <Icon name="zurueck" />
        </Link>
        <h1 className="m-0 text-2xl font-extrabold text-hof">{neu ? 'Neuer Partner' : w.name}</h1>
      </header>
      <form onSubmit={speichern} className="karte flex flex-col gap-3">
        <fieldset disabled={!darfVerwalten} className="m-0 flex flex-col gap-3 border-0 p-0">
          <label className="feld-label">
            Name / Firma
            <input className="eingabe" required value={w.name} onChange={set('name')} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="feld-label">
              Art
              <select className="eingabe" value={w.art} onChange={set('art')}>
                {PARTNERARTEN.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
            <label className="feld-label">
              Kontaktperson
              <input className="eingabe" value={w.kontaktperson} onChange={set('kontaktperson')} />
            </label>
            <label className="feld-label">
              Telefon
              <input className="eingabe" type="tel" value={w.telefon} onChange={set('telefon')} />
            </label>
            <label className="feld-label">
              Mobile
              <input className="eingabe" type="tel" value={w.mobile} onChange={set('mobile')} />
            </label>
          </div>
          <label className="feld-label">
            E-Mail
            <input className="eingabe" type="email" value={w.email} onChange={set('email')} />
          </label>
          <label className="feld-label">
            Adresse
            <textarea className="eingabe min-h-16 py-2" value={w.adresse} onChange={set('adresse')} />
          </label>
          <label className="feld-label">
            Leistungen
            <input className="eingabe" value={w.leistungen} onChange={set('leistungen')} placeholder="z. B. Mähdrescher, Pressen, Traktorservice" />
          </label>
          <label className="feld-label">
            Bemerkungen
            <textarea className="eingabe min-h-16 py-2" value={w.bemerkungen} onChange={set('bemerkungen')} />
          </label>
        </fieldset>
        {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
        {darfVerwalten && <button className="knopf">Speichern</button>}
        {darfVerwalten && !neu && (
          <button type="button" className="self-start text-sm font-bold text-fehler" onClick={archivieren}>
            Archivieren
          </button>
        )}
      </form>
      {p && <PartnerAuftraege partnerId={p.id} art={p.art} />}
      {p && <PartnerAbnahmen partnerId={p.id} />}
    </div>
  );
}

function PartnerAuftraege({ partnerId, art }: { partnerId: string; art: Partner['art'] }) {
  const { darfVerwalten } = useAuth();
  const auftraege = useAuftraege();
  const liste = (auftraege.data ?? []).filter((a) => a.partner_id === partnerId);
  const neueArt = art === 'Mechaniker/Werkstatt' ? 'Werkstatt' : 'Lohnarbeit';
  return (
    <section className="karte flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-lg font-extrabold">Aufträge</h2>
        {darfVerwalten && (
          <Link to={`/auftraege/neu?art=${neueArt}&partner=${partnerId}`} className="knopf no-underline">
            <Icon name="plus" /> {neueArt === 'Werkstatt' ? 'Werkstattauftrag' : 'Lohnauftrag'}
          </Link>
        )}
      </div>
      {liste.length === 0 && <p className="m-0 text-sm text-leise">Noch keine Aufträge an diesen Partner.</p>}
      {liste.map((a) => (
        <Link key={a.id} to={`/auftraege/${a.id}`} className="flex items-center justify-between gap-2 border-b border-rand py-2 text-sm text-text no-underline last:border-0">
          <span className="flex flex-col">
            <span className="font-bold">{a.titel}</span>
            <span className="text-xs text-leise">
              Nr. {a.nummer}
              {a.termin_von && ` · ${datum(a.termin_von)}`}
            </span>
          </span>
          <AuftragStatus status={a.status} />
        </Link>
      ))}
    </section>
  );
}

/** Was dieser Partner aus der Ernte übernommen hat (Verkauf/Abgabe) inkl. Zahlungsstatus */
function PartnerAbnahmen({ partnerId }: { partnerId: string }) {
  const { darfVerwalten } = useAuth();
  const qc = useQueryClient();
  const ernten = useErnten();
  const felder = useFelder();
  const [fehler, setFehler] = useState<string | null>(null);
  const feldName = new Map((felder.data ?? []).map((f) => [f.id, f.name]));
  const zeilen = (ernten.data ?? []).flatMap((e) => e.ernte_abnehmer.filter((a) => a.partner_id === partnerId).map((a) => ({ e, a })));
  const lohn = (ernten.data ?? []).filter((e) => e.lohnunternehmen_id === partnerId);
  if (!zeilen.length && !lohn.length) return null;
  const summe = zeilen.reduce(
    (s, { a }) => ({
      ballen: s.ballen + (a.ballen ?? 0),
      kg: s.kg + Number(a.menge_kg ?? 0),
      chf: s.chf + Number(a.preis_chf ?? 0),
      offen: s.offen + (a.bezahlt ? 0 : Number(a.preis_chf ?? 0)),
    }),
    { ballen: 0, kg: 0, chf: 0, offen: 0 },
  );

  async function bezahlt(id: string | undefined, wert: boolean) {
    if (!id) return;
    setFehler(null);
    const { error } = await supabase.from('ernte_abnehmer').update({ bezahlt: wert }).eq('id', id);
    if (error) return setFehler(fehlertext(error));
    qc.invalidateQueries({ queryKey: ['ernten'] });
  }

  return (
    <section className="karte flex flex-col gap-2">
      <h2 className="m-0 text-lg font-extrabold">Abnahmen aus der Ernte</h2>
      {zeilen.length > 0 && (
        <p className="m-0 text-sm font-bold">
          Total {summe.ballen ? `${summe.ballen} Ballen` : ''}
          {summe.ballen && summe.kg ? ' · ' : ''}
          {summe.kg ? `${summe.kg.toLocaleString('de-CH')} kg` : ''}
          {summe.chf ? ` · ${chf(summe.chf)}` : ''}
          {summe.offen ? <span className="text-fehler"> · offen {chf(summe.offen)}</span> : null}
        </p>
      )}
      {zeilen.map(({ e, a }) => (
        <div key={a.id} className="flex items-center justify-between gap-2 border-b border-rand py-2 text-sm last:border-0">
          <Link to={`/ernte/${e.id}`} className="flex flex-col text-text no-underline">
            <span className="font-bold">
              {datum(e.datum)} · {e.produkt} · {feldName.get(e.feld_id) ?? ''}
            </span>
            <span className="text-xs text-leise">
              {a.art}
              {a.ballen ? ` · ${a.ballen} Ballen` : ''}
              {a.menge_kg ? ` · ${Number(a.menge_kg).toLocaleString('de-CH')} kg` : ''}
              {a.preis_chf ? ` · ${chf(Number(a.preis_chf))}` : ''}
            </span>
          </Link>
          {a.art === 'Verkauf' && a.preis_chf ? (
            <label className="flex shrink-0 items-center gap-2 text-xs font-bold">
              <input type="checkbox" className="h-5 w-5 accent-hof" checked={a.bezahlt} disabled={!darfVerwalten} onChange={(ev) => bezahlt(a.id, ev.target.checked)} />
              bezahlt
            </label>
          ) : null}
        </div>
      ))}
      {lohn.length > 0 && <p className="m-0 text-xs text-leise">Als Lohnunternehmen bei {lohn.length} Ernte(n) im Einsatz.</p>}
      {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
    </section>
  );
}

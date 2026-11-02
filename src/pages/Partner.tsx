import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { usePartner } from '../lib/daten';
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
    </div>
  );
}

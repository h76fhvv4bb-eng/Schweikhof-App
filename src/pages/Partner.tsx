import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useAuftraege, useBeweidungen, useErnten, useFelder, usePartner, useVerrechneteAbgaben } from '../lib/daten';
import { aktiv, umtriebText, weidetage, weidezins } from '../lib/weide';
import { AuftragStatus } from './Auftraege';
import { chf, datum } from '../lib/format';
import { PARTNERARTEN, hatRolle, rollenText, type Partner } from '../lib/typen';
import { Icon } from '../components/Icon';
import { Verlauf } from '../components/Verlauf';

export function PartnerListe() {
  const { darfVerwalten } = useAuth();
  const partner = usePartner();
  const [art, setArt] = useState('');
  const liste = (partner.data ?? []).filter((p) => p.aktiv && (!art || hatRolle(p, art as Partner['art'])));
  const arten = PARTNERARTEN.filter((a) => (partner.data ?? []).some((p) => p.aktiv && hatRolle(p, a)));

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
              {rollenText(p)}
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
    name: '', rollen: ['Lohnunternehmen'] as Partner['art'][], kontaktperson: '', telefon: '', mobile: '', email: '', adresse: '', leistungen: '', bemerkungen: '',
  });
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    if (p)
      setW({
        name: p.name, rollen: p.rollen?.length ? [...p.rollen] : [p.art], kontaktperson: p.kontaktperson ?? '', telefon: p.telefon ?? '', mobile: p.mobile ?? '',
        email: p.email ?? '', adresse: p.adresse ?? '', leistungen: p.leistungen ?? '', bemerkungen: p.bemerkungen ?? '',
      });
  }, [p]);

  async function speichern(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    if (!w.name.trim()) return setFehler('Name fehlt.');
    if (w.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(w.email.trim())) return setFehler('E-Mail-Adresse ungültig.');
    if (!w.rollen.length) return setFehler('Bitte mindestens eine Rolle wählen.');
    const daten = {
      name: w.name.trim(), art: w.rollen[0], rollen: w.rollen, kontaktperson: leer(w.kontaktperson), telefon: leer(w.telefon), mobile: leer(w.mobile),
      email: leer(w.email), adresse: leer(w.adresse), leistungen: leer(w.leistungen), bemerkungen: leer(w.bemerkungen),
    };
    const { error } = neu
      ? await supabase.from('partner').insert({ ...daten, betrieb_id: profil!.betrieb_id })
      : await supabase.from('partner').update({ ...daten, version: p!.version }).eq('id', id!);
    if (error) {
      const m = fehlertext(error);
      return setFehler(/rollen/.test(m) ? 'Für mehrere Rollen bitte zuerst Migration 20 in Supabase einspielen.' : m);
    }
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

  const set = (k: Exclude<keyof typeof w, 'rollen'>) => (e: { target: { value: string } }) => setW({ ...w, [k]: e.target.value });
  const rolleUmschalten = (a: Partner['art']) => setW({ ...w, rollen: w.rollen.includes(a) ? w.rollen.filter((x) => x !== a) : [...w.rollen, a] });
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
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
            <legend className="mb-1 text-sm font-bold">Rollen (mehrere möglich, die erste ist die Hauptrolle)</legend>
            <div className="flex flex-wrap gap-2">
              {PARTNERARTEN.map((a) => {
                const an = w.rollen.includes(a);
                const nr = w.rollen.indexOf(a);
                return (
                  <button
                    key={a}
                    type="button"
                    onClick={() => rolleUmschalten(a)}
                    aria-pressed={an}
                    className={`min-h-10 rounded-full border-2 px-3 text-sm font-bold ${an ? 'border-hof bg-hof text-white' : 'border-linie bg-white'}`}
                  >
                    {an && nr === 0 ? '★ ' : an ? '✓ ' : ''}
                    {a}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
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
      {p && <PartnerAuftraege partner={p} />}
      {p && <PartnerWeide partnerId={p.id} tierhalter={hatRolle(p, 'Tierhalter')} />}
      {p && <PartnerAbnahmen partnerId={p.id} />}
      {p && <Verlauf art="partner" id={p.id} titel="Arbeiten durch diesen Partner" />}
    </div>
  );
}

function PartnerAuftraege({ partner }: { partner: Partner }) {
  const { darfVerwalten } = useAuth();
  const auftraege = useAuftraege();
  const partnerId = partner.id;
  const liste = (auftraege.data ?? []).filter((a) => a.partner_id === partnerId);
  const werkstatt = hatRolle(partner, 'Mechaniker/Werkstatt');
  const lohn = hatRolle(partner, 'Lohnunternehmen') || !werkstatt;
  return (
    <section className="karte flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-lg font-extrabold">Aufträge</h2>
        {darfVerwalten && (
          <div className="flex flex-wrap gap-2">
            {lohn && (
              <Link to={`/auftraege/neu?art=Lohnarbeit&partner=${partnerId}`} className="knopf no-underline">
                <Icon name="plus" /> Lohnauftrag
              </Link>
            )}
            {werkstatt && (
              <Link to={`/auftraege/neu?art=Werkstatt&partner=${partnerId}`} className={`${lohn ? 'knopf-leise' : 'knopf'} no-underline`}>
                <Icon name="plus" /> Werkstattauftrag
              </Link>
            )}
          </div>
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
/** Tiere dieses Partners auf unseren Feldern */
function PartnerWeide({ partnerId, tierhalter }: { partnerId: string; tierhalter: boolean }) {
  const { darfVerwalten } = useAuth();
  const weiden = useBeweidungen({ partner_id: partnerId });
  const felder = useFelder();
  const liste = weiden.data ?? [];
  if (!tierhalter && !liste.length) return null;
  const fName = (id: string) => felder.data?.find((f) => f.id === id)?.name ?? '?';
  return (
    <section className="karte flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-lg font-extrabold">Weide auf unseren Feldern</h2>
        <div className="flex gap-2">
          {liste.length > 0 && (
            <Link to={`/weide?partner=${partnerId}`} className="knopf-leise min-h-10 no-underline">
              Export
            </Link>
          )}
          {darfVerwalten && (
            <Link to={`/weide/neu?partner=${partnerId}`} className="knopf min-h-10 no-underline">
              <Icon name="plus" /> Weide
            </Link>
          )}
        </div>
      </div>
      {!liste.length && <span className="text-sm text-leise">Noch keine Weide erfasst.</span>}
      {liste.map((b) => {
        const z = weidezins(b);
        return (
          <Link key={b.id} to={`/weide/${b.id}`} className="flex flex-col rounded-xl bg-grund p-2 text-sm text-text no-underline">
            <span className="font-bold">
              {b.anzahl} {b.tierart} · {datum(b.von)} – {b.bis ? datum(b.bis) : 'offen'} ({weidetage(b)} Tage){aktiv(b) && ' · auf der Weide'}
            </span>
            <span className="text-leise">
              {umtriebText(b, fName)}
              {z && ` · Weidezins ${chf(z.betrag)}${b.verkauf_id ? ' (verrechnet)' : ' (offen)'}`}
            </span>
          </Link>
        );
      })}
    </section>
  );
}

function PartnerAbnahmen({ partnerId }: { partnerId: string }) {
  const { darfVerwalten } = useAuth();
  const qc = useQueryClient();
  const ernten = useErnten();
  const felder = useFelder();
  const [fehler, setFehler] = useState<string | null>(null);
  const verrechnet = useVerrechneteAbgaben();
  const feldName = new Map((felder.data ?? []).map((f) => [f.id, f.name]));
  const zeilen = (ernten.data ?? []).flatMap((e) => e.ernte_abnehmer.filter((a) => a.partner_id === partnerId).map((a) => ({ e, a })));
  const lohn = (ernten.data ?? []).flatMap((e) => e.ernte_dienstleister.filter((d) => d.partner_id === partnerId).map((d) => ({ e, d })));
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
              {datum(e.datum)} · {e.ernte_produkte.find((p) => p.id === a.produkt_id)?.produkt ?? ''} · {feldName.get(e.feld_id) ?? ''}
            </span>
            <span className="text-xs text-leise">
              {a.art}
              {a.ballen ? ` · ${a.ballen} Ballen` : ''}
              {a.menge_kg ? ` · ${Number(a.menge_kg).toLocaleString('de-CH')} kg` : ''}
              {a.preis_chf ? ` · ${chf(Number(a.preis_chf))}` : ''}
            </span>
          </Link>
          {a.id && verrechnet.data?.get(a.id) ? (
            <Link to={`/verkauf/${verrechnet.data.get(a.id)!.id}`} className="shrink-0 text-xs font-bold">
              {a.bezahlt ? '✓ bezahlt' : 'offen'} · {verrechnet.data.get(a.id)!.art} {verrechnet.data.get(a.id)!.nummer}
            </Link>
          ) : a.art === 'Verkauf' && a.preis_chf ? (
            <label className="flex shrink-0 items-center gap-2 text-xs font-bold">
              <input type="checkbox" className="h-5 w-5 accent-hof" checked={a.bezahlt} disabled={!darfVerwalten} onChange={(ev) => bezahlt(a.id, ev.target.checked)} />
              bezahlt
            </label>
          ) : null}
        </div>
      ))}
      {lohn.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-rand pt-2">
          <span className="text-xs font-bold text-leise">Als Dienstleister bei der Ernte</span>
          {lohn.map(({ e, d }) => (
            <Link key={d.id} to={`/ernte/${e.id}`} className="text-sm text-text no-underline">
              {datum(e.datum)} · {d.leistung} · {feldName.get(e.feld_id) ?? ''}
              {d.kosten_chf ? ` · ${chf(Number(d.kosten_chf))}` : ''}
            </Link>
          ))}
        </div>
      )}
      {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
    </section>
  );
}

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import {
  ABHAENGIGE_DATEN, useAufgaben, useBenutzer, useFelder, useGeplanteArbeiten, useMaschinen, useMaschinenEintraege, usePartner, useWartungFaellig,
} from '../lib/daten';
import { datum, heuteIso, menge, zahlAus } from '../lib/format';
import { MIT_MOTOR, type Aufgabe, type Feldarbeit, type Maschine } from '../lib/typen';
import { Icon } from '../components/Icon';

type Filter = 'alle' | 'feld' | 'maschine' | 'allgemein';

interface Eintrag {
  key: string;
  typ: 'feld' | 'maschine' | 'allgemein';
  titel: string;
  details: string;
  datum: string | null;
  wer: string | null;
  wichtig: boolean;
  feldarbeit?: Feldarbeit;
  aufgabe?: Aufgabe;
}

const plusTage = (tage: number) => {
  const d = new Date();
  d.setDate(d.getDate() + tage);
  return d.toISOString().slice(0, 10);
};

/** Vorlage für eine neue Aufgabe (aus Wartungsplan, Beobachtung oder Maschinenseite) */
type Vorlage = Partial<Pick<Aufgabe, 'art' | 'titel' | 'maschine_id' | 'eintragsart' | 'beobachtung_id' | 'faellig_am'>>;

export function Aufgaben() {
  const { profil } = useAuth();
  const [params, setParams] = useSearchParams();
  const felder = useFelder();
  const maschinen = useMaschinen();
  const benutzer = useBenutzer();
  const geplant = useGeplanteArbeiten();
  const aufgaben = useAufgaben('offen');
  const wartung = useWartungFaellig();
  const eintraege = useMaschinenEintraege();
  const [filter, setFilter] = useState<Filter>('alle');
  const [nurMeine, setNurMeine] = useState(false);
  const [neu, setNeu] = useState<Vorlage | Aufgabe | null>(null);
  const [erledigen, setErledigen] = useState<Eintrag | null>(null);
  const [erledigteZeigen, setErledigteZeigen] = useState(false);

  // Aus der Maschinenseite: ?neu=maschine&maschine=<id>
  useEffect(() => {
    const art = params.get('neu');
    if (!art) return;
    setNeu({ art: art === 'maschine' ? 'Maschine' : 'Allgemein', maschine_id: params.get('maschine') ?? undefined, eintragsart: 'Reparatur' });
    setParams({}, { replace: true });
  }, [params, setParams]);

  const feldName = useMemo(() => new Map((felder.data ?? []).map((f) => [f.id, f.name])), [felder.data]);
  const maschName = useMemo(() => new Map((maschinen.data ?? []).map((m) => [m.id, m.name])), [maschinen.data]);
  const personName = useMemo(() => new Map((benutzer.data ?? []).map((b) => [b.id, b.name.split(' ')[0]])), [benutzer.data]);

  const liste: Eintrag[] = [
    ...(geplant.data ?? []).map((a) => ({
      key: `f-${a.id}`,
      typ: 'feld' as const,
      titel: `${a.arbeitsart} · ${a.feldarbeit_felder.map((f) => feldName.get(f.feld_id) ?? '?').join(', ')}`,
      details: [
        a.maschine_id && maschName.get(a.maschine_id),
        a.geraet_id && maschName.get(a.geraet_id),
        ...a.feldarbeit_mittel.map((m) => `${m.lagerartikel?.bezeichnung} ${menge(Number(m.menge_je_ha))} ${m.lagerartikel?.einheit}/ha`),
      ]
        .filter(Boolean)
        .join(' · '),
      datum: a.datum,
      wer: a.ausgefuehrt_von,
      wichtig: false,
      feldarbeit: a,
    })),
    ...(aufgaben.data ?? []).map((a) => ({
      key: `a-${a.id}`,
      typ: a.art === 'Maschine' ? ('maschine' as const) : ('allgemein' as const),
      titel: a.titel,
      details: [a.maschine_id && `${maschName.get(a.maschine_id)} · ${a.eintragsart}`, a.bemerkungen].filter(Boolean).join(' · '),
      datum: a.faellig_am,
      wer: a.zugewiesen_an,
      wichtig: a.wichtig,
      aufgabe: a,
    })),
  ]
    .filter((e) => filter === 'alle' || e.typ === filter)
    .filter((e) => !nurMeine || e.wer === profil?.id || e.wer == null)
    .sort((a, b) => (a.datum ?? '9999').localeCompare(b.datum ?? '9999') || Number(b.wichtig) - Number(a.wichtig));

  const heute = heuteIso();
  const inWoche = plusTage(7);
  const gruppen: [string, Eintrag[]][] = [
    ['Überfällig', liste.filter((e) => e.datum && e.datum < heute)],
    ['Heute', liste.filter((e) => e.datum === heute)],
    ['Nächste 7 Tage', liste.filter((e) => e.datum && e.datum > heute && e.datum <= inWoche)],
    ['Später', liste.filter((e) => e.datum && e.datum > inWoche)],
    ['Ohne Datum', liste.filter((e) => !e.datum)],
  ];

  // Vorschläge: fällige Wartungen und offene Beobachtungen, für die noch keine Aufgabe besteht
  const geplanteBeobachtungen = new Set((aufgaben.data ?? []).map((a) => a.beobachtung_id).filter(Boolean));
  const geplanteWartungen = new Set((aufgaben.data ?? []).filter((a) => a.eintragsart === 'Wartung').map((a) => `${a.maschine_id}|${a.titel}`));
  const vorschlaege = [
    ...(wartung.data ?? [])
      .filter((w) => (w.bald_faellig || w.ueberfaellig) && !geplanteWartungen.has(`${w.maschine_id}|${w.bezeichnung}`))
      .map((w) => ({
        key: `w-${w.plan_id}`,
        text: `${maschName.get(w.maschine_id) ?? ''}: ${w.bezeichnung} ${w.ueberfaellig ? 'überfällig' : 'bald fällig'}`,
        vorlage: { art: 'Maschine', maschine_id: w.maschine_id, eintragsart: 'Wartung', titel: w.bezeichnung, faellig_am: w.faellig_am ?? null } as Vorlage,
      })),
    ...(eintraege.data ?? [])
      .filter((e) => e.offen && !geplanteBeobachtungen.has(e.id))
      .map((e) => ({
        key: `b-${e.id}`,
        text: `${maschName.get(e.maschine_id) ?? ''}: ${e.titel} (offen)`,
        vorlage: { art: 'Maschine', maschine_id: e.maschine_id, eintragsart: 'Reparatur', titel: e.titel, beobachtung_id: e.id } as Vorlage,
      })),
  ];

  const darfPlanen = profil?.rolle !== 'lesen';

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-leise">Geplante Arbeiten und To-dos</span>
          <h1 className="m-0 text-3xl font-extrabold text-hof">Aufgaben</h1>
        </div>
        {darfPlanen && (
          <div className="flex flex-wrap gap-2">
            <Link to="/erfassen?geplant=1" className="knopf no-underline">
              <Icon name="felder" /> Feldarbeit planen
            </Link>
            <button className="knopf-leise" onClick={() => setNeu({ art: 'Allgemein' })}>
              <Icon name="plus" /> Aufgabe
            </button>
          </div>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['alle', 'Alle'],
            ['feld', 'Felder'],
            ['maschine', 'Maschinen'],
            ['allgemein', 'Allgemein'],
          ] as const
        ).map(([f, text]) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`min-h-10 rounded-full border-2 px-3 text-sm font-bold ${filter === f ? 'border-hof bg-hof text-white' : 'border-linie bg-white'}`}
          >
            {text}
          </button>
        ))}
        <label className="ml-auto flex min-h-10 items-center gap-2 text-sm font-bold">
          <input type="checkbox" className="h-5 w-5 accent-hof" checked={nurMeine} onChange={(e) => setNurMeine(e.target.checked)} />
          Nur meine
        </label>
      </div>

      {liste.length === 0 && geplant.isSuccess && (
        <p className="karte m-0 text-leise">Keine offenen Aufgaben. Plane eine Feldarbeit oder lege eine Aufgabe an, z. B. eine Reparatur.</p>
      )}

      {gruppen
        .filter(([, l]) => l.length)
        .map(([titel, l]) => (
          <section key={titel} className="flex flex-col gap-2">
            <h2 className={`m-0 text-sm font-extrabold tracking-wider ${titel === 'Überfällig' ? 'text-fehler' : 'text-leise'}`}>{titel.toUpperCase()}</h2>
            {l.map((e) => (
              <div key={e.key} className="karte flex items-center gap-3 p-3">
                {darfPlanen && (
                  <button
                    onClick={() => setErledigen(e)}
                    aria-label={`${e.titel} erledigen`}
                    title="Erledigen"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[3px] border-hof text-lg font-extrabold text-hof hover:bg-hof-hell"
                  >
                    ✓
                  </button>
                )}
                {e.feldarbeit ? (
                  <Link to={`/arbeiten/${e.feldarbeit.id}`} className="flex min-w-0 flex-1 flex-col text-text no-underline">
                    <span className="truncate font-extrabold">{e.titel}</span>
                    <Unterzeile e={e} personName={personName} />
                  </Link>
                ) : (
                  <button className="flex min-w-0 flex-1 flex-col text-left" onClick={() => e.aufgabe && setNeu(e.aufgabe)}>
                    <span className="truncate font-extrabold">
                      {e.wichtig && <span className="text-fehler">! </span>}
                      {e.titel}
                    </span>
                    <Unterzeile e={e} personName={personName} />
                  </button>
                )}
              </div>
            ))}
          </section>
        ))}

      {darfPlanen && vorschlaege.length > 0 && (filter === 'alle' || filter === 'maschine') && (
        <section className="karte flex flex-col gap-2">
          <h2 className="m-0 text-lg font-extrabold">Vorschläge</h2>
          {vorschlaege.map((v) => (
            <div key={v.key} className="flex items-center justify-between gap-2 border-t border-rand pt-2 text-sm">
              <span>{v.text}</span>
              <button className="knopf-leise min-h-10 shrink-0" onClick={() => setNeu(v.vorlage)}>
                Planen
              </button>
            </div>
          ))}
        </section>
      )}

      <button className="self-start text-sm font-bold text-hof" onClick={() => setErledigteZeigen(!erledigteZeigen)}>
        {erledigteZeigen ? 'Erledigte ausblenden' : 'Erledigte Aufgaben anzeigen'}
      </button>
      {erledigteZeigen && <Erledigte maschName={maschName} />}

      {neu && <AufgabeFormular vorlage={neu} maschinen={maschinen.data ?? []} onFertig={() => setNeu(null)} />}
      {erledigen?.feldarbeit && (
        <FeldarbeitErledigen arbeit={erledigen.feldarbeit} titel={erledigen.titel} maschinen={maschinen.data ?? []} onFertig={() => setErledigen(null)} />
      )}
      {erledigen?.aufgabe && <AufgabeErledigen aufgabe={erledigen.aufgabe} maschinen={maschinen.data ?? []} onFertig={() => setErledigen(null)} />}
    </div>
  );
}

function Unterzeile({ e, personName }: { e: Eintrag; personName: Map<string, string> }) {
  return (
    <span className="text-xs text-leise">
      {[e.typ === 'feld' ? 'Feldarbeit' : e.typ === 'maschine' ? 'Maschine' : 'Allgemein', e.datum && datum(e.datum), e.wer && personName.get(e.wer), e.details]
        .filter(Boolean)
        .join(' · ')}
    </span>
  );
}

function Erledigte({ maschName }: { maschName: Map<string, string> }) {
  const erledigt = useAufgaben('erledigt');
  return (
    <section className="karte flex flex-col gap-2">
      <h2 className="m-0 text-lg font-extrabold">Erledigt</h2>
      <p className="m-0 text-xs text-leise">Erledigte Feldarbeiten stehen in der Ackerschlagkartei, Wartungen und Reparaturen bei der Maschine.</p>
      {(erledigt.data ?? []).length === 0 && <p className="m-0 text-sm text-leise">Noch nichts erledigt.</p>}
      {(erledigt.data ?? []).map((a) => (
        <div key={a.id} className="flex flex-col border-t border-rand pt-2 text-sm">
          <span className="font-bold">✓ {a.titel}</span>
          <span className="text-xs text-leise">
            {[
              a.erledigt_am && datum(a.erledigt_am),
              a.maschine_id && maschName.get(a.maschine_id),
              a.dauer_h != null && `${menge(Number(a.dauer_h))} h`,
              a.ergebnis,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------- Dialoge

function Dialog({ titel, children, onSchliessen }: { titel: string; children: ReactNode; onSchliessen: () => void }) {
  return (
    <div className="fixed inset-0 z-[2000] flex items-end justify-center bg-black/30 p-3 md:items-center" onClick={onSchliessen}>
      <div className="karte flex max-h-[92dvh] w-full max-w-lg flex-col gap-3 overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={titel}>
        <div className="flex items-start justify-between gap-2">
          <h2 className="m-0 text-xl font-extrabold">{titel}</h2>
          <button className="h-11 w-11 shrink-0 text-leise" onClick={onSchliessen} aria-label="Schliessen">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Fehler({ text }: { text: string | null }) {
  return text ? <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{text}</p> : null;
}

const istAufgabe = (v: Vorlage | Aufgabe): v is Aufgabe => 'id' in v && typeof (v as Aufgabe).id === 'string';

function AufgabeFormular({ vorlage, maschinen, onFertig }: { vorlage: Vorlage | Aufgabe; maschinen: Maschine[]; onFertig: () => void }) {
  const { profil, darfVerwalten } = useAuth();
  const qc = useQueryClient();
  const benutzer = useBenutzer();
  const partner = usePartner();
  const bestehend = istAufgabe(vorlage) ? vorlage : null;
  const [w, setW] = useState({
    art: vorlage.art ?? 'Allgemein',
    titel: vorlage.titel ?? '',
    faellig_am: vorlage.faellig_am ?? '',
    maschine_id: vorlage.maschine_id ?? '',
    eintragsart: vorlage.eintragsart ?? 'Reparatur',
    zugewiesen_an: bestehend?.zugewiesen_an ?? '',
    partner_id: bestehend?.partner_id ?? '',
    wichtig: bestehend?.wichtig ?? false,
    bemerkungen: bestehend?.bemerkungen ?? '',
  });
  const [fehler, setFehler] = useState<string | null>(null);
  const set = (k: keyof typeof w) => (e: { target: { value: string } }) => setW({ ...w, [k]: e.target.value });

  async function speichern() {
    setFehler(null);
    if (!w.titel.trim()) return setFehler('Bitte beschreiben, was zu tun ist.');
    if (w.art === 'Maschine' && !w.maschine_id) return setFehler('Bitte die Maschine wählen.');
    const daten = {
      art: w.art,
      titel: w.titel.trim(),
      faellig_am: w.faellig_am || null,
      maschine_id: w.art === 'Maschine' ? w.maschine_id : null,
      eintragsart: w.art === 'Maschine' ? w.eintragsart : null,
      partner_id: w.art === 'Maschine' ? w.partner_id || null : null,
      beobachtung_id: w.art === 'Maschine' ? (vorlage.beobachtung_id ?? null) : null,
      zugewiesen_an: w.zugewiesen_an || null,
      wichtig: w.wichtig,
      bemerkungen: w.bemerkungen.trim() || null,
    };
    const { error } = bestehend
      ? await supabase.from('aufgaben').update({ ...daten, version: bestehend.version }).eq('id', bestehend.id)
      : await supabase.from('aufgaben').insert({ ...daten, betrieb_id: profil!.betrieb_id });
    if (error) return setFehler(fehlertext(error));
    qc.invalidateQueries({ queryKey: ['aufgaben'] });
    onFertig();
  }

  async function loeschen() {
    if (!bestehend || !confirm('Diese Aufgabe löschen?')) return;
    const { error } = await supabase.from('aufgaben').delete().eq('id', bestehend.id);
    if (error) return setFehler(fehlertext(error));
    qc.invalidateQueries({ queryKey: ['aufgaben'] });
    onFertig();
  }

  return (
    <Dialog titel={bestehend ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'} onSchliessen={onFertig}>
      {!bestehend && (
        <div className="grid grid-cols-3 gap-1 rounded-2xl bg-[#E7E1D0] p-1">
          {(['Allgemein', 'Maschine'] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setW({ ...w, art: a })}
              aria-pressed={w.art === a}
              className={`min-h-10 rounded-xl text-sm font-extrabold ${w.art === a ? 'bg-white text-hof' : 'text-[#4D5B50]'}`}
            >
              {a === 'Maschine' ? 'Maschine' : 'Allgemein'}
            </button>
          ))}
          <Link to="/erfassen?geplant=1" className="flex min-h-10 items-center justify-center rounded-xl text-sm font-extrabold text-[#4D5B50] no-underline">
            Feldarbeit →
          </Link>
        </div>
      )}
      {w.art === 'Maschine' && (
        <div className="grid grid-cols-2 gap-2">
          <label className="feld-label">
            Maschine
            <select className="eingabe" value={w.maschine_id} onChange={set('maschine_id')}>
              <option value="">– wählen –</option>
              {maschinen
                .filter((m) => m.status !== 'verkauft' || m.id === w.maschine_id)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="feld-label">
            Art
            <select className="eingabe" value={w.eintragsart} onChange={set('eintragsart')}>
              <option>Reparatur</option>
              <option>Wartung</option>
              <option>Kontrolle</option>
            </select>
          </label>
        </div>
      )}
      <label className="feld-label">
        Was ist zu tun?
        <input
          className="eingabe"
          value={w.titel}
          onChange={set('titel')}
          autoFocus={!w.titel}
          placeholder={w.art === 'Maschine' ? 'z. B. Hydraulikleitung ersetzen' : 'z. B. Zaun Weide flicken'}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="feld-label">
          Bis wann?
          <input className="eingabe" type="date" value={w.faellig_am} onChange={set('faellig_am')} />
        </label>
        <label className="feld-label">
          Wer?
          <select className="eingabe" value={w.zugewiesen_an} onChange={set('zugewiesen_an')}>
            <option value="">– offen –</option>
            {(benutzer.data ?? [])
              .filter((b) => b.aktiv)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      {w.art === 'Maschine' && (
        <label className="feld-label">
          Werkstatt / Partner (optional)
          <select className="eingabe" value={w.partner_id} onChange={set('partner_id')}>
            <option value="">– selbst –</option>
            {(partner.data ?? [])
              .filter((p) => p.aktiv)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.art})
                </option>
              ))}
          </select>
        </label>
      )}
      <label className="feld-label">
        Notiz
        <input className="eingabe" value={w.bemerkungen} onChange={set('bemerkungen')} />
      </label>
      <label className="flex min-h-10 items-center gap-2 text-sm font-bold">
        <input type="checkbox" className="h-5 w-5 accent-hof" checked={w.wichtig} onChange={(e) => setW({ ...w, wichtig: e.target.checked })} />
        Wichtig
      </label>
      <Fehler text={fehler} />
      <div className="flex flex-wrap gap-2">
        <button className="knopf" onClick={speichern}>
          Speichern
        </button>
        {bestehend && (darfVerwalten || bestehend.erstellt_von === profil?.id) && (
          <button className="ml-auto text-sm font-bold text-fehler" onClick={loeschen}>
            Löschen
          </button>
        )}
      </div>
    </Dialog>
  );
}

function ZaehlerFelder({
  maschine,
  stunden,
  km,
  onStunden,
  onKm,
}: {
  maschine: Maschine;
  stunden: string;
  km: string;
  onStunden: (v: string) => void;
  onKm?: (v: string) => void;
}) {
  const motor = MIT_MOTOR.includes(maschine.kategorie);
  return (
    <div className="grid grid-cols-2 gap-2 rounded-2xl bg-grund p-3">
      <span className="col-span-2 text-sm font-extrabold">{maschine.name}</span>
      <label className="feld-label">
        Stundenzähler
        <input
          className="eingabe"
          inputMode="decimal"
          value={stunden}
          onChange={(e) => onStunden(e.target.value)}
          placeholder={maschine.betriebsstunden != null ? `bisher ${menge(Number(maschine.betriebsstunden))}` : 'h'}
        />
      </label>
      {motor && onKm && (
        <label className="feld-label">
          Kilometer
          <input
            className="eingabe"
            inputMode="decimal"
            value={km}
            onChange={(e) => onKm(e.target.value)}
            placeholder={maschine.kilometerstand != null ? `bisher ${menge(Number(maschine.kilometerstand))}` : 'km'}
          />
        </label>
      )}
    </div>
  );
}

function pruefeZaehler(wert: string, bisher: number | null | undefined, name: string): string | null {
  const z = zahlAus(wert);
  if (wert.trim() && (z == null || z < 0)) return `Zählerstand bei ${name} ungültig.`;
  if (z != null && bisher != null && z < Number(bisher)) return `Der Zähler bei ${name} ist kleiner als bisher (${menge(Number(bisher))}). Bitte prüfen.`;
  return null;
}

function FeldarbeitErledigen({ arbeit, titel, maschinen, onFertig }: { arbeit: Feldarbeit; titel: string; maschinen: Maschine[]; onFertig: () => void }) {
  const qc = useQueryClient();
  const maschine = maschinen.find((m) => m.id === arbeit.maschine_id);
  const geraet = maschinen.find((m) => m.id === arbeit.geraet_id);
  const ha = arbeit.feldarbeit_felder.reduce((s, f) => s + Number(f.flaeche_m2), 0) / 10000;
  const [w, setW] = useState({
    datum: arbeit.datum < heuteIso() ? arbeit.datum : heuteIso(),
    dauer: arbeit.dauer_h != null ? String(arbeit.dauer_h) : '',
    m_stunden: '',
    m_km: '',
    g_stunden: '',
    beobachtung: '',
    melden: '',
  });
  const [mittel, setMittel] = useState(() =>
    Object.fromEntries(arbeit.feldarbeit_mittel.map((m) => [m.artikel_id, String(Math.round(Number(m.gesamtmenge) * 100) / 100)])),
  );
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  async function erledigt() {
    setFehler(null);
    if (w.datum > heuteIso()) return setFehler('Das Datum liegt in der Zukunft.');
    const pz =
      (maschine && (pruefeZaehler(w.m_stunden, maschine.betriebsstunden, maschine.name) ?? pruefeZaehler(w.m_km, maschine.kilometerstand, maschine.name))) ||
      (geraet && pruefeZaehler(w.g_stunden, geraet.betriebsstunden, geraet.name));
    if (pz && !confirm(`${pz}\n\nTrotzdem speichern?`)) return;
    for (const [id, v] of Object.entries(mittel)) if (v.trim() && (zahlAus(v) == null || zahlAus(v)! < 0)) return setFehler(`Menge ungültig: ${arbeit.feldarbeit_mittel.find((m) => m.artikel_id === id)?.lagerartikel?.bezeichnung ?? ''}`);
    setLaeuft(true);
    const { error } = await supabase.rpc('feldarbeit_erledigen', {
      p_id: arbeit.id,
      p: {
        datum: w.datum,
        dauer_h: zahlAus(w.dauer),
        maschine_stunden: zahlAus(w.m_stunden),
        maschine_km: zahlAus(w.m_km),
        geraet_stunden: zahlAus(w.g_stunden),
        mittel: Object.entries(mittel).map(([artikel_id, v]) => ({ artikel_id, gesamtmenge: zahlAus(v) })),
        beobachtung: w.beobachtung.trim() || null,
        beobachtung_an_maschine: w.melden || null,
      },
    });
    setLaeuft(false);
    if (error) return setFehler(fehlertext(error));
    ABHAENGIGE_DATEN.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    onFertig();
  }

  return (
    <Dialog titel={`Erledigt: ${titel}`} onSchliessen={onFertig}>
      <div className="grid grid-cols-2 gap-2">
        <label className="feld-label">
          Wann?
          <input className="eingabe" type="date" max={heuteIso()} value={w.datum} onChange={(e) => setW({ ...w, datum: e.target.value })} />
        </label>
        <label className="feld-label">
          Wie lange? (Std.)
          <input className="eingabe" inputMode="decimal" value={w.dauer} onChange={(e) => setW({ ...w, dauer: e.target.value })} placeholder="z. B. 2.5" />
        </label>
      </div>

      {arbeit.feldarbeit_mittel.length > 0 && (
        <div className="flex flex-col gap-2 rounded-2xl bg-grund p-3">
          <span className="text-sm font-extrabold">Effektiv gebraucht</span>
          {arbeit.feldarbeit_mittel.map((m) => {
            const v = zahlAus(mittel[m.artikel_id] ?? '');
            return (
              <label key={m.artikel_id} className="feld-label">
                {m.lagerartikel?.bezeichnung} (geplant {menge(Number(m.gesamtmenge), m.lagerartikel?.einheit)})
                <span className="flex items-center gap-2">
                  <input
                    className="eingabe w-full"
                    inputMode="decimal"
                    value={mittel[m.artikel_id] ?? ''}
                    onChange={(e) => setMittel({ ...mittel, [m.artikel_id]: e.target.value })}
                  />
                  <span className="shrink-0">{m.lagerartikel?.einheit}</span>
                </span>
                {v != null && ha > 0 && (
                  <span className="text-xs font-normal text-leise">
                    = {menge(v / ha)} {m.lagerartikel?.einheit}/ha · 0 = nicht ausgebracht
                  </span>
                )}
              </label>
            );
          })}
          {arbeit.feldarbeit_mittel.some((m) => m.vom_lager) && <span className="text-xs text-leise">Die Menge wird vom Lager abgebucht.</span>}
        </div>
      )}

      {maschine && (
        <ZaehlerFelder
          maschine={maschine}
          stunden={w.m_stunden}
          km={w.m_km}
          onStunden={(v) => setW({ ...w, m_stunden: v })}
          onKm={(v) => setW({ ...w, m_km: v })}
        />
      )}
      {geraet && <ZaehlerFelder maschine={geraet} stunden={w.g_stunden} km="" onStunden={(v) => setW({ ...w, g_stunden: v })} />}

      <label className="feld-label">
        Beobachtungen (optional)
        <textarea
          className="eingabe min-h-16 py-2"
          value={w.beobachtung}
          onChange={(e) => setW({ ...w, beobachtung: e.target.value })}
          placeholder="z. B. Stein am Feldrand, Streuer streut links ungleich"
        />
      </label>
      {w.beobachtung.trim() && (maschine || geraet) && (
        <label className="feld-label">
          Bei einer Maschine als offenen Punkt melden?
          <select className="eingabe" value={w.melden} onChange={(e) => setW({ ...w, melden: e.target.value })}>
            <option value="">Nein, nur bei der Arbeit notieren</option>
            {[maschine, geraet].filter(Boolean).map((m) => (
              <option key={m!.id} value={m!.id}>
                Ja, bei {m!.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <Fehler text={fehler} />
      <button className="knopf h-14 text-lg" onClick={erledigt} disabled={laeuft}>
        {laeuft ? 'Speichere …' : '✓ Erledigt'}
      </button>
      <span className="text-xs text-leise">Die Arbeit erscheint danach in der Ackerschlagkartei.</span>
    </Dialog>
  );
}

function AufgabeErledigen({ aufgabe, maschinen, onFertig }: { aufgabe: Aufgabe; maschinen: Maschine[]; onFertig: () => void }) {
  const qc = useQueryClient();
  const partner = usePartner();
  const maschine = maschinen.find((m) => m.id === aufgabe.maschine_id);
  const [w, setW] = useState({
    datum: heuteIso(),
    dauer: '',
    stunden: '',
    km: '',
    kosten: '',
    partner_id: aufgabe.partner_id ?? '',
    ergebnis: '',
    noch_offen: false,
    beobachtung_schliessen: true,
  });
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  async function erledigt() {
    setFehler(null);
    if (w.datum > heuteIso()) return setFehler('Das Datum liegt in der Zukunft.');
    const pz = maschine && (pruefeZaehler(w.stunden, maschine.betriebsstunden, maschine.name) ?? pruefeZaehler(w.km, maschine.kilometerstand, maschine.name));
    if (pz && !confirm(`${pz}\n\nTrotzdem speichern?`)) return;
    if (w.kosten.trim() && (zahlAus(w.kosten) == null || zahlAus(w.kosten)! < 0)) return setFehler('Kosten ungültig.');
    setLaeuft(true);
    const { error } = await supabase.rpc('aufgabe_erledigen', {
      p_id: aufgabe.id,
      p: {
        datum: w.datum,
        dauer_h: zahlAus(w.dauer),
        ergebnis: w.ergebnis.trim() || null,
        betriebsstunden: zahlAus(w.stunden),
        kilometerstand: zahlAus(w.km),
        kosten: zahlAus(w.kosten),
        partner_id: w.partner_id || null,
        noch_offen: w.noch_offen,
        beobachtung_schliessen: w.beobachtung_schliessen,
      },
    });
    setLaeuft(false);
    if (error) return setFehler(fehlertext(error));
    ABHAENGIGE_DATEN.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    onFertig();
  }

  return (
    <Dialog titel={`Erledigt: ${aufgabe.titel}`} onSchliessen={onFertig}>
      <div className="grid grid-cols-2 gap-2">
        <label className="feld-label">
          Wann?
          <input className="eingabe" type="date" max={heuteIso()} value={w.datum} onChange={(e) => setW({ ...w, datum: e.target.value })} />
        </label>
        <label className="feld-label">
          Wie lange? (Std.)
          <input className="eingabe" inputMode="decimal" value={w.dauer} onChange={(e) => setW({ ...w, dauer: e.target.value })} />
        </label>
      </div>
      {maschine && (
        <>
          <ZaehlerFelder
            maschine={maschine}
            stunden={w.stunden}
            km={w.km}
            onStunden={(v) => setW({ ...w, stunden: v })}
            onKm={(v) => setW({ ...w, km: v })}
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="feld-label">
              Kosten CHF
              <input className="eingabe" inputMode="decimal" value={w.kosten} onChange={(e) => setW({ ...w, kosten: e.target.value })} />
            </label>
            <label className="feld-label">
              Werkstatt / Partner
              <select className="eingabe" value={w.partner_id} onChange={(e) => setW({ ...w, partner_id: e.target.value })}>
                <option value="">– selbst –</option>
                {(partner.data ?? [])
                  .filter((p) => p.aktiv || p.id === w.partner_id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        </>
      )}
      <label className="feld-label">
        {maschine ? 'Was wurde gemacht? Beobachtungen' : 'Notiz / Beobachtungen (optional)'}
        <textarea
          className="eingabe min-h-16 py-2"
          value={w.ergebnis}
          onChange={(e) => setW({ ...w, ergebnis: e.target.value })}
          placeholder={maschine ? 'z. B. Dichtung ersetzt, Bremse etwas schwach' : ''}
        />
      </label>
      {maschine && (
        <label className="flex min-h-10 items-center gap-2 text-sm font-bold">
          <input type="checkbox" className="h-5 w-5 accent-hof" checked={w.noch_offen} onChange={(e) => setW({ ...w, noch_offen: e.target.checked })} />
          Mangel besteht weiter (als offen markieren)
        </label>
      )}
      {aufgabe.beobachtung_id && (
        <label className="flex min-h-10 items-center gap-2 text-sm font-bold">
          <input
            type="checkbox"
            className="h-5 w-5 accent-hof"
            checked={w.beobachtung_schliessen}
            onChange={(e) => setW({ ...w, beobachtung_schliessen: e.target.checked })}
          />
          Ursprüngliche Beobachtung als behoben schliessen
        </label>
      )}
      <Fehler text={fehler} />
      <button className="knopf h-14 text-lg" onClick={erledigt} disabled={laeuft}>
        {laeuft ? 'Speichere …' : '✓ Erledigt'}
      </button>
      {maschine && <span className="text-xs text-leise">Es entsteht ein Eintrag ({aufgabe.eintragsart}) bei der Maschine, Zähler werden nachgeführt.</span>}
    </Dialog>
  );
}

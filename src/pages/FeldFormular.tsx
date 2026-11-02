import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useFelder } from '../lib/daten';
import { ha, haZuM2 } from '../lib/format';
import { FELDSTATUS, NUTZUNGSARTEN, type Anbau, type Feld } from '../lib/typen';
import { Icon } from '../components/Icon';
import { FeldHinweise, FeldTeilenZusammenfuehren } from '../components/FeldWerkzeuge';

const schema = z.object({
  feldnummer: z.string().trim().min(1, 'Feldnummer fehlt').max(20),
  name: z.string().trim().min(1, 'Name fehlt').max(80),
  flaeche_m2: z.number({ invalid_type_error: 'Fläche in ha eingeben, z. B. 2.4' }).positive('Fläche muss grösser als 0 sein').max(5_000_000),
  gemeinde: z.string().trim().max(80).nullable(),
  nutzungsart: z.enum(NUTZUNGSARTEN),
  bodenart: z.string().trim().max(80).nullable(),
  hangneigung_prozent: z.number().min(0).max(100).nullable(),
  status: z.enum(FELDSTATUS),
  bemerkungen: z.string().trim().max(2000).nullable(),
  korrektur_p2o5: z.number().min(0, 'Korrekturfaktor zwischen 0 und 3').max(3, 'Korrekturfaktor zwischen 0 und 3').nullable(),
  korrektur_k2o: z.number().min(0, 'Korrekturfaktor zwischen 0 und 3').max(3, 'Korrekturfaktor zwischen 0 und 3').nullable(),
  korrektur_mg: z.number().min(0, 'Korrekturfaktor zwischen 0 und 3').max(3, 'Korrekturfaktor zwischen 0 und 3').nullable(),
  bodenprobe_jahr: z.number().int('Jahr der Bodenprobe ungültig').min(1990, 'Jahr der Bodenprobe ungültig').max(2100).nullable(),
});

const zahlOderNull = (s: string) => (s.trim() === '' ? null : Number(s.trim().replace(',', '.')));

const leer = (s: string) => (s.trim() === '' ? null : s.trim());

export function FeldFormular() {
  const { id } = useParams();
  const neu = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profil, darfVerwalten } = useAuth();
  const felder = useFelder();
  const feld = felder.data?.find((f) => f.id === id);

  const [w, setW] = useState({
    feldnummer: '',
    name: '',
    flaeche: '',
    gemeinde: '',
    nutzungsart: 'Ackerland' as Feld['nutzungsart'],
    bodenart: '',
    hang: '',
    status: 'bewirtschaftet' as Feld['status'],
    bemerkungen: '',
    kp: '',
    kk: '',
    kmg: '',
    probe: '',
  });
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    if (feld)
      setW({
        feldnummer: feld.feldnummer,
        name: feld.name,
        flaeche: String(Number(feld.flaeche_m2) / 10000),
        gemeinde: feld.gemeinde ?? '',
        nutzungsart: feld.nutzungsart,
        bodenart: feld.bodenart ?? '',
        hang: feld.hangneigung_prozent == null ? '' : String(feld.hangneigung_prozent),
        status: feld.status,
        bemerkungen: feld.bemerkungen ?? '',
        kp: feld.korrektur_p2o5 == null ? '' : String(feld.korrektur_p2o5),
        kk: feld.korrektur_k2o == null ? '' : String(feld.korrektur_k2o),
        kmg: feld.korrektur_mg == null ? '' : String(feld.korrektur_mg),
        probe: feld.bodenprobe_jahr == null ? '' : String(feld.bodenprobe_jahr),
      });
    else if (neu && felder.data) {
      const naechste = felder.data.reduce((m, f) => Math.max(m, Number(f.feldnummer) || 0), 0) + 1;
      setW((x) => ({ ...x, feldnummer: x.feldnummer || String(naechste) }));
    }
  }, [feld, neu, felder.data]);

  // Historie inkl. der Felder, aus denen dieses Feld entstanden ist (Teilen/Zusammenführen)
  const historie = useQuery({
    queryKey: ['anbau-feld', id, feld?.vorgaenger?.join(',')],
    enabled: !!id && !!feld,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('anbau')
        .select('id, feld_id, kultur_id, jahr, art, status, version, kulturen(name, farbe), felder(name)')
        .in('feld_id', [id!, ...(feld?.vorgaenger ?? [])])
        .order('jahr', { ascending: false })
        .order('art');
      if (error) throw error;
      return data as unknown as (Anbau & { felder: { name: string } | null })[];
    },
  });

  const speichern = useMutation({
    mutationFn: async () => {
      const roh = {
        feldnummer: w.feldnummer,
        name: w.name,
        flaeche_m2: haZuM2(w.flaeche) ?? NaN,
        gemeinde: leer(w.gemeinde),
        nutzungsart: w.nutzungsart,
        bodenart: leer(w.bodenart),
        hangneigung_prozent: w.hang.trim() === '' ? null : Number(w.hang.replace(',', '.')),
        status: w.status,
        bemerkungen: leer(w.bemerkungen),
        korrektur_p2o5: zahlOderNull(w.kp),
        korrektur_k2o: zahlOderNull(w.kk),
        korrektur_mg: zahlOderNull(w.kmg),
        bodenprobe_jahr: zahlOderNull(w.probe),
      };
      const geprueft = schema.safeParse(roh);
      if (!geprueft.success) throw new Error(geprueft.error.issues[0].message);
      if (neu) {
        const { error } = await supabase.from('felder').insert({ ...geprueft.data, betrieb_id: profil!.betrieb_id });
        if (error) throw error;
      } else {
        const { error } = await supabase.from('felder').update({ ...geprueft.data, version: feld!.version }).eq('id', id!);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['felder'] });
      qc.invalidateQueries({ queryKey: ['flaeche_je_kultur'] });
      navigate('/felder');
    },
    onError: (e) => setFehler(fehlertext(e)),
  });

  async function grenzeZuruecksetzen() {
    if (!feld || !confirm(`Grenze von «${feld.name}» entfernen? Das Feld und seine Daten bleiben erhalten, nur die Zeichnung wird gelöscht.`)) return;
    setFehler(null);
    const { error } = await supabase.from('felder').update({ geometrie: null, flaeche_gezeichnet_m2: null, version: feld.version }).eq('id', feld.id);
    if (error) return setFehler(fehlertext(error));
    qc.invalidateQueries({ queryKey: ['felder'] });
  }

  async function loeschen() {
    if (!feld) return;
    setFehler(null);
    const { data } = await supabase.rpc('feld_aufzeichnungen', { p_id: feld.id });
    const a = (data ?? {}) as { arbeiten?: number; ernten?: number; auftraege?: number };
    const teile = [
      a.arbeiten ? `${a.arbeiten} Arbeiten` : '',
      a.ernten ? `${a.ernten} Ernten` : '',
      a.auftraege ? `${a.auftraege} Aufträge` : '',
    ].filter(Boolean);
    const text =
      `«${feld.name}» löschen?\n\nDas Feld kommt in den Papierkorb und lässt sich 24 Stunden lang wiederherstellen.` +
      (teile.length
        ? `\n\nZu diesem Feld gibt es ${teile.join(', ')}. Diese Aufzeichnungen bleiben erhalten; das Feld wird darum nur archiviert, nicht ganz entfernt.`
        : '\n\nDanach wird es mit Fruchtfolge und Hinweisen endgültig entfernt.');
    if (!confirm(text)) return;
    const { error } = await supabase.rpc('feld_loeschen', { p_id: feld.id });
    if (error) return setFehler(fehlertext(error));
    ['felder', 'anbau', 'flaeche_je_kultur'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    navigate('/felder');
  }

  function absenden(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    speichern.mutate();
  }

  const nurLesen = !darfVerwalten;
  const set = (k: keyof typeof w) => (e: { target: { value: string } }) => setW({ ...w, [k]: e.target.value });

  if (!neu && felder.isSuccess && !feld) return <p>Feld nicht gefunden.</p>;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <Link to="/felder" aria-label="Zurück" className="knopf-leise h-11 w-11 px-0">
          <Icon name="zurueck" />
        </Link>
        <h1 className="m-0 text-2xl font-extrabold text-hof">{neu ? 'Neues Feld' : w.name || 'Feld'}</h1>
      </header>

      <form onSubmit={absenden} className="karte flex flex-col gap-3">
        <fieldset disabled={nurLesen} className="m-0 flex flex-col gap-3 border-0 p-0">
          <div className="grid grid-cols-[100px_1fr] gap-3">
            <label className="feld-label">
              Nr.
              <input className="eingabe" required value={w.feldnummer} onChange={set('feldnummer')} />
            </label>
            <label className="feld-label">
              Name
              <input className="eingabe" required value={w.name} onChange={set('name')} placeholder="z. B. Oberacker" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="feld-label">
              Fläche (ha)
              <input className="eingabe" inputMode="decimal" required value={w.flaeche} onChange={set('flaeche')} placeholder="2.40" />
              <span className="font-semibold">{haZuM2(w.flaeche) ? `= ${ha(haZuM2(w.flaeche))}` : ' '}</span>
            </label>
            <label className="feld-label">
              Gemeinde
              <input className="eingabe" value={w.gemeinde} onChange={set('gemeinde')} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="feld-label">
              Nutzungsart
              <select className="eingabe" value={w.nutzungsart} onChange={set('nutzungsart')}>
                {NUTZUNGSARTEN.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="feld-label">
              Status
              <select className="eingabe" value={w.status} onChange={set('status')}>
                {FELDSTATUS.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="feld-label">
              Bodenart
              <input className="eingabe" value={w.bodenart} onChange={set('bodenart')} placeholder="z. B. sandiger Lehm" />
            </label>
            <label className="feld-label">
              Hangneigung (%)
              <input className="eingabe" inputMode="decimal" value={w.hang} onChange={set('hang')} />
            </label>
          </div>
          <div className="flex flex-col gap-2 rounded-2xl bg-grund p-3">
            <span className="text-sm font-extrabold">Bodenprobe – Korrekturfaktoren</span>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="feld-label">
                P₂O₅
                <input className="eingabe" inputMode="decimal" value={w.kp} onChange={set('kp')} placeholder="z. B. 0.8" />
              </label>
              <label className="feld-label">
                K₂O
                <input className="eingabe" inputMode="decimal" value={w.kk} onChange={set('kk')} placeholder="z. B. 1.0" />
              </label>
              <label className="feld-label">
                Mg
                <input className="eingabe" inputMode="decimal" value={w.kmg} onChange={set('kmg')} />
              </label>
              <label className="feld-label">
                Jahr der Probe
                <input className="eingabe" inputMode="numeric" value={w.probe} onChange={set('probe')} />
              </label>
            </div>
            <span className="text-xs text-leise">Faktor gemäss Bodenanalyse (1.0 = Versorgung genügend). Dient nur als Notiz für die Düngungsplanung.</span>
          </div>
          <label className="feld-label">
            Bemerkungen
            <textarea className="eingabe min-h-24 py-2" value={w.bemerkungen} onChange={set('bemerkungen')} />
          </label>
        </fieldset>
        {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
        {!nurLesen && (
          <button className="knopf" disabled={speichern.isPending}>
            {speichern.isPending ? 'Speichere …' : 'Speichern'}
          </button>
        )}
      </form>

      {!neu && feld && (
        <section className="karte flex flex-col gap-2">
          <h2 className="m-0 text-lg font-extrabold">Feldgrenze</h2>
          <p className="m-0 text-sm text-leise">
            {feld.geometrie
              ? `Auf der Karte eingezeichnet: ${ha(Number(feld.flaeche_gezeichnet_m2))}${
                  feld.flaeche_gezeichnet_m2 && Math.abs(Number(feld.flaeche_gezeichnet_m2) - Number(feld.flaeche_m2)) > 100
                    ? ` (erfasst sind ${ha(Number(feld.flaeche_m2))})`
                    : ''
                }`
              : 'Noch nicht auf der Karte eingezeichnet.'}
          </p>
          {darfVerwalten && (
            <div className="flex flex-wrap gap-2">
              <Link to={`/felder?zeichnen=${feld.id}`} className="knopf-leise no-underline">
                {feld.geometrie ? 'Neu zeichnen' : 'Auf der Karte zeichnen'}
              </Link>
              {feld.geometrie && (
                <button type="button" className="knopf-leise text-fehler" onClick={grenzeZuruecksetzen}>
                  Grenze zurücksetzen
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {!neu && feld && <FeldHinweise feldId={feld.id} />}

      {!neu && (
        <section className="karte flex flex-col gap-2">
          <h2 className="m-0 text-lg font-extrabold">Feldhistorie</h2>
          {historie.data?.length === 0 && <p className="m-0 text-sm text-leise">Noch keine Kulturen erfasst.</p>}
          {historie.data?.map((a) => (
            <div key={a.id} className="flex items-center gap-3">
              <span className="w-12 font-extrabold">{a.jahr}</span>
              <span className="rounded-lg px-2 py-1 text-sm font-bold" style={{ background: a.kulturen?.farbe }}>
                {a.kulturen?.name}
              </span>
              <span className="text-xs text-leise">
                {a.art !== 'Hauptkultur' ? `${a.art} · ` : ''}
                {a.status === 'ist' ? 'Ist' : 'Plan'}
                {a.feld_id !== id && a.felder && ` · auf ${a.felder.name}`}
              </span>
            </div>
          ))}
          <span className="flex flex-wrap gap-4">
            <Link to="/fruchtfolge" className="text-sm font-bold text-hof">
              In der Fruchtfolge bearbeiten
            </Link>
            <Link to={`/ernte/neu?feld=${id}`} className="text-sm font-bold text-hof">
              Ernte erfassen
            </Link>
          </span>
        </section>
      )}

      {!neu && feld && darfVerwalten && <FeldTeilenZusammenfuehren feld={feld} />}

      {!neu && feld && darfVerwalten && (
        <section className="karte flex flex-col gap-2">
          <h2 className="m-0 text-lg font-extrabold">Feld löschen</h2>
          <p className="m-0 text-sm text-leise">
            Das Feld kommt in den Papierkorb (unten in der Felderliste) und ist 24 Stunden wiederherstellbar. Wird es nur nicht mehr bewirtschaftet,
            besser den Status auf «aufgegeben» setzen; dann bleibt die Historie sichtbar.
          </p>
          <button type="button" className="knopf-leise self-start text-fehler" onClick={loeschen}>
            Feld löschen
          </button>
        </section>
      )}
    </div>
  );
}

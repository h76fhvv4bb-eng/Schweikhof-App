import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useAufgaben, useFeldarbeiten, useFelder, useFlaecheJeKultur, useGeplanteArbeiten, useLager, useMaschinen, useMaschinenEintraege, useWartungFaellig } from '../lib/daten';
import { tageBis } from './Maschinen';
import { datum, ha, menge, wochentagDatum } from '../lib/format';
import { Icon } from '../components/Icon';

export function Heute() {
  const { profil } = useAuth();
  const jahr = new Date().getFullYear();
  const felder = useFelder();
  const kulturen = useFlaecheJeKultur(jahr);
  const lager = useLager();
  const arbeiten = useFeldarbeiten(jahr);
  const knapp = (lager.data ?? []).filter((a) => a.unter_mindestbestand);
  const feldName = new Map((felder.data ?? []).map((f) => [f.id, f.name]));
  const geplanteArbeiten = useGeplanteArbeiten();
  const offeneAufgaben = useAufgaben('offen');
  const heuteIso = new Date().toISOString().slice(0, 10);
  const todo = [
    ...(geplanteArbeiten.data ?? []).map((a) => ({
      key: a.id, link: `/arbeiten/${a.id}`, datum: a.datum as string | null, text: `${a.arbeitsart} · ${a.feldarbeit_felder.map((f) => feldName.get(f.feld_id)).join(', ')}`,
    })),
    ...(offeneAufgaben.data ?? []).map((a) => ({ key: a.id, link: '/aufgaben', datum: a.faellig_am, text: a.titel })),
  ].sort((a, b) => (a.datum ?? '9999').localeCompare(b.datum ?? '9999'));
  const letzte = (arbeiten.data ?? []).filter((a) => a.status === 'erledigt').slice(0, 4);
  const maschinen = useMaschinen();
  const wartung = useWartungFaellig();
  const maschEintraege = useMaschinenEintraege();
  const maschName = (id: string) => maschinen.data?.find((m) => m.id === id)?.name ?? '';
  const maschinenHinweise = [
    ...(wartung.data ?? []).filter((w) => w.bald_faellig || w.ueberfaellig).map((w) => ({
      id: w.plan_id, maschine: w.maschine_id, text: `${w.bezeichnung} ${w.ueberfaellig ? 'überfällig' : 'bald fällig'}`, rot: w.ueberfaellig,
    })),
    ...(maschinen.data ?? [])
      .filter((m) => m.status === 'in Betrieb' && (tageBis(m.mfk_faellig) ?? 999) <= 60)
      .map((m) => ({ id: `mfk-${m.id}`, maschine: m.id, text: `MFK ${(tageBis(m.mfk_faellig) ?? 0) < 0 ? 'abgelaufen' : 'bald'}`, rot: (tageBis(m.mfk_faellig) ?? 0) < 0 })),
    ...(maschEintraege.data ?? []).filter((e) => e.offen).map((e) => ({ id: e.id, maschine: e.maschine_id, text: e.titel, rot: false })),
  ];

  const aktive = (felder.data ?? []).filter((f) => f.status === 'bewirtschaftet');
  const gesamtM2 = aktive.reduce((s, f) => s + Number(f.flaeche_m2), 0);
  const zugeordnetM2 = (kulturen.data ?? []).reduce((s, k) => s + Number(k.flaeche_m2), 0);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <span className="text-sm font-semibold text-leise">{wochentagDatum()}</span>
        <h1 className="m-0 text-3xl font-extrabold text-hof">Grüezi{profil?.name ? `, ${profil.name.split(' ')[0]}` : ''}</h1>
      </header>

      <Link to="/felder" className="flex flex-col gap-3 rounded-[22px] bg-hof p-5 text-white no-underline shadow-[0_4px_0_var(--color-hof-dunkel)]">
        <span className="text-xs font-bold tracking-wider text-[#CFE3C9]">MEIN BETRIEB · ANBAUJAHR {jahr}</span>
        <div className="grid grid-cols-3 gap-2">
          <Kennzahl wert={ha(gesamtM2, 1).replace(' ha', '')} text="Hektaren" />
          <Kennzahl wert={String(aktive.length)} text="Felder" />
          <Kennzahl wert={String(kulturen.data?.length ?? 0)} text="Kulturen" />
        </div>
        {kulturen.data && kulturen.data.length > 0 ? (
          <>
            <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`Flächenanteile der Kulturen ${jahr}`}>
              {kulturen.data.map((k) => (
                <div key={k.kultur_id} style={{ flex: Number(k.flaeche_m2), background: k.farbe }} />
              ))}
            </div>
            <span className="text-xs text-[#CFE3C9]">
              {kulturen.data.map((k) => `${k.kultur} ${ha(Number(k.flaeche_m2), 1).replace(' ha', '')}`).join(' · ')} ha
            </span>
          </>
        ) : (
          <span className="text-sm text-[#CFE3C9]">Noch keine Kulturen für {jahr} erfasst.</span>
        )}
      </Link>

      {felder.data && felder.data.length === 0 && (
        <section className="karte flex flex-col gap-3">
          <h2 className="m-0 text-lg font-extrabold">Los geht's</h2>
          <p className="m-0 text-sm text-leise">Lege zuerst deine Felder an. Danach kannst du die Fruchtfolge eintragen.</p>
          <Link to="/felder/neu" className="knopf self-start no-underline">
            <Icon name="plus" /> Erstes Feld anlegen
          </Link>
        </section>
      )}

      {felder.data && felder.data.length > 0 && gesamtM2 - zugeordnetM2 > 1 && (
        <Link to="/fruchtfolge" className="karte flex items-start gap-3 text-text no-underline">
          <span className="text-warn">
            <Icon name="warnung" />
          </span>
          <span className="flex flex-col">
            <span className="font-extrabold">Kulturen {jahr} unvollständig</span>
            <span className="text-sm text-leise">{ha(gesamtM2 - zugeordnetM2)} ohne Kultur. In der Fruchtfolge ergänzen.</span>
          </span>
        </Link>
      )}

      {knapp.length > 0 && (
        <Link to="/lager" className="karte flex flex-col gap-2 text-text no-underline">
          <span className="flex items-center gap-2 text-xs font-extrabold text-warn">
            <Icon name="warnung" groesse={16} /> LAGER UNTER MINDESTBESTAND
          </span>
          {knapp.slice(0, 4).map((a) => (
            <span key={a.id} className="flex justify-between text-sm">
              <span className="font-bold">{a.bezeichnung}</span>
              <span>
                {menge(Number(a.bestand), a.einheit)} / min. {menge(Number(a.mindestbestand), a.einheit)}
              </span>
            </span>
          ))}
        </Link>
      )}

      {maschinenHinweise.length > 0 && (
        <Link to="/maschinen" className="karte flex flex-col gap-2 text-text no-underline">
          <span className="flex items-center gap-2 text-xs font-extrabold text-warn">
            <Icon name="traktor" groesse={16} /> MASCHINEN
          </span>
          {maschinenHinweise.slice(0, 5).map((h) => (
            <span key={h.id} className="flex justify-between gap-2 text-sm">
              <span className="font-bold">{maschName(h.maschine)}</span>
              <span className={h.rot ? 'font-bold text-fehler' : ''}>{h.text}</span>
            </span>
          ))}
        </Link>
      )}

      <section className="karte flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="m-0 text-lg font-extrabold">Aufgaben</h2>
          <Link to="/aufgaben" className="text-sm font-bold">
            Alle ({todo.length})
          </Link>
        </div>
        {todo.length === 0 && <p className="m-0 text-sm text-leise">Nichts geplant.</p>}
        {todo.slice(0, 5).map((a) => (
          <Link key={a.key} to={a.link} className="flex justify-between gap-2 text-sm text-text no-underline">
            <span className="font-bold">{a.text}</span>
            <span className={a.datum && a.datum < heuteIso ? 'shrink-0 font-bold text-fehler' : 'shrink-0 text-leise'}>{a.datum ? datum(a.datum) : ''}</span>
          </Link>
        ))}
      </section>

      <section className="karte flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="m-0 text-lg font-extrabold">Letzte Arbeiten</h2>
          <Link to="/kartei" className="text-sm font-bold">
            Ackerschlagkartei
          </Link>
        </div>
        {letzte.length === 0 && <p className="m-0 text-sm text-leise">Noch keine Arbeiten erfasst. Mit dem grünen + geht es los.</p>}
        {letzte.map((a) => (
          <Link key={a.id} to={`/arbeiten/${a.id}`} className="flex flex-col text-text no-underline">
            <span className="font-bold">
              {a.arbeitsart} · {a.feldarbeit_felder.map((f) => feldName.get(f.feld_id)).join(', ')}
            </span>
            <span className="text-xs text-leise">
              {datum(a.datum)}
              {a.feldarbeit_mittel.map((m) => ` · ${m.lagerartikel?.bezeichnung} ${menge(m.menge_je_ha)} ${m.lagerartikel?.einheit}/ha`).join('')}
            </span>
          </Link>
        ))}
      </section>
    </div>
  );
}

function Kennzahl({ wert, text }: { wert: string; text: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-3xl font-extrabold">{wert}</span>
      <span className="text-sm text-[#CFE3C9]">{text}</span>
    </div>
  );
}

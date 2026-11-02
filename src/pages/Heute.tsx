import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useFelder, useFlaecheJeKultur } from '../lib/daten';
import { ha, wochentagDatum } from '../lib/format';
import { Icon } from '../components/Icon';

export function Heute() {
  const { profil } = useAuth();
  const jahr = new Date().getFullYear();
  const felder = useFelder();
  const kulturen = useFlaecheJeKultur(jahr);

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

      <section className="karte flex flex-col gap-2">
        <h2 className="m-0 text-lg font-extrabold">Bald verfügbar</h2>
        <p className="m-0 text-sm text-leise">
          Aufgaben, Feldarbeiten, Düngung und Lagerwarnungen erscheinen hier, sobald diese Module gebaut sind.
        </p>
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

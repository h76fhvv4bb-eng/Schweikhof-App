import { Link } from 'react-router-dom';
import { useArbeitenVon, useAufgaben, useAuftraege, useErnten, useFelder, useMitarbeiter } from '../lib/daten';
import { datum, menge } from '../lib/format';

/** Verknüpfte Arbeiten, Ernten, Aufträge und Aufgaben zu einem Feld, einer Maschine oder einem Partner */
export function Verlauf({ art, id, titel = 'Arbeiten und Verlauf' }: { art: 'feld' | 'maschine' | 'partner'; id: string; titel?: string }) {
  const arbeiten = useArbeitenVon(art, id);
  const ernten = useErnten();
  const auftraege = useAuftraege();
  const aufgaben = useAufgaben('offen');
  const felder = useFelder();
  const mitarbeiter = useMitarbeiter();
  const feldName = (fid: string) => felder.data?.find((f) => f.id === fid)?.name ?? '';
  const person = (mid: string | null | undefined) => (mid ? mitarbeiter.data?.find((m) => m.id === mid)?.name.split(' ')[0] : null);

  const geplant = (arbeiten.data ?? []).filter((a) => a.status === 'geplant');
  const erledigt = (arbeiten.data ?? []).filter((a) => a.status === 'erledigt').slice(0, 10);
  const offeneAuftraege = (auftraege.data ?? []).filter(
    (a) =>
      !['Erledigt', 'Abgebrochen'].includes(a.status) &&
      (art === 'feld' ? a.auftrag_felder.some((f) => f.feld_id === id) : art === 'maschine' ? a.maschine_id === id : a.partner_id === id),
  );
  const maschAufgaben = art === 'maschine' ? (aufgaben.data ?? []).filter((a) => a.maschine_id === id) : [];
  const feldErnten = art === 'feld' ? (ernten.data ?? []).filter((e) => e.feld_id === id).slice(0, 6) : [];
  const stunden = art === 'maschine' ? erledigt.reduce((s, a) => s + Number(a.dauer_h ?? 0), 0) : 0;

  const leer = !geplant.length && !erledigt.length && !offeneAuftraege.length && !maschAufgaben.length && !feldErnten.length;

  return (
    <section className="karte flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-lg font-extrabold">{titel}</h2>
        {art === 'feld' && (
          <span className="flex flex-wrap gap-3 text-sm font-bold">
            <Link to={`/erfassen?feld=${id}`}>+ Arbeit</Link>
            <Link to={`/erfassen?geplant=1&feld=${id}`}>Planen</Link>
            <Link to={`/ernte/neu?feld=${id}`}>Ernte</Link>
          </span>
        )}
      </div>
      {leer && <p className="m-0 text-sm text-leise">Noch nichts verknüpft.</p>}

      {(geplant.length > 0 || offeneAuftraege.length > 0 || maschAufgaben.length > 0) && <span className="text-xs font-extrabold text-leise">OFFEN</span>}
      {geplant.map((a) => (
        <Link key={a.id} to={`/arbeiten/${a.id}`} className="flex justify-between gap-2 text-sm text-text no-underline">
          <span>
            <strong>{a.arbeitsart}</strong>
            {art !== 'feld' && ` · ${a.feldarbeit_felder.map((f) => feldName(f.feld_id)).join(', ')}`}
            {person(a.mitarbeiter_id) && ` · ${person(a.mitarbeiter_id)}`}
          </span>
          <span className="shrink-0 text-leise">geplant {datum(a.datum)}</span>
        </Link>
      ))}
      {offeneAuftraege.map((a) => (
        <Link key={a.id} to={`/auftraege/${a.id}`} className="flex justify-between gap-2 text-sm text-text no-underline">
          <span>
            Auftrag {a.nummer} · <strong>{a.titel}</strong>
          </span>
          <span className="shrink-0 text-leise">{a.status}</span>
        </Link>
      ))}
      {maschAufgaben.map((a) => (
        <Link key={a.id} to="/aufgaben" className="flex justify-between gap-2 text-sm text-text no-underline">
          <span>
            {a.eintragsart}: <strong>{a.titel}</strong>
          </span>
          <span className="shrink-0 text-leise">{a.faellig_am ? `bis ${datum(a.faellig_am)}` : 'offen'}</span>
        </Link>
      ))}

      {erledigt.length > 0 && (
        <span className="text-xs font-extrabold text-leise">
          ERLEDIGT{stunden > 0 ? ` · ${menge(stunden)} h in den letzten Einsätzen` : ''}
        </span>
      )}
      {erledigt.map((a) => (
        <Link key={a.id} to={`/arbeiten/${a.id}`} className="flex justify-between gap-2 text-sm text-text no-underline">
          <span>
            <strong>{a.arbeitsart}</strong>
            {art !== 'feld' && ` · ${a.feldarbeit_felder.map((f) => feldName(f.feld_id)).join(', ')}`}
            {a.feldarbeit_mittel.length > 0 && ` · ${a.feldarbeit_mittel.map((m) => m.lagerartikel?.bezeichnung).join(', ')}`}
            {a.dauer_h != null && ` · ${menge(Number(a.dauer_h))} h`}
            {a.maschine_stunden != null && art === 'maschine' && ` · Zähler ${menge(Number(a.maschine_stunden))}`}
          </span>
          <span className="shrink-0 text-leise">{datum(a.datum)}</span>
        </Link>
      ))}

      {feldErnten.length > 0 && <span className="text-xs font-extrabold text-leise">ERNTEN</span>}
      {feldErnten.map((e) => (
        <Link key={e.id} to={`/ernte/${e.id}`} className="flex justify-between gap-2 text-sm text-text no-underline">
          <span>
            {e.ernte_produkte
              .map((p) => `${p.produkt}${p.ballen != null ? ` ${p.ballen} B.` : ''}${p.menge_kg != null ? ` ${Number(p.menge_kg).toLocaleString('de-CH')} kg` : ''}`)
              .join(' · ')}
            {e.schnitt ? ` · ${e.schnitt}. Schnitt` : ''}
          </span>
          <span className="shrink-0 text-leise">{datum(e.datum)}</span>
        </Link>
      ))}
    </section>
  );
}

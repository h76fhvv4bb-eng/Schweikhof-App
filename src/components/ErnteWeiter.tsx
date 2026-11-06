import { Link } from 'react-router-dom';
import { Icon } from './Icon';

/** Nach einer Erntearbeit: direkt Ertrag erfassen oder später */
export function ErnteWeiter({ titel, link, onSpaeter }: { titel: string; link: string; onSpaeter: () => void }) {
  return (
    <div className="fixed inset-0 z-[2100] flex items-end justify-center bg-black/30 p-3 md:items-center" role="dialog" aria-label="Ertrag erfassen">
      <div className="karte flex w-full max-w-md flex-col gap-3">
        <span className="text-xs font-extrabold tracking-wider text-hof">ERLEDIGT</span>
        <h2 className="m-0 text-xl font-extrabold">{titel}</h2>
        <p className="m-0 text-sm text-leise">Jetzt die Erntemenge erfassen? Feld, Datum, Fläche und Lohnunternehmen sind schon eingetragen.</p>
        <Link to={link} className="knopf h-14 text-lg no-underline">
          <Icon name="ernte" /> Ertrag jetzt erfassen
        </Link>
        <button className="knopf-leise" onClick={onSpaeter}>
          Später
        </button>
      </div>
    </div>
  );
}

import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { NAVIGATION } from '../components/AppShell';
import { Icon } from '../components/Icon';

export function Mehr() {
  const { profil, abmelden } = useAuth();
  return (
    <div className="flex flex-col gap-3">
      <h1 className="m-0 text-3xl font-extrabold text-hof">Mehr</h1>
      {NAVIGATION.filter((n) => n.pfad !== '/').map((n) => (
        <Link key={n.pfad} to={n.pfad} className="karte flex min-h-14 items-center gap-3 p-3 font-extrabold text-text no-underline">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-hof-hell text-hof">
            <Icon name={n.icon} />
          </span>
          <span className="flex-1">{n.text}</span>
          <Icon name="weiter" groesse={18} className="text-[#9AA59C]" />
        </Link>
      ))}
      <div className="karte flex flex-col gap-2">
        <span className="text-sm text-leise">
          Angemeldet als {profil?.name} ({profil?.rolle})
        </span>
        <button className="knopf-leise" onClick={abmelden}>
          <Icon name="abmelden" /> Abmelden
        </button>
      </div>
    </div>
  );
}

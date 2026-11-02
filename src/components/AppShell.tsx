import { NavLink, Outlet } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import { useAuth } from '../lib/auth';

const navigation: { pfad: string; text: string; icon: IconName }[] = [
  { pfad: '/', text: 'Heute', icon: 'heute' },
  { pfad: '/felder', text: 'Felder', icon: 'felder' },
  { pfad: '/fruchtfolge', text: 'Fruchtfolge', icon: 'fruchtfolge' },
];

export function AppShell() {
  const { profil, abmelden } = useAuth();
  return (
    <div className="md:flex md:min-h-screen">
      {/* Seitenleiste ab Tablet */}
      <aside className="hidden w-60 shrink-0 flex-col gap-1 p-4 md:flex">
        <div className="mb-4 flex items-center gap-2 px-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-hof text-white">
            <Icon name="heute" />
          </span>
          <span className="text-lg font-extrabold text-hof">Hofmanager</span>
        </div>
        {navigation.map((n) => (
          <NavLink
            key={n.pfad}
            to={n.pfad}
            end={n.pfad === '/'}
            className={({ isActive }) =>
              `flex min-h-11 items-center gap-3 rounded-xl px-3 font-bold ${isActive ? 'bg-hof text-white' : 'text-[#3E4C41] hover:bg-white'}`
            }
          >
            <Icon name={n.icon} />
            {n.text}
          </NavLink>
        ))}
        <div className="mt-auto flex flex-col gap-2 px-2 text-sm text-leise">
          <span>
            {profil?.name} · {profil?.rolle}
          </span>
          <button className="knopf-leise" onClick={abmelden}>
            Abmelden
          </button>
        </div>
      </aside>

      <main className="mx-auto w-full max-w-5xl min-w-0 px-4 pb-32 pt-6 md:px-8 md:pb-10">
        <Outlet />
      </main>

      {/* Untere Leiste auf dem Handy */}
      <nav
        aria-label="Hauptnavigation"
        className="fixed inset-x-0 bottom-0 grid grid-cols-4 items-center border-t border-rand bg-white px-2 pb-[max(14px,env(safe-area-inset-bottom))] pt-2 md:hidden"
      >
        {navigation.map((n) => (
          <NavLink
            key={n.pfad}
            to={n.pfad}
            end={n.pfad === '/'}
            className={({ isActive }) =>
              `flex min-h-11 flex-col items-center gap-0.5 text-[11px] ${isActive ? 'font-extrabold text-hof' : 'font-bold text-leise'}`
            }
          >
            <Icon name={n.icon} groesse={24} />
            {n.text}
          </NavLink>
        ))}
        <button onClick={abmelden} className="flex min-h-11 flex-col items-center gap-0.5 text-[11px] font-bold text-leise">
          <Icon name="mehr" groesse={24} />
          Abmelden
        </button>
      </nav>
    </div>
  );
}

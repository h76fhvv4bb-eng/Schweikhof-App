import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import { useAuth } from '../lib/auth';
import { APP_KURZ } from '../lib/marke';
import { useBetrieb } from '../lib/daten';

export const NAVIGATION: { pfad: string; text: string; icon: IconName; gruppe: string }[] = [
  { pfad: '/', text: 'Heute', icon: 'heute', gruppe: 'Übersicht' },
  { pfad: '/aufgaben', text: 'Aufgaben', icon: 'aufgaben', gruppe: 'Übersicht' },
  { pfad: '/felder', text: 'Felder', icon: 'felder', gruppe: 'Pflanzenbau' },
  { pfad: '/fruchtfolge', text: 'Fruchtfolge', icon: 'fruchtfolge', gruppe: 'Pflanzenbau' },
  { pfad: '/ernte', text: 'Ernte & Erträge', icon: 'ernte', gruppe: 'Pflanzenbau' },
  { pfad: '/kartei', text: 'Ackerschlagkartei', icon: 'kartei', gruppe: 'Pflanzenbau' },
  { pfad: '/naehrstoffe', text: 'Nährstoffe', icon: 'tropfen', gruppe: 'Pflanzenbau' },
  { pfad: '/kontrolle', text: 'Kontrolle', icon: 'kontrolle', gruppe: 'Pflanzenbau' },
  { pfad: '/lager', text: 'Lager', icon: 'lager', gruppe: 'Betrieb' },
  { pfad: '/digiflux', text: 'digiFLUX (Hofdünger)', icon: 'tropfen', gruppe: 'Betrieb' },
  { pfad: '/verkauf', text: 'Verkauf', icon: 'verkauf', gruppe: 'Betrieb' },
  { pfad: '/maschinen', text: 'Maschinen', icon: 'traktor', gruppe: 'Betrieb' },
  { pfad: '/mitarbeiter', text: 'Mitarbeitende', icon: 'partner', gruppe: 'Betrieb' },
  { pfad: '/partner', text: 'Partner', icon: 'partner', gruppe: 'Betrieb' },
  { pfad: '/weide', text: 'Weidegäste', icon: 'weide', gruppe: 'Betrieb' },
  { pfad: '/richtpreise', text: 'Richtpreise', icon: 'verkauf', gruppe: 'Betrieb' },
  { pfad: '/betrieb', text: 'Betrieb', icon: 'heute', gruppe: 'Betrieb' },
  { pfad: '/auftraege', text: 'Aufträge', icon: 'auftrag', gruppe: 'Betrieb' },
];

const unten: { pfad: string; text: string; icon: IconName }[] = [
  { pfad: '/', text: 'Heute', icon: 'heute' },
  { pfad: '/felder', text: 'Felder', icon: 'felder' },
  { pfad: '/aufgaben', text: 'Aufgaben', icon: 'aufgaben' },
  { pfad: '/mehr', text: 'Mehr', icon: 'mehr' },
];

export function AppShell() {
  const { profil, abmelden } = useAuth();
  const ort = useLocation();
  useBetrieb(); // lädt die Betriebsdaten früh (Betriebsnummer in allen Exporten)
  const gruppen = [...new Set(NAVIGATION.map((n) => n.gruppe))];
  return (
    <div className="md:flex md:min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col gap-1 p-4 md:flex print:hidden">
        <div className="mb-2 flex items-center gap-2 px-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-hof text-white">
            <Icon name="heute" />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-[11px] font-bold text-leise">Hofmanager</span>
            <span className="text-lg font-extrabold text-hof">{APP_KURZ}</span>
          </span>
        </div>
        {profil?.rolle !== 'lesen' && (
          <NavLink to="/erfassen" className="knopf mb-2 no-underline">
            <Icon name="plus" /> Arbeit erfassen
          </NavLink>
        )}
        {gruppen.map((g) => (
          <div key={g} className="flex flex-col gap-1">
            <span className="px-3 pt-3 text-[11px] font-extrabold tracking-wider text-[#6B776D]">{g.toUpperCase()}</span>
            {NAVIGATION.filter((n) => n.gruppe === g).map((n) => (
              <NavLink
                key={n.pfad}
                to={n.pfad}
                end={n.pfad === '/'}
                className={({ isActive }) =>
                  `flex min-h-11 items-center gap-3 rounded-xl px-3 font-bold no-underline ${isActive ? 'bg-hof text-white' : 'text-[#3E4C41] hover:bg-white'}`
                }
              >
                <Icon name={n.icon} />
                {n.text}
              </NavLink>
            ))}
          </div>
        ))}
        <div className="mt-auto flex flex-col gap-2 px-2 pt-6 text-sm text-leise">
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

      {ort.pathname !== '/erfassen' && !ort.pathname.startsWith('/arbeiten/') && (
        <nav
          aria-label="Hauptnavigation"
          className="fixed inset-x-0 bottom-0 grid grid-cols-5 items-center border-t border-rand bg-white px-2 pb-[max(14px,env(safe-area-inset-bottom))] pt-2 md:hidden print:hidden"
        >
          {unten.slice(0, 2).map((n) => (
            <UntenLink key={n.pfad} {...n} />
          ))}
          {profil?.rolle !== 'lesen' ? (
            <NavLink
              to="/erfassen"
              aria-label="Arbeit erfassen"
              className="-mt-8 flex h-16 w-16 items-center justify-center justify-self-center rounded-full bg-hof text-white shadow-[0_4px_0_var(--color-hof-dunkel)]"
            >
              <Icon name="plus" groesse={30} />
            </NavLink>
          ) : (
            <span />
          )}
          {unten.slice(2).map((n) => (
            <UntenLink key={n.pfad} {...n} />
          ))}
        </nav>
      )}
    </div>
  );
}

function UntenLink({ pfad, text, icon }: { pfad: string; text: string; icon: IconName }) {
  return (
    <NavLink
      to={pfad}
      end={pfad === '/'}
      className={({ isActive }) =>
        `flex min-h-11 flex-col items-center gap-0.5 text-[11px] no-underline ${isActive ? 'font-extrabold text-hof' : 'font-bold text-leise'}`
      }
    >
      <Icon name={icon} groesse={24} />
      {text}
    </NavLink>
  );
}

import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { konfigurationFehlt } from './lib/supabase';
import { AppShell } from './components/AppShell';
import { Login } from './pages/Login';
import { Einrichten } from './pages/Einrichten';
import { Heute } from './pages/Heute';
import { Felder } from './pages/Felder';
import { FeldFormular } from './pages/FeldFormular';
import { Fruchtfolge } from './pages/Fruchtfolge';

export function App() {
  const { session, profil, laedt } = useAuth();

  if (konfigurationFehlt)
    return (
      <p className="p-6">
        Die Verbindung zur Datenbank ist nicht eingerichtet. VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY fehlen (siehe README).
      </p>
    );
  if (laedt) return <p className="p-6 text-leise">Lade …</p>;
  if (!session) return <Login />;
  if (profil === null) return <Einrichten />;
  if (profil && !profil.aktiv) return <p className="p-6">Dein Konto ist deaktiviert.</p>;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Heute />} />
        <Route path="felder" element={<Felder />} />
        <Route path="felder/neu" element={<FeldFormular />} />
        <Route path="felder/:id" element={<FeldFormular />} />
        <Route path="fruchtfolge" element={<Fruchtfolge />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

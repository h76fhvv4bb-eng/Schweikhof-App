import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { konfigurationFehlt } from './lib/supabase';
import { AppShell } from './components/AppShell';
import { Login, NeuesPasswort } from './pages/Login';
import { Benutzer } from './pages/Benutzer';
import { Einrichten } from './pages/Einrichten';
import { Heute } from './pages/Heute';
import { Felder } from './pages/Felder';
import { FeldFormular } from './pages/FeldFormular';
import { Fruchtfolge } from './pages/Fruchtfolge';
import { Erfassen } from './pages/Erfassen';
import { Kartei } from './pages/Kartei';
import { Lager } from './pages/Lager';
import { LagerArtikel } from './pages/LagerArtikel';
import { Naehrstoffe } from './pages/Naehrstoffe';
import { Mehr } from './pages/Mehr';
import { Maschinen } from './pages/Maschinen';
import { MaschineDetail } from './pages/MaschineDetail';
import { PartnerFormular, PartnerListe } from './pages/Partner';
import { AuftraegeListe, AuftragFormular } from './pages/Auftraege';
import { ErnteFormular, ErnteListe } from './pages/Ernte';
import { ErnteSammel } from './pages/ErnteSammel';
import { Aufgaben } from './pages/Aufgaben';
import { MitarbeiterSeite } from './pages/Mitarbeiter';
import { VerkaufFormular, VerkaufListe } from './pages/Verkauf';
import { Kontrolle } from './pages/Kontrolle';
import { BetriebSeite } from './pages/Betrieb';
import { WeideFormular, WeideListe } from './pages/Weide';

export function App() {
  const { session, profil, laedt, passwortNeu } = useAuth();

  if (konfigurationFehlt)
    return (
      <p className="p-6">
        Die Verbindung zur Datenbank ist nicht eingerichtet. VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY fehlen (siehe README).
      </p>
    );
  if (laedt) return <p className="p-6 text-leise">Lade …</p>;
  if (!session) return <Login />;
  if (passwortNeu) return <NeuesPasswort />;
  if (profil === null) return <Einrichten />;
  if (profil && !profil.aktiv) return <p className="p-6">Dein Konto ist deaktiviert.</p>;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Heute />} />
        <Route path="aufgaben" element={<Aufgaben />} />
        <Route path="felder" element={<Felder />} />
        <Route path="felder/neu" element={<FeldFormular />} />
        <Route path="felder/:id" element={<FeldFormular />} />
        <Route path="fruchtfolge" element={<Fruchtfolge />} />
        <Route path="erfassen" element={<Erfassen />} />
        <Route path="arbeiten/:id" element={<Erfassen />} />
        <Route path="ernte" element={<ErnteListe />} />
        <Route path="ernte/neu" element={<ErnteFormular />} />
        <Route path="ernte/sammel" element={<ErnteSammel />} />
        <Route path="ernte/:id" element={<ErnteFormular />} />
        <Route path="kartei" element={<Kartei />} />
        <Route path="kontrolle" element={<Kontrolle />} />
        <Route path="naehrstoffe" element={<Naehrstoffe />} />
        <Route path="lager" element={<Lager />} />
        <Route path="lager/neu" element={<LagerArtikel />} />
        <Route path="lager/:id" element={<LagerArtikel />} />
        <Route path="mehr" element={<Mehr />} />
        <Route path="betrieb" element={<BetriebSeite />} />
        <Route path="weide" element={<WeideListe />} />
        <Route path="weide/neu" element={<WeideFormular />} />
        <Route path="weide/:id" element={<WeideFormular />} />
        <Route path="benutzer" element={<Benutzer />} />
        <Route path="mitarbeiter" element={<MitarbeiterSeite />} />
        <Route path="verkauf" element={<VerkaufListe />} />
        <Route path="verkauf/neu" element={<VerkaufFormular />} />
        <Route path="verkauf/:id" element={<VerkaufFormular />} />
        <Route path="maschinen" element={<Maschinen />} />
        <Route path="maschinen/neu" element={<MaschineDetail />} />
        <Route path="maschinen/:id" element={<MaschineDetail />} />
        <Route path="partner" element={<PartnerListe />} />
        <Route path="partner/neu" element={<PartnerFormular />} />
        <Route path="partner/:id" element={<PartnerFormular />} />
        <Route path="auftraege" element={<AuftraegeListe />} />
        <Route path="auftraege/neu" element={<AuftragFormular />} />
        <Route path="auftraege/:id" element={<AuftragFormular />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

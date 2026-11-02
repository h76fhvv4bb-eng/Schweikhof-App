import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { Profil } from './typen';

interface AuthWert {
  session: Session | null;
  laedt: boolean;
  profil: Profil | null | undefined; // undefined = lädt, null = noch kein Betrieb
  darfVerwalten: boolean;
  abmelden: () => Promise<void>;
  passwortNeu: boolean;
  passwortGesetzt: () => void;
}

const AuthKontext = createContext<AuthWert | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [laedt, setLaedt] = useState(true);
  const [passwortNeu, setPasswortNeu] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLaedt(false);
    });
    const { data } = supabase.auth.onAuthStateChange((ereignis, s) => {
      setSession(s);
      if (ereignis === 'PASSWORD_RECOVERY') setPasswortNeu(true);
      qc.invalidateQueries();
    });
    return () => data.subscription.unsubscribe();
  }, [qc]);

  const profilQuery = useQuery({
    queryKey: ['profil', session?.user.id],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('benutzer_profile')
        .select('id, betrieb_id, name, rolle, aktiv')
        .eq('id', session!.user.id)
        .maybeSingle();
      if (error) throw error;
      return (data as Profil | null) ?? null;
    },
  });

  const profil = session ? profilQuery.data : null;
  const wert: AuthWert = {
    session,
    laedt: laedt || (!!session && profilQuery.isLoading),
    profil,
    darfVerwalten: profil?.rolle === 'administrator' || profil?.rolle === 'betriebsleiter',
    abmelden: async () => {
      await supabase.auth.signOut();
      qc.clear();
    },
    passwortNeu,
    passwortGesetzt: () => setPasswortNeu(false),
  };
  return <AuthKontext.Provider value={wert}>{children}</AuthKontext.Provider>;
}

export function useAuth(): AuthWert {
  const k = useContext(AuthKontext);
  if (!k) throw new Error('useAuth ausserhalb von AuthProvider');
  return k;
}

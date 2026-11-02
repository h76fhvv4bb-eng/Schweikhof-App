import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { Anbau, Feld, Feldarbeit, FlaecheJeKultur, Hofobjekt, Kultur, Lagerbestand, NaehrstoffeJeFeld } from './typen';

export function useFelder() {
  return useQuery({
    queryKey: ['felder'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('felder')
        .select('*')
        .is('geloescht_am', null)
        .order('feldnummer', { ascending: true });
      if (error) throw error;
      return data as Feld[];
    },
  });
}

export function useKulturen() {
  return useQuery({
    queryKey: ['kulturen'],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from('kulturen').select('*').eq('aktiv', true).order('kulturgruppe').order('name');
      if (error) throw error;
      return data as Kultur[];
    },
  });
}

export function useAnbau(vonJahr: number, bisJahr: number) {
  return useQuery({
    queryKey: ['anbau', vonJahr, bisJahr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('anbau')
        .select('id, feld_id, kultur_id, jahr, art, status, version, kulturen(name, farbe)')
        .eq('art', 'Hauptkultur')
        .gte('jahr', vonJahr)
        .lte('jahr', bisJahr);
      if (error) throw error;
      return data as unknown as Anbau[];
    },
  });
}

export function useFlaecheJeKultur(jahr: number) {
  return useQuery({
    queryKey: ['flaeche_je_kultur', jahr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('flaeche_je_kultur')
        .select('*')
        .eq('jahr', jahr)
        .order('flaeche_m2', { ascending: false });
      if (error) throw error;
      return data as FlaecheJeKultur[];
    },
  });
}

export function useLager() {
  return useQuery({
    queryKey: ['lager'],
    queryFn: async () => {
      const { data, error } = await supabase.from('lagerbestand').select('*').eq('aktiv', true).order('kategorie').order('bezeichnung');
      if (error) throw error;
      return data as Lagerbestand[];
    },
  });
}

const FELDARBEIT_SELECT =
  'id, datum, arbeitsart, status, dauer_h, maschine, geraet, ausgefuehrt_von, ausbringung, bemerkungen, erstellt_von, version,' +
  ' feldarbeit_felder(feld_id, flaeche_m2, anbau(kulturen(name))),' +
  ' feldarbeit_mittel(artikel_id, menge_je_ha, gesamtmenge, lagerartikel(bezeichnung, einheit))';

export function useFeldarbeiten(jahr: number) {
  return useQuery({
    queryKey: ['feldarbeiten', jahr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('feldarbeiten')
        .select(FELDARBEIT_SELECT)
        .is('geloescht_am', null)
        .gte('datum', `${jahr}-01-01`)
        .lte('datum', `${jahr}-12-31`)
        .order('datum', { ascending: false });
      if (error) throw error;
      return data as unknown as Feldarbeit[];
    },
  });
}

export function useFeldarbeit(id: string | undefined) {
  return useQuery({
    queryKey: ['feldarbeit', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('feldarbeiten').select(FELDARBEIT_SELECT).eq('id', id!).single();
      if (error) throw error;
      return data as unknown as Feldarbeit;
    },
  });
}

export function useNaehrstoffe(jahr: number) {
  return useQuery({
    queryKey: ['naehrstoffe', jahr],
    queryFn: async () => {
      const { data, error } = await supabase.from('naehrstoffe_je_feld').select('*').eq('jahr', jahr);
      if (error) throw error;
      return data as NaehrstoffeJeFeld[];
    },
  });
}

export function useBenutzer() {
  return useQuery({
    queryKey: ['benutzer'],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from('benutzer_profile').select('id, name, rolle, aktiv').order('name');
      if (error) throw error;
      return data as { id: string; name: string; rolle: string; aktiv: boolean }[];
    },
  });
}

/** Nach jeder Buchung: alles neu laden, was vom Lager oder den Arbeiten abhängt. */
export const ABHAENGIGE_DATEN = [['lager'], ['feldarbeiten'], ['feldarbeit'], ['naehrstoffe'], ['lagerjournal']];

export function useBetrieb() {
  return useQuery({
    queryKey: ['betrieb'],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from('betriebe').select('id, name, kanton').maybeSingle();
      if (error) throw error;
      return data as { id: string; name: string; kanton: string } | null;
    },
  });
}

export function useHofobjekte() {
  return useQuery({
    queryKey: ['hofobjekte'],
    queryFn: async () => {
      const { data, error } = await supabase.from('hofobjekte').select('*').order('typ');
      if (error) throw error;
      return data as Hofobjekt[];
    },
  });
}

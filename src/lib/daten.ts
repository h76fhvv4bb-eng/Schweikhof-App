import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { Anbau, Feld, FlaecheJeKultur, Kultur } from './typen';

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

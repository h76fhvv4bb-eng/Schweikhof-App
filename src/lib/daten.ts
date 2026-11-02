import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import type {
  Anbau, Feld, Feldarbeit, FeldHinweis, FlaecheJeKultur, Hofobjekt, Kultur, Lagerbestand, Maschine, MaschinenEintrag,
  NaehrstoffeJeFeld, Partner, WartungFaellig, Wartungsplan, Auftrag, Ernte,
} from './typen';

export function useFelder() {
  return useQuery({
    queryKey: ['felder'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('felder')
        .select('*')
        .is('geloescht_am', null)
        .neq('status', 'zusammengeführt')
        .order('feldnummer', { ascending: true });
      if (error) throw error;
      return (data as Feld[]).sort((a, b) => a.feldnummer.localeCompare(b.feldnummer, 'de-CH', { numeric: true }));
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
        .select('id, feld_id, kultur_id, jahr, art, status, version, saatdatum, erntedatum, nur_monat, bemerkungen, kulturen(name, farbe)')
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
  'id, datum, arbeitsart, status, dauer_h, maschine, geraet, ausgefuehrt_von, ausbringung, bemerkungen, erstellt_von, version, maschine_id, geraet_id, partner_id,' +
  ' feldarbeit_felder(feld_id, flaeche_m2, anbau(kulturen(name))),' +
  ' feldarbeit_mittel(artikel_id, menge_je_ha, gesamtmenge, vom_lager, lagerartikel(bezeichnung, einheit))';

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
export const ABHAENGIGE_DATEN = [['lager'], ['feldarbeiten'], ['feldarbeit'], ['naehrstoffe'], ['lagerjournal'], ['maschinen'], ['maschineneintraege'], ['wartung']];

export function useBetrieb() {
  return useQuery({
    queryKey: ['betrieb'],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from('betriebe').select('id, name, kanton, adresse, telefon, email, version').maybeSingle();
      if (error) throw error;
      return data as { id: string; name: string; kanton: string; adresse: string | null; telefon: string | null; email: string | null; version: number } | null;
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

export function usePartner() {
  return useQuery({
    queryKey: ['partner'],
    queryFn: async () => {
      const { data, error } = await supabase.from('partner').select('*').order('art').order('name');
      if (error) throw error;
      return data as Partner[];
    },
  });
}

export function useMaschinen() {
  return useQuery({
    queryKey: ['maschinen'],
    queryFn: async () => {
      const { data, error } = await supabase.from('maschinen').select('*').order('kategorie').order('name');
      if (error) throw error;
      return data as Maschine[];
    },
  });
}

export function useWartungFaellig() {
  return useQuery({
    queryKey: ['wartung'],
    queryFn: async () => {
      const { data, error } = await supabase.from('wartung_faelligkeit').select('*');
      if (error) throw error;
      return data as WartungFaellig[];
    },
  });
}

export function useWartungsplaene(maschineId: string | undefined) {
  return useQuery({
    queryKey: ['wartungsplaene', maschineId],
    enabled: !!maschineId,
    queryFn: async () => {
      const { data, error } = await supabase.from('wartungsplaene').select('*').eq('maschine_id', maschineId!).eq('aktiv', true);
      if (error) throw error;
      return data as Wartungsplan[];
    },
  });
}

export function useMaschinenEintraege(maschineId?: string) {
  return useQuery({
    queryKey: ['maschineneintraege', maschineId ?? 'alle'],
    queryFn: async () => {
      let q = supabase
        .from('maschinen_eintraege')
        .select('*, eintrag_teile(artikel_id, menge, lagerartikel(bezeichnung, einheit))')
        .order('datum', { ascending: false })
        .limit(300);
      if (maschineId) q = q.eq('maschine_id', maschineId);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as MaschinenEintrag[];
    },
  });
}

export function useHinweise() {
  return useQuery({
    queryKey: ['hinweise'],
    queryFn: async () => {
      const { data, error } = await supabase.from('feld_hinweise').select('*').eq('aktiv', true).order('art');
      if (error) throw error;
      return data as FeldHinweis[];
    },
  });
}

const AUFTRAG_SELECT =
  '*, auftrag_felder(feld_id), auftrag_mittel(id, artikel_id, bezeichnung, kategorie, einheit, menge_je_ha, bereitstellung, bemerkung, lagerartikel(bezeichnung, einheit)), auftrag_beobachtungen(eintrag_id)';

export function useAuftraege() {
  return useQuery({
    queryKey: ['auftraege'],
    queryFn: async () => {
      const { data, error } = await supabase.from('auftraege').select(AUFTRAG_SELECT).order('erstellt_am', { ascending: false }).limit(300);
      if (error) throw error;
      return data as unknown as Auftrag[];
    },
  });
}

/** Alle Anbau-Einträge (Haupt- und Zwischenkulturen) für die Zeitachse */
export function useAnbauAlle(vonJahr: number, bisJahr: number) {
  return useQuery({
    queryKey: ['anbau', 'alle', vonJahr, bisJahr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('anbau')
        .select('id, feld_id, kultur_id, jahr, art, status, version, saatdatum, erntedatum, nur_monat, bemerkungen, kulturen(name, farbe)')
        .gte('jahr', vonJahr)
        .lte('jahr', bisJahr);
      if (error) throw error;
      return data as unknown as Anbau[];
    },
  });
}

export function useErnten(jahr?: number) {
  return useQuery({
    queryKey: ['ernten', jahr ?? 'alle'],
    queryFn: async () => {
      let q = supabase.from('ernten').select('*, ernte_abnehmer(*)').order('datum', { ascending: false }).limit(500);
      if (jahr) q = q.gte('datum', `${jahr}-01-01`).lte('datum', `${jahr}-12-31`);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as Ernte[];
    },
  });
}

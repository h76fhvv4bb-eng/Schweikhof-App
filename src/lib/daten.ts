import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { exportBetrieb } from './export';
import type {
  Beweidung,
  Anbau, Feld, Feldarbeit, FeldHinweis, FlaecheJeKultur, Hofobjekt, Kultur, Lagerbestand, Maschine, MaschinenEintrag,
  NaehrstoffeJeFeld, Partner, WartungFaellig, Wartungsplan, Auftrag, Ernte, Kartenobjekt, Aufgabe, Mitarbeiter, Betrieb, Verkauf, Foto, MaschinenTeil,
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
        .select('id, feld_id, kultur_id, jahr, art, status, version, saatdatum, erntedatum, nur_monat, bemerkungen, sorte, kulturen(name, farbe)')
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
  'id, datum, arbeitsart, status, dauer_h, maschine, geraet, ausgefuehrt_von, ausbringung, bemerkungen, erstellt_von, version, maschine_id, geraet_id, partner_id, maschine_stunden, maschine_km, geraet_stunden, beobachtung, beobachtung_eintrag_id, mitarbeiter_id, vorgaenger_id,' +
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
export const ABHAENGIGE_DATEN = [['lager'], ['feldarbeiten'], ['feldarbeit'], ['naehrstoffe'], ['lagerjournal'], ['maschinen'], ['maschineneintraege'], ['wartung'], ['aufgaben'], ['mitarbeiter_stunden'], ['auftraege'], ['fotos'], ['flaeche_je_kultur'], ['maschine_teile'], ['beweidungen']];

export function useBetrieb() {
  return useQuery({
    queryKey: ['betrieb'],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from('betriebe').select('*').maybeSingle();
      if (error) throw error;
      exportBetrieb(data as Betrieb | null);
      return data as Betrieb | null;
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

/** Weidegäste; optional nur ein Partner oder ein Feld */
export function useBeweidungen(filter: { partner_id?: string; feld_id?: string } = {}) {
  return useQuery({
    queryKey: ['beweidungen', filter.partner_id ?? null, filter.feld_id ?? null],
    queryFn: async () => {
      const { data, error } = await supabase.from('beweidungen').select('*, beweidung_felder(id, feld_id, flaeche_m2, von, bis)').order('von', { ascending: false });
      if (error) return [] as Beweidung[];
      return (data as Beweidung[]).filter(
        (b) => (!filter.partner_id || b.partner_id === filter.partner_id) && (!filter.feld_id || b.beweidung_felder.some((f) => f.feld_id === filter.feld_id)),
      );
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
        .select('id, feld_id, kultur_id, jahr, art, status, version, saatdatum, erntedatum, nur_monat, bemerkungen, sorte, flaeche_m2, kulturen(name, farbe)')
        .gte('jahr', vonJahr)
        .lte('jahr', bisJahr)
        .order('saatdatum', { ascending: true, nullsFirst: true });
      if (error) throw error;
      return data as unknown as Anbau[];
    },
  });
}

export function useErnten(jahr?: number) {
  return useQuery({
    queryKey: ['ernten', jahr ?? 'alle'],
    queryFn: async () => {
      let q = supabase.from('ernten').select('*, ernte_produkte(*), ernte_abnehmer(*), ernte_dienstleister(*)').order('datum', { ascending: false }).limit(500);
      if (jahr) q = q.gte('datum', `${jahr}-01-01`).lte('datum', `${jahr}-12-31`);
      const { data, error } = await q;
      if (error) throw error;
      const liste = data as unknown as Ernte[];
      for (const e of liste) e.ernte_produkte.sort((a, b) => a.position - b.position);
      return liste;
    },
  });
}

/** Gelöschte Felder (Papierkorb). Räumt beim Laden abgelaufene Einträge auf. */
export function usePapierkorb() {
  return useQuery({
    queryKey: ['felder', 'papierkorb'],
    queryFn: async () => {
      await supabase.rpc('papierkorb_leeren'); // Fehler hier sind unkritisch (z. B. Migration fehlt)
      const seit = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data, error } = await supabase
        .from('felder')
        .select('id, feldnummer, name, flaeche_m2, geloescht_am')
        .not('geloescht_am', 'is', null)
        .gt('geloescht_am', seit)
        .order('geloescht_am', { ascending: false });
      if (error) throw error;
      return data as Pick<Feld, 'id' | 'feldnummer' | 'name' | 'flaeche_m2' | 'geloescht_am'>[];
    },
  });
}

export function useKartenobjekte() {
  return useQuery({
    queryKey: ['kartenobjekte'],
    queryFn: async () => {
      const { data, error } = await supabase.from('kartenobjekte').select('*').order('erstellt_am');
      // Fehlt Migration 9 noch, bleibt die Karte ohne diese Objekte nutzbar.
      if (error) return [] as Kartenobjekt[];
      return data as Kartenobjekt[];
    },
  });
}

/** Alle geplanten Feldarbeiten (unabhängig vom Jahr) */
export function useGeplanteArbeiten() {
  return useQuery({
    queryKey: ['feldarbeiten', 'geplant'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('feldarbeiten')
        .select(FELDARBEIT_SELECT)
        .is('geloescht_am', null)
        .eq('status', 'geplant')
        .order('datum');
      if (error) throw error;
      return data as unknown as Feldarbeit[];
    },
  });
}

export function useAufgaben(status: 'offen' | 'erledigt' = 'offen') {
  return useQuery({
    queryKey: ['aufgaben', status],
    queryFn: async () => {
      let q = supabase.from('aufgaben').select('*').eq('status', status);
      q = status === 'offen' ? q.order('faellig_am', { ascending: true, nullsFirst: false }) : q.order('erledigt_am', { ascending: false }).limit(50);
      const { data, error } = await q;
      // Fehlt Migration 11 noch, bleibt die Liste leer.
      if (error) return [] as Aufgabe[];
      return data as Aufgabe[];
    },
  });
}

export function useMitarbeiter() {
  return useQuery({
    queryKey: ['mitarbeiter'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from('mitarbeiter').select('*').order('name');
      // Fehlt Migration 13 noch, bleibt die Liste leer.
      if (error) return [] as Mitarbeiter[];
      return data as Mitarbeiter[];
    },
  });
}

export function useMitarbeiterStunden(jahr: number) {
  return useQuery({
    queryKey: ['mitarbeiter_stunden', jahr],
    queryFn: async () => {
      const { data, error } = await supabase.from('mitarbeiter_stunden').select('*').eq('jahr', jahr);
      if (error) return [] as { mitarbeiter_id: string; stunden: number; anzahl: number }[];
      return data as { mitarbeiter_id: string; stunden: number; anzahl: number }[];
    },
  });
}

/** Feldarbeiten zu einem Feld, einer Maschine, einem Partner oder einer Person (für Verknüpfungen) */
export function useArbeitenVon(art: 'feld' | 'maschine' | 'partner' | 'mitarbeiter', id: string | undefined) {
  return useQuery({
    queryKey: ['feldarbeiten', 'von', art, id],
    enabled: !!id,
    queryFn: async () => {
      let q = supabase
        .from('feldarbeiten')
        .select(art === 'feld' ? FELDARBEIT_SELECT.replace('feldarbeit_felder(', 'feldarbeit_felder!inner(') : FELDARBEIT_SELECT)
        .is('geloescht_am', null)
        .order('datum', { ascending: false })
        .limit(30);
      if (art === 'feld') q = q.eq('feldarbeit_felder.feld_id', id!);
      else if (art === 'maschine') q = q.or(`maschine_id.eq.${id},geraet_id.eq.${id}`);
      else if (art === 'partner') q = q.eq('partner_id', id!);
      else q = q.eq('mitarbeiter_id', id!);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as Feldarbeit[];
    },
  });
}

export function useVerkaeufe(jahr: number) {
  return useQuery({
    queryKey: ['verkaeufe', jahr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('verkaeufe')
        .select('*, verkauf_positionen(*)')
        .gte('datum', `${jahr}-01-01`)
        .lte('datum', `${jahr}-12-31`)
        .order('nummer', { ascending: false });
      if (error) return [] as Verkauf[];
      for (const v of data as Verkauf[]) v.verkauf_positionen.sort((a, b) => a.position - b.position);
      return data as Verkauf[];
    },
  });
}

export function useVerkauf(id: string | undefined) {
  return useQuery({
    queryKey: ['verkaeufe', 'einzeln', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('verkaeufe').select('*, verkauf_positionen(*)').eq('id', id!).single();
      if (error) throw error;
      const v = data as Verkauf;
      v.verkauf_positionen.sort((a, b) => a.position - b.position);
      return v;
    },
  });
}

/** Bereits verrechnete Ernte-Abgaben (ID → Belegnummer) */
export function useVerrechneteAbgaben() {
  return useQuery({
    queryKey: ['verkaeufe', 'ernte'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('verkauf_positionen')
        .select('ernte_abnehmer_id, verkaeufe(id, nummer, art)')
        .not('ernte_abnehmer_id', 'is', null);
      if (error) return new Map<string, { id: string; nummer: string; art: string }>();
      return new Map(
        (data as unknown as { ernte_abnehmer_id: string; verkaeufe: { id: string; nummer: string; art: string } }[]).map((r) => [r.ernte_abnehmer_id, r.verkaeufe]),
      );
    },
  });
}

/** Fotos zu einer Maschine (inkl. ihrer Einträge) oder einem Feld */
export function useFotos(ziel: { maschine_id?: string; feld_id?: string }) {
  return useQuery({
    queryKey: ['fotos', ziel.maschine_id ?? '', ziel.feld_id ?? ''],
    enabled: !!(ziel.maschine_id || ziel.feld_id),
    queryFn: async () => {
      let q = supabase.from('fotos').select('*').order('erstellt_am', { ascending: false });
      if (ziel.maschine_id) q = q.eq('maschine_id', ziel.maschine_id);
      if (ziel.feld_id) q = q.eq('feld_id', ziel.feld_id);
      const { data, error } = await q;
      if (error || !data?.length) return [] as (Foto & { url: string })[];
      const urls = await supabase.storage.from('fotos').createSignedUrls(data.map((f) => f.pfad as string), 3600);
      const map = new Map((urls.data ?? []).map((u) => [u.path, u.signedUrl]));
      return (data as Foto[]).map((f) => ({ ...f, url: map.get(f.pfad) ?? '' }));
    },
    staleTime: 30 * 60 * 1000,
  });
}

/** Ersatz- und Verschleissteile: je Maschine oder je Lagerartikel */
export function useMaschinenTeile(filter: { maschine_id?: string; artikel_id?: string } = {}) {
  return useQuery({
    queryKey: ['maschine_teile', filter.maschine_id ?? '', filter.artikel_id ?? ''],
    queryFn: async () => {
      let q = supabase.from('maschine_teile').select('*').order('art').order('erstellt_am');
      if (filter.maschine_id) q = q.eq('maschine_id', filter.maschine_id);
      if (filter.artikel_id) q = q.eq('artikel_id', filter.artikel_id);
      const { data, error } = await q;
      if (error) return [] as MaschinenTeil[];
      return data as MaschinenTeil[];
    },
  });
}

import type { MultiPolygon, Polygon } from 'geojson';

export type Rolle = 'administrator' | 'betriebsleiter' | 'mitarbeiter' | 'lesen';

export interface Profil {
  id: string;
  betrieb_id: string;
  name: string;
  rolle: Rolle;
  aktiv: boolean;
}

export interface Kultur {
  id: string;
  name: string;
  kulturgruppe: string;
  farbe: string;
  anbaupause_jahre: number;
  ist_grasland: boolean;
}

export const NUTZUNGSARTEN = ['Ackerland', 'Kunstwiese', 'Dauergrünland', 'Weide', 'Spezialkultur', 'Andere'] as const;
export const FELDSTATUS = ['bewirtschaftet', 'verpachtet', 'nicht bewirtschaftet', 'aufgegeben'] as const;

export interface Feld {
  id: string;
  betrieb_id: string;
  feldnummer: string;
  name: string;
  flaeche_m2: number;
  gemeinde: string | null;
  nutzungsart: (typeof NUTZUNGSARTEN)[number];
  bodenart: string | null;
  hangneigung_prozent: number | null;
  status: (typeof FELDSTATUS)[number];
  bemerkungen: string | null;
  geometrie: Polygon | MultiPolygon | null;
  flaeche_gezeichnet_m2: number | null;
  version: number;
}

export interface Anbau {
  id: string;
  feld_id: string;
  kultur_id: string;
  jahr: number;
  art: 'Hauptkultur' | 'Zwischenkultur';
  status: 'geplant' | 'ist';
  version: number;
  kulturen?: Pick<Kultur, 'name' | 'farbe'>;
}

export interface FlaecheJeKultur {
  jahr: number;
  kultur_id: string;
  kultur: string;
  farbe: string;
  flaeche_m2: number;
  anzahl_felder: number;
}

export const LAGERKATEGORIEN = [
  'Dünger', 'Saatgut', 'Pflanzenschutzmittel', 'Ersatzteile', 'Betriebsstoffe', 'Erzeugnisse', 'Verbrauchsmaterial', 'Sonstiges',
] as const;
export const EINHEITEN = ['kg', 't', 'l', 'm³', 'Stk', 'Ballen', 'Einheit'] as const;

export interface Lagerartikel {
  id: string;
  betrieb_id: string;
  artikelnummer: string | null;
  bezeichnung: string;
  kategorie: (typeof LAGERKATEGORIEN)[number];
  einheit: (typeof EINHEITEN)[number];
  hersteller: string | null;
  lieferant: string | null;
  lagerort: string | null;
  mindestbestand: number;
  einkaufspreis: number | null;
  lagerfuehrung: boolean;
  n_je_einheit: number | null;
  p2o5_je_einheit: number | null;
  k2o_je_einheit: number | null;
  mg_je_einheit: number | null;
  s_je_einheit: number | null;
  naehrstoffquelle: 'Deklaration' | 'Analyse' | 'Richtwert' | null;
  bemerkungen: string | null;
  aktiv: boolean;
  version: number;
}

export interface Lagerbestand extends Lagerartikel {
  bestand: number;
  unter_mindestbestand: boolean;
  lagerwert: number;
}

export interface Lagerbewegung {
  id: string;
  artikel_id: string;
  datum: string;
  art: 'Eingang' | 'Verbrauch' | 'Verkauf' | 'Korrektur' | 'Inventur' | 'Ernte';
  menge: number;
  preis_je_einheit: number | null;
  quelle_typ: string | null;
  quelle_id: string | null;
  bemerkung: string | null;
}

export const ARBEITSARTEN = [
  'Pflügen', 'Grubbern', 'Eggen', 'Säen', 'Walzen', 'Düngen', 'Pflanzenschutz',
  'Mähen', 'Zetten', 'Schwaden', 'Pressen', 'Ernten', 'Mulchen', 'Hacken', 'Striegeln', 'Andere',
] as const;
export type Arbeitsart = (typeof ARBEITSARTEN)[number];

export interface Feldarbeit {
  id: string;
  datum: string;
  arbeitsart: Arbeitsart;
  status: 'erledigt' | 'geplant';
  dauer_h: number | null;
  maschine: string | null;
  geraet: string | null;
  ausgefuehrt_von: string | null;
  ausbringung: string | null;
  bemerkungen: string | null;
  erstellt_von: string | null;
  version: number;
  feldarbeit_felder: { feld_id: string; flaeche_m2: number; anbau: { kulturen: { name: string } | null } | null }[];
  feldarbeit_mittel: { artikel_id: string; menge_je_ha: number; gesamtmenge: number; lagerartikel: { bezeichnung: string; einheit: string } | null }[];
}

export interface NaehrstoffeJeFeld {
  feld_id: string;
  jahr: number;
  status: 'erledigt' | 'geplant';
  n_kg_ha: number;
  p2o5_kg_ha: number;
  k2o_kg_ha: number;
  mg_kg_ha: number;
  n_kg: number;
  p2o5_kg: number;
  k2o_kg: number;
  anzahl_gaben: number;
}

export const HOFOBJEKT_TYPEN = ['Hof', 'Wohnhaus', 'Scheune', 'Lager', 'Düngerlager', 'Maschinenhalle', 'Silo', 'Werkstatt', 'Andere'] as const;
export type HofobjektTyp = (typeof HOFOBJEKT_TYPEN)[number];

export interface Hofobjekt {
  id: string;
  betrieb_id: string;
  typ: HofobjektTyp;
  name: string;
  breite: number;
  laenge: number;
  link: string | null;
  bemerkungen: string | null;
  version: number;
}

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
  status: (typeof FELDSTATUS)[number] | 'zusammengeführt';
  bemerkungen: string | null;
  vorgaenger: string[];
  zusammengefuehrt_in: string | null;
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
  maschine_id: string | null;
  geraet_id: string | null;
  partner_id: string | null;
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

export const PARTNERARTEN = [
  'Lohnunternehmen', 'Mechaniker/Werkstatt', 'Händler/Lieferant', 'Berater', 'Abnehmer/Käufer', 'Behörde/Kontrolle', 'Andere',
] as const;

export interface Partner {
  id: string;
  betrieb_id: string;
  name: string;
  art: (typeof PARTNERARTEN)[number];
  kontaktperson: string | null;
  telefon: string | null;
  mobile: string | null;
  email: string | null;
  adresse: string | null;
  leistungen: string | null;
  bemerkungen: string | null;
  aktiv: boolean;
  version: number;
}

export const MASCHINENKATEGORIEN = [
  'Traktor', 'Hoflader/Teleskoplader', 'Mähwerk', 'Kreiselheuer/Zetter', 'Schwader', 'Ladewagen', 'Presse',
  'Kreiselegge', 'Pflug', 'Grubber', 'Sämaschine', 'Walze', 'Düngerstreuer', 'Feldspritze',
  'Güllefass', 'Anhänger', 'Mulcher', 'Andere',
] as const;
/** Kategorien mit eigenem Motor (Kontrollschild, MFK, Öle, Stunden) */
export const MIT_MOTOR = ['Traktor', 'Hoflader/Teleskoplader'];

export interface Maschine {
  id: string;
  betrieb_id: string;
  kategorie: (typeof MASCHINENKATEGORIEN)[number];
  name: string;
  hersteller: string | null;
  modell: string | null;
  baujahr: number | null;
  seriennummer: string | null;
  kennzeichen: string | null;
  stammnummer: string | null;
  leistung_ps: number | null;
  leergewicht_kg: number | null;
  gesamtgewicht_kg: number | null;
  hoechstgeschw_kmh: number | null;
  arbeitsbreite_m: number | null;
  reifen_vorne: string | null;
  reifen_hinten: string | null;
  motoroel: string | null;
  hydraulikoel: string | null;
  getriebeoel: string | null;
  tankinhalt_l: number | null;
  mfk_faellig: string | null;
  versicherung: string | null;
  kaufdatum: string | null;
  kaufpreis: number | null;
  betriebsstunden: number | null;
  standort_id: string | null;
  status: 'in Betrieb' | 'ausser Betrieb' | 'verkauft';
  bemerkungen: string | null;
  version: number;
}

export interface Wartungsplan {
  id: string;
  maschine_id: string;
  bezeichnung: string;
  intervall_tage: number | null;
  intervall_stunden: number | null;
  aktiv: boolean;
  version: number;
}

export interface WartungFaellig {
  plan_id: string;
  maschine_id: string;
  bezeichnung: string;
  intervall_tage: number | null;
  intervall_stunden: number | null;
  zuletzt_am: string | null;
  zuletzt_stunden: number | null;
  stunden_aktuell: number | null;
  faellig_am: string | null;
  faellig_stunden: number | null;
  bald_faellig: boolean;
  ueberfaellig: boolean;
}

export const EINTRAGSARTEN = ['Wartung', 'Reparatur', 'Beobachtung', 'Kontrolle'] as const;

export interface MaschinenEintrag {
  id: string;
  maschine_id: string;
  art: (typeof EINTRAGSARTEN)[number];
  datum: string;
  betriebsstunden: number | null;
  titel: string;
  beschreibung: string | null;
  kosten: number | null;
  arbeitszeit_h: number | null;
  partner_id: string | null;
  wartungsplan_id: string | null;
  offen: boolean;
  erstellt_von: string | null;
  version: number;
  eintrag_teile: { artikel_id: string; menge: number; lagerartikel: { bezeichnung: string; einheit: string } | null }[];
}

export interface FeldHinweis {
  id: string;
  betrieb_id: string;
  feld_id: string;
  art: 'Gefahr' | 'Hinweis' | 'Info';
  text: string;
  breite: number | null;
  laenge: number | null;
  aktiv: boolean;
  version: number;
}

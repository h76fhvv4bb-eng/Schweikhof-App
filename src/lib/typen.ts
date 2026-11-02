import type { MultiPolygon, Point, Polygon } from 'geojson';

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
  korrektur_p2o5: number | null;
  korrektur_k2o: number | null;
  korrektur_mg: number | null;
  bodenprobe_jahr: number | null;
  zusammengefuehrt_in: string | null;
  geloescht_am?: string | null;
  geometrie: Polygon | MultiPolygon | null;
  flaeche_gezeichnet_m2: number | null;
  version: number;
}

export const ANBAUARTEN = ['Hauptkultur', 'Zweitkultur', 'Zwischenkultur', 'Untersaat'] as const;
export const ANBAUART_TEXT: Record<(typeof ANBAUARTEN)[number], string> = {
  Hauptkultur: 'Hauptkultur (eine pro Jahr)',
  Zweitkultur: 'Zweitkultur (nach der Hauptkultur oder auf Teilfläche)',
  Zwischenkultur: 'Zwischenkultur / Gründüngung',
  Untersaat: 'Untersaat / Mischpartner',
};

export interface Anbau {
  id: string;
  feld_id: string;
  kultur_id: string;
  jahr: number;
  art: (typeof ANBAUARTEN)[number];
  status: 'geplant' | 'ist';
  flaeche_m2?: number | null;
  version: number;
  saatdatum?: string | null;
  erntedatum?: string | null;
  nur_monat?: boolean;
  bemerkungen?: string | null;
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
  maschine_stunden?: number | null;
  maschine_km?: number | null;
  geraet_stunden?: number | null;
  beobachtung?: string | null;
  beobachtung_eintrag_id?: string | null;
  mitarbeiter_id?: string | null;
  vorgaenger_id?: string | null;
  version: number;
  feldarbeit_felder: { feld_id: string; flaeche_m2: number; anbau: { kulturen: { name: string } | null } | null }[];
  feldarbeit_mittel: { artikel_id: string; menge_je_ha: number; gesamtmenge: number; vom_lager: boolean; lagerartikel: { bezeichnung: string; einheit: string } | null }[];
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
  kilometerstand?: number | null;
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
  kilometerstand?: number | null;
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

export const AUFTRAGSSTATUS = ['Entwurf', 'Gesendet', 'Bestätigt', 'Erledigt', 'Abgebrochen'] as const;

export interface AuftragMittel {
  id?: string;
  artikel_id: string | null;
  bezeichnung: string | null;
  kategorie: string;
  einheit: string | null;
  menge_je_ha: number | null;
  bereitstellung: 'Betrieb' | 'Dienstleister';
  bemerkung: string | null;
  lagerartikel?: { bezeichnung: string; einheit: string } | null;
}

export interface Auftrag {
  id: string;
  betrieb_id: string;
  nummer: string;
  art: 'Lohnarbeit' | 'Werkstatt';
  partner_id: string;
  titel: string;
  arbeitsart: string | null;
  maschine_id: string | null;
  termin_von: string | null;
  termin_bis: string | null;
  beschreibung: string | null;
  status: (typeof AUFTRAGSSTATUS)[number];
  gesendet_am: string | null;
  erledigt_am: string | null;
  feldarbeit_id: string | null;
  aufgabe_id?: string | null;
  eintrag_id: string | null;
  version: number;
  auftrag_felder: { feld_id: string }[];
  auftrag_mittel: AuftragMittel[];
  auftrag_beobachtungen: { eintrag_id: string }[];
}

export const ERNTEPRODUKTE = [
  'Heu', 'Emd', 'Grassilage', 'Gras frisch', 'Silomais', 'Körnermais', 'Getreide', 'Stroh', 'Raps', 'Eiweisserbsen', 'Kartoffeln', 'Zuckerrüben', 'Andere',
] as const;
export const BALLENARTEN = ['Rundballen', 'Quaderballen', 'Kleinballen', 'Siloballen'] as const;
export const ABGABEARTEN = ['Verkauf', 'Abgabe', 'Eigenbedarf', 'Lager'] as const;

export const LEISTUNGEN = ['Mähen', 'Zetten', 'Schwaden', 'Pressen', 'Wickeln', 'Dreschen', 'Häckseln', 'Roden', 'Transport', 'Ernte', 'Andere'] as const;

export interface ErnteProdukt {
  id: string;
  position: number;
  produkt: (typeof ERNTEPRODUKTE)[number];
  ballen: number | null;
  ballenart: (typeof BALLENARTEN)[number] | null;
  menge_kg: number | null;
  feuchte_prozent: number | null;
  qualitaet: string | null;
}

export interface ErnteAbnehmer {
  id?: string;
  produkt_id: string;
  partner_id: string | null;
  art: (typeof ABGABEARTEN)[number];
  ballen: number | null;
  menge_kg: number | null;
  preis_chf: number | null;
  preis_einheit: 'total' | 'je Ballen' | 'je 100 kg' | 'je t' | null;
  bezahlt: boolean;
  bemerkung: string | null;
  lagerartikel_id: string | null;
  lagerort_id: string | null;
}

export interface ErnteDienstleister {
  id: string;
  partner_id: string;
  leistung: (typeof LEISTUNGEN)[number];
  kosten_chf: number | null;
  bemerkung: string | null;
}

export interface Ernte {
  id: string;
  feld_id: string;
  datum: string;
  schnitt: number | null;
  flaeche_m2: number;
  bemerkungen: string | null;
  erstellt_von: string | null;
  version: number;
  ernte_produkte: ErnteProdukt[];
  ernte_abnehmer: ErnteAbnehmer[];
  ernte_dienstleister: ErnteDienstleister[];
}

// ---------------------------------------------------------------- Karte: Flächen, Orte, Bäume (ohne Fruchtfolge)
export const FLAECHENTYPEN = ['Garten', 'Ungenutzte Fläche', 'Hofplatz', 'Wald', 'Hecke', 'Biodiversitätsfläche', 'Obstgarten', 'Weg', 'Gewässer', 'Andere'] as const;
export const ORTSTYPEN = ['Brunnen', 'Tränke', 'Zufahrt', 'Tor', 'Schacht', 'Bienenstand', 'Sammelplatz', 'Andere'] as const;
export const BAUMTYPEN = ['Obstbaum', 'Nussbaum', 'Einzelbaum', 'Andere'] as const;
export const BAUMARTEN = ['Apfel', 'Birne', 'Kirsche', 'Zwetschge', 'Quitte', 'Baumnuss', 'Linde', 'Eiche', 'Ahorn', 'Andere'] as const;

export interface Kartenobjekt {
  id: string;
  betrieb_id: string;
  ebene: 'flaeche' | 'ort' | 'baum';
  typ: string;
  name: string | null;
  geometrie: Polygon | MultiPolygon | Point;
  flaeche_m2: number | null;
  baumart: string | null;
  sorte: string | null;
  pflanzjahr: number | null;
  hochstamm: boolean;
  bemerkungen: string | null;
  version: number;
}

// ---------------------------------------------------------------- Aufgaben
export interface Aufgabe {
  id: string;
  art: 'Maschine' | 'Allgemein';
  titel: string;
  faellig_am: string | null;
  zugewiesen_an: string | null;
  wichtig: boolean;
  maschine_id: string | null;
  eintragsart: 'Wartung' | 'Reparatur' | 'Kontrolle' | null;
  partner_id: string | null;
  beobachtung_id: string | null;
  bemerkungen: string | null;
  status: 'offen' | 'erledigt';
  erledigt_am: string | null;
  dauer_h: number | null;
  ergebnis: string | null;
  mitarbeiter_id?: string | null;
  erstellt_von: string | null;
  version: number;
}

// ---------------------------------------------------------------- Mitarbeitende
export interface Mitarbeiter {
  id: string;
  name: string;
  funktion: string | null;
  telefon: string | null;
  email: string | null;
  stundenansatz_chf: number | null;
  benutzer_id: string | null;
  aktiv: boolean;
  bemerkungen: string | null;
  version: number;
}

// ---------------------------------------------------------------- Betrieb, Verkauf, Fotos
export interface Betrieb {
  id: string;
  name: string;
  kanton: string;
  adresse: string | null;
  telefon: string | null;
  email: string | null;
  strasse?: string | null;
  hausnummer?: string | null;
  plz?: string | null;
  ort?: string | null;
  iban?: string | null;
  mwst_nr?: string | null;
  zahlungsfrist_tage?: number;
  version: number;
}

export interface VerkaufPosition {
  id: string;
  position: number;
  bezeichnung: string;
  menge: number;
  einheit: string;
  preis_je_einheit: number;
  betrag: number;
  artikel_id: string | null;
  vom_lager: boolean;
  ernte_abnehmer_id: string | null;
}

export interface Verkauf {
  id: string;
  nummer: string;
  art: 'Rechnung' | 'Quittung';
  datum: string;
  partner_id: string | null;
  kunde_name: string | null;
  kunde_adresse: string | null;
  zahlungsart: 'Bar' | 'TWINT' | 'Überweisung' | 'Andere' | null;
  faellig_am: string | null;
  bezahlt: boolean;
  bezahlt_am: string | null;
  mwst_satz: number | null;
  total_chf: number;
  bemerkungen: string | null;
  storniert: boolean;
  version: number;
  verkauf_positionen: VerkaufPosition[];
}

export interface Foto {
  id: string;
  betrieb_id: string;
  pfad: string;
  maschine_id: string | null;
  eintrag_id: string | null;
  feld_id: string | null;
  beschreibung: string | null;
  erstellt_von: string | null;
  erstellt_am: string;
}

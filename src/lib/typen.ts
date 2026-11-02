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

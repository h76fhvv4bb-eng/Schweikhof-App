/**
 * Gängige Mineraldünger mit Standard-Nährstoffgehalten in % (Richtwerte).
 * Die Deklaration auf dem Sack bzw. Lieferschein ist massgebend; Werte nach dem Übernehmen prüfen.
 * Mg ist als elementares Mg angegeben (MgO × 0.603), S als elementarer Schwefel.
 */
export interface DuengerVorlage {
  bezeichnung: string;
  n?: number;
  p2o5?: number;
  k2o?: number;
  mg?: number;
  s?: number;
  gruppe: 'Stickstoff' | 'Phosphor' | 'Kali' | 'Magnesium' | 'Mehrnährstoff';
}

export const DUENGER_KATALOG: DuengerVorlage[] = [
  { bezeichnung: 'Ammonsalpeter 27.5 % N', n: 27.5, gruppe: 'Stickstoff' },
  { bezeichnung: 'Kalkammonsalpeter (KAS) 27 % N', n: 27, gruppe: 'Stickstoff' },
  { bezeichnung: 'Harnstoff 46 % N', n: 46, gruppe: 'Stickstoff' },
  { bezeichnung: 'Ammonsulfat 21 % N + 24 % S', n: 21, s: 24, gruppe: 'Stickstoff' },
  { bezeichnung: 'Ammonsulfatsalpeter 26 % N + 13 % S', n: 26, s: 13, gruppe: 'Stickstoff' },
  { bezeichnung: 'Kalksalpeter 15.5 % N', n: 15.5, gruppe: 'Stickstoff' },
  { bezeichnung: 'Triple-Superphosphat 46 % P₂O₅', p2o5: 46, gruppe: 'Phosphor' },
  { bezeichnung: 'Diammonphosphat (DAP) 18-46-0', n: 18, p2o5: 46, gruppe: 'Phosphor' },
  { bezeichnung: 'Monoammonphosphat (MAP) 12-52-0', n: 12, p2o5: 52, gruppe: 'Phosphor' },
  { bezeichnung: 'Kalisalz 60 % K₂O', k2o: 60, gruppe: 'Kali' },
  { bezeichnung: 'Kaliumsulfat 50 % K₂O + 18 % S', k2o: 50, s: 18, gruppe: 'Kali' },
  { bezeichnung: 'Patentkali 30 % K₂O + 10 % MgO + S', k2o: 30, mg: 6, s: 17, gruppe: 'Kali' },
  { bezeichnung: 'Kieserit 25 % MgO + 20 % S', mg: 15, s: 20, gruppe: 'Magnesium' },
  { bezeichnung: 'NPK 15-15-15', n: 15, p2o5: 15, k2o: 15, gruppe: 'Mehrnährstoff' },
  { bezeichnung: 'NPK 20-10-10', n: 20, p2o5: 10, k2o: 10, gruppe: 'Mehrnährstoff' },
  { bezeichnung: 'NPK 12-12-17', n: 12, p2o5: 12, k2o: 17, gruppe: 'Mehrnährstoff' },
];

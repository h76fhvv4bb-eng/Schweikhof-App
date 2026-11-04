import type { Richtpreis } from './typen';

export type RichtpreisVorlage = Pick<Richtpreis, 'bereich' | 'bezeichnung' | 'einheit' | 'preis_chf' | 'quelle' | 'jahr' | 'bemerkung'>;

const AGROSCOPE = 'Agroscope Kostenkatalog 2024 (Entschädigungsansatz)';
const OHNE = 'ohne Bedienung, ohne MWST; Richtwert';
const traktor = (kw: string, ps: string, preis: number): RichtpreisVorlage => ({
  bereich: 'Maschine', bezeichnung: `Traktor ${kw} kW (${ps} PS)`, einheit: 'h', preis_chf: preis, quelle: AGROSCOPE, jahr: 2024, bemerkung: OHNE,
});
const maschine = (bezeichnung: string, einheit: string, preis: number): RichtpreisVorlage => ({
  bereich: 'Maschine', bezeichnung, einheit, preis_chf: preis, quelle: AGROSCOPE, jahr: 2024, bemerkung: OHNE,
});

/**
 * Öffentlich zugängliche Richtwerte als Startpunkt. Der vollständige Katalog (Geräte je ha, Pressen je Ballen …)
 * ist bei Agroscope erhältlich (www.kostenkatalog.ch) und kann über «CSV einfügen» übernommen werden.
 */
export const VORLAGEN: { titel: string; beschreibung: string; preise: RichtpreisVorlage[] }[] = [
  {
    titel: 'Traktoren und Lader (Agroscope 2024)',
    beschreibung: 'Entschädigungsansätze je Stunde ohne Fahrer, aus dem Kostenkatalog 2024 von Agroscope.',
    preise: [
      traktor('30–36', '41–49', 27), traktor('37–44', '50–60', 33), traktor('45–54', '61–73', 35), traktor('55–64', '74–87', 41),
      traktor('65–74', '88–101', 44), traktor('75–89', '102–121', 50), traktor('90–104', '122–142', 62), traktor('105–124', '143–169', 70),
      traktor('125–149', '171–203', 85), traktor('150–199', '204–271', 103), traktor('200–250', '272–340', 130),
      maschine('Hof-/Kompaktlader Diesel 20 kW', 'h', 35), maschine('Hof-/Kompaktlader Diesel 44 kW', 'h', 54),
      maschine('Teleskoplader 50 kW, 2.5 t', 'h', 50), maschine('Teleskoplader 75 kW, 2.5–3.4 t', 'h', 57), maschine('Teleskoplader 90 kW, über 3.4 t', 'h', 62),
      maschine('Zweiachsmäher Diesel 30 kW', 'h', 50), maschine('Zweiachsmäher Diesel 70 kW', 'h', 67),
      maschine('Transporter Diesel 40 kW', 'h', 54), maschine('Transporter Diesel 80 kW', 'h', 76),
      maschine('Motormäher 1.6 m', 'ha', 100), maschine('Motormäher 1.9 m', 'ha', 110),
      maschine('Einachser Benzin 6 kW', 'h', 14.5), maschine('Einachser Benzin 17 kW', 'h', 28),
      maschine('Viehtransporter 3.5 t', 'km', 1.2),
    ],
  },
  {
    titel: 'Arbeitskosten (Agroscope 2024)',
    beschreibung: 'Ansätze je Arbeitskraftstunde (Akh) aus dem Kostenkatalog 2024. Bei Spannen ist der Mittelwert eingetragen.',
    preise: [
      { bereich: 'Arbeit', bezeichnung: 'Arbeitskraft innerlandwirtschaftlich', einheit: 'h', preis_chf: 31, quelle: 'Agroscope Kostenkatalog 2024', jahr: 2024, bemerkung: 'Opportunitätskosten' },
      { bereich: 'Arbeit', bezeichnung: 'Arbeitskraft angestellt / Lohnunternehmer', einheit: 'h', preis_chf: 52, quelle: 'Agroscope Kostenkatalog 2024', jahr: 2024, bemerkung: 'Spanne 47–57, inkl. Sozialkosten' },
      { bereich: 'Arbeit', bezeichnung: 'Arbeitskraft im Unternehmerverhältnis', einheit: 'h', preis_chf: 69.5, quelle: 'Agroscope Kostenkatalog 2024', jahr: 2024, bemerkung: 'Spanne 63–76, inkl. Betriebs-/Verwaltungskosten, Risiko, Gewinn' },
    ],
  },
  {
    titel: 'Raufutter (AGRIDEA 2026)',
    beschreibung: 'Richtpreis für Heu bei Verrechnung unter Landwirten.',
    preise: [
      { bereich: 'Futter', bezeichnung: 'Heu bodengetrocknet, gepresst, verladen', einheit: 'dt', preis_chf: 25, quelle: 'AGRIDEA, Richtpreise stehendes Gras 2026', jahr: 2026, bemerkung: 'Grundpreis; Spanne je nach Qualität 20–30 Fr./dt' },
    ],
  },
];

/**
 * digiFLUX (Nachfolger von HODUFLU): Lieferungen aus einer Export-Datei erkennen und für den Import aufbereiten.
 * Die Spalten werden über ihre Überschrift erkannt – deutsche Bezeichnungen aus digiFLUX ebenso wie die technischen
 * Feldnamen der Schnittstelle (z. B. «shipmentDate», «quantity.unit»). Unbekannte Spalten können von Hand zugeordnet werden.
 */
import { datumLesen, zahlLesen } from './tabelleLesen';

export const DIGIFLUX_FELDER = [
  { k: 'dfx_id', text: 'Liefer-ID', namen: ['id', 'id.id', 'liefer-id', 'lieferid', 'lieferungs-id', 'lieferung-id', 'digiflux-id', 'transaktions-id', 'transaktion', 'lieferungsnummer', 'lieferungsnr', 'nr'] },
  { k: 'status', text: 'Status', namen: ['status', 'zustand', 'state', 'lieferstatus', 'shipmentstatus'] },
  { k: 'lieferdatum', text: 'Lieferdatum', pflicht: true, namen: ['lieferdatum', 'shipmentdate', 'datum', 'lieferungsdatum', 'versanddatum'] },
  { k: 'abgeber', text: 'Abgeber', namen: ['abgeber', 'abgeber firmenname', 'abgeber name', 'abgebername', 'shippedfromaddress.organisationname', 'absender', 'lieferant', 'name/firma lieferant', 'abgeberstandort', 'abgeber betrieb'] },
  { k: 'abgeber_vorname', text: 'Abgeber Vorname', namen: ['abgeber vorname', 'shippedfromaddress.firstname'] },
  { k: 'abgeber_nachname', text: 'Abgeber Nachname', namen: ['abgeber nachname', 'shippedfromaddress.lastname'] },
  { k: 'abgeber_id', text: 'Abgeber-ID (DFLID/BUR)', namen: ['abgeberstandort-id', 'shippedfromstock.id', 'abgeber-id', 'abgeber dflid', 'abgeber bur'] },
  { k: 'empfaenger_id', text: 'Empfänger-ID (DFLID/BUR)', namen: ['empfängerstandort-id', 'empfaengerstandort-id', 'shippedtostock.id', 'empfänger-id', 'empfänger dflid'] },
  { k: 'produkt', text: 'Produkt', namen: ['produkt', 'produktname', 'produktbezeichnung', 'product.name', 'productname', 'bezeichnung', 'artikel', 'handelsname'] },
  { k: 'produkt_id', text: 'Produkt-ID', namen: ['produkt-id', 'product.id', 'produktid', 'produktnummer'] },
  { k: 'produkt_quelle', text: 'Produkt-ID Quellsystem', namen: ['produkt-id quellsystem', 'product.sourcesystemid', 'quellsystem produkt'] },
  { k: 'produktfamilie', text: 'Produktfamilie', namen: ['produktfamilie', 'productfamily', 'familie', 'produktkategorie'] },
  { k: 'menge', text: 'Menge', pflicht: true, namen: ['menge', 'quantity.amount', 'quantity.value', 'liefermenge'] },
  { k: 'einheit', text: 'Einheit', pflicht: true, namen: ['einheit', 'quantity.unit', 'unit', 'mengeneinheit'] },
  { k: 'lieferschein_nr', text: 'Lieferschein-Nr.', namen: ['lieferschein-nr', 'lieferscheinnr', 'lieferschein-nr.', 'deliverynumber', 'lieferschein'] },
  { k: 'kommentar', text: 'Kommentar', namen: ['kommentar', 'comment', 'bemerkung', 'bemerkungen', 'kommentar / retournierungsgrund / stonierungsgrund'] },
] as const;
export type DigifluxFeld = (typeof DIGIFLUX_FELDER)[number]['k'];
export type Zuordnung = Partial<Record<DigifluxFeld, number>>;

export interface DigifluxZeile {
  dfx_id: string;
  status: string | null;
  lieferdatum: string;
  abgeber: string | null;
  abgeber_id: string | null;
  produkt: string | null;
  produkt_id: string | null;
  produkt_quelle: string | null;
  produktfamilie: string | null;
  menge: number;
  einheit: string;
  lieferschein_nr: string | null;
  kommentar: string | null;
  roh: Record<string, string>;
}

const norm = (s: string) => s.toLowerCase().replace(/\*/g, '').replace(/\s+/g, ' ').trim();

/** Kopfzeile finden und Spalten zuordnen. digiFLUX-Vorlagen haben zwei Kopfzeilen (deutsch + technisch). */
export function spaltenErkennen(zeilen: string[][]): { kopf: number; daten: number; zuordnung: Zuordnung } {
  const treffer = (z: string[]) => {
    const zu: Zuordnung = {};
    z.forEach((zelle, i) => {
      const n = norm(zelle ?? '');
      if (!n) return;
      const f = DIGIFLUX_FELDER.find((x) => (x.namen as readonly string[]).includes(n));
      if (f && zu[f.k] == null) zu[f.k] = i;
    });
    return zu;
  };
  let kopf = 0;
  let beste: Zuordnung = {};
  for (let i = 0; i < Math.min(6, zeilen.length); i++) {
    const t = treffer(zeilen[i]);
    if (Object.keys(t).length > Object.keys(beste).length) {
      beste = t;
      kopf = i;
    }
  }
  // zweite Kopfzeile (technische Namen) überspringen und fehlende Spalten daraus ergänzen
  let daten = kopf + 1;
  while (daten < zeilen.length && Object.keys(treffer(zeilen[daten])).length >= 3) {
    beste = { ...treffer(zeilen[daten]), ...beste };
    daten++;
  }
  return { kopf, daten, zuordnung: beste };
}

const STATUS: Record<string, string> = {
  gesendet: 'SENT', versandt: 'SENT', 'zu bestätigen': 'SENT', offen: 'SENT', sent: 'SENT',
  erstellt: 'CREATED', created: 'CREATED',
  bestätigt: 'ACCEPTED', quittiert: 'ACCEPTED', angenommen: 'ACCEPTED', akzeptiert: 'ACCEPTED', accepted: 'ACCEPTED',
  abgelehnt: 'REJECTED', zurückgewiesen: 'REJECTED', rejected: 'REJECTED',
  storniert: 'CANCELLED', annulliert: 'CANCELLED', cancelled: 'CANCELLED', canceled: 'CANCELLED',
};
export const statusNorm = (s: string | null | undefined) => {
  const t = norm(s ?? '');
  return t ? (STATUS[t] ?? t.toUpperCase()) : null;
};
export const STATUS_TEXT: Record<string, string> = {
  CREATED: 'erstellt', SENT: 'zu bestätigen', ACCEPTED: 'bestätigt', REJECTED: 'abgelehnt', CANCELLED: 'storniert',
};

/** kurze, stabile Kennung für Zeilen ohne digiFLUX-ID (gleiche Datei zweimal importiert → keine Doppel) */
function kennung(teile: (string | number | null)[]) {
  let h = 2166136261;
  for (const c of teile.map((t) => String(t ?? '')).join('|')) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return `DATEI-${(h >>> 0).toString(36)}`;
}

/** Zeilen in Lieferungen umwandeln; ungültige Zeilen kommen mit Grund in «fehler» */
export function lieferungenAus(
  zeilen: string[][],
  kopf: number,
  daten: number,
  zu: Zuordnung,
  eigeneId?: string | null,
): { lieferungen: DigifluxZeile[]; fehler: string[]; fremd: number } {
  const lieferungen: DigifluxZeile[] = [];
  const fehler: string[] = [];
  let fremd = 0;
  const titel = zeilen[kopf] ?? [];
  const wert = (z: string[], k: DigifluxFeld) => {
    const i = zu[k];
    return i == null ? '' : (z[i] ?? '').trim();
  };
  for (let r = daten; r < zeilen.length; r++) {
    const z = zeilen[r];
    const nr = r + 1;
    // nur Lieferungen an den eigenen Betrieb (wenn Empfänger-ID und eigene DFLID/BUR bekannt)
    const empf = wert(z, 'empfaenger_id');
    if (eigeneId && empf && empf.toUpperCase() !== eigeneId.toUpperCase()) {
      fremd++;
      continue;
    }
    const datum = datumLesen(wert(z, 'lieferdatum'));
    const menge = zahlLesen(wert(z, 'menge'));
    const einheit = wert(z, 'einheit');
    if (!datum) {
      fehler.push(`Zeile ${nr}: Lieferdatum fehlt oder ist unlesbar («${wert(z, 'lieferdatum')}»).`);
      continue;
    }
    if (menge == null) {
      fehler.push(`Zeile ${nr}: Menge fehlt oder ist unlesbar («${wert(z, 'menge')}»).`);
      continue;
    }
    if (!einheit) {
      fehler.push(`Zeile ${nr}: Einheit fehlt.`);
      continue;
    }
    const name = [wert(z, 'abgeber_vorname'), wert(z, 'abgeber_nachname')].filter(Boolean).join(' ');
    const abgeber = wert(z, 'abgeber') || name || null;
    const produkt = wert(z, 'produkt') || null;
    const produkt_id = wert(z, 'produkt_id') || null;
    const roh: Record<string, string> = {};
    titel.forEach((t, i) => {
      if (t && z[i]) roh[t] = z[i];
    });
    lieferungen.push({
      dfx_id: wert(z, 'dfx_id') || kennung([datum, abgeber, wert(z, 'abgeber_id'), produkt, produkt_id, menge, einheit, wert(z, 'lieferschein_nr')]),
      status: statusNorm(wert(z, 'status')),
      lieferdatum: datum,
      abgeber,
      abgeber_id: wert(z, 'abgeber_id') || null,
      produkt: produkt ?? produkt_id,
      produkt_id,
      produkt_quelle: wert(z, 'produkt_quelle') || null,
      produktfamilie: wert(z, 'produktfamilie') || null,
      menge,
      einheit,
      lieferschein_nr: wert(z, 'lieferschein_nr') || null,
      kommentar: wert(z, 'kommentar') || null,
      roh,
    });
  }
  return { lieferungen, fehler, fremd };
}

export const FAMILIE_TEXT: Record<string, string> = {
  FARM_MANURE_RECYCLING: 'Hof-/Recyclingdünger', FERTILISER: 'Dünger', PLANT_PROTECTION_PRODUCT: 'Pflanzenschutzmittel',
  FEEDSTUFF: 'Futtermittel', TRADE_PRODUCT: 'Handelsprodukt',
};
/** Vorschlag für die Lagerkategorie eines neuen Artikels */
export const kategorieVorschlag = (familie: string | null) =>
  familie === 'PLANT_PROTECTION_PRODUCT' ? 'Pflanzenschutzmittel' : familie === 'FEEDSTUFF' ? 'Sonstiges' : 'Dünger';
/** App-Einheit zu einer digiFLUX-Einheit */
export const einheitApp = (e: string) => ({ m3: 'm³', 'm³': 'm³', pc: 'Stk', kg: 'kg', t: 't', l: 'l' })[e.trim().toLowerCase()] ?? 'Einheit';
/** Umrechnung wie in der Datenbank (digiflux_umrechnen) */
export function umrechnen(menge: number, von: string, nach: string): number | null {
  const v = einheitApp(von);
  if (v === nach) return menge;
  const f: Record<string, number> = { 'kg>t': 0.001, 't>kg': 1000, 'l>m³': 0.001, 'm³>l': 1000 };
  return f[`${v}>${nach}`] != null ? Math.round(menge * f[`${v}>${nach}`] * 1000) / 1000 : null;
}

/**
 * Tabellen aus Dateien lesen: Excel (.xlsx) und CSV – ohne zusätzliche Bibliothek.
 * Für .xlsx wird das ZIP im Browser entpackt (DecompressionStream) und das erste Tabellenblatt gelesen.
 */

/** Liest die erste Tabelle einer Datei als Zeilen mit Text-Zellen */
export async function tabelleLesen(datei: File): Promise<string[][]> {
  const name = datei.name.toLowerCase();
  const daten = new Uint8Array(await datei.arrayBuffer());
  if (name.endsWith('.xlsx') || (daten[0] === 0x50 && daten[1] === 0x4b)) return xlsxLesen(daten);
  return csvLesen(new TextDecoder(istUtf8(daten) ? 'utf-8' : 'windows-1252').decode(daten));
}

function istUtf8(b: Uint8Array) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
}

/** CSV mit ; , oder Tab, Anführungszeichen nach RFC 4180 */
export function csvLesen(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const ersteZeile = t.split(/\r?\n/)[0] ?? '';
  const trenner = [';', '\t', ','].sort((a, b) => ersteZeile.split(b).length - ersteZeile.split(a).length)[0];
  const zeilen: string[][] = [];
  let zeile: string[] = [];
  let feld = '';
  let inAnf = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inAnf) {
      if (c === '"' && t[i + 1] === '"') {
        feld += '"';
        i++;
      } else if (c === '"') inAnf = false;
      else feld += c;
    } else if (c === '"') inAnf = true;
    else if (c === trenner) {
      zeile.push(feld);
      feld = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      zeile.push(feld);
      zeilen.push(zeile);
      zeile = [];
      feld = '';
    } else feld += c;
  }
  if (feld || zeile.length) {
    zeile.push(feld);
    zeilen.push(zeile);
  }
  return zeilen.filter((z) => z.some((x) => x.trim()));
}

// ------------------------------------------------------------------ ZIP

async function zipEintraege(d: Uint8Array): Promise<Map<string, () => Promise<Uint8Array>>> {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  // Ende des zentralen Verzeichnisses suchen
  let e = d.length - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Die Datei ist keine gültige Excel-Datei.');
  const anzahl = v.getUint16(e + 10, true);
  let p = v.getUint32(e + 16, true);
  const m = new Map<string, () => Promise<Uint8Array>>();
  for (let i = 0; i < anzahl; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const methode = v.getUint16(p + 10, true);
    const groesse = v.getUint32(p + 20, true);
    const nLen = v.getUint16(p + 28, true);
    const xLen = v.getUint16(p + 30, true);
    const kLen = v.getUint16(p + 32, true);
    const lokal = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(d.subarray(p + 46, p + 46 + nLen));
    p += 46 + nLen + xLen + kLen;
    m.set(name, async () => {
      const start = lokal + 30 + v.getUint16(lokal + 26, true) + v.getUint16(lokal + 28, true);
      const roh = d.subarray(start, start + groesse);
      if (methode === 0) return roh;
      if (methode !== 8) throw new Error('Nicht unterstützte Komprimierung in der Excel-Datei.');
      const strom = new Blob([roh as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(strom).arrayBuffer());
    });
  }
  return m;
}

// ------------------------------------------------------------------ XLSX

const spalteNr = (ref: string) => {
  let n = 0;
  for (const c of ref.replace(/\d+$/, '')) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
};

async function xlsxLesen(d: Uint8Array): Promise<string[][]> {
  const z = await zipEintraege(d);
  const text = async (pfad: string) => {
    const f = z.get(pfad);
    return f ? new TextDecoder().decode(await f()) : null;
  };
  const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const alle = (doc: Document | Element, tag: string) => Array.from(doc.getElementsByTagNameNS(NS, tag));

  // erstes Blatt über workbook.xml und die Beziehungen finden
  let blattPfad = 'xl/worksheets/sheet1.xml';
  const wb = await text('xl/workbook.xml');
  const rels = await text('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const erstes = alle(xml(wb), 'sheet')[0];
    const rid = erstes?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const ziel = Array.from(xml(rels).getElementsByTagName('Relationship')).find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target');
    if (ziel) blattPfad = ziel.startsWith('/') ? ziel.slice(1) : `xl/${ziel.replace(/^\.\//, '')}`;
  }
  const geteilt: string[] = [];
  const ss = await text('xl/sharedStrings.xml');
  if (ss) for (const si of alle(xml(ss), 'si')) geteilt.push(alle(si, 't').map((t) => t.textContent ?? '').join(''));

  const blatt = await text(blattPfad);
  if (!blatt) throw new Error('Kein Tabellenblatt in der Excel-Datei gefunden.');
  const zeilen: string[][] = [];
  for (const row of alle(xml(blatt), 'row')) {
    const r: string[] = [];
    let naechste = 0;
    for (const c of alle(row, 'c')) {
      const ref = c.getAttribute('r');
      const nr = ref ? spalteNr(ref) : naechste;
      naechste = nr + 1;
      const typ = c.getAttribute('t');
      const v = alle(c, 'v')[0]?.textContent ?? '';
      let wert = v;
      if (typ === 's') wert = geteilt[Number(v)] ?? '';
      else if (typ === 'inlineStr') wert = alle(c, 't').map((t) => t.textContent ?? '').join('');
      else if (typ === 'b') wert = v === '1' ? 'WAHR' : 'FALSCH';
      while (r.length < nr) r.push('');
      r[nr] = wert;
    }
    zeilen.push(r);
  }
  return zeilen.filter((z) => z.some((x) => (x ?? '').trim()));
}

/** Datum aus Excel-Seriennummer, ISO, TT.MM.JJJJ oder JJJJ-MM-TTThh:mm → JJJJ-MM-TT (sonst null) */
export function datumLesen(s: string): string | null {
  const t = (s ?? '').trim();
  if (!t) return null;
  if (/^\d{5}(\.\d+)?$/.test(t)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) {
    const j = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${j}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

/** Zahl aus «1'234.5», «1234,5», «1 234.50» */
export function zahlLesen(s: string): number | null {
  const t = (s ?? '').trim().replace(/['’\s]/g, '');
  if (!t) return null;
  const n = Number(/,\d{1,3}$/.test(t) && !t.includes('.') ? t.replace(',', '.') : t.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

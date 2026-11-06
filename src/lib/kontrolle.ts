import { supabase } from './supabase';
import { hinweiseFuerJahr } from './fruchtfolgeRegeln';
import type { Betrieb, Feld, Kultur } from './typen';
import { inFruchtfolge } from './typen';
import { bffHinweise } from './bff';

/** Abschnitte des Parzellenblatts und welche Arbeitsarten dorthin gehören */
export const ABSCHNITT_VON: Record<string, 'boden' | 'saat' | 'duengung' | 'pflege' | 'nutzung'> = {
  Pflügen: 'boden', Grubbern: 'boden', Eggen: 'boden', Walzen: 'boden', Mulchen: 'boden',
  Säen: 'saat',
  Düngen: 'duengung',
  Pflanzenschutz: 'pflege', Hacken: 'pflege', Striegeln: 'pflege', Andere: 'pflege',
  Mähen: 'nutzung', Zetten: 'nutzung', Wenden: 'nutzung', Schwaden: 'nutzung', Pressen: 'nutzung', Ernten: 'nutzung',
};

export interface ArbeitZeile {
  id: string;
  datum: string;
  arbeitsart: string;
  status: string;
  teil_ha: number;
  dauer_h: number | null;
  geraet: string | null;
  person: string | null;
  partner: string | null;
  bemerkungen: string | null;
  beobachtung: string | null;
  mittel: {
    bezeichnung: string;
    einheit: string;
    kategorie: string;
    menge_je_ha: number;
    gesamt: number;
    n: number | null; // kg/ha ausgebracht
    p2o5: number | null;
    k2o: number | null;
    mgo: number | null;
  }[];
}

export interface ErnteZeile {
  id: string;
  datum: string;
  schnitt: number | null;
  teil_ha: number;
  produkte: { produkt: string; ballen: number | null; ballenart: string | null; kg: number | null }[];
}

export interface Parzellenblatt {
  feld: Feld;
  jahr: number;
  hauptkultur: string | null;
  sorte: string | null;
  weitere: string[]; // Zweitkultur, Untersaat
  vorkultur: string | null;
  zwischenkulturen: { name: string; sorte: string | null; saat: string | null; umbruch: string | null; nurMonat: boolean }[];
  arbeiten: ArbeitZeile[];
  ernten: ErnteZeile[];
  /** Tiere anderer Betriebe auf diesem Feld (Weidegäste) */
  weiden?: { partner: string; tierart: string; anzahl: number; gve: number | null; von: string; bis: string | null; ha: number }[];
}

export interface KontrollDaten {
  betrieb: Betrieb | null;
  jahr: number;
  blaetter: Parzellenblatt[];
  felder: Feld[];
}

const kuerzel = (name: string | null | undefined) =>
  name
    ? name
        .split(/\s+/)
        .filter(Boolean)
        .map((t) => t[0]!.toUpperCase())
        .join('')
        .slice(0, 3)
    : null;

type AnbauRoh = { feld_id: string; jahr: number; art: string; sorte: string | null; saatdatum: string | null; erntedatum: string | null; nur_monat: boolean; kulturen: { name: string } | null };

/** Lädt alles, was für Parzellenblätter eines Jahres nötig ist (ein Feld oder alle). */
export async function parzellenblaetterLaden(jahr: number, feldId?: string): Promise<KontrollDaten> {
  const von = `${jahr}-01-01`;
  const bis = `${jahr}-12-31`;
  let felderQ = supabase.from('felder').select('*').is('geloescht_am', null).neq('status', 'zusammengeführt');
  if (feldId) felderQ = felderQ.eq('id', feldId);
  const [betrieb, felder, anbau, arbeiten, ernten, maschinen, mitarbeiter, partner, geraete, weiden] = await Promise.all([
    supabase.from('betriebe').select('*').maybeSingle(),
    felderQ,
    supabase.from('anbau').select('feld_id, jahr, art, sorte, saatdatum, erntedatum, nur_monat, kulturen(name)').gte('jahr', jahr - 1).lte('jahr', jahr),
    supabase
      .from('feldarbeiten')
      .select(
        'id, datum, arbeitsart, status, dauer_h, geraet, geraet_id, maschine, maschine_id, mitarbeiter_id, partner_id, bemerkungen, beobachtung,' +
          ' feldarbeit_felder(feld_id, flaeche_m2),' +
          ' feldarbeit_mittel(menge_je_ha, gesamtmenge, lagerartikel(bezeichnung, einheit, kategorie, n_je_einheit, p2o5_je_einheit, k2o_je_einheit, mg_je_einheit))',
      )
      .is('geloescht_am', null)
      .eq('status', 'erledigt')
      .gte('datum', von)
      .lte('datum', bis)
      .order('datum'),
    supabase.from('ernten').select('id, feld_id, datum, schnitt, flaeche_m2, ernte_produkte(produkt, ballen, ballenart, menge_kg, position)').gte('datum', von).lte('datum', bis).order('datum'),
    supabase.from('maschinen').select('id, name'),
    supabase.from('mitarbeiter').select('id, name'),
    supabase.from('partner').select('id, name'),
    supabase.from('feldarbeit_geraete').select('feldarbeit_id, maschine_id, position').order('position'),
    supabase.from('beweidungen').select('partner_id, tierart, anzahl, gve, von, bis, beweidung_felder(feld_id, flaeche_m2, von, bis)').lte('von', bis).or(`bis.is.null,bis.gte.${von}`).order('von'),
  ]);
  for (const r of [felder, anbau, arbeiten, ernten]) if (r.error) throw r.error;

  const name = (liste: { id: string; name: string }[] | null, id: string | null) => (id ? (liste?.find((x) => x.id === id)?.name ?? null) : null);
  const anbauListe = (anbau.data ?? []) as unknown as AnbauRoh[];
  type ArbeitRoh = {
    id: string; datum: string; arbeitsart: string; status: string; dauer_h: number | null; geraet: string | null; geraet_id: string | null;
    maschine: string | null; maschine_id: string | null; mitarbeiter_id: string | null; partner_id: string | null; bemerkungen: string | null; beobachtung: string | null;
    feldarbeit_felder: { feld_id: string; flaeche_m2: number }[];
    feldarbeit_mittel: { menge_je_ha: number; gesamtmenge: number; lagerartikel: { bezeichnung: string; einheit: string; kategorie: string; n_je_einheit: number | null; p2o5_je_einheit: number | null; k2o_je_einheit: number | null; mg_je_einheit: number | null } | null }[];
  };
  const arbeitenListe = (arbeiten.data ?? []) as unknown as ArbeitRoh[];
  type ErnteRoh = { id: string; feld_id: string; datum: string; schnitt: number | null; flaeche_m2: number; ernte_produkte: { produkt: string; ballen: number | null; ballenart: string | null; menge_kg: number | null; position: number }[] };
  const erntenListe = (ernten.data ?? []) as unknown as ErnteRoh[];

  type WeideRoh = { partner_id: string; tierart: string; anzahl: number; gve: number | null; von: string; bis: string | null; beweidung_felder: { feld_id: string; flaeche_m2: number; von: string | null; bis: string | null }[] };
  // Fehlt die Tabelle noch (Migration 18 nicht eingespielt), bleiben die Weiden einfach leer
  const weidenListe = (weiden.error ? [] : (weiden.data ?? [])) as unknown as WeideRoh[];
  // mehrere Geräte je Arbeit (fehlt die Tabelle, gilt das eine Gerät)
  const geraeteJe = new Map<string, string[]>();
  for (const g of (geraete.error ? [] : (geraete.data ?? [])) as { feldarbeit_id: string; maschine_id: string }[])
    geraeteJe.set(g.feldarbeit_id, [...(geraeteJe.get(g.feldarbeit_id) ?? []), g.maschine_id]);
  const sortiert = ((felder.data ?? []) as Feld[]).sort((a, b) => a.feldnummer.localeCompare(b.feldnummer, 'de-CH', { numeric: true }));
  const blaetter: Parzellenblatt[] = sortiert.map((feld) => {
    const haupt = anbauListe.find((a) => a.feld_id === feld.id && a.jahr === jahr && a.art === 'Hauptkultur');
    const vor = anbauListe.find((a) => a.feld_id === feld.id && a.jahr === jahr - 1 && a.art === 'Hauptkultur');
    return {
      feld,
      jahr,
      hauptkultur: haupt?.kulturen?.name ?? null,
      sorte: haupt?.sorte ?? null,
      weitere: anbauListe
        .filter((a) => a.feld_id === feld.id && a.jahr === jahr && (a.art === 'Zweitkultur' || a.art === 'Untersaat'))
        .map((a) => `${a.art}: ${a.kulturen?.name ?? ''}${a.sorte ? ` (${a.sorte})` : ''}`),
      vorkultur: vor?.kulturen?.name ?? null,
      zwischenkulturen: anbauListe
        .filter((a) => a.feld_id === feld.id && a.jahr === jahr && a.art === 'Zwischenkultur')
        .map((a) => ({ name: a.kulturen?.name ?? '', sorte: a.sorte, saat: a.saatdatum, umbruch: a.erntedatum, nurMonat: a.nur_monat })),
      arbeiten: arbeitenListe
        .filter((a) => a.feldarbeit_felder.some((f) => f.feld_id === feld.id))
        .map((a) => {
          const teilM2 = Number(a.feldarbeit_felder.find((f) => f.feld_id === feld.id)!.flaeche_m2);
          const totalM2 = a.feldarbeit_felder.reduce((s, f) => s + Number(f.flaeche_m2), 0) || teilM2;
          return {
            id: a.id,
            datum: a.datum,
            arbeitsart: a.arbeitsart,
            status: a.status,
            teil_ha: teilM2 / 10000,
            dauer_h: a.dauer_h,
            geraet:
              (geraeteJe.get(a.id)?.map((g) => name(maschinen.data, g)).filter(Boolean).join(' + ') || null) ??
              name(maschinen.data, a.geraet_id) ?? a.geraet ?? name(maschinen.data, a.maschine_id) ?? a.maschine,
            person: kuerzel(name(mitarbeiter.data, a.mitarbeiter_id)),
            partner: name(partner.data, a.partner_id),
            bemerkungen: a.bemerkungen,
            beobachtung: a.beobachtung,
            mittel: a.feldarbeit_mittel.map((m) => {
              const l = m.lagerartikel;
              const je = Number(m.menge_je_ha);
              const n = (x: number | null | undefined) => (x != null ? je * Number(x) : null);
              return {
                bezeichnung: l?.bezeichnung ?? '',
                einheit: l?.einheit ?? '',
                kategorie: l?.kategorie ?? '',
                menge_je_ha: je,
                // Gesamtmenge auf diesem Feld (Anteil an der ganzen Arbeit)
                gesamt: Number(m.gesamtmenge) * (teilM2 / totalM2),
                n: n(l?.n_je_einheit),
                p2o5: n(l?.p2o5_je_einheit),
                k2o: n(l?.k2o_je_einheit),
                mgo: l?.mg_je_einheit != null ? (je * Number(l.mg_je_einheit)) / 0.603 : null,
              };
            }),
          };
        }),
      ernten: erntenListe
        .filter((e) => e.feld_id === feld.id)
        .map((e) => ({
          id: e.id,
          datum: e.datum,
          schnitt: e.schnitt,
          teil_ha: Number(e.flaeche_m2) / 10000,
          produkte: [...e.ernte_produkte]
            .sort((x, y) => x.position - y.position)
            .map((p) => ({ produkt: p.produkt, ballen: p.ballen, ballenart: p.ballenart, kg: p.menge_kg != null ? Number(p.menge_kg) : null })),
        })),
      weiden: weidenListe.flatMap((w) =>
        w.beweidung_felder
          // Aufenthalt auf diesem Feld, der ins Jahr fällt
          .filter((f) => f.feld_id === feld.id && (f.von ?? w.von) <= bis && ((f.bis ?? w.bis) == null || (f.bis ?? w.bis)! >= von))
          .map((f) => ({
            partner: name(partner.data, w.partner_id) ?? '', tierart: w.tierart, anzahl: w.anzahl, gve: w.gve != null ? Number(w.gve) : null,
            von: f.von ?? w.von, bis: f.bis ?? w.bis, ha: Number(f.flaeche_m2) / 10000,
          })),
      ),
    };
  });
  return { betrieb: (betrieb.data as Betrieb | null) ?? null, jahr, blaetter, felder: sortiert };
}

// ---------------------------------------------------------------- Plausibilitätsprüfung

export interface Pruefpunkt {
  stufe: 'fehlt' | 'pruefen' | 'info';
  text: string;
  link?: string;
}

/** Prüft die Aufzeichnungen eines Jahres auf Lücken. Es sind Hinweise, keine Prüfung von Vorschriften. */
export async function aufzeichnungenPruefen(jahr: number, kulturen: Kultur[]): Promise<Pruefpunkt[]> {
  const d = await parzellenblaetterLaden(jahr);
  const punkte: Pruefpunkt[] = [];
  const heute = new Date().toISOString().slice(0, 10);
  const kulturByName = new Map(kulturen.map((k) => [k.name, k]));
  const relevant = d.blaetter.filter((b) => b.feld.status === 'bewirtschaftet');

  for (const b of relevant) {
    const f = b.feld;
    const titel = `${f.feldnummer} ${f.name}`;
    const link = `/felder/${f.id}`;
    const dauer = !inFruchtfolge(f);
    if (!b.hauptkultur && !dauer) punkte.push({ stufe: 'fehlt', text: `${titel}: keine Hauptkultur ${jahr} erfasst`, link: '/fruchtfolge' });
    const k = b.hauptkultur ? kulturByName.get(b.hauptkultur) : undefined;
    const ackerkultur = k && !k.ist_grasland && k.kulturgruppe !== 'Brache';
    if (ackerkultur && !b.arbeiten.some((a) => a.arbeitsart === 'Säen') && jahr <= new Date().getFullYear())
      punkte.push({ stufe: 'pruefen', text: `${titel}: ${b.hauptkultur}, aber keine Saat im ${jahr} erfasst (Herbstsaat im Vorjahr?)`, link: `/erfassen?feld=${f.id}` });
    for (const a of b.arbeiten) {
      // Biodiversitätsförderfläche: Schnitt vor dem Termin, Düngung, Pflanzenschutz
      if (a.status === 'erledigt')
        for (const h of bffHinweise(f, d.betrieb?.zone, a.arbeitsart, a.datum))
          punkte.push({ stufe: 'pruefen', text: `${a.datum.split('-').reverse().join('.')} ${a.arbeitsart}: ${h}`, link: `/arbeiten/${a.id}` });
      if (a.arbeitsart === 'Düngen' && !a.mittel.length)
        punkte.push({ stufe: 'fehlt', text: `${titel}: Düngung vom ${a.datum.split('-').reverse().join('.')} ohne Dünger und Menge`, link: `/arbeiten/${a.id}` });
      if (a.arbeitsart === 'Pflanzenschutz' && !a.mittel.length)
        punkte.push({ stufe: 'fehlt', text: `${titel}: Pflanzenschutz vom ${a.datum.split('-').reverse().join('.')} ohne Mittel`, link: `/arbeiten/${a.id}` });
      for (const m of a.mittel)
        if (m.kategorie === 'Dünger' && m.n == null && m.p2o5 == null && m.k2o == null)
          punkte.push({ stufe: 'pruefen', text: `Dünger «${m.bezeichnung}» hat keine Nährstoffgehalte – Nährstoffbilanz unvollständig`, link: '/lager' });
    }
    if (f.bodenprobe_jahr == null) {
      if (!dauer) punkte.push({ stufe: 'info', text: `${titel}: Jahr der Bodenprobe nicht erfasst`, link });
    } else if (jahr - f.bodenprobe_jahr >= 10) punkte.push({ stufe: 'pruefen', text: `${titel}: Bodenprobe von ${f.bodenprobe_jahr} ist 10 Jahre oder älter`, link });
    if (!f.geometrie) punkte.push({ stufe: 'info', text: `${titel}: Feldgrenze noch nicht eingezeichnet`, link: `/felder?zeichnen=${f.id}` });
  }

  // Fruchtfolge-Hinweise (Empfehlungen) für das Jahr
  const { data: anbau } = await supabase.from('anbau').select('feld_id, jahr, kultur_id').eq('art', 'Hauptkultur').gte('jahr', jahr - 6).lte('jahr', jahr);
  const kById = new Map(kulturen.map((k) => [k.id, k]));
  for (const b of relevant) {
    if (!inFruchtfolge(b.feld)) continue;
    const folge = new Map<number, Kultur>();
    for (const a of (anbau ?? []).filter((x) => x.feld_id === b.feld.id)) {
      const k = kById.get(a.kultur_id as string);
      if (k) folge.set(a.jahr as number, k);
    }
    for (const h of hinweiseFuerJahr(folge, jahr)) punkte.push({ stufe: 'pruefen', text: `${b.feld.feldnummer} ${b.feld.name}: ${h}`, link: '/fruchtfolge' });
  }

  // Geplante Arbeiten, deren Datum vorbei ist
  const { data: offen } = await supabase.from('feldarbeiten').select('id, datum, arbeitsart').is('geloescht_am', null).eq('status', 'geplant').lt('datum', heute);
  for (const a of offen ?? []) punkte.push({ stufe: 'pruefen', text: `Geplante Arbeit «${a.arbeitsart}» vom ${String(a.datum).split('-').reverse().join('.')} ist noch nicht erledigt`, link: '/aufgaben' });

  // Lager mit negativem Bestand
  const { data: lager } = await supabase.from('lagerbestand').select('id, bezeichnung, bestand, lagerfuehrung').lt('bestand', 0);
  for (const l of lager ?? []) if (l.lagerfuehrung) punkte.push({ stufe: 'pruefen', text: `Lager «${l.bezeichnung}» hat einen negativen Bestand`, link: `/lager/${l.id}` });

  // Betriebsangaben
  if (!d.betrieb?.betriebsnummer) punkte.push({ stufe: 'info', text: 'Betriebsnummer fehlt in den Betriebsangaben (erscheint auf allen Unterlagen)', link: '/betrieb' });
  if (!d.betrieb?.bewirtschafter) punkte.push({ stufe: 'info', text: 'Bewirtschafter/in fehlt in der Betriebsverwaltung', link: '/betrieb' });

  // Weidegäste ohne Ende in einem vergangenen Jahr
  const { data: offeneWeiden } = await supabase.from('beweidungen').select('id, tierart, von').is('bis', null).lt('von', `${jahr}-12-31`);
  if (jahr < new Date().getFullYear())
    for (const w of offeneWeiden ?? []) punkte.push({ stufe: 'pruefen', text: `Weide «${w.tierart}» ab ${String(w.von).split('-').reverse().join('.')} hat kein Ende`, link: `/weide/${w.id}` });

  // doppelte Texte entfernen (z. B. derselbe Dünger bei mehreren Feldern)
  const gesehen = new Set<string>();
  return punkte
    .filter((p) => (gesehen.has(p.text) ? false : (gesehen.add(p.text), true)))
    .sort((a, b) => ['fehlt', 'pruefen', 'info'].indexOf(a.stufe) - ['fehlt', 'pruefen', 'info'].indexOf(b.stufe));
}

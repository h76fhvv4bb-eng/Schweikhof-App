import { supabase } from './supabase';
import type { Beweidung, Betrieb, Ernte, Feld, Kultur, Verkauf } from './typen';
import { aufzeichnungenPruefen, parzellenblaetterLaden } from './kontrolle';
import { fruchtfolgeLaden } from './kontrollePdf';
import type { MappeDaten, VerkaufsDaten, WeideDaten } from './berichtePdf';
import { imZeitraum } from './weide';

async function betriebLaden() {
  const { data } = await supabase.from('betriebe').select('*').maybeSingle();
  return (data as Betrieb | null) ?? null;
}

/** Alle Belege eines Jahres und die Ernte-Verkäufe ohne Beleg */
export async function verkaeufeLaden(jahr: number): Promise<VerkaufsDaten> {
  const [betrieb, belege, partner, ernten, felder, verrechnet] = await Promise.all([
    betriebLaden(),
    supabase.from('verkaeufe').select('*, verkauf_positionen(*)').gte('datum', `${jahr}-01-01`).lte('datum', `${jahr}-12-31`).order('nummer'),
    supabase.from('partner').select('id, name'),
    supabase
      .from('ernten')
      .select('*, ernte_produkte(*), ernte_abnehmer(*)')
      .gte('datum', `${jahr}-01-01`)
      .lte('datum', `${jahr}-12-31`)
      .order('datum'),
    supabase.from('felder').select('id, name'),
    supabase.from('verkauf_positionen').select('ernte_abnehmer_id, verkaeufe!inner(storniert)').not('ernte_abnehmer_id', 'is', null),
  ]);
  if (belege.error) throw belege.error;
  const pName = (id: string | null) => (id ? (partner.data?.find((p) => p.id === id)?.name ?? '') : '');
  const aufBeleg = new Set(
    ((verrechnet.data ?? []) as unknown as { ernte_abnehmer_id: string; verkaeufe: { storniert: boolean } }[])
      .filter((v) => !v.verkaeufe.storniert)
      .map((v) => v.ernte_abnehmer_id),
  );
  const liste = (belege.data ?? []) as Verkauf[];
  for (const v of liste) v.verkauf_positionen.sort((a, b) => a.position - b.position);
  const abgaben = ((ernten.data ?? []) as Ernte[]).flatMap((e) =>
    e.ernte_abnehmer
      .filter((a) => a.art === 'Verkauf' && !(a.id && aufBeleg.has(a.id)))
      .map((a) => {
        const p = e.ernte_produkte.find((x) => x.id === a.produkt_id);
        return {
          datum: e.datum,
          feld: felder.data?.find((f) => f.id === e.feld_id)?.name ?? '',
          produkt: p?.produkt ?? '',
          menge: a.ballen != null ? `${a.ballen} ${p?.ballenart ?? 'Ballen'}` : a.menge_kg != null ? `${a.menge_kg} kg` : '',
          partner: pName(a.partner_id) || (a.bemerkung ?? ''),
          preis: a.preis_chf != null ? Number(a.preis_chf) : null,
          bezahlt: a.bezahlt,
        };
      }),
  );
  return { jahr, betrieb, belege: liste.map((v) => ({ ...v, kunde: pName(v.partner_id) || (v.kunde_name ?? '') })), abgaben };
}

/** Weidegäste im Zeitraum, optional nur ein Tierhalter */
export async function weideLaden(von: string, bis: string, partnerId?: string): Promise<WeideDaten> {
  const [betrieb, eintraege, felder, partner] = await Promise.all([
    betriebLaden(),
    supabase.from('beweidungen').select('*, beweidung_felder(feld_id, flaeche_m2)').order('von'),
    supabase.from('felder').select('*'),
    supabase.from('partner').select('id, name, adresse'),
  ]);
  if (eintraege.error) throw new Error('Weidegäste noch nicht verfügbar. Bitte zuerst Migration 18 in Supabase einspielen.');
  return {
    von, bis, betrieb,
    felder: (felder.data ?? []) as Feld[],
    partner: (partner.data ?? []) as WeideDaten['partner'],
    eintraege: ((eintraege.data ?? []) as Beweidung[]).filter((b) => imZeitraum(b, von, bis) && (!partnerId || b.partner_id === partnerId)),
  };
}

/** Alles für die Kontrollmappe eines Jahres */
export async function mappeLaden(jahr: number, kulturen: Kultur[]): Promise<MappeDaten> {
  const [kontroll, fruchtfolge, verkaeufe, weide, pruefpunkte] = await Promise.all([
    parzellenblaetterLaden(jahr),
    fruchtfolgeLaden(jahr - 4, jahr + 2),
    verkaeufeLaden(jahr),
    weideLaden(`${jahr}-01-01`, `${jahr}-12-31`).catch(() => null),
    aufzeichnungenPruefen(jahr, kulturen),
  ]);
  return {
    jahr,
    betrieb: kontroll.betrieb,
    felder: kontroll.felder,
    kontroll,
    fruchtfolge,
    verkaeufe,
    weide: weide ?? { von: `${jahr}-01-01`, bis: `${jahr}-12-31`, betrieb: kontroll.betrieb, felder: kontroll.felder, partner: [], eintraege: [] },
    pruefpunkte,
  };
}

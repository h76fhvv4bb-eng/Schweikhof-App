import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { MultiPolygon, Polygon } from 'geojson';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import {
  useAnbauAlle, useAuftraege, useBetrieb, useFelder, useHinweise, useHofobjekte, useLager, useMaschinen, useMaschinenEintraege, usePartner, useAufgaben, useGeplanteArbeiten,
} from '../lib/daten';
import { chf, datum, ha, heuteIso, menge, zahlAus } from '../lib/format';
import { aktuelleKulturJeFeld } from '../lib/aktuelleKultur';
import { ABRECHNUNG_EINHEIT, ABRECHNUNGSARTEN, ARBEITSGRUPPEN, LAGERKATEGORIEN, MIT_MOTOR, type Auftrag, rollenText, hatRolle } from '../lib/typen';
import { AbrechnungNachtragen, AuftragAbschluss } from '../components/AuftragAbschluss';
import { RichtpreisWahl } from '../components/RichtpreisWahl';
import { HinweisListe } from '../components/FeldWerkzeuge';
import { Icon } from '../components/Icon';
import { NEU, NeuerArtikelDialog } from '../components/Schnellanlage';
import type { Anbau, Lagerartikel } from '../lib/typen';

const STATUSFARBE: Record<string, string> = {
  Entwurf: 'bg-[#E7E1D0] text-[#3E4C41]',
  Gesendet: 'bg-[#E6F0F8] text-[#2D5F86]',
  Bestätigt: 'bg-hof-hell text-hof',
  Erledigt: 'bg-hof text-white',
  Abgebrochen: 'bg-fehler-hell text-fehler',
};

export function AuftragStatus({ status }: { status: string }) {
  return <span className={`rounded-lg px-2 py-0.5 text-xs font-extrabold ${STATUSFARBE[status] ?? ''}`}>{status}</span>;
}

export function AuftraegeListe() {
  const { darfVerwalten } = useAuth();
  const [params] = useSearchParams();
  const auftraege = useAuftraege();
  const partner = usePartner();
  const [filter, setFilter] = useState<'offen' | 'erledigt' | 'alle'>('offen');
  const partnerFilter = params.get('partner');
  const liste = (auftraege.data ?? []).filter(
    (a) =>
      (!partnerFilter || a.partner_id === partnerFilter) &&
      (filter === 'alle' || (filter === 'offen' ? !['Erledigt', 'Abgebrochen'].includes(a.status) : a.status === 'Erledigt')),
  );
  const pName = (id: string) => partner.data?.find((p) => p.id === id)?.name ?? '';

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-leise">
            {liste.length} Aufträge{partnerFilter && ` an ${pName(partnerFilter)}`}
          </span>
          <h1 className="m-0 text-3xl font-extrabold text-hof">Aufträge</h1>
        </div>
        {darfVerwalten && (
          <div className="flex flex-wrap gap-2">
            <Link to={`/auftraege/neu?art=Lohnarbeit${partnerFilter ? `&partner=${partnerFilter}` : ''}`} className="knopf no-underline">
              <Icon name="plus" /> Lohnauftrag
            </Link>
            <Link to={`/auftraege/neu?art=Werkstatt${partnerFilter ? `&partner=${partnerFilter}` : ''}`} className="knopf-leise no-underline">
              <Icon name="plus" /> Werkstatt
            </Link>
          </div>
        )}
      </header>
      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-[#E7E1D0] p-1">
        {(['offen', 'erledigt', 'alle'] as const).map((f) => (
          <button
            key={f}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={`min-h-10 rounded-xl text-sm font-extrabold capitalize ${filter === f ? 'bg-white text-hof' : 'text-[#4D5B50]'}`}
          >
            {f}
          </button>
        ))}
      </div>
      {auftraege.isSuccess && liste.length === 0 && (
        <p className="karte m-0 text-leise">Keine Aufträge. Lohnaufträge gehen an Lohnunternehmen, Werkstattaufträge an Mechaniker.</p>
      )}
      {liste.map((a) => (
        <Link key={a.id} to={`/auftraege/${a.id}`} className="karte flex flex-col gap-1 p-3 text-text no-underline">
          <div className="flex items-center justify-between gap-2">
            <span className="font-extrabold">{a.titel}</span>
            <AuftragStatus status={a.status} />
          </div>
          <span className="text-xs text-leise">
            {[
              `Nr. ${a.nummer}`,
              a.art,
              pName(a.partner_id),
              a.termin_von && `Termin ${datum(a.termin_von)}`,
              a.art === 'Lohnarbeit' && `${a.auftrag_felder.length} Felder`,
              a.kosten_chf != null && chf(Number(a.kosten_chf)),
              a.kosten_chf == null && a.abrechnung && a.preis_je_einheit != null && `${chf(Number(a.preis_je_einheit))} ${a.abrechnung === 'Pauschale' ? 'pauschal' : `je ${ABRECHNUNG_EINHEIT[a.abrechnung]}`}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </Link>
      ))}
    </div>
  );
}

interface MittelZeile {
  quelle: 'lager' | 'frei';
  artikel_id: string;
  bezeichnung: string;
  kategorie: string;
  einheit: string;
  menge_je_ha: string;
  bereitstellung: 'Betrieb' | 'Dienstleister';
  bemerkung: string;
}

function mitte(g: Polygon | MultiPolygon | null): [number, number] | null {
  if (!g) return null;
  const ring = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0]?.[0];
  if (!ring?.length) return null;
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  return [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lons) + Math.max(...lons)) / 2];
}

export function AuftragFormular() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profil, session, darfVerwalten } = useAuth();
  const auftraege = useAuftraege();
  const vorhanden = auftraege.data?.find((a) => a.id === id);
  const partner = usePartner();
  const felder = useFelder();
  const lager = useLager();
  const maschinen = useMaschinen();
  const eintraegeAlle = useMaschinenEintraege();
  const hinweise = useHinweise();
  const betrieb = useBetrieb();
  const orte = useHofobjekte();
  const jahr = new Date().getFullYear();
  const anbau = useAnbauAlle(jahr - 1, jahr + 1);

  const [art, setArt] = useState<Auftrag['art']>((params.get('art') as Auftrag['art']) || 'Lohnarbeit');
  const [partnerId, setPartnerId] = useState(params.get('partner') ?? '');
  const [titel, setTitel] = useState('');
  const [titelGeaendert, setTitelGeaendert] = useState(false);
  const [arbeitsart, setArbeitsart] = useState('Säen');
  const [maschineId, setMaschineId] = useState(params.get('maschine') ?? '');
  const [terminVon, setTerminVon] = useState('');
  const [terminBis, setTerminBis] = useState('');
  const [beschreibung, setBeschreibung] = useState('');
  const [feldWahl, setFeldWahl] = useState<string[]>([]);
  const [mittel, setMittel] = useState<MittelZeile[]>([]);
  const [beobWahl, setBeobWahl] = useState<string[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [neuerArtikelFuer, setNeuerArtikelFuer] = useState<number | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);
  const [arbeitet, setArbeitet] = useState(false);
  const [abschlussOffen, setAbschlussOffen] = useState(false);
  const [abrechnung, setAbrechnung] = useState<string>('');
  const [preisJe, setPreisJe] = useState('');
  const [richtpreisWahl, setRichtpreisWahl] = useState(false);
  const geladen = useMemo(() => ({ id: '' }), []);
  // Aus den Aufgaben: geplante Feldarbeit (Lohnarbeit) oder Maschinen-Aufgabe (Werkstatt) übernehmen
  const geplanteArbeiten = useGeplanteArbeiten();
  const offeneAufgaben = useAufgaben('offen');
  const feldarbeitId = id ? (vorhanden?.feldarbeit_id ?? null) : params.get('feldarbeit');
  const aufgabeId = id ? (vorhanden?.aufgabe_id ?? null) : params.get('aufgabe');
  const quelleArbeit = (geplanteArbeiten.data ?? []).find((a) => a.id === feldarbeitId);
  const quelleAufgabe = (offeneAufgaben.data ?? []).find((a) => a.id === aufgabeId);
  const vorbelegt = useMemo(() => ({ fertig: false }), []);
  useEffect(() => {
    if (id || vorbelegt.fertig) return;
    if (quelleArbeit && lager.data) {
      vorbelegt.fertig = true;
      setArt('Lohnarbeit');
      setArbeitsart(quelleArbeit.arbeitsart);
      setFeldWahl(quelleArbeit.feldarbeit_felder.map((f) => f.feld_id));
      setTerminVon(quelleArbeit.datum);
      if (quelleArbeit.partner_id) setPartnerId(quelleArbeit.partner_id);
      if (quelleArbeit.bemerkungen) setBeschreibung(quelleArbeit.bemerkungen);
      setMittel(
        quelleArbeit.feldarbeit_mittel.map((m) => {
          const a = lager.data?.find((x) => x.id === m.artikel_id);
          return {
            quelle: 'lager' as const, artikel_id: m.artikel_id, bezeichnung: '', kategorie: a?.kategorie ?? 'Saatgut', einheit: a?.einheit ?? 'kg',
            menge_je_ha: String(m.menge_je_ha), bereitstellung: m.vom_lager === false ? ('Dienstleister' as const) : ('Betrieb' as const), bemerkung: '',
          };
        }),
      );
    } else if (quelleAufgabe) {
      vorbelegt.fertig = true;
      setArt('Werkstatt');
      if (quelleAufgabe.maschine_id) setMaschineId(quelleAufgabe.maschine_id);
      if (quelleAufgabe.partner_id) setPartnerId(quelleAufgabe.partner_id);
      setTitel(quelleAufgabe.titel);
      setTitelGeaendert(true);
      if (quelleAufgabe.faellig_am) setTerminBis(quelleAufgabe.faellig_am);
      if (quelleAufgabe.bemerkungen) setBeschreibung(quelleAufgabe.bemerkungen);
      if (quelleAufgabe.beobachtung_id) setBeobWahl([quelleAufgabe.beobachtung_id]);
    }
  }, [id, quelleArbeit, quelleAufgabe, lager.data, vorbelegt]);

  useEffect(() => {
    const a = vorhanden;
    if (!a || geladen.id === a.id) return;
    geladen.id = a.id;
    setArt(a.art);
    setPartnerId(a.partner_id);
    setTitel(a.titel);
    setTitelGeaendert(true);
    setArbeitsart(a.arbeitsart ?? 'Säen');
    setMaschineId(a.maschine_id ?? '');
    setTerminVon(a.termin_von ?? '');
    setTerminBis(a.termin_bis ?? '');
    setBeschreibung(a.beschreibung ?? '');
    setFeldWahl(a.auftrag_felder.map((f) => f.feld_id));
    setAbrechnung(a.abrechnung ?? '');
    setPreisJe(a.preis_je_einheit != null ? String(a.preis_je_einheit) : '');
    setBeobWahl(a.auftrag_beobachtungen.map((b) => b.eintrag_id));
    setMittel(
      a.auftrag_mittel.map((m) => ({
        quelle: m.artikel_id ? 'lager' : 'frei',
        artikel_id: m.artikel_id ?? '',
        bezeichnung: m.bezeichnung ?? '',
        kategorie: m.kategorie,
        einheit: m.einheit ?? 'kg',
        menge_je_ha: m.menge_je_ha != null ? String(m.menge_je_ha) : '',
        bereitstellung: m.bereitstellung,
        bemerkung: m.bemerkung ?? '',
      })),
    );
  }, [vorhanden, geladen]);

  // Offene Beobachtungen der Maschine bei einem neuen Werkstattauftrag vorwählen
  const beobachtungen = (eintraegeAlle.data ?? []).filter((e) => e.maschine_id === maschineId && (e.offen || beobWahl.includes(e.id)));
  useEffect(() => {
    if (!id && art === 'Werkstatt' && maschineId) setBeobWahl((eintraegeAlle.data ?? []).filter((e) => e.maschine_id === maschineId && e.offen).map((e) => e.id));
  }, [id, art, maschineId, eintraegeAlle.data]);

  const ausgewaehlteFelder = (felder.data ?? []).filter((f) => feldWahl.includes(f.id));
  // aktuelle Kultur am Termin (ab der Saat die neue Kultur, auch wenn sie zum nächsten Anbaujahr gehört)
  const kulturAmTermin = useMemo(
    () => aktuelleKulturJeFeld((anbau.data ?? []) as Anbau[], terminVon || heuteIso()),
    [anbau.data, terminVon],
  );
  const flaecheHa = ausgewaehlteFelder.reduce((s, f) => s + Number(f.flaeche_m2), 0) / 10000;
  const maschine = maschinen.data?.find((m) => m.id === maschineId);
  // Fläche für Abschluss und Ernte: Teilflächen der geplanten Arbeit, sonst ganze Felder
  const abschlussFelder = ausgewaehlteFelder.map((f) => ({
    feld_id: f.id,
    flaeche_m2: Number(quelleArbeit?.feldarbeit_felder.find((x) => x.feld_id === f.id)?.flaeche_m2 ?? f.flaeche_m2),
  }));
  const abschlussFlaecheM2 = abschlussFelder.reduce((s, f) => s + f.flaeche_m2, 0);

  // Vorschlag für den Titel
  useEffect(() => {
    if (titelGeaendert) return;
    if (art === 'Lohnarbeit') setTitel(`${arbeitsart}${ausgewaehlteFelder.length ? ` ${ausgewaehlteFelder.map((f) => f.name).join(', ')}` : ''}`);
    else setTitel(maschine ? `Reparatur ${maschine.name}` : 'Reparatur');
  }, [art, arbeitsart, ausgewaehlteFelder.map((f) => f.id).join(), maschine?.name, titelGeaendert]); // eslint-disable-line react-hooks/exhaustive-deps

  const abgeschlossen = vorhanden && ['Erledigt', 'Abgebrochen'].includes(vorhanden.status);
  const sortiertePartner = [...(partner.data ?? []).filter((p) => p.aktiv)].sort(
    (a, b) =>
      Number(hatRolle(b, art === 'Lohnarbeit' ? 'Lohnunternehmen' : 'Mechaniker/Werkstatt')) -
      Number(hatRolle(a, art === 'Lohnarbeit' ? 'Lohnunternehmen' : 'Mechaniker/Werkstatt')),
  );
  const gewaehlterPartner = partner.data?.find((p) => p.id === partnerId);

  function nutzlast() {
    const mittelListe = [];
    for (const m of mittel) {
      if (m.quelle === 'lager' && !m.artikel_id) continue;
      if (m.quelle === 'frei' && !m.bezeichnung.trim()) continue;
      const n = zahlAus(m.menge_je_ha);
      if (m.menge_je_ha.trim() && (n == null || n <= 0)) throw new Error('Menge pro ha muss grösser als 0 sein.');
      mittelListe.push({
        artikel_id: m.quelle === 'lager' ? m.artikel_id : null,
        bezeichnung: m.quelle === 'frei' ? m.bezeichnung.trim() : null,
        kategorie: m.kategorie,
        einheit: m.quelle === 'lager' ? (lager.data?.find((a) => a.id === m.artikel_id)?.einheit ?? m.einheit) : m.einheit,
        menge_je_ha: n,
        bereitstellung: m.bereitstellung,
        bemerkung: m.bemerkung.trim() || null,
      });
    }
    return {
      id: id ?? null,
      version: vorhanden?.version,
      art,
      partner_id: partnerId,
      titel: titel.trim(),
      arbeitsart: art === 'Lohnarbeit' ? arbeitsart : null,
      maschine_id: art === 'Werkstatt' ? maschineId : null,
      termin_von: terminVon || null,
      termin_bis: terminBis || null,
      beschreibung: beschreibung.trim() || null,
      felder: art === 'Lohnarbeit' ? feldWahl : [],
      mittel: art === 'Lohnarbeit' ? mittelListe : [],
      beobachtungen: art === 'Werkstatt' ? beobWahl : [],
      feldarbeit_id: art === 'Lohnarbeit' && quelleArbeit ? quelleArbeit.id : null,
      aufgabe_id: aufgabeId || null,
      abrechnung: abrechnung || null,
      preis_je_einheit: abrechnung ? zahlAus(preisJe) : null,
    };
  }

  async function speichern(): Promise<string | null> {
    setFehler(null);
    setMeldung(null);
    if (!partnerId) return (setFehler('Bitte einen Partner wählen.'), null);
    if (!titel.trim()) return (setFehler('Bitte einen Titel eingeben.'), null);
    if (art === 'Lohnarbeit' && !feldWahl.length) return (setFehler('Bitte mindestens ein Feld wählen.'), null);
    if (art === 'Werkstatt' && !maschineId) return (setFehler('Bitte eine Maschine wählen.'), null);
    let p;
    try {
      p = nutzlast();
    } catch (e) {
      return (setFehler((e as Error).message), null);
    }
    if (abrechnung && preisJe.trim() && (zahlAus(preisJe) == null || zahlAus(preisJe)! < 0)) return (setFehler('Preis der Abrechnung ungültig.'), null);
    let { data, error } = await supabase.rpc('auftrag_speichern_abrechnung', { p });
    // ältere Datenbank ohne Migration 24: ohne Abrechnung speichern
    if (error && /auftrag_speichern_abrechnung/.test(error.message)) ({ data, error } = await supabase.rpc('auftrag_speichern', { p }));
    if (error) return (setFehler(fehlertext(error)), null);
    await qc.invalidateQueries({ queryKey: ['auftraege'] });
    qc.invalidateQueries({ queryKey: ['feldarbeiten'] });
    return data as string;
  }

  function druckdaten() {
    const kultur = (feldId: string) => kulturAmTermin.get(feldId)?.eintrag.kulturen?.name ?? null;
    return {
      betrieb: { name: betrieb.data?.name ?? 'Betrieb', adresse: betrieb.data?.adresse ?? null, telefon: betrieb.data?.telefon ?? null, email: betrieb.data?.email ?? session?.user.email ?? null, betriebsnummer: betrieb.data?.betriebsnummer ?? null },
      absender: profil?.name ?? null,
      partner: {
        name: gewaehlterPartner?.name ?? '',
        kontaktperson: gewaehlterPartner?.kontaktperson ?? null,
        adresse: gewaehlterPartner?.adresse ?? null,
        email: gewaehlterPartner?.email ?? null,
      },
      auftrag: {
        nummer: vorhanden?.nummer ?? '',
        art,
        titel: titel.trim(),
        arbeitsart: art === 'Lohnarbeit' ? arbeitsart : null,
        termin_von: terminVon || null,
        termin_bis: terminBis || null,
        beschreibung: beschreibung.trim() || null,
      },
      felder: ausgewaehlteFelder.map((f) => ({
        nr: f.feldnummer,
        name: f.name,
        ha: Number(f.flaeche_m2) / 10000,
        kultur: kultur(f.id),
        gemeinde: f.gemeinde,
        mitte: mitte(f.geometrie),
        hinweise: (hinweise.data ?? []).filter((h) => h.feld_id === f.id).map((h) => ({ art: h.art, text: h.text })),
      })),
      mittel: mittel
        .filter((m) => (m.quelle === 'lager' ? m.artikel_id : m.bezeichnung.trim()))
        .map((m) => {
          const a = lager.data?.find((x) => x.id === m.artikel_id);
          const n = zahlAus(m.menge_je_ha);
          return {
            bezeichnung: m.quelle === 'lager' ? (a?.bezeichnung ?? '') : m.bezeichnung.trim(),
            menge_je_ha: n,
            einheit: m.quelle === 'lager' ? (a?.einheit ?? '') : m.einheit,
            total: n != null ? n * flaecheHa : null,
            bereitstellung: m.bereitstellung,
            bemerkung: m.bemerkung.trim() || null,
          };
        }),
      maschine: maschine
        ? {
            name: maschine.name, kategorie: maschine.kategorie, hersteller: maschine.hersteller, modell: maschine.modell, baujahr: maschine.baujahr,
            seriennummer: maschine.seriennummer, kennzeichen: maschine.kennzeichen,
            betriebsstunden: maschine.betriebsstunden != null ? Number(maschine.betriebsstunden) : null,
            standort: orte.data?.find((o) => o.id === maschine.standort_id)?.name ?? null,
          }
        : null,
      beobachtungen: (eintraegeAlle.data ?? [])
        .filter((e) => beobWahl.includes(e.id))
        .map((e) => ({ datum: e.datum, titel: e.titel, beschreibung: e.beschreibung, betriebsstunden: e.betriebsstunden != null ? Number(e.betriebsstunden) : null })),
    };
  }

  async function pdfErstellen(aktion: 'ansehen' | 'mail') {
    setArbeitet(true);
    try {
      const auftragId = await speichern();
      if (!auftragId) return;
      const frisch = (await supabase.from('auftraege').select('nummer').eq('id', auftragId).single()).data as { nummer: string } | null;
      const d = druckdaten();
      d.auftrag.nummer = frisch?.nummer ?? d.auftrag.nummer;
      const { auftragPdf, pdfPerMail, pdfHerunterladen } = await import('../lib/auftragPdf');
      const pdf = await auftragPdf(d);
      const dateiname = `Auftrag_${d.auftrag.nummer}_${d.betrieb.name.replace(/[^A-Za-z0-9äöüÄÖÜ]+/g, '_')}.pdf`;
      if (aktion === 'ansehen') {
        const url = URL.createObjectURL(pdf);
        if (!window.open(url, '_blank')) pdfHerunterladen(pdf, dateiname);
      } else {
        const betreff = `Auftrag ${d.auftrag.nummer}: ${d.auftrag.titel} – ${d.betrieb.name}`;
        const text = `Grüezi${gewaehlterPartner?.kontaktperson ? ` ${gewaehlterPartner.kontaktperson}` : ''}\n\nim Anhang finden Sie unseren Auftrag «${d.auftrag.titel}»${
          terminVon ? ` (Termin ${datum(terminVon)}${terminBis && terminBis !== terminVon ? ` bis ${datum(terminBis)}` : ''})` : ''
        }. Bitte bestätigen Sie kurz den Termin.\n\nFreundliche Grüsse\n${profil?.name ?? ''}\n${d.betrieb.name}`;
        const ergebnis = await pdfPerMail(pdf, dateiname, gewaehlterPartner?.email ?? null, betreff, text);
        if (ergebnis !== 'abgebrochen') {
          await supabase.rpc('auftrag_status', { p_id: auftragId, p_status: 'Gesendet' });
          await qc.invalidateQueries({ queryKey: ['auftraege'] });
          setMeldung(
            ergebnis === 'geteilt'
              ? 'Auftrag als gesendet markiert.'
              : 'PDF heruntergeladen und Mail vorbereitet: bitte das PDF anhängen. Auftrag als gesendet markiert.',
          );
        }
      }
      if (!id) navigate(`/auftraege/${auftragId}`, { replace: true });
    } catch (e) {
      setFehler(fehlertext(e));
    } finally {
      setArbeitet(false);
    }
  }

  async function statusSetzen(status: string) {
    if (!id) return;
    const { error } = await supabase.rpc('auftrag_status', { p_id: id, p_status: status });
    if (error) return setFehler(fehlertext(error));
    qc.invalidateQueries({ queryKey: ['auftraege'] });
    qc.invalidateQueries({ queryKey: ['feldarbeiten'] });
  }

  if (!darfVerwalten) return <p>Aufträge können nur Administratoren und Betriebsleiter bearbeiten.</p>;
  if (id && auftraege.isSuccess && !vorhanden) return <p>Auftrag nicht gefunden.</p>;

  const artikelFuer = (kategorie: string) => (lager.data ?? []).filter((a) => a.kategorie === kategorie);

  return (
    <div className="flex flex-col gap-4 pb-6">
      <header className="flex items-center gap-3">
        <Link to="/auftraege" aria-label="Zurück" className="knopf-leise h-11 w-11 px-0">
          <Icon name="zurueck" />
        </Link>
        <div className="min-w-0">
          <h1 className="m-0 truncate text-2xl font-extrabold text-hof">{id ? `Auftrag ${vorhanden?.nummer ?? ''}` : art === 'Lohnarbeit' ? 'Neuer Lohnauftrag' : 'Neuer Werkstattauftrag'}</h1>
          {(quelleArbeit || quelleAufgabe) && (
            <span className="block text-xs font-bold text-hof">
              Aus Aufgabe: {quelleArbeit ? `${quelleArbeit.arbeitsart} (${datum(quelleArbeit.datum)})` : quelleAufgabe?.titel} – beim Abschliessen wird sie erledigt.
            </span>
          )}
          {vorhanden && (
            <span className="flex items-center gap-2 text-sm text-leise">
              <AuftragStatus status={vorhanden.status} />
              {vorhanden.gesendet_am && `gesendet ${datum(vorhanden.gesendet_am)}`}
              {vorhanden.erledigt_am && ` · erledigt ${datum(vorhanden.erledigt_am)}`}
            </span>
          )}
        </div>
      </header>

      {vorhanden?.status === 'Erledigt' && (
        <p className="karte m-0 text-sm">
          Dieser Auftrag ist erledigt und wurde{' '}
          {vorhanden.feldarbeit_id ? <Link to={`/arbeiten/${vorhanden.feldarbeit_id}`}>in die Ackerschlagkartei übernommen</Link> : <Link to={`/maschinen/${vorhanden.maschine_id}`}>als Reparatur bei der Maschine erfasst</Link>}
          .
        </p>
      )}
      {vorhanden?.status === 'Erledigt' && <AbrechnungNachtragen auftrag={vorhanden} flaecheM2={abschlussFlaecheM2} />}

      <fieldset disabled={!!abgeschlossen} className="m-0 flex flex-col gap-4 border-0 p-0">
        {!id && (
          <div className="grid grid-cols-2 gap-1 rounded-2xl bg-[#E7E1D0] p-1">
            {(['Lohnarbeit', 'Werkstatt'] as const).map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={art === a}
                onClick={() => setArt(a)}
                className={`min-h-10 rounded-xl text-sm font-extrabold ${art === a ? 'bg-white text-hof' : 'text-[#4D5B50]'}`}
              >
                {a === 'Lohnarbeit' ? 'Lohnarbeit (Feld)' : 'Werkstatt (Maschine)'}
              </button>
            ))}
          </div>
        )}

        <section className="karte flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="feld-label col-span-2">
              {art === 'Lohnarbeit' ? 'Lohnunternehmen / Dienstleister' : 'Werkstatt / Mechaniker'}
              <select className="eingabe" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                <option value="">– wählen –</option>
                {sortiertePartner.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({rollenText(p)})
                  </option>
                ))}
              </select>
              {partner.isSuccess && !sortiertePartner.length && (
                <Link to="/partner/neu" className="font-bold">
                  Zuerst einen Partner erfassen
                </Link>
              )}
            </label>
            {art === 'Lohnarbeit' ? (
              <label className="feld-label">
                Arbeit
                <select className="eingabe" value={arbeitsart} onChange={(e) => setArbeitsart(e.target.value)}>
                  {ARBEITSGRUPPEN.map((g) => (
                    <optgroup key={g.name} label={g.name}>
                      {g.arten.map((a) => (
                        <option key={a}>{a}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            ) : (
              <label className="feld-label">
                Maschine
                <select className="eingabe" value={maschineId} onChange={(e) => setMaschineId(e.target.value)}>
                  <option value="">– wählen –</option>
                  {(maschinen.data ?? [])
                    .filter((m) => m.status !== 'verkauft')
                    .sort((a, b) => Number(MIT_MOTOR.includes(b.kategorie)) - Number(MIT_MOTOR.includes(a.kategorie)))
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label className="feld-label">
              Titel
              <input
                className="eingabe"
                value={titel}
                onChange={(e) => {
                  setTitel(e.target.value);
                  setTitelGeaendert(true);
                }}
              />
            </label>
            <label className="feld-label">
              Termin von
              <input className="eingabe" type="date" value={terminVon} onChange={(e) => setTerminVon(e.target.value)} />
            </label>
            <label className="feld-label">
              bis (optional)
              <input className="eingabe" type="date" value={terminBis} onChange={(e) => setTerminBis(e.target.value)} />
            </label>
          </div>
        </section>

        {art === 'Lohnarbeit' && (
          <section className="karte flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h2 className="m-0 text-lg font-extrabold">Felder</h2>
              <span className="text-sm font-extrabold text-hof">
                {feldWahl.length} Felder · {ha(flaecheHa * 10000)}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {(felder.data ?? [])
                .filter((f) => f.status === 'bewirtschaftet' || feldWahl.includes(f.id))
                .map((f) => {
                  const an = feldWahl.includes(f.id);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      aria-pressed={an}
                      onClick={() => setFeldWahl(an ? feldWahl.filter((x) => x !== f.id) : [...feldWahl, f.id])}
                      className={`flex min-h-11 items-center gap-2 rounded-full border-2 py-1 pl-1.5 pr-4 text-left text-sm font-extrabold ${an ? 'border-hof bg-hof text-white' : 'border-linie bg-white'}`}
                    >
                      <span className={`flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-xs ${an ? 'bg-white text-hof' : 'bg-hof-hell text-hof'}`}>
                        {f.feldnummer}
                      </span>
                      <span className="flex flex-col leading-tight">
                        {f.name}
                        {kulturAmTermin.get(f.id)?.eintrag.kulturen?.name && (
                          <span className={`text-[11px] font-semibold ${an ? 'text-white/85' : 'text-leise'}`}>{kulturAmTermin.get(f.id)!.eintrag.kulturen!.name}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
            </div>
            {(hinweise.data ?? []).some((h) => feldWahl.includes(h.feld_id)) && (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-bold text-leise">Diese Hinweise stehen im Auftrag:</span>
                <HinweisListe hinweise={(hinweise.data ?? []).filter((h) => feldWahl.includes(h.feld_id))} />
              </div>
            )}
          </section>
        )}

        {art === 'Lohnarbeit' && (
          <section className="karte flex flex-col gap-3">
            <h2 className="m-0 text-lg font-extrabold">Betriebsmittel</h2>
            <p className="m-0 text-sm text-leise">
              Saatgut, Dünger usw. Lege fest, ob du es bereitstellst oder der Dienstleister es mitbringt. Beim Abschliessen wird nur Selbstgestelltes vom Lager
              abgebucht, dokumentiert wird alles.
            </p>
            {mittel.map((m, i) => {
              const setz = (teil: Partial<MittelZeile>) => setMittel(mittel.map((x, j) => (j === i ? { ...x, ...teil } : x)));
              const art_ = lager.data?.find((a) => a.id === m.artikel_id);
              const n = zahlAus(m.menge_je_ha);
              return (
                <div key={i} className="flex flex-col gap-2 rounded-2xl bg-grund p-3">
                  {neuerArtikelFuer === i && (
                    <NeuerArtikelDialog
                      kategorie={m.kategorie as Lagerartikel['kategorie']}
                      onFertig={(neuId) => {
                        if (neuId) setz({ artikel_id: neuId });
                        setNeuerArtikelFuer(null);
                      }}
                    />
                  )}
                  <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#E7E1D0] p-1">
                    {(['Betrieb', 'Dienstleister'] as const).map((b) => (
                      <button
                        key={b}
                        type="button"
                        aria-pressed={m.bereitstellung === b}
                        onClick={() => setz({ bereitstellung: b, quelle: b === 'Betrieb' ? 'lager' : m.quelle })}
                        className={`min-h-10 rounded-lg text-xs font-extrabold ${m.bereitstellung === b ? 'bg-white text-hof' : 'text-[#4D5B50]'}`}
                      >
                        {b === 'Betrieb' ? 'Ich stelle bereit' : 'Dienstleister bringt mit'}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="feld-label">
                      Kategorie
                      <select className="eingabe" value={m.kategorie} onChange={(e) => setz({ kategorie: e.target.value, artikel_id: '' })}>
                        {LAGERKATEGORIEN.map((k) => (
                          <option key={k}>{k}</option>
                        ))}
                      </select>
                    </label>
                    {m.bereitstellung === 'Dienstleister' && (
                      <label className="feld-label">
                        Angabe
                        <select className="eingabe" value={m.quelle} onChange={(e) => setz({ quelle: e.target.value as MittelZeile['quelle'] })}>
                          <option value="frei">Sorte/Produkt eintippen</option>
                          <option value="lager">Aus meinen Artikeln</option>
                        </select>
                      </label>
                    )}
                  </div>
                  {m.quelle === 'lager' ? (
                    <label className="feld-label">
                      Artikel
                      <select
                        className="eingabe"
                        value={m.artikel_id}
                        onChange={(e) => (e.target.value === NEU ? setNeuerArtikelFuer(i) : setz({ artikel_id: e.target.value }))}
                      >
                        <option value="">– wählen –</option>
                        <option value={NEU}>+ Neu: {m.kategorie} anlegen …</option>
                        {artikelFuer(m.kategorie).map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.bezeichnung}
                            {a.lagerfuehrung ? ` · Lager ${menge(Number(a.bestand), a.einheit)}` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <div className="grid grid-cols-[1fr_90px] gap-2">
                      <label className="feld-label">
                        Sorte / Produkt
                        <input className="eingabe" value={m.bezeichnung} onChange={(e) => setz({ bezeichnung: e.target.value })} placeholder="z. B. Winterweizen Arina" />
                      </label>
                      <label className="feld-label">
                        Einheit
                        <select className="eingabe px-2" value={m.einheit} onChange={(e) => setz({ einheit: e.target.value })}>
                          {['kg', 't', 'l', 'm³', 'Stk', 'Einheit'].map((x) => (
                            <option key={x}>{x}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <label className="feld-label">
                      Menge pro ha ({m.quelle === 'lager' ? (art_?.einheit ?? '') : m.einheit})
                      <input className="eingabe" inputMode="decimal" value={m.menge_je_ha} onChange={(e) => setz({ menge_je_ha: e.target.value })} />
                    </label>
                    <div className="feld-label">
                      Total für {ha(flaecheHa * 10000)}
                      <span className="flex min-h-12 items-center rounded-xl bg-white px-3 text-base font-extrabold text-text">
                        {n ? menge(n * flaecheHa, m.quelle === 'lager' ? art_?.einheit : m.einheit) : '–'}
                      </span>
                    </div>
                  </div>
                  {m.bereitstellung === 'Betrieb' && art_ && art_.lagerfuehrung && n != null && n * flaecheHa > Number(art_.bestand) && (
                    <span className="flex gap-2 rounded-xl bg-warn-hell p-2 text-sm font-semibold text-[#5C3D00]">
                      <Icon name="warnung" groesse={18} className="shrink-0" />
                      Lager reicht nicht ({menge(Number(art_.bestand), art_.einheit)} vorhanden).
                    </span>
                  )}
                  <label className="feld-label">
                    Bemerkung
                    <input className="eingabe" value={m.bemerkung} onChange={(e) => setz({ bemerkung: e.target.value })} placeholder="z. B. Säcke stehen in der Scheune" />
                  </label>
                  <button type="button" className="self-start text-sm font-bold text-fehler" onClick={() => setMittel(mittel.filter((_, j) => j !== i))}>
                    Entfernen
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className="self-start text-sm font-extrabold text-hof"
              onClick={() =>
                setMittel([
                  ...mittel,
                  { quelle: 'frei', artikel_id: '', bezeichnung: '', kategorie: arbeitsart === 'Düngen' ? 'Dünger' : arbeitsart === 'Pflanzenschutz' ? 'Pflanzenschutzmittel' : 'Saatgut', einheit: 'kg', menge_je_ha: '', bereitstellung: 'Dienstleister', bemerkung: '' },
                ])
              }
            >
              + Betriebsmittel
            </button>
          </section>
        )}

        {art === 'Werkstatt' && maschine && (
          <section className="karte flex flex-col gap-2">
            <h2 className="m-0 text-lg font-extrabold">Beobachtungen und Mängel</h2>
            <p className="m-0 text-sm text-leise">Die gewählten Einträge stehen mit allen Details im Auftrag und werden beim Abschliessen als behoben markiert.</p>
            {beobachtungen.length === 0 && (
              <p className="m-0 text-sm text-leise">
                Keine offenen Beobachtungen. <Link to={`/maschinen/${maschine.id}`}>Bei der Maschine erfassen</Link>
              </p>
            )}
            {beobachtungen.map((e) => (
              <label key={e.id} className="flex min-h-11 items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5 accent-hof"
                  checked={beobWahl.includes(e.id)}
                  onChange={(x) => setBeobWahl(x.target.checked ? [...beobWahl, e.id] : beobWahl.filter((y) => y !== e.id))}
                />
                <span>
                  <strong>{e.titel}</strong> <span className="text-leise">({datum(e.datum)})</span>
                  {e.beschreibung && <span className="block text-leise">{e.beschreibung}</span>}
                </span>
              </label>
            ))}
          </section>
        )}

        <section className="karte flex flex-col gap-2">
          <label className="feld-label">
            {art === 'Werkstatt' ? 'Auftragsbeschreibung (was soll gemacht werden?)' : 'Weitere Hinweise an den Dienstleister'}
            <textarea
              className="eingabe min-h-24 py-2"
              value={beschreibung}
              onChange={(e) => setBeschreibung(e.target.value)}
              placeholder={art === 'Werkstatt' ? 'z. B. Hydraulik prüfen, Service 1000 h durchführen. Maschine wird gebracht.' : 'z. B. Zufahrt über den Feldweg Nord, Vorgewende 12 m'}
            />
          </label>
        </section>

        {!abgeschlossen && (
          <section className="karte flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="m-0 text-lg font-extrabold">Abrechnung</h2>
              <button type="button" className="text-sm font-bold text-hof" onClick={() => setRichtpreisWahl(true)}>
                aus Richtpreis …
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="feld-label">
                Abrechnen nach
                <select className="eingabe" value={abrechnung} onChange={(e) => setAbrechnung(e.target.value)}>
                  <option value="">noch offen / Betrag</option>
                  {ABRECHNUNGSARTEN.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              {abrechnung && (
                <label className="feld-label">
                  {abrechnung === 'Pauschale' ? 'Betrag CHF' : `CHF je ${ABRECHNUNG_EINHEIT[abrechnung as keyof typeof ABRECHNUNG_EINHEIT]}`}
                  <input className="eingabe" inputMode="decimal" value={preisJe} onChange={(e) => setPreisJe(e.target.value)} />
                </label>
              )}
            </div>
            {abrechnung === 'Hektare' && zahlAus(preisJe) != null && art === 'Lohnarbeit' && flaecheHa > 0 && (
              <span className="text-sm text-leise">
                Voraussichtlich {ha(flaecheHa * 10000)} × {chf(zahlAus(preisJe)!)} = {chf(Math.round(flaecheHa * zahlAus(preisJe)! * 100) / 100)}
              </span>
            )}
            {abrechnung && abrechnung !== 'Pauschale' && abrechnung !== 'Hektare' && (
              <span className="text-sm text-leise">Die {abrechnung === 'Stunde' ? 'Stunden' : abrechnung === 'Ballen' ? 'Ballenzahl' : 'Stückzahl'} gibst du beim Abschliessen ein; die Kosten werden berechnet.</span>
            )}
          </section>
        )}
      </fieldset>
      {richtpreisWahl && (
        <RichtpreisWahl
          bereiche={['Dienstleistung', 'Maschine', 'Arbeit']}
          titel="Abrechnung aus Richtpreis"
          onSchliessen={() => setRichtpreisWahl(false)}
          onWahl={(rp) => {
            const e = rp.einheit.toLowerCase();
            setAbrechnung(e === 'h' || e === 'akh' ? 'Stunde' : e === 'ha' ? 'Hektare' : e.startsWith('ballen') ? 'Ballen' : e.startsWith('stk') || e.startsWith('stück') ? 'Stück' : 'Pauschale');
            setPreisJe(String(rp.preis_chf));
            setRichtpreisWahl(false);
          }}
        />
      )}

      {fehler && <p className="m-0 rounded-xl bg-fehler-hell p-3 text-sm font-semibold text-fehler">{fehler}</p>}
      {meldung && <p className="m-0 rounded-xl bg-hof-hell p-3 text-sm font-semibold text-hof">{meldung}</p>}

      {!abgeschlossen && (
        <div className="flex flex-wrap gap-2">
          <button className="knopf" disabled={arbeitet} onClick={() => pdfErstellen('mail')}>
            {arbeitet ? 'Erstelle PDF …' : 'Per Mail senden (PDF)'}
          </button>
          <button className="knopf-leise" disabled={arbeitet} onClick={() => pdfErstellen('ansehen')}>
            PDF ansehen
          </button>
          <button
            className="knopf-leise"
            disabled={arbeitet}
            onClick={async () => {
              const neuId = await speichern();
              if (neuId) {
                setMeldung('Gespeichert.');
                if (!id) navigate(`/auftraege/${neuId}`, { replace: true });
              }
            }}
          >
            Speichern
          </button>
        </div>
      )}
      {gewaehlterPartner && !gewaehlterPartner.email && !abgeschlossen && (
        <p className="m-0 text-xs text-leise">
          Für {gewaehlterPartner.name} ist keine E-Mail-Adresse erfasst. <Link to={`/partner/${gewaehlterPartner.id}`}>Jetzt ergänzen</Link>
        </p>
      )}

      {id && !abgeschlossen && (
        <section className="karte flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {vorhanden?.status !== 'Bestätigt' && (
              <button className="knopf-leise" onClick={() => statusSetzen('Bestätigt')}>
                Als bestätigt markieren
              </button>
            )}
            <button className="knopf" onClick={() => setAbschlussOffen(true)}>
              Erledigt – abschliessen
            </button>
            <button className="ml-auto text-sm font-bold text-fehler" onClick={() => confirm('Auftrag abbrechen?') && statusSetzen('Abgebrochen')}>
              Abbrechen
            </button>
          </div>
          {abschlussOffen && vorhanden && (
            <AuftragAbschluss
              auftrag={{ ...vorhanden, abrechnung: (abrechnung || null) as Auftrag['abrechnung'], preis_je_einheit: abrechnung ? zahlAus(preisJe) : null, arbeitsart: art === 'Lohnarbeit' ? arbeitsart : null }}
              flaecheM2={abschlussFlaecheM2}
              felder={abschlussFelder}
              vorSpeichern={async () => !!(await speichern())}
              onAbbrechen={() => setAbschlussOffen(false)}
              onFertig={(ziel) => navigate(art === 'Lohnarbeit' ? `/arbeiten/${ziel}` : `/maschinen/${maschineId}`)}
            />
          )}
        </section>
      )}
    </div>
  );
}

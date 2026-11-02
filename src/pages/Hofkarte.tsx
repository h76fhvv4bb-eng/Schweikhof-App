import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import type { MultiPolygon, Polygon } from 'geojson';
import { supabase, fehlertext } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useAnbau, useFelder, useHofobjekte } from '../lib/daten';
import { ha } from '../lib/format';
import { GEBAEUDE, KARTEN, QUELLE, SCHWEIZ, feldLabelHtml, flaecheM2, gebaeudeHtml, ortSuchen } from '../lib/karte';
import { HOFOBJEKT_TYPEN, type HofobjektTyp } from '../lib/typen';
import { Icon } from '../components/Icon';

type Modus =
  | { art: 'ansehen' }
  | { art: 'zeichnen'; feldId?: string }
  | { art: 'gebaeude'; typ: HofobjektTyp }
  | { art: 'grenze'; feldId: string }
  | { art: 'verschieben'; id: string };

type Geometrie = Polygon | MultiPolygon;

/** Hof-Ansicht: Luftbild mit Feldern und Gebäuden. Wird nur geladen, wenn sie gebraucht wird. */
export default function Hofkarte() {
  const { darfVerwalten, profil } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const jahr = new Date().getFullYear();
  const felder = useFelder();
  const anbau = useAnbau(jahr, jahr);
  const objekte = useHofobjekte();

  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const ebenen = useRef<{ luftbild: L.TileLayer; karte: L.TileLayer; parzellen: L.TileLayer; felder: L.LayerGroup; gebaeude: L.LayerGroup } | null>(null);
  const feldLayer = useRef(new Map<string, L.Polygon>());
  const markerRef = useRef(new Map<string, L.Marker>());
  const eingepasst = useRef(false);

  const [modus, setModusState] = useState<Modus>({ art: 'ansehen' });
  const modusRef = useRef<Modus>(modus);
  const setModus = (m: Modus) => {
    modusRef.current = m;
    setModusState(m);
  };
  const [gewaehlt, setGewaehlt] = useState<{ art: 'feld' | 'gebaeude'; id: string } | null>(null);
  const [zeichnung, setZeichnung] = useState<{ geometrie: Geometrie; flaeche: number; feldId?: string } | null>(null);
  const [neuerOrt, setNeuerOrt] = useState<{ breite: number; laenge: number; typ: HofobjektTyp } | null>(null);
  const [grundkarte, setGrundkarte] = useState<'luftbild' | 'karte'>('luftbild');
  const [parzellen, setParzellen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [gebaeudeWahl, setGebaeudeWahl] = useState(false);

  const kulturJeFeld = useMemo(() => new Map((anbau.data ?? []).map((a) => [a.feld_id, a.kulturen])), [anbau.data]);

  // ---------- Karte einmal aufbauen ----------
  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    const map = L.map(divRef.current, { zoomControl: false }).setView([SCHWEIZ.breite, SCHWEIZ.laenge], SCHWEIZ.zoom);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    const luftbild = L.tileLayer(KARTEN.luftbild, { maxNativeZoom: 19, maxZoom: 21, attribution: QUELLE }).addTo(map);
    const karte = L.tileLayer(KARTEN.landeskarte, { maxNativeZoom: 18, maxZoom: 21, attribution: QUELLE });
    const parz = L.tileLayer(KARTEN.parzellen, { maxNativeZoom: 20, maxZoom: 21, minZoom: 15, opacity: 0.85, attribution: QUELLE });
    const felderGruppe = L.layerGroup().addTo(map);
    const gebaeudeGruppe = L.layerGroup().addTo(map);
    ebenen.current = { luftbild, karte, parzellen: parz, felder: felderGruppe, gebaeude: gebaeudeGruppe };

    map.pm.setLang('de');
    map.pm.setGlobalOptions({ snappable: true, snapDistance: 18, allowSelfIntersection: false });

    map.on('pm:create', (e) => {
      const layer = (e as unknown as { layer: L.Polygon }).layer;
      const geometrie = layer.toGeoJSON().geometry as Geometrie;
      map.removeLayer(layer);
      const m = modusRef.current;
      setZeichnung({ geometrie, flaeche: flaecheM2(geometrie), feldId: m.art === 'zeichnen' ? m.feldId : undefined });
      modusRef.current = { art: 'ansehen' };
      setModusState({ art: 'ansehen' });
    });
    map.on('click', (e: L.LeafletMouseEvent) => {
      const m = modusRef.current;
      if (m.art === 'gebaeude') {
        setNeuerOrt({ breite: e.latlng.lat, laenge: e.latlng.lng, typ: m.typ });
        modusRef.current = { art: 'ansehen' };
        setModusState({ art: 'ansehen' });
      } else if (m.art === 'ansehen') {
        setGewaehlt(null);
      }
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ---------- Grundkarte und Parzellen umschalten ----------
  useEffect(() => {
    const map = mapRef.current;
    const e = ebenen.current;
    if (!map || !e) return;
    if (grundkarte === 'luftbild') {
      map.removeLayer(e.karte);
      e.luftbild.addTo(map).bringToBack();
    } else {
      map.removeLayer(e.luftbild);
      e.karte.addTo(map).bringToBack();
    }
    if (parzellen) e.parzellen.addTo(map);
    else map.removeLayer(e.parzellen);
  }, [grundkarte, parzellen]);

  // ---------- Felder zeichnen ----------
  useEffect(() => {
    const e = ebenen.current;
    if (!e) return;
    e.felder.clearLayers();
    feldLayer.current.clear();
    for (const f of felder.data ?? []) {
      if (!f.geometrie) continue;
      const k = kulturJeFeld.get(f.id);
      const istGewaehlt = gewaehlt?.art === 'feld' && gewaehlt.id === f.id;
      const gruppe = L.geoJSON(f.geometrie, {
        style: {
          color: istGewaehlt ? '#1F4D2E' : '#FFFFFF',
          weight: istGewaehlt ? 4 : 3,
          fillColor: k?.farbe ?? '#C9C2B0',
          fillOpacity: 0.6,
        },
      });
      const polygon = gruppe.getLayers()[0] as L.Polygon;
      polygon.bindTooltip(feldLabelHtml(f.name, k?.name ?? null, ha(Number(f.flaeche_m2), 1)), {
        permanent: true,
        direction: 'center',
        className: 'hof-feld-label',
      });
      polygon.on('click', (ev) => {
        L.DomEvent.stopPropagation(ev as unknown as Event);
        if (modusRef.current.art === 'ansehen') setGewaehlt({ art: 'feld', id: f.id });
      });
      polygon.addTo(e.felder);
      feldLayer.current.set(f.id, polygon);
    }
  }, [felder.data, kulturJeFeld, gewaehlt]);

  // ---------- Gebäude zeichnen ----------
  useEffect(() => {
    const e = ebenen.current;
    if (!e) return;
    e.gebaeude.clearLayers();
    markerRef.current.clear();
    for (const o of objekte.data ?? []) {
      const verschieben = modus.art === 'verschieben' && modus.id === o.id;
      const marker = L.marker([o.breite, o.laenge], {
        icon: L.divIcon({
          html: gebaeudeHtml(o.typ, o.name, verschieben || (gewaehlt?.art === 'gebaeude' && gewaehlt.id === o.id)),
          className: '',
          iconSize: [96, 76],
          iconAnchor: [48, 30],
        }),
        draggable: verschieben,
        keyboard: true,
        title: o.name,
      });
      marker.on('click', (ev) => {
        L.DomEvent.stopPropagation(ev as unknown as Event);
        if (modusRef.current.art !== 'ansehen') return;
        const ziel = o.link ?? GEBAEUDE[o.typ].link;
        if (ziel && ziel !== '/' && !darfVerwalten) navigate(ziel);
        else setGewaehlt({ art: 'gebaeude', id: o.id });
      });
      marker.on('dragend', async () => {
        const p = marker.getLatLng();
        const { error } = await supabase.from('hofobjekte').update({ breite: p.lat, laenge: p.lng, version: o.version }).eq('id', o.id);
        if (error) setFehler(fehlertext(error));
        qc.invalidateQueries({ queryKey: ['hofobjekte'] });
      });
      marker.addTo(e.gebaeude);
      markerRef.current.set(o.id, marker);
    }
  }, [objekte.data, modus, gewaehlt, darfVerwalten, navigate, qc]);

  // ---------- Beim ersten Laden auf den Hof zoomen ----------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || eingepasst.current || !felder.isSuccess || !objekte.isSuccess) return;
    const punkte: L.LatLngExpression[] = [];
    for (const f of felder.data) {
      if (!f.geometrie) continue;
      const b = L.geoJSON(f.geometrie).getBounds();
      if (b.isValid()) punkte.push(...boundsPunkte(b));
    }
    for (const o of objekte.data) punkte.push([o.breite, o.laenge]);
    if (punkte.length) map.fitBounds(L.latLngBounds(punkte), { padding: [40, 40], maxZoom: 18 });
    eingepasst.current = true;
  }, [felder.isSuccess, objekte.isSuccess, felder.data, objekte.data]);

  // ---------- Modus-Wechsel steuern ----------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (modus.art === 'zeichnen') map.pm.enableDraw('Polygon', { snappable: true });
    else map.pm.disableDraw();
    if (modus.art === 'grenze') feldLayer.current.get(modus.feldId)?.pm.enable({ allowSelfIntersection: false, snappable: true });
    return () => {
      if (modus.art === 'grenze') feldLayer.current.get(modus.feldId)?.pm.disable();
    };
  }, [modus]);

  // Aus der Feldseite: ?zeichnen=<feldId> startet das Zeichnen für dieses Feld
  useEffect(() => {
    const id = params.get('zeichnen');
    if (id && darfVerwalten && mapRef.current) {
      setModus({ art: 'zeichnen', feldId: id });
      params.delete('zeichnen');
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, darfVerwalten]);

  async function grenzeSpeichern(feldId: string) {
    const layer = feldLayer.current.get(feldId);
    const feld = felder.data?.find((f) => f.id === feldId);
    if (!layer || !feld) return;
    const geometrie = layer.toGeoJSON().geometry as Geometrie;
    const { error } = await supabase
      .from('felder')
      .update({ geometrie, flaeche_gezeichnet_m2: flaecheM2(geometrie), version: feld.version })
      .eq('id', feldId);
    if (error) setFehler(fehlertext(error));
    setModus({ art: 'ansehen' });
    qc.invalidateQueries({ queryKey: ['felder'] });
  }

  const feld = gewaehlt?.art === 'feld' ? felder.data?.find((f) => f.id === gewaehlt.id) : undefined;
  const objekt = gewaehlt?.art === 'gebaeude' ? objekte.data?.find((o) => o.id === gewaehlt.id) : undefined;
  const ohneGrenze = (felder.data ?? []).filter((f) => !f.geometrie).length;

  return (
    <div className="relative -mx-4 overflow-hidden md:mx-0 md:rounded-[22px] md:shadow-[0_2px_0_var(--color-rand)]">
      <div ref={divRef} className="h-[calc(100dvh-230px)] min-h-[420px] w-full bg-[#CFE3B8] md:h-[70vh]" />

      {/* Oben: Suche und Ebenen */}
      <div className="pointer-events-none absolute inset-x-2 top-2 z-[1000] flex flex-col gap-2">
        <Ortsuche onWahl={(b, l) => mapRef.current?.setView([b, l], 17)} />
        <div className="pointer-events-auto flex flex-wrap gap-2">
          <div className="flex rounded-full bg-white p-1 shadow">
            {(['luftbild', 'karte'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setGrundkarte(k)}
                aria-pressed={grundkarte === k}
                className={`min-h-9 rounded-full px-3 text-xs font-extrabold ${grundkarte === k ? 'bg-hof text-white' : 'text-text'}`}
              >
                {k === 'luftbild' ? 'Luftbild' : 'Karte'}
              </button>
            ))}
          </div>
          <button
            onClick={() => setParzellen(!parzellen)}
            aria-pressed={parzellen}
            className={`min-h-11 rounded-full px-3 text-xs font-extrabold shadow ${parzellen ? 'bg-hof text-white' : 'bg-white text-text'}`}
          >
            Parzellengrenzen
          </button>
        </div>
      </div>

      {/* Werkzeuge */}
      {darfVerwalten && modus.art === 'ansehen' && !zeichnung && !neuerOrt && !gewaehlt && (
        <div className="absolute bottom-3 left-3 z-[1000] flex flex-col items-start gap-2">
          {gebaeudeWahl && (
            <div className="flex max-w-[300px] flex-wrap gap-1.5 rounded-2xl bg-white p-2 shadow-lg">
              {HOFOBJEKT_TYPEN.map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setGebaeudeWahl(false);
                    setModus({ art: 'gebaeude', typ: t });
                  }}
                  className="flex min-h-11 items-center gap-1 rounded-xl bg-grund px-2 text-xs font-extrabold"
                >
                  <svg viewBox="0 0 44 44" width="24" height="24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: GEBAEUDE[t].svg }} />
                  {t}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button className="knopf" onClick={() => setModus({ art: 'zeichnen' })}>
              <Icon name="felder" /> Feld zeichnen
            </button>
            <button className="knopf-leise shadow" onClick={() => setGebaeudeWahl(!gebaeudeWahl)}>
              <Icon name="heute" /> Gebäude
            </button>
          </div>
        </div>
      )}

      {/* Hinweise während eines Modus */}
      {modus.art !== 'ansehen' && (
        <div className="absolute inset-x-3 bottom-3 z-[1000] flex flex-col gap-2 rounded-2xl bg-white p-3 shadow-lg">
          <span className="text-sm font-bold">
            {modus.art === 'zeichnen' &&
              `${modus.feldId ? `Grenze für «${felder.data?.find((f) => f.id === modus.feldId)?.name}»: ` : ''}Ecken des Feldes antippen. Zum Abschliessen den ersten Punkt erneut antippen.`}
            {modus.art === 'gebaeude' && `Tippe auf die Stelle, wo «${modus.typ}» stehen soll.`}
            {modus.art === 'grenze' && 'Eckpunkte ziehen. Neue Punkte entstehen, wenn du die Mitte einer Kante ziehst.'}
            {modus.art === 'verschieben' && 'Gebäude an die richtige Stelle ziehen.'}
          </span>
          <div className="flex gap-2">
            {modus.art === 'grenze' && (
              <button className="knopf flex-1" onClick={() => grenzeSpeichern(modus.feldId)}>
                Grenze speichern
              </button>
            )}
            <button
              className={modus.art === 'verschieben' ? 'knopf flex-1' : 'knopf-leise flex-1'}
              onClick={() => {
                setModus({ art: 'ansehen' });
                qc.invalidateQueries({ queryKey: ['felder'] });
              }}
            >
              {modus.art === 'verschieben' ? 'Fertig' : 'Abbrechen'}
            </button>
          </div>
        </div>
      )}

      {/* Gewähltes Feld */}
      {feld && modus.art === 'ansehen' && (
        <Karte onSchliessen={() => setGewaehlt(null)}>
          <span className="text-xs font-bold text-leise">Feld {feld.feldnummer}</span>
          <h2 className="m-0 text-xl font-extrabold">{feld.name}</h2>
          <span className="text-sm">
            {kulturJeFeld.get(feld.id)?.name ?? `Keine Kultur ${jahr}`} · {ha(Number(feld.flaeche_m2))}
            {feld.flaeche_gezeichnet_m2 && Math.abs(Number(feld.flaeche_gezeichnet_m2) - Number(feld.flaeche_m2)) > 100 && (
              <span className="text-warn"> · gezeichnet {ha(Number(feld.flaeche_gezeichnet_m2))}</span>
            )}
          </span>
          <div className="mt-2 flex flex-wrap gap-2">
            {profil?.rolle !== 'lesen' && (
              <Link to={`/erfassen?feld=${feld.id}`} className="knopf no-underline">
                <Icon name="plus" /> Arbeit
              </Link>
            )}
            <Link to={`/felder/${feld.id}`} className="knopf-leise no-underline">
              Details
            </Link>
            {darfVerwalten && (
              <button className="knopf-leise" onClick={() => setModus({ art: 'grenze', feldId: feld.id })}>
                Grenze ändern
              </button>
            )}
          </div>
        </Karte>
      )}

      {/* Gewähltes Gebäude */}
      {objekt && modus.art === 'ansehen' && (
        <GebaeudeKarte
          objekt={objekt}
          onSchliessen={() => setGewaehlt(null)}
          onVerschieben={() => {
            setGewaehlt(null);
            setModus({ art: 'verschieben', id: objekt.id });
          }}
          onFehler={setFehler}
        />
      )}

      {/* Neue Zeichnung zuordnen */}
      {zeichnung && (
        <ZeichnungZuordnen
          zeichnung={zeichnung}
          onFertig={() => setZeichnung(null)}
          onFehler={setFehler}
          betriebId={profil!.betrieb_id}
        />
      )}

      {/* Neues Gebäude benennen */}
      {neuerOrt && (
        <NeuesGebaeude ort={neuerOrt} betriebId={profil!.betrieb_id} onFertig={() => setNeuerOrt(null)} onFehler={setFehler} />
      )}

      {fehler && (
        <button
          onClick={() => setFehler(null)}
          className="absolute inset-x-3 top-28 z-[1100] rounded-2xl bg-fehler-hell p-3 text-left text-sm font-semibold text-fehler shadow"
        >
          {fehler} (antippen zum Schliessen)
        </button>
      )}

      {darfVerwalten && ohneGrenze > 0 && modus.art === 'ansehen' && !gewaehlt && !zeichnung && (
        <span className="absolute right-3 top-28 z-[999] rounded-full bg-white/90 px-3 py-1 text-xs font-bold shadow">
          {ohneGrenze} Felder ohne Grenze
        </span>
      )}
    </div>
  );
}

function boundsPunkte(b: L.LatLngBounds): L.LatLngExpression[] {
  return [b.getSouthWest(), b.getNorthEast()];
}

function Karte({ children, onSchliessen }: { children: ReactNode; onSchliessen: () => void }) {
  return (
    <div className="absolute inset-x-3 bottom-3 z-[1000] flex flex-col gap-1 rounded-[20px] bg-white p-4 shadow-lg">
      <button onClick={onSchliessen} aria-label="Schliessen" className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center text-leise">
        ✕
      </button>
      {children}
    </div>
  );
}

function Ortsuche({ onWahl }: { onWahl: (breite: number, laenge: number) => void }) {
  const [text, setText] = useState('');
  const [treffer, setTreffer] = useState<{ name: string; breite: number; laenge: number }[]>([]);
  const [laeuft, setLaeuft] = useState(false);
  async function suchen(e: FormEvent) {
    e.preventDefault();
    if (text.trim().length < 3) return;
    setLaeuft(true);
    try {
      setTreffer(await ortSuchen(text));
    } catch {
      setTreffer([]);
    }
    setLaeuft(false);
  }
  return (
    <form onSubmit={suchen} className="pointer-events-auto flex flex-col gap-1">
      <label className="flex items-center gap-2 rounded-full bg-white px-3 shadow">
        <Icon name="suche" className="text-leise" />
        <span className="sr-only">Adresse oder Ort suchen</span>
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Adresse oder Ort suchen"
          className="min-h-11 flex-1 bg-transparent text-base outline-none"
        />
        {laeuft && <span className="text-xs text-leise">…</span>}
      </label>
      {treffer.length > 0 && (
        <div className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-lg">
          {treffer.map((t) => (
            <button
              key={`${t.breite},${t.laenge}`}
              type="button"
              className="min-h-11 border-b border-rand px-3 text-left text-sm last:border-0"
              onClick={() => {
                onWahl(t.breite, t.laenge);
                setTreffer([]);
              }}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}

function ZeichnungZuordnen({
  zeichnung,
  onFertig,
  onFehler,
  betriebId,
}: {
  zeichnung: { geometrie: Geometrie; flaeche: number; feldId?: string };
  onFertig: () => void;
  onFehler: (t: string) => void;
  betriebId: string;
}) {
  const qc = useQueryClient();
  const felder = useFelder();
  const [ziel, setZiel] = useState(zeichnung.feldId ?? '');
  const [name, setName] = useState('');
  const [uebernehmen, setUebernehmen] = useState(true);
  const naechsteNr = (felder.data ?? []).reduce((m, f) => Math.max(m, Number(f.feldnummer) || 0), 0) + 1;
  const sortiert = [...(felder.data ?? [])].sort((a, b) => Number(!!a.geometrie) - Number(!!b.geometrie));

  useEffect(() => {
    if (!ziel && felder.data) setZiel(sortiert.find((f) => !f.geometrie)?.id ?? 'neu');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [felder.data]);

  async function speichern() {
    let error;
    if (ziel === 'neu') {
      if (!name.trim()) return onFehler('Bitte einen Namen für das neue Feld eingeben.');
      ({ error } = await supabase.from('felder').insert({
        betrieb_id: betriebId,
        feldnummer: String(naechsteNr),
        name: name.trim(),
        flaeche_m2: zeichnung.flaeche,
        geometrie: zeichnung.geometrie,
        flaeche_gezeichnet_m2: zeichnung.flaeche,
      }));
    } else {
      const f = felder.data?.find((x) => x.id === ziel);
      if (!f) return;
      ({ error } = await supabase
        .from('felder')
        .update({
          geometrie: zeichnung.geometrie,
          flaeche_gezeichnet_m2: zeichnung.flaeche,
          ...(uebernehmen ? { flaeche_m2: zeichnung.flaeche } : {}),
          version: f.version,
        })
        .eq('id', f.id));
    }
    if (error) return onFehler(fehlertext(error));
    qc.invalidateQueries({ queryKey: ['felder'] });
    onFertig();
  }

  const zielFeld = felder.data?.find((f) => f.id === ziel);
  return (
    <Karte onSchliessen={onFertig}>
      <h2 className="m-0 text-xl font-extrabold">Gezeichnete Fläche: {ha(zeichnung.flaeche)}</h2>
      <label className="feld-label mt-2">
        Zu welchem Feld gehört sie?
        <select className="eingabe" value={ziel} onChange={(e) => setZiel(e.target.value)}>
          <option value="neu">+ Neues Feld anlegen</option>
          {sortiert.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} ({ha(Number(f.flaeche_m2))}){f.geometrie ? ' · hat schon eine Grenze' : ''}
            </option>
          ))}
        </select>
      </label>
      {ziel === 'neu' && (
        <label className="feld-label">
          Name des neuen Feldes (Nr. {naechsteNr})
          <input className="eingabe" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Oberacker" autoFocus />
        </label>
      )}
      {zielFeld && (
        <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
          <input type="checkbox" className="h-5 w-5 accent-hof" checked={uebernehmen} onChange={(e) => setUebernehmen(e.target.checked)} />
          Gezeichnete Fläche als Feldfläche übernehmen (bisher {ha(Number(zielFeld.flaeche_m2))})
        </label>
      )}
      <button className="knopf mt-2" onClick={speichern}>
        Speichern
      </button>
    </Karte>
  );
}

function NeuesGebaeude({
  ort,
  betriebId,
  onFertig,
  onFehler,
}: {
  ort: { breite: number; laenge: number; typ: HofobjektTyp };
  betriebId: string;
  onFertig: () => void;
  onFehler: (t: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(ort.typ === 'Hof' ? 'Schweikhof' : ort.typ);
  async function speichern() {
    const { error } = await supabase.from('hofobjekte').insert({
      betrieb_id: betriebId,
      typ: ort.typ,
      name: name.trim() || ort.typ,
      breite: ort.breite,
      laenge: ort.laenge,
      link: GEBAEUDE[ort.typ].link,
    });
    if (error) return onFehler(fehlertext(error));
    qc.invalidateQueries({ queryKey: ['hofobjekte'] });
    onFertig();
  }
  return (
    <Karte onSchliessen={onFertig}>
      <h2 className="m-0 text-xl font-extrabold">Neues Gebäude: {ort.typ}</h2>
      <label className="feld-label mt-2">
        Name
        <input className="eingabe" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      {GEBAEUDE[ort.typ].link && GEBAEUDE[ort.typ].link !== '/' && (
        <span className="text-sm text-leise">Ein Klick darauf öffnet später die Seite {GEBAEUDE[ort.typ].link === '/lager' ? 'Lager' : GEBAEUDE[ort.typ].link}.</span>
      )}
      <button className="knopf mt-2" onClick={speichern}>
        Platzieren
      </button>
    </Karte>
  );
}

function GebaeudeKarte({
  objekt,
  onSchliessen,
  onVerschieben,
  onFehler,
}: {
  objekt: { id: string; typ: HofobjektTyp; name: string; link: string | null; version: number };
  onSchliessen: () => void;
  onVerschieben: () => void;
  onFehler: (t: string) => void;
}) {
  const { darfVerwalten } = useAuth();
  const qc = useQueryClient();
  const ziel = objekt.link ?? GEBAEUDE[objekt.typ].link;
  const [name, setName] = useState(objekt.name);

  async function umbenennen() {
    const { error } = await supabase.from('hofobjekte').update({ name: name.trim() || objekt.typ, version: objekt.version }).eq('id', objekt.id);
    if (error) return onFehler(fehlertext(error));
    qc.invalidateQueries({ queryKey: ['hofobjekte'] });
  }
  async function entfernen() {
    if (!confirm(`«${objekt.name}» von der Karte entfernen?`)) return;
    const { error } = await supabase.from('hofobjekte').delete().eq('id', objekt.id);
    if (error) return onFehler(fehlertext(error));
    qc.invalidateQueries({ queryKey: ['hofobjekte'] });
    onSchliessen();
  }

  return (
    <Karte onSchliessen={onSchliessen}>
      <span className="text-xs font-bold text-leise">{objekt.typ}</span>
      {darfVerwalten ? (
        <input className="eingabe text-lg" value={name} onChange={(e) => setName(e.target.value)} onBlur={umbenennen} aria-label="Name" />
      ) : (
        <h2 className="m-0 text-xl font-extrabold">{objekt.name}</h2>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {ziel && ziel !== '/' && (
          <Link to={ziel} className="knopf no-underline">
            {ziel === '/lager' ? 'Zum Lager' : 'Öffnen'}
          </Link>
        )}
        {darfVerwalten && (
          <>
            <button className="knopf-leise" onClick={onVerschieben}>
              Verschieben
            </button>
            <button className="knopf-leise text-fehler" onClick={entfernen}>
              Entfernen
            </button>
          </>
        )}
      </div>
    </Karte>
  );
}

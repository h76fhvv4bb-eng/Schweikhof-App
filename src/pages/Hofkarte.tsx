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
import { useAnbau, useFelder, useHinweise, useHofobjekte, useMaschinen } from '../lib/daten';
import { ha } from '../lib/format';
import {
  GEBAEUDE, KARTEN, QUELLE, SCHWEIZ, feldLabelHtml, feldTeilen, felderVereinigen, flaecheM2, gebaeudeHtml, hinweisHtml, ortSuchen,
} from '../lib/karte';
import { HinweisListe } from '../components/FeldWerkzeuge';
import { HOFOBJEKT_TYPEN, NUTZUNGSARTEN, type FeldHinweis, type HofobjektTyp } from '../lib/typen';
import { Icon } from '../components/Icon';
import { BETRIEB_VORGABE } from '../lib/marke';

type Modus =
  | { art: 'ansehen' }
  | { art: 'zeichnen'; feldId?: string }
  | { art: 'gebaeude'; typ: HofobjektTyp }
  | { art: 'grenze'; feldId: string }
  | { art: 'verschieben'; id: string }
  | { art: 'teilen'; feldId: string }
  | { art: 'zusammen'; feldId: string; wahl: string[] }
  | { art: 'hinweis'; feldId: string };

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
  const hinweise = useHinweise();

  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const ebenen = useRef<{
    luftbild: L.TileLayer; karte: L.TileLayer; parzellen: L.TileLayer; felder: L.LayerGroup; gebaeude: L.LayerGroup; hinweise: L.LayerGroup;
  } | null>(null);
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
  const [teilSkizze, setTeilSkizze] = useState<{ feldId: string; geometrie: Geometrie } | null>(null);
  const [neuerHinweis, setNeuerHinweis] = useState<{ feldId: string; breite: number; laenge: number } | null>(null);
  const maschinen = useMaschinen();

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
    const hinweisGruppe = L.layerGroup().addTo(map);
    ebenen.current = { luftbild, karte, parzellen: parz, felder: felderGruppe, gebaeude: gebaeudeGruppe, hinweise: hinweisGruppe };

    map.pm.setLang('de');
    map.pm.setGlobalOptions({ snappable: true, snapDistance: 18, allowSelfIntersection: false });

    map.on('pm:create', (e) => {
      const layer = (e as unknown as { layer: L.Polygon }).layer;
      const geometrie = layer.toGeoJSON().geometry as Geometrie;
      map.removeLayer(layer);
      const m = modusRef.current;
      if (m.art === 'teilen') setTeilSkizze({ feldId: m.feldId, geometrie });
      else setZeichnung({ geometrie, flaeche: flaecheM2(geometrie), feldId: m.art === 'zeichnen' ? m.feldId : undefined });
      modusRef.current = { art: 'ansehen' };
      setModusState({ art: 'ansehen' });
    });
    map.on('click', (e: L.LeafletMouseEvent) => {
      const m = modusRef.current;
      if (m.art === 'gebaeude') {
        setNeuerOrt({ breite: e.latlng.lat, laenge: e.latlng.lng, typ: m.typ });
        modusRef.current = { art: 'ansehen' };
        setModusState({ art: 'ansehen' });
      } else if (m.art === 'hinweis') {
        setNeuerHinweis({ feldId: m.feldId, breite: e.latlng.lat, laenge: e.latlng.lng });
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
      const imZusammen = modus.art === 'zusammen' && (modus.feldId === f.id || modus.wahl.includes(f.id));
      const istGewaehlt = (gewaehlt?.art === 'feld' && gewaehlt.id === f.id) || imZusammen;
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
        const m = modusRef.current;
        if (m.art === 'ansehen') setGewaehlt({ art: 'feld', id: f.id });
        else if (m.art === 'zusammen' && f.id !== m.feldId)
          setModus({ ...m, wahl: m.wahl.includes(f.id) ? m.wahl.filter((x) => x !== f.id) : [...m.wahl, f.id] });
        else if (m.art === 'hinweis' && f.id === m.feldId) {
          setNeuerHinweis({ feldId: f.id, breite: (ev as L.LeafletMouseEvent).latlng.lat, laenge: (ev as L.LeafletMouseEvent).latlng.lng });
          setModus({ art: 'ansehen' });
        }
      });
      polygon.addTo(e.felder);
      feldLayer.current.set(f.id, polygon);
    }
  }, [felder.data, kulturJeFeld, gewaehlt, modus]);

  // ---------- Hinweise mit Position ----------
  useEffect(() => {
    const e = ebenen.current;
    if (!e) return;
    e.hinweise.clearLayers();
    for (const h of hinweise.data ?? []) {
      if (h.breite == null || h.laenge == null) continue;
      L.marker([h.breite, h.laenge], {
        icon: L.divIcon({ html: hinweisHtml(h.art), className: '', iconSize: [30, 30], iconAnchor: [15, 15] }),
        title: `${h.art}: ${h.text}`,
        keyboard: true,
      })
        .bindTooltip(`${h.art}: ${h.text.replace(/</g, '&lt;')}`, { direction: 'top', offset: [0, -14] })
        .addTo(e.hinweise);
    }
  }, [hinweise.data]);

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
    if (modus.art === 'zeichnen' || modus.art === 'teilen') map.pm.enableDraw('Polygon', { snappable: true });
    else map.pm.disableDraw();
    if (modus.art === 'grenze') feldLayer.current.get(modus.feldId)?.pm.enable({ allowSelfIntersection: false, snappable: true });
    return () => {
      if (modus.art === 'grenze') feldLayer.current.get(modus.feldId)?.pm.disable();
    };
  }, [modus]);

  // Aus der Feldseite: ?zeichnen=<feldId> startet das Zeichnen für dieses Feld
  useEffect(() => {
    const id = params.get('zeichnen');
    const teil = params.get('teilen');
    if ((id || teil) && darfVerwalten && mapRef.current) {
      setModus(teil ? { art: 'teilen', feldId: teil } : { art: 'zeichnen', feldId: id! });
      params.delete('zeichnen');
      params.delete('teilen');
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, darfVerwalten]);

  async function zusammenfuehren(zielId: string, andere: string[]) {
    const ziel = felder.data?.find((f) => f.id === zielId);
    const weitere = (felder.data ?? []).filter((f) => andere.includes(f.id));
    if (!ziel) return;
    const alleGrenzen = ziel.geometrie && weitere.every((f) => f.geometrie);
    const u = alleGrenzen ? felderVereinigen([ziel.geometrie!, ...weitere.map((f) => f.geometrie!)]) : null;
    const summe = [ziel, ...weitere].reduce((s, f) => s + Number(f.flaeche_m2), 0);
    if (!confirm(`${weitere.map((f) => f.name).join(', ')} in «${ziel.name}» zusammenführen? Neue Fläche ${ha(u?.m2 ?? summe)}.`)) return;
    const { error } = await supabase.rpc('felder_zusammenfuehren', {
      p_ziel: zielId, p_andere: andere, p_geometrie: u?.geometrie ?? null, p_flaeche_m2: u?.m2 ?? summe,
    });
    if (error) setFehler(fehlertext(error));
    setModus({ art: 'ansehen' });
    ['felder', 'anbau', 'hinweise'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  }

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
            {modus.art === 'teilen' &&
              `Zeichne die Fläche, die von «${felder.data?.find((f) => f.id === modus.feldId)?.name}» abgetrennt wird. Du darfst über den Feldrand hinaus zeichnen, es zählt nur der Teil im Feld.`}
            {modus.art === 'zusammen' &&
              `Tippe die Felder an, die in «${felder.data?.find((f) => f.id === modus.feldId)?.name}» aufgehen sollen (${modus.wahl.length} gewählt).`}
            {modus.art === 'hinweis' && 'Tippe auf die Stelle im Feld, an der sich der Hinweis befindet.'}
          </span>
          <div className="flex gap-2">
            {modus.art === 'grenze' && (
              <button className="knopf flex-1" onClick={() => grenzeSpeichern(modus.feldId)}>
                Grenze speichern
              </button>
            )}
            {modus.art === 'zusammen' && modus.wahl.length > 0 && (
              <button className="knopf flex-1" onClick={() => zusammenfuehren(modus.feldId, modus.wahl)}>
                Zusammenführen
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
          <div className="mt-1 flex max-h-28 flex-col gap-1 overflow-y-auto">
            <HinweisListe hinweise={(hinweise.data ?? []).filter((h) => h.feld_id === feld.id)} />
          </div>
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
            {darfVerwalten && feld.geometrie && (
              <button className="knopf-leise" onClick={() => setModus({ art: 'teilen', feldId: feld.id })}>
                Teilen
              </button>
            )}
            {darfVerwalten && (
              <button className="knopf-leise" onClick={() => setModus({ art: 'zusammen', feldId: feld.id, wahl: [] })}>
                Zusammenführen
              </button>
            )}
            {profil?.rolle !== 'lesen' && (
              <button className="knopf-leise" onClick={() => setModus({ art: 'hinweis', feldId: feld.id })}>
                Hinweis setzen
              </button>
            )}
          </div>
        </Karte>
      )}

      {/* Gewähltes Gebäude */}
      {objekt && modus.art === 'ansehen' && (
        <GebaeudeKarte
          objekt={objekt}
          maschinen={(maschinen.data ?? []).filter((m) => m.standort_id === objekt.id && m.status !== 'verkauft')}
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

      {/* Teilung bestätigen */}
      {teilSkizze && (
        <TeilungBestaetigen
          skizze={teilSkizze}
          feld={felder.data?.find((f) => f.id === teilSkizze.feldId)}
          onFertig={() => setTeilSkizze(null)}
          onFehler={setFehler}
        />
      )}

      {/* Hinweis mit Position */}
      {neuerHinweis && (
        <NeuerHinweis ort={neuerHinweis} betriebId={profil!.betrieb_id} onFertig={() => setNeuerHinweis(null)} onFehler={setFehler} />
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
  const [name, setName] = useState(ort.typ === 'Hof' ? BETRIEB_VORGABE : ort.typ);
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
  maschinen,
  onSchliessen,
  onVerschieben,
  onFehler,
}: {
  objekt: { id: string; typ: HofobjektTyp; name: string; link: string | null; version: number };
  maschinen: { id: string; name: string; kategorie: string }[];
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
        {maschinen.length > 0 && (
          <div className="flex w-full flex-col gap-1">
            <span className="text-xs font-bold text-leise">Standplatz für</span>
            {maschinen.map((m) => (
              <Link key={m.id} to={`/maschinen/${m.id}`} className="text-sm font-bold">
                {m.name} <span className="font-normal text-leise">({m.kategorie})</span>
              </Link>
            ))}
          </div>
        )}
        {ziel === '/maschinen' && (
          <Link to={`/maschinen?standort=${objekt.id}`} className="knopf no-underline">
            Maschinen hier
          </Link>
        )}
        {ziel && ziel !== '/' && ziel !== '/maschinen' && (
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

function TeilungBestaetigen({
  skizze,
  feld,
  onFertig,
  onFehler,
}: {
  skizze: { feldId: string; geometrie: Geometrie };
  feld: { id: string; name: string; nutzungsart: string; geometrie: Geometrie | null } | undefined;
  onFertig: () => void;
  onFehler: (t: string) => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(feld ? `${feld.name} Teil` : '');
  const [nutzung, setNutzung] = useState(feld?.nutzungsart === 'Ackerland' ? 'Weide' : (feld?.nutzungsart ?? 'Ackerland'));
  const ergebnis = feld?.geometrie ? feldTeilen(feld.geometrie, skizze.geometrie) : null;

  async function speichern() {
    if (!feld || !ergebnis) return;
    const { data, error } = await supabase.rpc('feld_teilen', {
      p_feld: feld.id, p_name: name.trim(), p_nutzungsart: nutzung, p_teil_m2: ergebnis.teilM2, p_rest_m2: ergebnis.restM2,
      p_teil_geometrie: ergebnis.teil, p_rest_geometrie: ergebnis.rest,
    });
    if (error) return onFehler(fehlertext(error));
    ['felder', 'anbau'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    onFertig();
    navigate(`/felder/${data as string}`);
  }

  return (
    <Karte onSchliessen={onFertig}>
      {!ergebnis ? (
        <p className="m-0 font-bold">Die gezeichnete Fläche liegt nicht im Feld oder deckt es ganz ab. Bitte nochmals versuchen.</p>
      ) : (
        <>
          <h2 className="m-0 text-xl font-extrabold">{feld!.name} teilen</h2>
          <span className="text-sm">
            Neuer Teil <strong>{ha(ergebnis.teilM2)}</strong> · bleibt <strong>{ha(ergebnis.restM2)}</strong>
          </span>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="feld-label">
              Name des Teils
              <input className="eingabe" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="feld-label">
              Nutzung
              <select className="eingabe" value={nutzung} onChange={(e) => setNutzung(e.target.value)}>
                {NUTZUNGSARTEN.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
          <button className="knopf mt-2" onClick={speichern}>
            Feld teilen
          </button>
        </>
      )}
    </Karte>
  );
}

function NeuerHinweis({
  ort,
  betriebId,
  onFertig,
  onFehler,
}: {
  ort: { feldId: string; breite: number; laenge: number };
  betriebId: string;
  onFertig: () => void;
  onFehler: (t: string) => void;
}) {
  const qc = useQueryClient();
  const [art, setArt] = useState<FeldHinweis['art']>('Gefahr');
  const [text, setText] = useState('');
  async function speichern() {
    if (!text.trim()) return onFehler('Bitte den Hinweis beschreiben.');
    const { error } = await supabase.from('feld_hinweise').insert({
      betrieb_id: betriebId, feld_id: ort.feldId, art, text: text.trim(), breite: ort.breite, laenge: ort.laenge,
    });
    if (error) return onFehler(fehlertext(error));
    qc.invalidateQueries({ queryKey: ['hinweise'] });
    onFertig();
  }
  return (
    <Karte onSchliessen={onFertig}>
      <h2 className="m-0 text-xl font-extrabold">Hinweis an dieser Stelle</h2>
      <div className="mt-2 grid grid-cols-[110px_1fr] gap-2">
        <select className="eingabe px-2" value={art} onChange={(e) => setArt(e.target.value as FeldHinweis['art'])} aria-label="Art">
          <option>Gefahr</option>
          <option>Hinweis</option>
          <option>Info</option>
        </select>
        <input className="eingabe" value={text} onChange={(e) => setText(e.target.value)} placeholder="z. B. Metallschacht" autoFocus aria-label="Hinweis" />
      </div>
      <button className="knopf mt-2" onClick={speichern}>
        Speichern
      </button>
    </Karte>
  );
}

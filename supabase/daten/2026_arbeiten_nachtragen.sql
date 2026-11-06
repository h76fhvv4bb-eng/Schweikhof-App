-- =====================================================================
-- Arbeiten 2026 nachtragen (einmalig, im Supabase SQL-Editor ausführen)
-- Felder werden über Kultur, Nutzung bzw. Namen gefunden. Alles läuft in einem Block: bei einem Fehler wird nichts geändert.
-- Mehrfaches Ausführen erzeugt keine Doppel: Gibt es auf einem Feld schon dieselbe Arbeit am selben Tag, wird es übersprungen.
-- =====================================================================

do $$
declare
  v_anteil_oeko numeric := 0.15;   -- öko-Flächen: 15 % gemäht
  v_admin   uuid;
  v_haeckis uuid;
  v_gruppen jsonb := '{}';
  v_schritt jsonb;
  v_liste   jsonb;
  v_anteil  numeric;
begin
  -- als Administrator des Betriebs handeln (Berechtigungen, «erfasst von»)
  select id into v_admin from benutzer_profile where rolle = 'administrator' and aktiv order by erstellt_am limit 1;
  if v_admin is null then raise exception 'Kein aktiver Administrator gefunden'; end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- Lohnunternehmen «Häckis» (falls noch nicht vorhanden)
  select id into v_haeckis from partner where betrieb_id = mein_betrieb() and name ilike 'häckis%' order by erstellt_am limit 1;
  if v_haeckis is null then
    insert into partner (betrieb_id, name, art) values (mein_betrieb(), 'Häckis', 'Lohnunternehmen') returning id into v_haeckis;
  end if;

  -- Feldgruppen
  v_gruppen := jsonb_build_object(
    -- Wintergerste (Saat Herbst 2026 für 2027)
    'wintergerste', (select coalesce(jsonb_agg(distinct a.feld_id), '[]') from anbau a join kulturen k on k.id = a.kultur_id join felder f on f.id = a.feld_id
                      where a.art = 'Hauptkultur' and a.jahr = 2027 and k.name ilike 'wintergerste%' and f.geloescht_am is null),
    -- Weizen 2026, danach Wintergerste oder Kunstwiese
    'stoppelsturz', (select coalesce(jsonb_agg(distinct a.feld_id), '[]') from anbau a join kulturen k on k.id = a.kultur_id join felder f on f.id = a.feld_id
                      where a.art = 'Hauptkultur' and a.jahr = 2026 and k.name ilike '%weizen%' and f.geloescht_am is null
                        and exists (select 1 from anbau b join kulturen kb on kb.id = b.kultur_id
                                     where b.feld_id = a.feld_id and b.art = 'Hauptkultur' and b.jahr = 2027
                                       and (kb.name ilike 'wintergerste%' or kb.name ilike 'kunstwiese%'))),
    -- Oberer und unterer Dreizopf (ohne öko und Rand)
    'dreizopf', (select coalesce(jsonb_agg(id), '[]') from felder where geloescht_am is null and (name ilike 'oberer dreizopf' or name ilike 'unterer dreizopf')),
    -- alle Flächen mit «öko» im Namen
    'oeko', (select coalesce(jsonb_agg(id), '[]') from felder where geloescht_am is null and status = 'bewirtschaftet' and name ilike '%öko%'),
    -- Buntbrachen 2026
    'buntbrache', (select coalesce(jsonb_agg(distinct a.feld_id), '[]') from anbau a join kulturen k on k.id = a.kultur_id join felder f on f.id = a.feld_id
                    where a.art = 'Hauptkultur' and a.jahr = 2026 and k.name ilike 'buntbrache%' and f.geloescht_am is null),
    -- Dauergrünland, Weiden und Kunstwiesen, die am 6. März bestanden (ohne Brachen)
    'wiesenegge', (select coalesce(jsonb_agg(f.id), '[]') from felder f where f.geloescht_am is null and f.status = 'bewirtschaftet'
                    and (f.nutzungsart in ('Dauergrünland', 'Weide')
                         or exists (select 1 from anbau a join kulturen k on k.id = a.kultur_id
                                     where a.feld_id = f.id and a.art = 'Hauptkultur' and a.jahr = 2026 and k.name ilike 'kunstwiese%'
                                       and (a.saatdatum is null or a.saatdatum < '2026-03-06')))
                    and not exists (select 1 from anbau a join kulturen k on k.id = a.kultur_id where a.feld_id = f.id and a.jahr = 2026 and k.name ilike '%brache%')),
    'bienenhaus', (select coalesce(jsonb_agg(id), '[]') from felder where geloescht_am is null and name ilike 'untere bienenhausweide%')
  );

  -- Falls eine frühere Version schon lief: öko-Mähen/Pressen auf 15 % korrigieren
  update feldarbeit_felder ff set flaeche_m2 = round(f.flaeche_m2 * v_anteil_oeko, 1)
    from feldarbeiten fa, felder f
   where fa.id = ff.feldarbeit_id and f.id = ff.feld_id and f.name ilike '%öko%' and fa.geloescht_am is null
     and ((fa.datum = '2026-07-04' and fa.arbeitsart = 'Mähen') or (fa.datum = '2026-07-06' and fa.arbeitsart = 'Pressen'))
     and ff.flaeche_m2 is distinct from round(f.flaeche_m2 * v_anteil_oeko, 1);
  update feldarbeiten set bemerkungen = 'öko-Fläche, 15 % gemäht'
   where datum = '2026-07-04' and arbeitsart = 'Mähen' and bemerkungen = 'öko-Fläche, Rückzugsstreifen stehen gelassen';

  -- Arbeiten: Datum, Arbeit, Feldgruppe, Anteil der Fläche, Lohnunternehmen, Bemerkung
  for v_schritt in select * from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('d', '2026-03-06', 'a', 'Eggen',    'g', 'wiesenegge',   'b', 'Wiesenegge'),
    jsonb_build_object('d', '2026-03-06', 'a', 'Säen',     'g', 'bienenhaus',   'anteil', 0.10, 'b', 'Nachsaat Kunstwiese nach Umbau der Wiese (ca. 10 %)'),
    jsonb_build_object('d', '2026-04-11', 'a', 'Pflügen',  'g', 'buntbrache'),
    jsonb_build_object('d', '2026-04-11', 'a', 'Eggen',    'g', 'buntbrache'),
    jsonb_build_object('d', '2026-04-18', 'a', 'Eggen',    'g', 'buntbrache'),
    jsonb_build_object('d', '2026-05-23', 'a', 'Säen',     'g', 'buntbrache',   'b', 'Buntbrache'),
    jsonb_build_object('d', '2026-07-04', 'a', 'Mähen',    'g', 'oeko',         'anteil', v_anteil_oeko, 'b', 'öko-Fläche, 15 % gemäht'),
    jsonb_build_object('d', '2026-07-06', 'a', 'Pressen',  'g', 'oeko',         'anteil', v_anteil_oeko, 'p', v_haeckis),
    jsonb_build_object('d', '2026-07-25', 'a', 'Grubbern', 'g', 'stoppelsturz', 'b', 'Stoppelsturz'),
    jsonb_build_object('d', '2026-08-13', 'a', 'Eggen',    'g', 'dreizopf'),
    jsonb_build_object('d', '2026-08-13', 'a', 'Säen',     'g', 'dreizopf',     'b', 'Kunstwiese, Saatgut Helvetia'),
    jsonb_build_object('d', '2026-10-02', 'a', 'Pflügen',  'g', 'wintergerste'),
    jsonb_build_object('d', '2026-10-03', 'a', 'Eggen',    'g', 'wintergerste'),
    jsonb_build_object('d', '2026-10-04', 'a', 'Säen',     'g', 'wintergerste', 'b', 'Wintergerste Esprit, TKG 46 g')
  )) loop
    v_anteil := coalesce((v_schritt ->> 'anteil')::numeric, 1);
    select jsonb_agg(jsonb_build_object('feld_id', f.id,
             'flaeche_m2', case when v_anteil >= 1 then null else round(f.flaeche_m2 * v_anteil, 1) end) order by f.feldnummer)
      into v_liste
      from felder f
     where f.id in (select (x)::uuid from jsonb_array_elements_text(v_gruppen -> (v_schritt ->> 'g')) x)
       and not exists (select 1 from feldarbeiten fa join feldarbeit_felder ff on ff.feldarbeit_id = fa.id
                        where ff.feld_id = f.id and fa.datum = (v_schritt ->> 'd')::date and fa.arbeitsart = v_schritt ->> 'a'
                          and fa.geloescht_am is null);
    continue when v_liste is null;
    if to_regprocedure('public.feldarbeit_speichern_geraete(jsonb)') is not null then
      perform feldarbeit_speichern_geraete(jsonb_build_object('datum', v_schritt ->> 'd', 'arbeitsart', v_schritt ->> 'a', 'status', 'erledigt',
                'partner_id', v_schritt ->> 'p', 'bemerkungen', v_schritt ->> 'b', 'felder', v_liste));
    else
      perform feldarbeit_speichern(jsonb_build_object('datum', v_schritt ->> 'd', 'arbeitsart', v_schritt ->> 'a', 'status', 'erledigt',
                'partner_id', v_schritt ->> 'p', 'bemerkungen', v_schritt ->> 'b', 'felder', v_liste));
    end if;
  end loop;

  -- Sorten bei den Kulturen eintragen (falls noch leer)
  update anbau a set sorte = 'Esprit', version = a.version from kulturen k
   where k.id = a.kultur_id and a.jahr = 2027 and a.art = 'Hauptkultur' and k.name ilike 'wintergerste%'
     and a.feld_id in (select (x)::uuid from jsonb_array_elements_text(v_gruppen -> 'wintergerste') x) and coalesce(a.sorte, '') = '';
  update anbau a set sorte = 'Helvetia', version = a.version from kulturen k
   where k.id = a.kultur_id and a.jahr = 2027 and a.art = 'Hauptkultur' and k.name ilike 'kunstwiese%'
     and a.feld_id in (select (x)::uuid from jsonb_array_elements_text(v_gruppen -> 'dreizopf') x) and coalesce(a.sorte, '') = '';
end $$;

-- Übersicht: alle Arbeiten an diesen Tagen
select to_char(fa.datum, 'DD.MM.YYYY') as datum, fa.arbeitsart as arbeit, f.name as feld,
       case when abs(ff.flaeche_m2 - f.flaeche_m2) > 1 then round(ff.flaeche_m2 / 10000, 2) end as teilflaeche_ha,
       p.name as lohnunternehmen, fa.bemerkungen as bemerkung
  from feldarbeiten fa
  join feldarbeit_felder ff on ff.feldarbeit_id = fa.id
  join felder f on f.id = ff.feld_id
  left join partner p on p.id = fa.partner_id
 where fa.geloescht_am is null and fa.status = 'erledigt'
   and fa.datum in ('2026-03-06', '2026-04-11', '2026-04-18', '2026-05-23', '2026-07-04', '2026-07-06', '2026-07-25',
                    '2026-08-13', '2026-10-02', '2026-10-03', '2026-10-04')
 order by fa.datum, fa.arbeitsart, f.name;

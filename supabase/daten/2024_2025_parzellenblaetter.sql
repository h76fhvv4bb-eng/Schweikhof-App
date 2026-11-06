-- =====================================================================
-- Arbeiten, Düngung, Pflanzenschutz und Ernten 2024 und 2025 nachtragen
-- Quelle: Parzellenblätter «Schweikhof_2024.xlsx» und «Schweikhof_2025.xlsx» (inkl. Blätter Dünger und Grundfutter)
-- Einspielen: Supabase › SQL Editor › gesamten Inhalt einfügen › Run   (Migrationen bis 31 eingespielt)
--
-- • Felder werden über den Namen gefunden (Gross/klein, «öko», «-weide/-weid», Doppelbuchstaben egal), sonst über die
--   Parzellennummer. Besteht eine Parzelle in der App aus mehreren Feldern (z. B. «oberer Langenriemen» und «… plateau»), zählen alle.
--   Felder, die es in der App noch nicht gibt (v. a. Wiesen und öko-Flächen), werden mit Fläche aus der Übersicht angelegt.
-- • Anbau 2024/2025 wird nur eingetragen, wo für das Jahr noch keine Hauptkultur besteht (die Fruchtfolge bleibt).
-- • Dünger und Pflanzenschutzmittel werden als Betriebsmittel erfasst, ohne den heutigen Lagerbestand zu verändern.
-- • Ernten mit Ballen/kg über mehrere Felder werden nach Fläche aufgeteilt (Hinweis in der Bemerkung).
-- • Mehrfaches Ausführen erzeugt keine Doppel. Bei einem Fehler wird nichts geändert.
-- Am Schluss zeigt eine Tabelle, welches Excel-Feld welchem Feld in der App zugeordnet wurde.
-- =====================================================================

do $$
declare
  v_admin    uuid;
  v_betrieb  uuid;
  v_felder   jsonb := '{}';   -- Excel-Nr → Feld-IDs (eine Excel-Parzelle kann in der App aus mehreren Feldern bestehen)
  v_alle     jsonb := '[]';
  v_parz     jsonb;
  v_ids      jsonb;
  v_pass     int;
  v_bestand  jsonb;
  v_zuord    jsonb := '[]';   -- für die Übersicht
  v_art      jsonb := '{}';   -- Artikel-Schlüssel → ID
  v_partner  jsonb := '{}';   -- Partner-Schlüssel → ID
  v_neue_arten boolean := exists (select 1 from pg_constraint where conname = 'feldarbeiten_arbeitsart_check'
                                    and pg_get_constraintdef(oid) like '%Wiesenegge%');
  x jsonb; s jsonb; f text;
  v_id uuid; v_key text; v_kultur uuid;
  v_liste jsonb; v_mittel jsonb; v_arbeit text; v_bem text;
  v_teile jsonb; v_rest int; v_summe numeric; v_n int; v_kg numeric;
begin
  -- als Administrator des Betriebs handeln
  select id into v_admin from benutzer_profile where rolle = 'administrator' and aktiv order by erstellt_am limit 1;
  if v_admin is null then raise notice 'Kein aktiver Administrator gefunden – nichts nachgetragen'; return; end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_betrieb := mein_betrieb();

  -- ------------------------------------------------------------------ Felder zuordnen
  -- nr, Name (Übersicht), Fläche a, Kultur 2024, Kultur 2025, Nutzung für neue Felder, BFF
  v_parz := '[
    {"nr":"1","name":"Obere Hausweid","a":70,"k24":"Naturwiese","k25":"Naturwiese","nutzung":"Weide"},
    {"nr":"2","name":"Obere Matte","a":50,"k24":"Naturwiese","k25":"Naturwiese","nutzung":"Weide"},
    {"nr":"3","name":"Geissrein","a":40,"k24":"Naturwiese","k25":"Naturwiese","nutzung":"Weide"},
    {"nr":"4","name":"Bödeliweid","a":40,"k24":"Naturwiese","k25":"Naturwiese","nutzung":"Weide"},
    {"nr":"5","name":"Obere Dreispitzweid","a":35,"k24":"Naturwiese","k25":"Naturwiese","nutzung":"Weide"},
    {"nr":"6","name":"Dreispitzweid","a":15,"k24":"Naturwiese","k25":"Naturwiese","nutzung":"Weide"},
    {"nr":"7","name":"Bienenhausweid","a":65,"k24":"Naturwiese","k25":"Naturwiese","nutzung":"Weide"},
    {"nr":"8","name":"Untere Bienenhausweid","a":55,"k24":"Naturwiese","k25":"Naturwiese","nutzung":"Weide"},
    {"nr":"9","name":"Obere Suterweid","a":80,"k24":"Kunstwiese","k25":"Kunstwiese","nutzung":"Kunstwiese"},
    {"nr":"10","name":"Mittlere Suterweid","a":110,"k24":"Kunstwiese","k25":"Kunstwiese","nutzung":"Kunstwiese"},
    {"nr":"11","name":"Untere Suterweid","a":20,"k24":"Kunstwiese","k25":"Kunstwiese","nutzung":"Kunstwiese"},
    {"nr":"12","name":"Hüttlihoger","a":70,"k24":"Naturwiese","k25":"Naturwiese","nutzung":"Dauergrünland","bff":"Extensiv genutzte Wiese"},
    {"nr":"13","name":"Obere Kollerweid","a":80,"k24":"Buntbrache","k25":"Silomais","nutzung":"Ackerland"},
    {"nr":"14","name":"Mittlere Kollerweid","a":55,"k24":"Buntbrache","k25":"Silomais","nutzung":"Ackerland"},
    {"nr":"15","name":"Untere Kollerweid","a":35,"k24":"Triticale","k25":"Silomais","nutzung":"Ackerland"},
    {"nr":"16","name":"Rank","a":60,"k24":"Triticale","k25":"Silomais","nutzung":"Ackerland"},
    {"nr":"17","name":"Hinterer Dreizopf","a":50,"k24":"Naturwiese","k25":"Naturwiese","nutzung":"Dauergrünland","bff":"Extensiv genutzte Wiese"},
    {"nr":"18","name":"Oberer Dreizopf","a":40,"k24":"Triticale","k25":"Silomais","nutzung":"Ackerland"},
    {"nr":"19","name":"Unterer Dreizopf","a":115,"k24":"Triticale","k25":"Silomais","nutzung":"Ackerland"},
    {"nr":"20","name":"Langerriemen","a":75,"k24":"Naturwiese","k25":"Naturwiese","nutzung":"Dauergrünland","bff":"Extensiv genutzte Wiese"},
    {"nr":"21","name":"Oberer Langerriemen","a":60,"k24":"Kunstwiese","k25":"Buntbrache","nutzung":"Ackerland"},
    {"nr":"22","name":"Steinmatthoger Wald","a":128,"k24":"Naturwiese","k25":"Naturwiese","nutzung":"Dauergrünland","bff":"Extensiv genutzte Wiese"},
    {"nr":"23","name":"Steinmatthoger Schürli","a":100,"k24":"Naturwiese","k25":"Naturwiese","nutzung":"Dauergrünland","bff":"Extensiv genutzte Wiese"},
    {"nr":"24","name":"Steinmatt Ried","a":110,"k24":"Kunstwiese","k25":"Eiweisserbsen","nutzung":"Ackerland"},
    {"nr":"25","name":"Obere Steinmatt","a":80,"k24":"Kunstwiese","k25":"Buntbrache","nutzung":"Ackerland"}
  ]'::jsonb;
  -- Schlüssel: klein, ohne «öko», Umlaute vereinfacht, nur Buchstaben, Doppelbuchstaben einfach, «weide» = «weid», «langen» = «langer»
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nr', feldnummer, 'k', regexp_replace(replace(replace(regexp_replace(translate(regexp_replace(lower(name), '(ö|oe)ko\s*', '', 'g'), 'äöüéè', 'aouee'), '[^a-z]', '', 'g'), 'weide', 'weid'), 'langen', 'langer'), '(.)\1+', '\1', 'g'))), '[]') into v_bestand
    from felder where betrieb_id = v_betrieb and geloescht_am is null and status <> 'aufgegeben';
  -- Durchgang 1: gleicher Name (auch mit Zusatz, z. B. «… plateau» = Teil derselben Parzelle)
  -- Durchgang 2: gleiche Parzellennummer und ähnlicher Name
  -- Durchgang 3: Name enthalten, aber ohne zusätzliches «obere/untere/mittlere/hintere» (sonst wäre es ein anderes Feld)
  for v_pass in 1..3 loop
    for x in select * from jsonb_array_elements(v_parz) loop
      continue when v_felder ? (x ->> 'nr');
      v_key := regexp_replace(replace(replace(regexp_replace(translate(regexp_replace(lower(x ->> 'name'), '(ö|oe)ko\s*', '', 'g'), 'äöüéè', 'aouee'), '[^a-z]', '', 'g'), 'weide', 'weid'), 'langen', 'langer'), '(.)\1+', '\1', 'g');
      select coalesce(jsonb_agg(b.id), '[]') into v_ids from jsonb_to_recordset(v_bestand) as b(id uuid, nr text, k text)
       where id::text not in (select jsonb_array_elements_text(v_alle))
         and case v_pass
               when 1 then b.k = v_key or (length(v_key) >= 8 and b.k like v_key || '%' and length(b.k) - length(v_key) >= 3)
               when 2 then b.nr = x ->> 'nr' and left(b.k, 4) = left(v_key, 4)
               else length(v_key) >= 5 and length(b.k) >= 5
                    and ((b.k like '%' || v_key || '%' and replace(b.k, v_key, '') !~ '^(ober|unter|mitl|hinter|vorder)')
                      or (v_key like '%' || b.k || '%' and replace(v_key, b.k, '') !~ '^(ober|unter|mitl|hinter|vorder)'))
             end;
      if jsonb_array_length(v_ids) > 0 then
        v_felder := v_felder || jsonb_build_object(x ->> 'nr', v_ids);
        v_alle := v_alle || v_ids;
      end if;
    end loop;
  end loop;
  for x in select * from jsonb_array_elements(v_parz) loop
    if v_felder ? (x ->> 'nr') then
      v_zuord := v_zuord || (select jsonb_agg(jsonb_build_object('nr', x ->> 'nr', 'excel', x ->> 'name', 'feld', i, 'neu', false))
                               from jsonb_array_elements_text(v_felder -> (x ->> 'nr')) i);
    else
      insert into felder (betrieb_id, feldnummer, name, flaeche_m2, nutzungsart, bemerkungen)
      values (v_betrieb,
              case when exists (select 1 from felder where betrieb_id = v_betrieb and feldnummer = x ->> 'nr') then (x ->> 'nr') || 'a' else x ->> 'nr' end,
              x ->> 'name', (x ->> 'a')::numeric * 100, x ->> 'nutzung', 'Angelegt aus Parzellenblatt 2024/2025')
      returning id into v_id;
      v_felder := v_felder || jsonb_build_object(x ->> 'nr', jsonb_build_array(v_id));
      v_zuord := v_zuord || jsonb_build_object('nr', x ->> 'nr', 'excel', x ->> 'name', 'feld', v_id, 'neu', true);
    end if;
    for v_id in select (jsonb_array_elements_text(v_felder -> (x ->> 'nr')))::uuid loop
      -- öko-Wiesen: BFF-Typ setzen, falls noch leer (Migration 25)
      if x ? 'bff' then
        update felder set bff_typ = x ->> 'bff', version = version where id = v_id and bff_typ is null;
      end if;
      -- Hauptkultur 2024/2025 nur, wo noch keine erfasst ist
      foreach f in array array['2024', '2025'] loop
        select id into v_kultur from kulturen where betrieb_id is null and name = x ->> ('k' || right(f, 2));
        if v_kultur is not null and not exists (select 1 from anbau where feld_id = v_id and jahr = f::int and art = 'Hauptkultur') then
          insert into anbau (betrieb_id, feld_id, kultur_id, jahr, art, status, bemerkungen)
          values (v_betrieb, v_id, v_kultur, f::int, 'Hauptkultur', 'ist', 'Parzellenblatt ' || f);
        end if;
      end loop;
    end loop;
  end loop;

  -- ------------------------------------------------------------------ Partner
  for x in select * from jsonb_array_elements('[
    {"k":"chlaeus","name":"Chläus","art":"Abnehmer/Käufer","such":"chläus%"},
    {"k":"reto","name":"Reto","art":"Abnehmer/Käufer","such":"reto%"},
    {"k":"holliger","name":"Holliger","art":"Abnehmer/Käufer","such":"%holliger%"},
    {"k":"goeggel","name":"Göggel","art":"Abnehmer/Käufer","such":"%göggel%"},
    {"k":"flueckiger","name":"Flückiger","art":"Abnehmer/Käufer","such":"%flückiger%"},
    {"k":"schmid","name":"Schmid (Kompost)","art":"Lohnunternehmen","such":"%schmid%"},
    {"k":"bieri","name":"Hans Bieri","art":"Lohnunternehmen","such":"%bieri%"}
  ]'::jsonb) loop
    select id into v_id from partner where betrieb_id = v_betrieb and name ilike x ->> 'such' order by erstellt_am limit 1;
    if v_id is null then
      insert into partner (betrieb_id, name, art) values (v_betrieb, x ->> 'name', x ->> 'art') returning id into v_id;
    end if;
    v_partner := v_partner || jsonb_build_object(x ->> 'k', v_id);
  end loop;

  -- ------------------------------------------------------------------ Betriebsmittel (ohne Lagerbuchung)
  for x in select * from jsonb_array_elements('[
    {"k":"46n","name":"Dünger 46N (Harnstoff)","kat":"Dünger","einheit":"kg","n":0.46,"such":["%46%n%","%harnstoff%"]},
    {"k":"kompost","name":"Kompost","kat":"Dünger","einheit":"m³","n":0.49,"p":2.45,"such":["kompost%"],"ohne_lager":true,
     "bem":"Gehalte aus Parzellenblatt 2024 (29.6 m³/ha = 14.5 kg N, 72.5 kg P2O5)"},
    {"k":"alypower","name":"Alypower","kat":"Pflanzenschutzmittel","einheit":"kg","such":["alypower%"],"bem":"Zulassung W-7300-1, Herbizid"},
    {"k":"talis","name":"Talis","kat":"Pflanzenschutzmittel","einheit":"kg","such":["talis%"],"bem":"Zulassung W-7428-1, Herbizid"},
    {"k":"picobello","name":"Picobello","kat":"Pflanzenschutzmittel","einheit":"l","such":["picobello%"],"bem":"Zulassung W-6403, Herbizid (Einzelstockbehandlung)"}
  ]'::jsonb) loop
    select id into v_id from lagerartikel
     where betrieb_id = v_betrieb and aktiv and bezeichnung ilike any (select jsonb_array_elements_text(x -> 'such')) order by erstellt_am limit 1;
    if v_id is null then
      insert into lagerartikel (betrieb_id, bezeichnung, kategorie, einheit, n_je_einheit, p2o5_je_einheit, naehrstoffquelle, lagerfuehrung, bemerkungen)
      values (v_betrieb, x ->> 'name', x ->> 'kat', x ->> 'einheit', (x ->> 'n')::numeric, (x ->> 'p')::numeric,
              case when x ? 'n' then 'Deklaration' end, not coalesce((x ->> 'ohne_lager')::boolean, false), x ->> 'bem')
      returning id into v_id;
    end if;
    v_art := v_art || jsonb_build_object(x ->> 'k', v_id);
  end loop;

  -- Gründüngung 2024 (Zwischenkultur) auf 15, 16, 18, 19: gesät 31.08.2024, bis zum Umbruch im Frühling 2025.
  -- Vor den Arbeiten anlegen, damit das Säen vom 31.08. automatisch damit verknüpft wird.
  select id into v_kultur from kulturen where betrieb_id is null and name = 'Gründüngung';
  for v_id in select (jsonb_array_elements_text(v_felder -> n))::uuid from jsonb_array_elements_text('["15","16","18","19"]') n loop
    insert into anbau (betrieb_id, feld_id, kultur_id, jahr, art, status, saatdatum, erntedatum, sorte, bemerkungen)
    values (v_betrieb, v_id, v_kultur, 2024, 'Zwischenkultur', 'ist', '2024-08-31', '2025-04-15', 'UFA Humus', 'Parzellenblatt 2024; Umbruch-Datum geschätzt')
    on conflict (feld_id, jahr, art, kultur_id) do nothing;
  end loop;

  -- ------------------------------------------------------------------ Feldarbeiten
  -- d Datum, a Arbeit, f Excel-Felder, t Anteil der Fläche, b Bemerkung, g Gerät, p Partner, m Mittel [[Artikel, Menge je ha]]
  for s in select * from jsonb_array_elements('[
    {"d":"2024-03-02","a":"Mulchen","f":["2","3","4","5"],"g":"Schlegelmulcher","b":"Teilfläche gemulcht (Dornen/Brombeeren) – Person SL"},
    {"d":"2024-03-26","a":"Pflanzenschutz","f":["1","2","3","13","14"],"b":"Einzelstockbehandlung Picobello (W-6403) gegen Disteln – Person HL; Menge nicht erfasst"},
    {"d":"2024-03-26","a":"Wiesenegge","f":["12","17","20","21","22","23"],"g":"Wiesenegge","b":"Person SL"},
    {"d":"2024-03-30","a":"Düngen","f":["9","10","11","15","16","18","19"],"g":"Streuer","b":"Person SL","m":[["46n",62]]},
    {"d":"2024-03-30","a":"Walzen","f":["15","16","18","19"],"g":"Glattwalze","b":"Bestockung – Person SL/HPL"},
    {"d":"2024-04-05","a":"Pflanzenschutz","f":["15","16","18","19"],"g":"Spritze","p":"bieri","b":"Herbizid Alypower (W-7300-1) und Talis (W-7428-1), je 720 g/ha laut Parzellenblatt","m":[["alypower",0.72],["talis",0.72]]},
    {"d":"2024-04-14","a":"Düngen","f":["15","16","18","19"],"g":"Streuer","b":"Person SL","m":[["46n",74]]},
    {"d":"2024-04-27","a":"Mähen","f":["9","10","11"],"b":"Silage"},
    {"d":"2024-04-27","a":"Mähen","f":["15","16","18","19","21"],"t":0.05,"b":"Nur Feldränder zur Strasse bzw. Teilfläche «Reservoir» (Anteil geschätzt), siliert"},
    {"d":"2024-05-01","a":"Pressen","f":["9","10","11"],"b":"Siloballen (Total 17 an Chläus)"},
    {"d":"2024-05-11","a":"Mulchen","f":["7","8"],"g":"Schlegelmulcher","b":"Teilfläche gemulcht (Dornen/Brombeeren/Brennnesseln) – Person SL"},
    {"d":"2024-05-11","a":"Pflanzenschutz","f":["7","8"],"b":"Einzelstockbehandlung Picobello (W-6403) gegen Blacken/Disteln/Brombeeren – Person HL; Menge nicht erfasst"},
    {"d":"2024-05-13","a":"Düngen","f":["9","10","11","15","16","18","19"],"g":"Streuer","b":"Person SL","m":[["46n",62]]},
    {"d":"2024-05-28","a":"Pflanzenschutz","f":["1","2","13","14"],"b":"Einzelstockbehandlung Picobello (W-6403) gegen Disteln/Blacken – Person HL; Menge nicht erfasst"},
    {"d":"2024-06-17","a":"Mähen","f":["1","9","10","11"],"b":"Teilfläche siliert"},
    {"d":"2024-06-19","a":"Pressen","f":["1","9","10","11"],"b":"Siloballen (Total 12 an Chläus)"},
    {"d":"2024-07-07","a":"Mähen","f":["9","10","11"],"b":"Silage"},
    {"d":"2024-07-09","a":"Pressen","f":["9","10","11"],"b":"Siloballen (Total 20 an Reto)"},
    {"d":"2024-07-17","a":"Mähen","f":["12","17","20","22","23"],"t":0.85,"b":"Heuen, ca. 15 % als Rückzugsstreifen stehen gelassen – ab Feld an Holliger"},
    {"d":"2024-07-20","a":"Pressen","f":["12","17","20","22","23"],"t":0.85,"b":"Ökoheu ab Feld an Holliger (Total 7000 kg)"},
    {"d":"2024-07-24","a":"Ernten","f":["15","16","18","19"],"b":"Mähdrescher, Triticale an Göggel (Total 8100 kg)"},
    {"d":"2024-07-25","a":"Pressen","f":["15","16","18","19"],"b":"Stroh (Total 24 Ballen an Flückiger)"},
    {"d":"2024-08-08","a":"Mähen","f":["12","17","20","22","23"],"t":0.15,"b":"Restliche ca. 15 % geheut – ab Feld an Holliger"},
    {"d":"2024-08-08","a":"Mähen","f":["21"],"b":"Heu ab Feld an Holliger"},
    {"d":"2024-08-10","a":"Pressen","f":["12","17","20","22","23"],"t":0.15,"b":"Ökoheu ab Feld an Holliger (Total 1500 kg mit Feld 21)"},
    {"d":"2024-08-10","a":"Pressen","f":["21"],"b":"Heu ab Feld an Holliger (im Total 1500 kg enthalten)"},
    {"d":"2024-08-12","a":"Mähen","f":["9","10","11"],"b":"Gras ab Feld an Flückiger (12.–16.08.)"},
    {"d":"2024-08-28","a":"Düngen","f":["15","16","18","19"],"g":"Miststreuer","p":"schmid","b":"Kompost, Total 74 m³","m":[["kompost",29.6]]},
    {"d":"2024-08-30","a":"Grubbern","f":["15","16","18","19"],"b":"Flachgrubber (5 cm), Stoppelbearbeitung"},
    {"d":"2024-08-31","a":"Säen","f":["15","16","18","19"],"b":"Gründüngung UFA Humus, 30 kg/ha"},
    {"d":"2024-11-09","a":"Pflügen","f":["21"],"b":"Pflug"},
    {"d":"2025-03-04","a":"Pflügen","f":["13","14","24","25"],"b":"Pflug"},
    {"d":"2025-03-06","a":"Wiesenegge","f":["7","8","9","10","11","12"],"b":"Person SL"},
    {"d":"2025-03-10","a":"Wiesenegge","f":["1","2","3","4","5","6","17","20","22","23"],"b":"Person SL"},
    {"d":"2025-03-29","a":"Düngen","f":["9","10","11"],"g":"Pendelstreuer","b":"Person SL; laut Parzellenblatt «47N» 95.24 kg/ha = 44.76 kg N/ha (Düngerliste: 46N, 200 kg am 30.03.)","m":[["46n",95.24]]}
  ]'::jsonb) loop
    v_arbeit := s ->> 'a';
    v_bem := s ->> 'b';
    if v_arbeit = 'Wiesenegge' and not v_neue_arten then
      v_arbeit := 'Eggen';
      v_bem := concat_ws(' – ', 'Wiesenegge', v_bem);
    end if;
    -- Felder, die an diesem Tag diese Arbeit noch nicht haben
    select jsonb_agg(jsonb_build_object('feld_id', fe.id,
             'flaeche_m2', case when s ? 't' then round(fe.flaeche_m2 * (s ->> 't')::numeric, 1) end) order by fe.feldnummer)
      into v_liste
      from felder fe
     where fe.id in (select (jsonb_array_elements_text(v_felder -> n))::uuid from jsonb_array_elements_text(s -> 'f') n)
       and not exists (select 1 from feldarbeiten fa join feldarbeit_felder ff on ff.feldarbeit_id = fa.id
                        where ff.feld_id = fe.id and fa.datum = (s ->> 'd')::date and fa.arbeitsart in (v_arbeit, s ->> 'a')
                          and fa.geloescht_am is null);
    continue when v_liste is null;
    select coalesce(jsonb_agg(jsonb_build_object('artikel_id', v_art ->> (m ->> 0), 'menge_je_ha', (m ->> 1)::numeric, 'vom_lager', false)), '[]')
      into v_mittel from jsonb_array_elements(coalesce(s -> 'm', '[]')) m;
    perform feldarbeit_speichern_geraete(jsonb_build_object(
      'datum', s ->> 'd', 'arbeitsart', v_arbeit, 'status', 'erledigt', 'geraet', s ->> 'g',
      'partner_id', v_partner ->> (s ->> 'p'), 'bemerkungen', v_bem, 'felder', v_liste, 'mittel', v_mittel));
  end loop;

  -- Eiweisserbsen 2025 (Steinmatt Ried): Sorte
  update anbau a set sorte = 'UFA Orchestra', version = a.version from kulturen k
   where k.id = a.kultur_id and a.feld_id in (select (jsonb_array_elements_text(v_felder -> '24'))::uuid) and a.jahr = 2025 and a.art = 'Hauptkultur'
     and k.name ilike '%erbsen%' and coalesce(a.sorte, '') = '';

  -- ------------------------------------------------------------------ Ernten (Blatt «Grundfutter», nach Fläche aufgeteilt)
  -- d Datum, f Felder, t Anteil der Fläche, produkt, ballen oder kg, ballenart, an (Partner), b Bemerkung
  for s in select * from jsonb_array_elements('[
    {"d":"2024-05-01","f":["9","10","11"],"produkt":"Grassilage","ballen":17,"ballenart":"Siloballen","an":"chlaeus","b":"1. Schnitt, Total 17 Siloballen an Chläus"},
    {"d":"2024-06-19","f":["1","9","10","11"],"produkt":"Grassilage","ballen":12,"ballenart":"Siloballen","an":"chlaeus","b":"Teilfläche, Total 12 Siloballen an Chläus"},
    {"d":"2024-07-09","f":["9","10","11"],"produkt":"Grassilage","ballen":20,"ballenart":"Siloballen","an":"reto","b":"Total 20 Siloballen an Reto"},
    {"d":"2024-07-20","f":["12","17","20","22","23"],"t":0.85,"produkt":"Heu","kg":7000,"an":"holliger","b":"Ökoheu ab Feld, Total 7000 kg an Holliger"},
    {"d":"2024-07-24","f":["15","16","18","19"],"produkt":"Getreide","kg":8100,"an":"goeggel","b":"Triticale, Total 8100 kg an Göggel"},
    {"d":"2024-07-25","f":["15","16","18","19"],"produkt":"Stroh","ballen":24,"an":"flueckiger","b":"Total 24 Strohballen an Flückiger"},
    {"d":"2024-08-10","f":["12","17","20","22","23","21"],"t":0.15,"t21":1,"produkt":"Heu","kg":1500,"an":"holliger","b":"Ökoheu/Heu ab Feld, Total 1500 kg an Holliger"}
  ]'::jsonb) loop
    -- Anteile je Feld (Fläche × Anteil)
    select jsonb_agg(jsonb_build_object('id', fe.id, 'm2', fe.flaeche_m2 * case when n = '21' and s ? 't21' then 1 else coalesce((s ->> 't')::numeric, 1) end)
                     order by fe.flaeche_m2 desc)
      into v_teile
      from jsonb_array_elements_text(s -> 'f') n
      join lateral jsonb_array_elements_text(v_felder -> n) i on true
      join felder fe on fe.id = i::uuid;
    select sum((t ->> 'm2')::numeric) into v_summe from jsonb_array_elements(v_teile) t;
    v_rest := coalesce((s ->> 'ballen')::int, 0) - (select coalesce(sum(floor((s ->> 'ballen')::numeric * (t ->> 'm2')::numeric / v_summe)), 0)
                                                       from jsonb_array_elements(v_teile) t);
    v_n := 0;
    for x in select * from jsonb_array_elements(v_teile) loop
      v_n := v_n + 1;
      continue when exists (select 1 from ernten e join ernte_produkte p on p.ernte_id = e.id
                             where e.feld_id = (x ->> 'id')::uuid and e.datum = (s ->> 'd')::date and p.produkt = s ->> 'produkt');
      if s ? 'ballen' then
        v_kg := floor((s ->> 'ballen')::numeric * (x ->> 'm2')::numeric / v_summe) + case when v_n <= v_rest then 1 else 0 end;
        continue when v_kg = 0;
        perform ernte_speichern(jsonb_build_object(
          'feld_id', x ->> 'id', 'datum', s ->> 'd', 'flaeche_m2', round((x ->> 'm2')::numeric, 1),
          'bemerkungen', (s ->> 'b') || ' (nach Fläche aufgeteilt; Parzellenblatt)',
          'produkte', jsonb_build_array(jsonb_build_object('produkt', s ->> 'produkt', 'ballen', v_kg::int, 'ballenart', s ->> 'ballenart')),
          'abnehmer', jsonb_build_array(jsonb_build_object('art', 'Verkauf', 'partner_id', v_partner ->> (s ->> 'an'), 'ballen', v_kg::int))));
      else
        v_kg := round((s ->> 'kg')::numeric * (x ->> 'm2')::numeric / v_summe);
        perform ernte_speichern(jsonb_build_object(
          'feld_id', x ->> 'id', 'datum', s ->> 'd', 'flaeche_m2', round((x ->> 'm2')::numeric, 1),
          'bemerkungen', (s ->> 'b') || ' (nach Fläche aufgeteilt; Parzellenblatt)',
          'produkte', jsonb_build_array(jsonb_build_object('produkt', s ->> 'produkt', 'menge_kg', v_kg)),
          'abnehmer', jsonb_build_array(jsonb_build_object('art', 'Verkauf', 'partner_id', v_partner ->> (s ->> 'an'), 'menge_kg', v_kg))));
      end if;
    end loop;
  end loop;

  -- Zuordnung für die Übersicht merken (nur in dieser Sitzung sichtbar)
  perform set_config('hofmanager.zuordnung', v_zuord::text, false);
end $$;

-- Übersicht 1: Zuordnung Excel → App
select z ->> 'nr' as excel_nr, z ->> 'excel' as excel_feld, f.feldnummer as app_nr, f.name as app_feld,
       case when (z ->> 'neu')::boolean then 'NEU angelegt' else 'gefunden' end as zuordnung
  from jsonb_array_elements(coalesce(nullif(current_setting('hofmanager.zuordnung', true), ''), '[]')::jsonb) z
  left join felder f on f.id = (z ->> 'feld')::uuid
 order by (z ->> 'nr')::int;

-- Übersicht 2: nachgetragene Arbeiten und Ernten 2024/2025
select datum, eintrag, felder, ha, bemerkung from (
select fa.datum as tag, to_char(fa.datum, 'DD.MM.YYYY') as datum, fa.arbeitsart as eintrag, count(*) as felder,
       round(sum(ff.flaeche_m2) / 10000, 2) as ha, min(fa.bemerkungen) as bemerkung
  from feldarbeiten fa join feldarbeit_felder ff on ff.feldarbeit_id = fa.id
 where fa.geloescht_am is null and fa.datum between '2024-01-01' and '2025-12-31'
 group by fa.id, fa.datum, fa.arbeitsart
union all
select e.datum, to_char(e.datum, 'DD.MM.YYYY'), 'Ernte ' || min(p.produkt), count(distinct e.id), round(sum(e.flaeche_m2) / 10000, 2),
       coalesce(sum(p.ballen)::text || ' Ballen', round(sum(p.menge_kg))::text || ' kg')
  from ernten e join ernte_produkte p on p.ernte_id = e.id
 where e.datum between '2024-01-01' and '2025-12-31'
 group by e.datum, p.produkt
) x
 order by tag, eintrag;

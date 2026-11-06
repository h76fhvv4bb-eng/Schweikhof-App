-- Tests für Migration 30 (Weide-Reihenfolge ohne Datum). Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id) values ('82828282-0000-0000-0000-000000000001') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', '82828282-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef') is not null as betrieb;
insert into felder (betrieb_id, feldnummer, name, flaeche_m2) values (mein_betrieb(), '1', 'A', 10000), (mein_betrieb(), '2', 'B', 8000), (mein_betrieb(), '3', 'C', 6000);
insert into partner (betrieb_id, name, art) values (mein_betrieb(), 'Schäfer', 'Tierhalter');
create temp table ids (id uuid);
grant all on ids to authenticated;

-- Plan: A ab Beginn, danach C, dann B – ohne Daten
insert into ids select public.beweidung_speichern(jsonb_build_object('partner_id', (select id from partner), 'tierart', 'Schafe', 'anzahl', 40,
  'von', '2026-11-01', 'felder', jsonb_build_array(
    jsonb_build_object('feld_id', (select id from felder where name = 'A')),
    jsonb_build_object('feld_id', (select id from felder where name = 'C')),
    jsonb_build_object('feld_id', (select id from felder where name = 'B')))));
select string_agg(f.name || ':' || coalesce(to_char(bf.von, 'DD.MM'), 'offen'), ' ' order by bf.position) = 'A:01.11 C:offen B:offen' as ok,
       'Reihenfolge ohne Datum gespeichert' as test
  from beweidung_felder bf join felder f on f.id = bf.feld_id;

-- Weiterziehen auf C: das geplante C bekommt sein Datum, A endet am Vortag
select public.beweidung_umtreiben((select id from ids), jsonb_build_object('datum', '2026-11-10', 'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where name = 'C')))));
select string_agg(f.name || ':' || coalesce(to_char(bf.von, 'DD.MM'), 'offen') || '-' || coalesce(to_char(bf.bis, 'DD.MM'), 'offen'), ' ' order by bf.position)
         = 'A:01.11-09.11 C:10.11-offen B:offen-offen' as ok, 'Geplantes Feld übernommen' as test
  from beweidung_felder bf join felder f on f.id = bf.feld_id;
select count(*) = 3 as ok, 'Kein doppeltes Feld' as test from beweidung_felder;

-- Ungeplantes Feld dazwischen: wird vor den geplanten eingereiht
select public.beweidung_umtreiben((select id from ids), jsonb_build_object('datum', '2026-11-15', 'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where name = 'A')))));
select string_agg(f.name || ':' || coalesce(to_char(bf.von, 'DD.MM'), 'offen'), ' ' order by bf.position) = 'A:01.11 C:10.11 A:15.11 B:offen' as ok,
       'Neues Feld vor den geplanten' as test
  from beweidung_felder bf join felder f on f.id = bf.feld_id;

-- Abgeholt: geplantes B fällt weg
select public.beweidung_beenden((select id from ids), '2026-11-20');
select count(*) = 3 and count(*) filter (where von is null) = 0 and max(bis) = '2026-11-20' as ok, 'Abgeholt: Plan ohne Datum entfernt' as test from beweidung_felder;

\set ON_ERROR_STOP 0
select public.beweidung_speichern(jsonb_build_object('partner_id', (select id from partner), 'tierart', 'Schafe', 'anzahl', 5,
  'von', '2026-11-01', 'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where name = 'A')),
    jsonb_build_object('feld_id', (select id from felder where name = 'B'), 'bis', '2026-11-05'))));
\set ON_ERROR_STOP 1
select count(*) = 1 as ok, 'Ende ohne Beginn abgelehnt' as test from beweidungen;

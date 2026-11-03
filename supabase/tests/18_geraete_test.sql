-- Tests für Migration 21 (mehrere Geräte pro Arbeit). Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id) values ('efefefef-0000-0000-0000-000000000001') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', 'efefefef-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef') is not null as betrieb;
insert into felder (betrieb_id, feldnummer, name, flaeche_m2) values (mein_betrieb(), '1', 'A', 10000);
insert into maschinen (betrieb_id, kategorie, name) values (mein_betrieb(), 'Traktor', 'Fendt'), (mein_betrieb(), 'Kreiselegge', 'Egge'),
  (mein_betrieb(), 'Sämaschine', 'Drille'), (mein_betrieb(), 'Mähwerk', 'Front');
create temp table ids (name text, id uuid);

insert into ids select 'fa', public.feldarbeit_speichern_geraete(jsonb_build_object('datum', current_date + 1, 'arbeitsart', 'Säen', 'status', 'geplant',
  'maschine_id', (select id from maschinen where name = 'Fendt'),
  'geraete', jsonb_build_array((select id from maschinen where name = 'Egge'), (select id from maschinen where name = 'Drille')),
  'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder)))));
select string_agg(m.name, ',' order by g.position) = 'Egge,Drille' and (select geraet_id from feldarbeiten) = (select id from maschinen where name = 'Egge') as ok,
       'Zwei Geräte, erstes als geraet_id' as test
  from feldarbeit_geraete g join maschinen m on m.id = g.maschine_id;

-- ändern: Reihenfolge und Auswahl
select public.feldarbeit_speichern_geraete(jsonb_build_object('id', (select id from ids), 'version', (select version from feldarbeiten), 'datum', current_date + 1,
  'arbeitsart', 'Säen', 'status', 'geplant', 'maschine_id', (select id from maschinen where name = 'Fendt'),
  'geraete', jsonb_build_array((select id from maschinen where name = 'Drille')),
  'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder)))));
select count(*) = 1 and (select geraet_id from feldarbeiten) = (select id from maschinen where name = 'Drille') as ok, 'Geräte ersetzt' as test from feldarbeit_geraete;

-- alter Weg (nur geraet_id): Liste wird nachgeführt
select public.feldarbeit_speichern(jsonb_build_object('id', (select id from ids), 'version', (select version from feldarbeiten), 'datum', current_date + 1,
  'arbeitsart', 'Säen', 'status', 'geplant', 'geraet_id', (select id from maschinen where name = 'Front'),
  'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder)))));
select bool_and(m.name = 'Front') and count(*) = 1 as ok, 'Alter Weg führt Liste nach' as test from feldarbeit_geraete g join maschinen m on m.id = g.maschine_id;

\set ON_ERROR_STOP 0
select public.feldarbeit_speichern_geraete(jsonb_build_object('datum', current_date, 'arbeitsart', 'Säen', 'status', 'geplant',
  'geraete', jsonb_build_array(gen_random_uuid()), 'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder)))));
\set ON_ERROR_STOP 1
select count(*) = 1 as ok, 'Unbekanntes Gerät abgelehnt' as test from feldarbeiten;

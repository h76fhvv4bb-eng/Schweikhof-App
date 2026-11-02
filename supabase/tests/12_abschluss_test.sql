-- Tests für Migration 15 (Abschluss beim direkten Erfassen). Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id) values ('eeeeeeee-0000-0000-0000-000000000001') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef') is not null as betrieb;
insert into felder (betrieb_id, feldnummer, name, flaeche_m2) values (mein_betrieb(), '1', 'Acker', 20000);
insert into maschinen (betrieb_id, kategorie, name, betriebsstunden) values (mein_betrieb(), 'Traktor', 'Fendt', 500), (mein_betrieb(), 'Pflug', 'Pflug', null);
create temp table ids (name text, id uuid);
insert into ids select 'a', public.feldarbeit_speichern(jsonb_build_object('datum', current_date, 'arbeitsart', 'Pflügen', 'status', 'erledigt',
  'maschine_id', (select id from maschinen where name = 'Fendt'), 'geraet_id', (select id from maschinen where name = 'Pflug'),
  'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder)))));
select public.feldarbeit_abschluss((select id from ids), jsonb_build_object('maschine_stunden', 504.5, 'maschine_km', 1200, 'geraet_stunden', 80,
  'beobachtung', 'Schar links abgenutzt', 'beobachtung_an_maschine', (select id from maschinen where name = 'Pflug')));
select betriebsstunden = 504.5 and kilometerstand = 1200 as ok, 'Traktorzähler nachgeführt' as test from maschinen where name = 'Fendt';
select count(*) = 1 as ok, 'Beobachtung beim Pflug' as test from maschinen_eintraege where art = 'Beobachtung';
-- erneut speichern: keine doppelte Beobachtung
select public.feldarbeit_abschluss((select id from ids), jsonb_build_object('maschine_stunden', 505,
  'beobachtung', 'Schar links stark abgenutzt', 'beobachtung_an_maschine', (select id from maschinen where name = 'Pflug')));
select count(*) = 1 and max(titel) = 'Schar links stark abgenutzt' as ok, 'Beobachtung nachgeführt, nicht doppelt' as test from maschinen_eintraege;

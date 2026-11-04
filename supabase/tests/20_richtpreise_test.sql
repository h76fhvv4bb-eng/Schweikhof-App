-- Tests für Migration 23 (Richtpreise). Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id) values ('34343434-0000-0000-0000-000000000001') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', '34343434-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef') is not null as betrieb;
select public.richtpreise_importieren(jsonb_build_object('preise', jsonb_build_array(
  jsonb_build_object('bereich', 'Maschine', 'bezeichnung', 'Traktor 75–89 kW', 'einheit', 'h', 'preis_chf', 50, 'quelle', 'Agroscope', 'jahr', 2024),
  jsonb_build_object('bereich', 'Futter', 'bezeichnung', 'Heu', 'einheit', 'dt', 'preis_chf', 25)))) = 2 as ok, 'Zwei importiert' as test;
select public.richtpreise_importieren(jsonb_build_object('preise', jsonb_build_array(
  jsonb_build_object('bereich', 'Maschine', 'bezeichnung', 'Traktor 75–89 kW', 'einheit', 'h', 'preis_chf', 52, 'quelle', 'Agroscope', 'jahr', 2025))));
select count(*) = 2 and (select preis_chf from richtpreise where bereich = 'Maschine') = 52 and (select jahr from richtpreise where bereich = 'Maschine') = 2025 as ok,
       'Erneuter Import aktualisiert statt doppelt' as test from richtpreise;
insert into maschinen (betrieb_id, kategorie, name, richtpreis_id) select mein_betrieb(), 'Traktor', 'Fendt', id from richtpreise where bereich = 'Maschine';
select richtpreis_id is not null as ok, 'Maschine mit Ansatz' as test from maschinen;
delete from richtpreise where bereich = 'Maschine';
select richtpreis_id is null as ok, 'Ansatz gelöscht, Maschine bleibt' as test from maschinen;
\set ON_ERROR_STOP 0
select public.richtpreise_importieren(jsonb_build_object('preise', jsonb_build_array(jsonb_build_object('bezeichnung', 'ohne Preis', 'einheit', 'h'))));
\set ON_ERROR_STOP 1
select count(*) = 1 as ok, 'Unvollständige Zeile abgelehnt' as test from richtpreise;

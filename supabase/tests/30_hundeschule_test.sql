-- Tests für Migration 33 (Hundeschule). Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id) values ('85858585-0000-0000-0000-000000000001') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', '85858585-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef') is not null as betrieb;
insert into felder (betrieb_id, feldnummer, name, flaeche_m2) values (mein_betrieb(), '1', 'A', 10000), (mein_betrieb(), '2', 'B', 8000);
select hundeschule_setzen(jsonb_build_object('felder', (select jsonb_agg(jsonb_build_object('feld_id', id, 'frei', name = 'A', 'bemerkung', 'nur Wegrand')) from felder), 'hinweis', 'Bitte Kot aufnehmen'));
select (select count(*) from hundeschule_felder where frei) = 1 and (select hundeschule_hinweis from betriebe) = 'Bitte Kot aufnehmen' as ok, 'Gesetzt' as test;
-- nur Status ändern, Bemerkung bleibt
select hundeschule_setzen(jsonb_build_object('felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where name = 'B'), 'frei', true))));
select (select count(*) from hundeschule_felder where frei) = 2 and (select bemerkung from hundeschule_felder h join felder f on f.id = h.feld_id where f.name = 'B') = 'nur Wegrand' as ok, 'Status ohne Bemerkung' as test;
-- Bemerkung leeren
select hundeschule_setzen(jsonb_build_object('felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where name = 'B'), 'frei', false, 'bemerkung', ''))));
select (select bemerkung from hundeschule_felder h join felder f on f.id = h.feld_id where f.name = 'B') is null as ok, 'Bemerkung geleert' as test;

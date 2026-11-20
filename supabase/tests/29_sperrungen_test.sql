-- Tests für Migration 32 (Sperrflächen). Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id) values ('84848484-0000-0000-0000-000000000001') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', '84848484-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef') is not null as betrieb;
insert into felder (betrieb_id, feldnummer, name, flaeche_m2) values (mein_betrieb(), '1', 'A', 10000), (mein_betrieb(), '2', 'B', 8000);
select sperrung_speichern(jsonb_build_object('grund', 'Frisch gesät', 'fuer', 'Hundetraining', 'von', '2026-11-20', 'bis', '2026-12-10',
  'felder', (select jsonb_agg(id) from felder))) is not null as gespeichert;
select count(*) = 2 as ok, 'Zwei Felder gesperrt' as test from sperrung_felder;
select sperrung_speichern(jsonb_build_object('id', (select id from sperrungen), 'grund', 'Frisch gesät', 'von', '2026-11-20',
  'felder', (select jsonb_agg(id) from felder where name = 'A'))) is not null as geaendert;
select count(*) = 1 and (select bis from sperrungen) is null as ok, 'Geändert: ein Feld, bis auf Weiteres' as test from sperrung_felder;
select sperrung_beenden((select id from sperrungen), '2026-11-25');
select (select bis from sperrungen) = '2026-11-25' as ok, 'Aufgehoben' as test;
\set ON_ERROR_STOP 0
select sperrung_speichern(jsonb_build_object('grund', 'X', 'von', '2026-11-20', 'bis', '2026-11-01', 'felder', (select jsonb_agg(id) from felder)));
select sperrung_speichern(jsonb_build_object('grund', 'X', 'von', '2026-11-20', 'felder', '[]'::jsonb));
\set ON_ERROR_STOP 1
select count(*) = 1 as ok, 'Ungültige abgelehnt' as test from sperrungen;
select sperrung_beenden((select id from sperrungen));
select not exists (select 1 from sperrungen) and not exists (select 1 from sperrung_felder) as ok, 'Gelöscht' as test;

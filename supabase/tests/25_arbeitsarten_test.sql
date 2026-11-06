-- Tests für Migration 28 (Wiesenegge, Stoppelsturz). Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id) values ('81818181-0000-0000-0000-000000000001') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', '81818181-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef') is not null as betrieb;
insert into felder (betrieb_id, feldnummer, name, flaeche_m2) values (mein_betrieb(), '1', 'Wiese', 10000);
select feldarbeit_speichern(jsonb_build_object('datum', '2026-03-06', 'arbeitsart', 'Wiesenegge', 'status', 'erledigt',
  'felder', (select jsonb_agg(jsonb_build_object('feld_id', id)) from felder))) is not null as gespeichert;
select feldarbeit_speichern(jsonb_build_object('datum', '2026-07-25', 'arbeitsart', 'Stoppelsturz', 'status', 'erledigt',
  'felder', (select jsonb_agg(jsonb_build_object('feld_id', id)) from felder))) is not null as gespeichert;
select count(*) = 2 as ok, 'Neue Arbeitsarten speicherbar' as test from feldarbeiten where arbeitsart in ('Wiesenegge', 'Stoppelsturz');
\set ON_ERROR_STOP 0
select feldarbeit_speichern(jsonb_build_object('datum', '2026-07-26', 'arbeitsart', 'Gibtsnicht', 'status', 'erledigt',
  'felder', (select jsonb_agg(jsonb_build_object('feld_id', id)) from felder)));
\set ON_ERROR_STOP 1
select count(*) = 2 as ok, 'Unbekannte Arbeitsart abgelehnt' as test from feldarbeiten;

-- Tests für Migration 9 (Kartenobjekte). Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id) values ('eeeeeeee-0000-0000-0000-000000000001') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef') is not null as betrieb;
insert into kartenobjekte (betrieb_id, ebene, typ, name, geometrie, flaeche_m2) values
  (mein_betrieb(), 'flaeche', 'Garten', 'Gemüsegarten',
   '{"type":"Polygon","coordinates":[[[8.55,47.25],[8.551,47.25],[8.551,47.251],[8.55,47.25]]]}', 420);
insert into kartenobjekte (betrieb_id, ebene, typ, geometrie, baumart, sorte, pflanzjahr, hochstamm) values
  (mein_betrieb(), 'baum', 'Obstbaum', '{"type":"Point","coordinates":[8.5505,47.2505]}', 'Apfel', 'Boskoop', 2015, true);
select count(*) = 2 as ok, 'Fläche und Baum gespeichert' as test from kartenobjekte;
\set ON_ERROR_STOP 0
-- Baum mit Polygon und Punkt ausserhalb der Schweiz
insert into kartenobjekte (betrieb_id, ebene, typ, geometrie) values
  (mein_betrieb(), 'baum', 'Obstbaum', '{"type":"Polygon","coordinates":[[[8.55,47.25],[8.551,47.25],[8.55,47.251],[8.55,47.25]]]}');
insert into kartenobjekte (betrieb_id, ebene, typ, geometrie) values (mein_betrieb(), 'ort', 'Brunnen', '{"type":"Point","coordinates":[2.35,48.85]}');
\set ON_ERROR_STOP 1
select count(*) = 2 as ok, 'Ungültige Geometrien abgelehnt' as test from kartenobjekte;
update kartenobjekte set sorte = 'Gravensteiner', version = 1 where ebene = 'baum';
select version = 2 as ok, 'Version erhöht' as test from kartenobjekte where ebene = 'baum';
select count(*) = 0 as ok, 'Nicht in der Felderliste' as test from felder;

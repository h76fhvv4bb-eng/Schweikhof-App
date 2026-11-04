-- Tests für Migration 22 (Saat in die Fruchtfolge übernehmen). Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id) values ('12121212-0000-0000-0000-000000000001') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', '12121212-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef') is not null as betrieb;
insert into felder (betrieb_id, feldnummer, name, flaeche_m2) values (mein_betrieb(), '1', 'A', 10000), (mein_betrieb(), '2', 'B', 10000);
-- Feld A: Winterweizen 2026 (geerntet im Juli), Kunstwiese 2027 geplant ab September 2026 (nur Monat)
insert into anbau (betrieb_id, feld_id, kultur_id, jahr, art, status, saatdatum, erntedatum)
select mein_betrieb(), (select id from felder where name = 'A'), id, 2026, 'Hauptkultur', 'ist', '2025-10-10', '2026-07-20' from kulturen where name = 'Winterweizen' and betrieb_id is null;
insert into anbau (betrieb_id, feld_id, kultur_id, jahr, art, status, saatdatum, nur_monat)
select mein_betrieb(), (select id from felder where name = 'A'), id, 2027, 'Hauptkultur', 'geplant', '2026-09-01', true from kulturen where name = 'Kunstwiese' and betrieb_id is null;

select public.feldarbeit_speichern(jsonb_build_object('datum', '2026-09-12', 'arbeitsart', 'Säen', 'status', 'erledigt',
  'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where name = 'A')))));
select a.saatdatum = '2026-09-12' and a.status = 'ist' and not a.nur_monat as ok, 'Saat übernommen (Datum, ist)' as test
  from anbau a where a.jahr = 2027;
select ff.anbau_id = (select id from anbau where jahr = 2027) as ok, 'Arbeit der neuen Kultur zugeordnet' as test from feldarbeit_felder ff;
select erntedatum = '2026-07-20' as ok, 'Geerntete Vorkultur unverändert' as test from anbau where jahr = 2026;

-- Feld B: Kunstwiese läuft, Silomais 2027 geplant ohne Saattermin; Saat erst geplant, dann erledigt
insert into anbau (betrieb_id, feld_id, kultur_id, jahr, art, status, saatdatum)
select mein_betrieb(), (select id from felder where name = 'B'), id, 2025, 'Hauptkultur', 'ist', '2024-08-20' from kulturen where name = 'Kunstwiese' and betrieb_id is null;
insert into anbau (betrieb_id, feld_id, kultur_id, jahr, art, status)
select mein_betrieb(), (select id from felder where name = 'B'), id, 2026, 'Hauptkultur', 'geplant' from kulturen where name = 'Silomais' and betrieb_id is null;
create temp table ids (id uuid);
insert into ids select public.feldarbeit_speichern(jsonb_build_object('datum', '2026-05-05', 'arbeitsart', 'Säen', 'status', 'geplant',
  'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where name = 'B')))));
select status = 'geplant' and saatdatum is null as ok, 'Geplante Saat ändert nichts' as test
  from anbau where jahr = 2026 and feld_id = (select id from felder where name = 'B');
select public.feldarbeit_erledigen((select id from ids), jsonb_build_object('datum', '2026-05-05'));
select saatdatum = '2026-05-05' and status = 'ist' as ok, 'Beim Erledigen übernommen' as test
  from anbau where jahr = 2026 and feld_id = (select id from felder where name = 'B');
select erntedatum = '2026-05-04' as ok, 'Kunstwiese endet am Vortag (Umbruch)' as test
  from anbau where jahr = 2025 and feld_id = (select id from felder where name = 'B');

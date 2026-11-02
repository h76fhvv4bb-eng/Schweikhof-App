-- Tests für Migration 2. Erwartete Werte stehen jeweils in der Spalte "ok" (muss überall t sein).
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users values ('aaaaaaaa-0000-0000-0000-000000000001'), ('aaaaaaaa-0000-0000-0000-000000000002'), ('aaaaaaaa-0000-0000-0000-000000000003')
  on conflict do nothing;

set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('Testhof', 'Admin') is not null as betrieb;
reset role;
insert into benutzer_profile (id, betrieb_id, name, rolle)
  select 'aaaaaaaa-0000-0000-0000-000000000002', id, 'Mitarbeiter', 'mitarbeiter' from betriebe;
insert into benutzer_profile (id, betrieb_id, name, rolle)
  select 'aaaaaaaa-0000-0000-0000-000000000003', id, 'Nur lesen', 'lesen' from betriebe;
set role authenticated;

insert into felder (betrieb_id, feldnummer, name, flaeche_m2) values
  (mein_betrieb(), '1', 'Oberacker', 24000), (mein_betrieb(), '2', 'Unterfeld', 19000);
insert into lagerartikel (betrieb_id, bezeichnung, kategorie, einheit, mindestbestand, einkaufspreis, n_je_einheit)
  values (mein_betrieb(), 'Ammonsalpeter 27.5', 'Dünger', 'kg', 200, 0.65, 0.275);
insert into lagerbewegungen (betrieb_id, artikel_id, art, menge)
  select mein_betrieb(), id, 'Eingang', 1000 from lagerartikel;

-- 1) Düngung auf beiden Feldern (4.3 ha × 150 kg = 645 kg)
create temp table ids (name text, id uuid);
insert into ids select 'a1', public.feldarbeit_speichern(jsonb_build_object(
  'datum', current_date - 1, 'arbeitsart', 'Düngen', 'status', 'erledigt',
  'felder', (select jsonb_agg(jsonb_build_object('feld_id', id)) from felder),
  'mittel', jsonb_build_array(jsonb_build_object('artikel_id', (select id from lagerartikel), 'menge_je_ha', 150))));
select bestand = 355 as ok, 'Bestand nach Düngung 355 kg' as test from lagerbestand;
select count(*) = 1 as ok, 'genau eine Buchung' as test from lagerbewegungen where quelle_id = (select id from ids where name='a1');

-- 2) Nochmals buchen darf nichts verdoppeln (intern, darum als Datenbank-Besitzer)
reset role;
select public.feldarbeit_buchen((select id from ids where name='a1'));
set role authenticated;
select count(*) = 1 as ok, 'idempotent' as test from lagerbewegungen where quelle_id = (select id from ids where name='a1');

-- 3) Bearbeiten: 100 kg/ha, nur Oberacker (2.4 ha → 240 kg)
select public.feldarbeit_speichern(jsonb_build_object(
  'id', (select id from ids where name='a1'), 'version', 1,
  'datum', current_date - 1, 'arbeitsart', 'Düngen', 'status', 'erledigt',
  'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where feldnummer='1'))),
  'mittel', jsonb_build_array(jsonb_build_object('artikel_id', (select id from lagerartikel), 'menge_je_ha', 100))));
select bestand = 760 as ok, 'Bestand nach Änderung 760 kg' as test from lagerbestand;
select count(*) = 1 as ok, 'weiterhin eine Buchung' as test from lagerbewegungen where quelle_id = (select id from ids where name='a1');

-- 4) Veraltete Version wird abgelehnt
\set ON_ERROR_STOP 0
select public.feldarbeit_speichern(jsonb_build_object(
  'id', (select id from ids where name='a1'), 'version', 1,
  'datum', current_date - 1, 'arbeitsart', 'Düngen', 'status', 'erledigt',
  'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where feldnummer='1')))));
\set ON_ERROR_STOP 1

-- 5) Nährstoffe: 100 kg/ha × 0.275 = 27.5 kg N/ha, 2.4 ha → 66 kg
select n_kg_ha = 27.5 and n_kg = 66 as ok, 'Nährstoffe' as test from naehrstoffe_je_feld where status = 'erledigt';

-- 6) Auf "geplant" setzen bucht zurück
select public.feldarbeit_speichern(jsonb_build_object(
  'id', (select id from ids where name='a1'), 'datum', current_date + 5, 'arbeitsart', 'Düngen', 'status', 'geplant',
  'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where feldnummer='1'))),
  'mittel', jsonb_build_array(jsonb_build_object('artikel_id', (select id from lagerartikel), 'menge_je_ha', 100))));
select bestand = 1000 as ok, 'geplant bucht nicht' as test from lagerbestand;

-- 7) Erledigt in der Zukunft wird abgelehnt
\set ON_ERROR_STOP 0
select public.feldarbeit_speichern(jsonb_build_object(
  'datum', current_date + 3, 'arbeitsart', 'Pflügen', 'status', 'erledigt',
  'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where feldnummer='1')))));
\set ON_ERROR_STOP 1

-- 8) Löschen nimmt Buchung zurück
insert into ids select 'a2', public.feldarbeit_speichern(jsonb_build_object(
  'datum', current_date, 'arbeitsart', 'Düngen', 'status', 'erledigt',
  'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where feldnummer='2'))),
  'mittel', jsonb_build_array(jsonb_build_object('artikel_id', (select id from lagerartikel), 'menge_je_ha', 200))));
select bestand = 620 as ok, 'Bestand vor Löschen 620' as test from lagerbestand;
select public.feldarbeit_loeschen((select id from ids where name='a2'));
select bestand = 1000 as ok, 'Löschen bucht zurück' as test from lagerbestand;

-- 9) Inventur
select public.inventur_buchen((select id from lagerartikel), 990) = -10 as ok, 'Inventur-Differenz' as test;
select bestand = 990 as ok, 'Bestand nach Inventur' as test from lagerbestand;

-- 10) Mitarbeiter: darf erfassen, aber keine Lagerbuchung von Hand
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000002', false);
select public.feldarbeit_speichern(jsonb_build_object(
  'datum', current_date, 'arbeitsart', 'Eggen', 'status', 'erledigt',
  'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where feldnummer='2'))))) is not null as ok,
  'Mitarbeiter erfasst' as test;
\set ON_ERROR_STOP 0
insert into lagerbewegungen (betrieb_id, artikel_id, art, menge) select mein_betrieb(), id, 'Eingang', 5 from lagerartikel;
-- 11) Lesen-Rolle darf nichts erfassen
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000003', false);
select public.feldarbeit_speichern(jsonb_build_object(
  'datum', current_date, 'arbeitsart', 'Eggen',
  'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where feldnummer='2')))));

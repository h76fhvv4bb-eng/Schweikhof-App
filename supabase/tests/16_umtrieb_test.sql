-- Tests für Migration 19 (Umtrieb der Weidegäste). Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id) values ('abababab-0000-0000-0000-000000000001') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', 'abababab-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef') is not null as betrieb;
insert into felder (betrieb_id, feldnummer, name, flaeche_m2) values (mein_betrieb(), '1', 'A', 10000), (mein_betrieb(), '2', 'B', 8000), (mein_betrieb(), '3', 'C', 6000);
insert into partner (betrieb_id, name, art) values (mein_betrieb(), 'Schäfer', 'Tierhalter');
create temp table ids (name text, id uuid);

insert into ids select 'bw', public.beweidung_speichern(jsonb_build_object('partner_id', (select id from partner), 'tierart', 'Schafe', 'anzahl', 40,
  'von', '2026-05-01', 'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where name = 'A')))));
select count(*) = 1 and min(von) = '2026-05-01' and max(bis) is null as ok, 'Start auf Feld A' as test from beweidung_felder;

-- Weiterziehen auf B am 10.05., dann auf C am 20.05.
select public.beweidung_umtreiben((select id from ids), jsonb_build_object('datum', '2026-05-10', 'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where name = 'B')))));
select public.beweidung_umtreiben((select id from ids), jsonb_build_object('datum', '2026-05-20', 'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where name = 'C')))));
select string_agg(f.name || ':' || to_char(bf.von, 'DD.MM') || '-' || coalesce(to_char(bf.bis, 'DD.MM'), 'offen'), ' ' order by bf.von) = 'A:01.05-09.05 B:10.05-19.05 C:20.05-offen' as ok,
       'Feld A, B, C nacheinander' as test
  from beweidung_felder bf join felder f on f.id = bf.feld_id;

-- Korrektur am selben Tag: doch auf A statt C
select public.beweidung_umtreiben((select id from ids), jsonb_build_object('datum', '2026-05-20', 'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where name = 'A')))));
select count(*) = 3 and not exists (select 1 from beweidung_felder bf join felder f on f.id = bf.feld_id where f.name = 'C') as ok, 'Korrektur ersetzt den Wechsel' as test from beweidung_felder;

\set ON_ERROR_STOP 0
-- in die Vergangenheit vor einen späteren Wechsel: abgelehnt
select public.beweidung_umtreiben((select id from ids), jsonb_build_object('datum', '2026-05-05', 'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where name = 'C')))));
-- vor dem Beginn
select public.beweidung_umtreiben((select id from ids), jsonb_build_object('datum', '2026-04-01', 'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where name = 'C')))));
\set ON_ERROR_STOP 1
select count(*) = 3 as ok, 'Ungültige Wechsel abgelehnt' as test from beweidung_felder;

-- Beenden am 31.05.
select public.beweidung_beenden((select id from ids), '2026-05-31');
select b.bis = '2026-05-31' and not exists (select 1 from beweidung_felder where bis is null) and (select max(bis) from beweidung_felder) = '2026-05-31' as ok,
       'Beendet, alle Abschnitte geschlossen' as test from beweidungen b;

-- Nachtragen im Formular: Abschnitte mit eigenem Zeitraum
select public.beweidung_speichern(jsonb_build_object('id', (select id from ids), 'partner_id', (select id from partner), 'tierart', 'Schafe', 'anzahl', 40,
  'von', '2026-05-01', 'bis', '2026-05-31', 'felder', jsonb_build_array(
    jsonb_build_object('feld_id', (select id from felder where name = 'A'), 'von', '2026-05-01', 'bis', '2026-05-15'),
    jsonb_build_object('feld_id', (select id from felder where name = 'B'), 'von', '2026-05-16'))));
select count(*) = 2 and (select bis from beweidung_felder bf join felder f on f.id = bf.feld_id where f.name = 'B') = '2026-05-31' as ok,
       'Nachgetragen, offenes Ende übernimmt Ende der Weide' as test from beweidung_felder;
\set ON_ERROR_STOP 0
select public.beweidung_speichern(jsonb_build_object('id', (select id from ids), 'partner_id', (select id from partner), 'tierart', 'Schafe', 'anzahl', 40,
  'von', '2026-05-01', 'bis', '2026-05-31', 'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where name = 'A'), 'von', '2026-04-20'))));
\set ON_ERROR_STOP 1
select count(*) = 2 as ok, 'Abschnitt vor Beginn abgelehnt' as test from beweidung_felder;

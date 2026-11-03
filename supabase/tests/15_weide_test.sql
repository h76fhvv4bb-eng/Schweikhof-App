-- Tests für Migration 18 (Betrieb, Weidegäste). Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id) values ('ffffffff-0000-0000-0000-000000000001') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', 'ffffffff-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef') is not null as betrieb;
update betriebe set betriebsnummer = 'ZH-123', bewirtschafter = 'Chef', gemeinde = 'Ebertswil', version = 1;
select betriebsnummer = 'ZH-123' and gemeinde = 'Ebertswil' as ok, 'Betriebsangaben gespeichert' as test from betriebe;
insert into felder (betrieb_id, feldnummer, name, flaeche_m2, nutzungsart) values (mein_betrieb(), '1', 'Weid', 20000, 'Dauergrünland');
insert into felder (betrieb_id, feldnummer, name, flaeche_m2) values (mein_betrieb(), '2', 'Acker', 10000);
insert into partner (betrieb_id, name, art) values (mein_betrieb(), 'Nachbar Muster', 'Tierhalter');
select count(*) = 1 as ok, 'Partnerart Tierhalter' as test from partner where art = 'Tierhalter';
create temp table ids (name text, id uuid);

insert into ids select 'bw', public.beweidung_speichern(jsonb_build_object(
  'partner_id', (select id from partner), 'tierart', 'Rinder', 'anzahl', 12, 'gve', 8.4, 'von', '2026-05-01', 'bis', '2026-06-30',
  'entgelt_art', 'je Tier und Tag', 'entgelt_satz', 0.5,
  'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where name = 'Weid')),
                              jsonb_build_object('feld_id', (select id from felder where name = 'Acker'), 'flaeche_m2', 4000))));
select count(*) = 2 and sum(flaeche_m2) = 24000 as ok, 'Zwei Felder, ganze und Teilfläche' as test from beweidung_felder;

\set ON_ERROR_STOP 0
-- Ende vor Beginn
select public.beweidung_speichern(jsonb_build_object('partner_id', (select id from partner), 'tierart', 'Schafe', 'anzahl', 5,
  'von', '2026-05-01', 'bis', '2026-04-01', 'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where name = 'Weid')))));
-- Fläche grösser als Feld
select public.beweidung_speichern(jsonb_build_object('partner_id', (select id from partner), 'tierart', 'Schafe', 'anzahl', 5,
  'von', '2026-05-01', 'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where name = 'Acker'), 'flaeche_m2', 99999))));
-- ohne Feld
select public.beweidung_speichern(jsonb_build_object('partner_id', (select id from partner), 'tierart', 'Schafe', 'anzahl', 5, 'von', '2026-05-01', 'felder', '[]'::jsonb));
\set ON_ERROR_STOP 1
select count(*) = 1 as ok, 'Ungültige Einträge abgelehnt' as test from beweidungen;

-- Ändern: nur noch ein Feld
select public.beweidung_speichern(jsonb_build_object('id', (select id from ids where name = 'bw'), 'version', 1,
  'partner_id', (select id from partner), 'tierart', 'Rinder', 'anzahl', 10, 'von', '2026-05-01', 'bis', '2026-06-30',
  'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where name = 'Weid')))));
select count(*) = 1 and (select anzahl from beweidungen) = 10 and (select entgelt_satz from beweidungen) is null as ok,
       'Geändert, Felder ersetzt, ohne Weidezins' as test from beweidung_felder;

-- Mit Beleg verknüpfen
insert into ids select 'vk', public.verkauf_speichern(jsonb_build_object('art', 'Rechnung', 'datum', '2026-07-01', 'partner_id', (select id from partner),
  'positionen', jsonb_build_array(jsonb_build_object('bezeichnung', 'Weidezins', 'menge', 610, 'einheit', 'Tiertage', 'preis_je_einheit', 0.5))));
update beweidungen set verkauf_id = (select id from ids where name = 'vk');
select verkauf_id is not null as ok, 'Mit Rechnung verknüpft' as test from beweidungen;

-- Löschen
select public.beweidung_loeschen((select id from ids where name = 'bw'));
select (select count(*) from beweidungen) = 0 and (select count(*) from beweidung_felder) = 0 as ok, 'Gelöscht mit Feldern' as test;

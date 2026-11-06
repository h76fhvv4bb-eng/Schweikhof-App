-- Tests für Migration 31 (digiFLUX). Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id) values ('83838383-0000-0000-0000-000000000001') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', '83838383-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef') is not null as betrieb;

-- Import: Gülle 25 m3 und Dünger 1.2 t
select r ->> 'neu' = '2' and r ->> 'gebucht' = '0' as ok, 'Import neu, noch nichts zugeordnet' as test
  from (select digiflux_importieren('{"quelle":"Datei","lieferungen":[
    {"dfx_id":"1001","status":"SENT","lieferdatum":"2026-09-15","abgeber":"Hof Meier","produkt":"Rindergülle","produkt_id":"P-1","produkt_quelle":"DIGIFLUX","produktfamilie":"FARM_MANURE_RECYCLING","menge":25,"einheit":"m3","lieferschein_nr":"77"},
    {"dfx_id":"1002","status":"ACCEPTED","lieferdatum":"2026-10-01","abgeber":"Landi","produkt":"Ammonsalpeter","produkt_id":"969481-06","produkt_quelle":"RPC","produktfamilie":"FERTILISER","menge":1.2,"einheit":"t"}
  ]}'::jsonb) r) x;

-- Gülle: neuer Artikel in m³, gemerkt
select digiflux_uebernehmen((select id from digiflux_lieferungen where dfx_id = '1001'),
  '{"neu":{"bezeichnung":"Rindergülle (zugeführt)","kategorie":"Dünger","einheit":"m³"}}') is not null as uebernommen;
select (select sum(menge) from lagerbewegungen where quelle_typ = 'digiflux') = 25 as ok, 'Gülle 25 m³ gebucht' as test;

-- Dünger: Artikel in kg → 1.2 t = 1200 kg
insert into lagerartikel (betrieb_id, bezeichnung, kategorie, einheit) values (mein_betrieb(), 'Ammonsalpeter 27.5', 'Dünger', 'kg');
select digiflux_uebernehmen((select id from digiflux_lieferungen where dfx_id = '1002'),
  jsonb_build_object('artikel_id', (select id from lagerartikel where bezeichnung = 'Ammonsalpeter 27.5'))) is not null as uebernommen;
select (select menge from lagerbewegungen b join lagerartikel a on a.id = b.artikel_id where a.bezeichnung = 'Ammonsalpeter 27.5') = 1200 as ok, 'Umrechnung t → kg' as test;

-- Nächste Gülle-Lieferung wird über die gemerkte Zuordnung direkt gebucht; erneuter Import ändert nichts doppelt
select r ->> 'gebucht' = '1' as ok, 'Gemerkte Zuordnung bucht direkt' as test
  from (select digiflux_importieren('{"quelle":"API","lieferungen":[
    {"dfx_id":"1003","status":"SENT","lieferdatum":"2026-10-20","abgeber":"Hof Meier","produkt":"Rindergülle","produkt_id":"P-1","produkt_quelle":"DIGIFLUX","menge":18,"einheit":"m3"}]}'::jsonb) r) x;
select r ->> 'neu' = '0' and r ->> 'gebucht' = '0' as ok, 'Zweiter Import ohne Doppel' as test
  from (select digiflux_importieren('{"quelle":"API","lieferungen":[
    {"dfx_id":"1003","status":"SENT","lieferdatum":"2026-10-20","abgeber":"Hof Meier","produkt":"Rindergülle","produkt_id":"P-1","produkt_quelle":"DIGIFLUX","menge":18,"einheit":"m3"}]}'::jsonb) r) x;
select (select count(*) from lagerbewegungen where quelle_typ = 'digiflux') = 3 as ok, 'Drei Buchungen' as test;

-- Abgelehnt: Buchung wird storniert
select r ->> 'storniert' = '1' as ok, 'Abgelehnt storniert' as test
  from (select digiflux_importieren('{"quelle":"API","lieferungen":[
    {"dfx_id":"1003","status":"REJECTED","lieferdatum":"2026-10-20","menge":18,"einheit":"m3"}]}'::jsonb) r) x;
select (select sum(menge) from lagerbewegungen b join lagerartikel a on a.id = b.artikel_id where a.einheit = 'm³') = 25 as ok, 'Bestand Gülle wieder 25' as test;

-- Menge korrigiert in digiFLUX: Buchung angepasst
select digiflux_importieren('{"quelle":"API","lieferungen":[{"dfx_id":"1001","status":"ACCEPTED","lieferdatum":"2026-09-15","menge":27,"einheit":"m3"}]}'::jsonb) is not null as x;
select (select sum(menge) from lagerbewegungen b join lagerartikel a on a.id = b.artikel_id where a.einheit = 'm³') = 27 as ok, 'Mengenkorrektur übernommen' as test;

-- Zurücksetzen
select digiflux_zuruecksetzen((select id from digiflux_lieferungen where dfx_id = '1002'), true);
select not exists (select 1 from lagerbewegungen b join lagerartikel a on a.id = b.artikel_id where a.bezeichnung = 'Ammonsalpeter 27.5')
   and (select ignoriert from digiflux_lieferungen where dfx_id = '1002') as ok, 'Zurückgesetzt und ausgeblendet' as test;

-- Unpassende Einheit ohne Menge: Fehler
insert into lagerartikel (betrieb_id, bezeichnung, kategorie, einheit) values (mein_betrieb(), 'Sack', 'Dünger', 'Stk');
\set ON_ERROR_STOP 0
select digiflux_uebernehmen((select id from digiflux_lieferungen where dfx_id = '1002'), jsonb_build_object('artikel_id', (select id from lagerartikel where bezeichnung = 'Sack')));
\set ON_ERROR_STOP 1
select (select lagerbewegung_id from digiflux_lieferungen where dfx_id = '1002') is null as ok, 'Unpassende Einheit abgelehnt' as test;
select digiflux_uebernehmen((select id from digiflux_lieferungen where dfx_id = '1002'), jsonb_build_object('artikel_id', (select id from lagerartikel where bezeichnung = 'Sack'), 'menge', 48, 'merken', false)) is not null as x;
select (select menge from lagerbewegungen b join lagerartikel a on a.id = b.artikel_id where a.bezeichnung = 'Sack') = 48 as ok, 'Menge von Hand' as test;

-- Tests für Migration 14 (Verkauf, Fotos). Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id) values ('eeeeeeee-0000-0000-0000-000000000001') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef') is not null as betrieb;
insert into felder (betrieb_id, feldnummer, name, flaeche_m2) values (mein_betrieb(), '9', 'Obere Suterweid', 8000);
insert into partner (betrieb_id, name, art, adresse) values (mein_betrieb(), 'Hof Nachbar', 'Abnehmer/Käufer', 'Dorfstrasse 1, 8925 Ebertswil');
insert into lagerartikel (betrieb_id, bezeichnung, kategorie, einheit) values (mein_betrieb(), 'Heu Rundballen 2026', 'Erzeugnisse', 'Ballen');
insert into lagerbewegungen (betrieb_id, artikel_id, art, menge) select mein_betrieb(), id, 'Eingang', 20 from lagerartikel;

-- Ernte mit Verkauf an Nachbar
create temp table ids (name text, id uuid);
insert into ids select 'e', public.ernte_speichern(jsonb_build_object('feld_id', (select id from felder), 'datum', current_date,
  'produkte', jsonb_build_array(jsonb_build_object('produkt', 'Heu', 'ballen', 10)),
  'abnehmer', jsonb_build_array(jsonb_build_object('produkt_index', 0, 'art', 'Verkauf', 'partner_id', (select id from partner), 'ballen', 6))));
insert into ids select 'ab', id from ernte_abnehmer;

-- Rechnung: 6 Ballen aus der Ernte à 55.–, 4 Ballen aus dem Lager à 50.–, eine freie Position
insert into ids select 'r', public.verkauf_speichern(jsonb_build_object('art', 'Rechnung', 'datum', current_date, 'partner_id', (select id from partner),
  'positionen', jsonb_build_array(
    jsonb_build_object('bezeichnung', 'Heu Rundballen (Ernte)', 'menge', 6, 'einheit', 'Ballen', 'preis_je_einheit', 55, 'ernte_abnehmer_id', (select id from ids where name = 'ab')),
    jsonb_build_object('bezeichnung', 'Heu Rundballen', 'menge', 4, 'einheit', 'Ballen', 'preis_je_einheit', 50, 'artikel_id', (select id from lagerartikel)),
    jsonb_build_object('bezeichnung', 'Transport', 'menge', 1, 'einheit', 'Pauschal', 'preis_je_einheit', 40))));
select total_chf = 570 and nummer like to_char(current_date, 'YYYY') || '-001' and not bezahlt as ok, 'Rechnung mit Total und Nummer' as test from verkaeufe;
select bestand = 16 as ok, 'Lager um 4 Ballen reduziert' as test from lagerbestand;
select preis_chf = 330 as ok, 'Preis in Ernte-Abgabe übernommen' as test from ernte_abnehmer;

-- Ernte neu speichern: Verknüpfung zum Beleg bleibt
select public.ernte_speichern(jsonb_build_object('id', (select id from ids where name = 'e'), 'feld_id', (select id from felder), 'datum', current_date,
  'produkte', jsonb_build_array(jsonb_build_object('produkt', 'Heu', 'ballen', 11)),
  'abnehmer', jsonb_build_array(jsonb_build_object('id', (select id from ids where name = 'ab'), 'produkt_index', 0, 'art', 'Verkauf',
    'partner_id', (select id from partner), 'ballen', 6, 'preis_chf', 330))));
select ernte_abnehmer_id is not null as ok, 'Verknüpfung bleibt nach Ernte-Änderung' as test from verkauf_positionen where position = 1;

\set ON_ERROR_STOP 0
-- Dieselbe Abgabe nicht doppelt verrechnen
select public.verkauf_speichern(jsonb_build_object('art', 'Quittung', 'datum', current_date, 'kunde_name', 'Barverkauf',
  'positionen', jsonb_build_array(jsonb_build_object('bezeichnung', 'Heu', 'menge', 6, 'einheit', 'Ballen', 'preis_je_einheit', 55,
    'ernte_abnehmer_id', (select id from ids where name = 'ab')))));
\set ON_ERROR_STOP 1
select count(*) = 1 as ok, 'Keine doppelte Verrechnung' as test from verkaeufe;

select public.verkauf_bezahlt((select id from ids where name = 'r'), true);
select bezahlt as ok, 'Bezahlt auch in der Ernte' as test from ernte_abnehmer;

-- Quittung bar
select public.verkauf_speichern(jsonb_build_object('art', 'Quittung', 'datum', current_date, 'kunde_name', 'Familie Muster', 'zahlungsart', 'Bar',
  'positionen', jsonb_build_array(jsonb_build_object('bezeichnung', 'Heu Rundballen', 'menge', 2, 'einheit', 'Ballen', 'preis_je_einheit', 50,
    'artikel_id', (select id from lagerartikel)))));
select bezahlt and nummer like '%-002' as ok, 'Quittung sofort bezahlt' as test from verkaeufe where art = 'Quittung';

-- Storno bucht Lager zurück
select public.verkauf_stornieren((select id from ids where name = 'r'));
select bestand = 18 as ok, 'Storno bucht Lager zurück' as test from lagerbestand;
select count(*) = 0 as ok, 'Storno löst Verknüpfung' as test from verkauf_positionen where ernte_abnehmer_id is not null;

-- Fotos: nur im eigenen Betriebsordner
insert into maschinen (betrieb_id, kategorie, name) values (mein_betrieb(), 'Traktor', 'Fendt');
insert into fotos (betrieb_id, pfad, maschine_id) select mein_betrieb(), mein_betrieb()::text || '/a.jpg', id from maschinen;
\set ON_ERROR_STOP 0
insert into fotos (betrieb_id, pfad, maschine_id) select mein_betrieb(), 'fremd/b.jpg', id from maschinen;
\set ON_ERROR_STOP 1
select count(*) = 1 as ok, 'Foto nur im eigenen Ordner' as test from fotos;

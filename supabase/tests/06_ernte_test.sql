-- Tests für Ernte (Migrationen 7 und 10). Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id) values ('eeeeeeee-0000-0000-0000-000000000001') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef') is not null as betrieb;
insert into felder (betrieb_id, feldnummer, name, flaeche_m2) values (mein_betrieb(), '9', 'Obere Suterweid', 8000);
insert into partner (betrieb_id, name, art) values
  (mein_betrieb(), 'Hof Nachbar', 'Abnehmer/Käufer'), (mein_betrieb(), 'LU Drescher', 'Lohnunternehmen'), (mein_betrieb(), 'LU Presse', 'Lohnunternehmen');
insert into hofobjekte (betrieb_id, typ, name, breite, laenge) values (mein_betrieb(), 'Scheune', 'Scheune Ost', 47.25, 8.55);

create temp table ids (name text, id uuid);
-- Getreide (verkauft) und Stroh (verkauft + eingelagert), zwei Dienstleister
insert into ids select 'e1', public.ernte_speichern(jsonb_build_object(
  'feld_id', (select id from felder), 'datum', current_date,
  'produkte', jsonb_build_array(
    jsonb_build_object('produkt', 'Getreide', 'menge_kg', 5600),
    jsonb_build_object('produkt', 'Stroh', 'ballen', 12, 'ballenart', 'Quaderballen', 'menge_kg', 3600)),
  'dienstleister', jsonb_build_array(
    jsonb_build_object('partner_id', (select id from partner where name = 'LU Drescher'), 'leistung', 'Dreschen', 'kosten_chf', 400),
    jsonb_build_object('partner_id', (select id from partner where name = 'LU Presse'), 'leistung', 'Pressen')),
  'abnehmer', jsonb_build_array(
    jsonb_build_object('produkt_index', 0, 'partner_id', (select id from partner where name = 'Hof Nachbar'), 'art', 'Verkauf', 'menge_kg', 5600, 'preis_chf', 2800),
    jsonb_build_object('produkt_index', 1, 'partner_id', (select id from partner where name = 'Hof Nachbar'), 'art', 'Verkauf', 'ballen', 8, 'preis_chf', 400),
    jsonb_build_object('produkt_index', 1, 'art', 'Lager', 'ballen', 4, 'lagerort_id', (select id from hofobjekte)))));
select count(*) = 2 as ok, 'Zwei Produkte' as test from ernte_produkte;
select count(*) = 2 as ok, 'Zwei Dienstleister' as test from ernte_dienstleister;
select kg_je_ha = 7000 and erloes_chf = 2800 and offen_chf = 2800 as ok, 'Ertrag Getreide je ha' as test from ertraege where produkt = 'Getreide';
select ballen_je_ha = 15 and ballen_abgegeben = 8 as ok, 'Stroh Ballen' as test from ertraege where produkt = 'Stroh';
select bestand = 4 and einheit = 'Ballen' and bezeichnung like 'Stroh Quaderballen % – Scheune Ost' as ok, 'Stroh im Lager' as test from lagerbestand;
update ernte_abnehmer set bezahlt = true where art = 'Verkauf';
select sum(offen_chf) = 0 as ok, 'Bezahlt markiert' as test from ertraege;

-- Erneut speichern: keine Doppelbuchung im Lager
select public.ernte_speichern(jsonb_build_object(
  'id', (select id from ids where name = 'e1'), 'feld_id', (select id from felder), 'datum', current_date,
  'produkte', jsonb_build_array(jsonb_build_object('produkt', 'Stroh', 'ballen', 12, 'ballenart', 'Quaderballen')),
  'abnehmer', jsonb_build_array(jsonb_build_object('produkt_index', 0, 'art', 'Lager', 'ballen', 10, 'lagerort_id', (select id from hofobjekte)))));
select bestand = 10 as ok, 'Lager nach Änderung ohne Doppelbuchung' as test from lagerbestand;

\set ON_ERROR_STOP 0
select public.ernte_speichern(jsonb_build_object(
  'feld_id', (select id from felder), 'datum', current_date,
  'produkte', jsonb_build_array(jsonb_build_object('produkt', 'Emd', 'ballen', 5)),
  'abnehmer', jsonb_build_array(jsonb_build_object('produkt_index', 0, 'partner_id', (select id from partner where name = 'Hof Nachbar'), 'ballen', 6))));
select public.ernte_speichern(jsonb_build_object('feld_id', (select id from felder), 'datum', current_date + 2,
  'produkte', jsonb_build_array(jsonb_build_object('produkt', 'Emd', 'ballen', 5))));
\set ON_ERROR_STOP 1
select count(*) = 1 as ok, 'Ungültige Ernten nicht gespeichert' as test from ernten;
select public.ernte_loeschen((select id from ids where name = 'e1'));
select count(*) = 0 as ok, 'Ernte gelöscht' as test from ernte_abnehmer;
select bestand = 0 as ok, 'Lagerbuchung entfernt' as test from lagerbestand;

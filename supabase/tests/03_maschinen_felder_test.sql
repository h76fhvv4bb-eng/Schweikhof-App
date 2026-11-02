-- Tests für Migration 4. Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users values ('bbbbbbbb-0000-0000-0000-000000000001'), ('bbbbbbbb-0000-0000-0000-000000000002') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('Testhof4', 'Admin') is not null as betrieb;
reset role;
insert into benutzer_profile (id, betrieb_id, name, rolle) select 'bbbbbbbb-0000-0000-0000-000000000002', id, 'MA', 'mitarbeiter' from betriebe;
set role authenticated;

-- Felder teilen
insert into felder (betrieb_id, feldnummer, name, flaeche_m2) values (mein_betrieb(), '1', 'Grossmatt', 30000);
insert into anbau (betrieb_id, feld_id, kultur_id, jahr, status)
  select mein_betrieb(), f.id, k.id, extract(year from current_date)::int, 'ist' from felder f, kulturen k where k.name = 'Kunstwiese';
create temp table ids (name text, id uuid);
insert into ids select 'teil', public.feld_teilen((select id from felder where name='Grossmatt'), 'Grossmatt Weide', 'Weide', 8000);
select flaeche_m2 = 22000 as ok, 'Restfläche' as test from felder where name = 'Grossmatt';
select flaeche_m2 = 8000 and vorgaenger = array[(select id from felder where name='Grossmatt')] and nutzungsart = 'Weide' as ok, 'Neuer Teil' as test
  from felder where name = 'Grossmatt Weide';
select count(*) = 1 as ok, 'Kultur übernommen' as test from anbau where feld_id = (select id from ids where name='teil');
\set ON_ERROR_STOP 0
select public.feld_teilen((select id from felder where name='Grossmatt'), 'Zu gross', null, 22000);
\set ON_ERROR_STOP 1

-- Hinweis und Zusammenführen
insert into feld_hinweise (betrieb_id, feld_id, art, text)
  select mein_betrieb(), id, 'Gefahr', 'Achtung: 3 Metallschächte' from felder where name = 'Grossmatt Weide';
select public.felder_zusammenfuehren((select id from felder where name='Grossmatt'), array[(select id from ids where name='teil')]);
select flaeche_m2 = 30000 as ok, 'Zusammengeführt 3 ha' as test from felder where name = 'Grossmatt';
select status = 'zusammengeführt' as ok, 'Teil markiert' as test from felder where name = 'Grossmatt Weide';
select count(*) = 1 as ok, 'Hinweis gewandert' as test from feld_hinweise where feld_id = (select id from felder where name='Grossmatt');

-- Maschine, Wartungsplan, Eintrag mit Ersatzteil
insert into partner (betrieb_id, name, art) values (mein_betrieb(), 'Landtechnik Muster', 'Mechaniker/Werkstatt');
insert into maschinen (betrieb_id, kategorie, name, betriebsstunden) values (mein_betrieb(), 'Traktor', 'Traktor 1', 1200);
insert into wartungsplaene (betrieb_id, maschine_id, bezeichnung, intervall_stunden)
  select mein_betrieb(), id, 'Motorölwechsel', 250 from maschinen;
insert into lagerartikel (betrieb_id, bezeichnung, kategorie, einheit) values (mein_betrieb(), 'Ölfilter', 'Ersatzteile', 'Stk');
insert into lagerbewegungen (betrieb_id, artikel_id, art, menge) select mein_betrieb(), id, 'Eingang', 3 from lagerartikel where bezeichnung = 'Ölfilter';
select ueberfaellig as ok, 'Ohne Wartung überfällig (1200 h > 250 h)' as test from wartung_faelligkeit;
insert into ids select 'e1', public.maschineneintrag_speichern(jsonb_build_object(
  'maschine_id', (select id from maschinen), 'art', 'Wartung', 'datum', current_date, 'betriebsstunden', 1250,
  'titel', 'Motoröl und Filter', 'kosten', 180, 'partner_id', (select id from partner),
  'wartungsplan_id', (select id from wartungsplaene),
  'teile', jsonb_build_array(jsonb_build_object('artikel_id', (select id from lagerartikel where bezeichnung='Ölfilter'), 'menge', 1))));
select bestand = 2 as ok, 'Ersatzteil abgebucht' as test from lagerbestand where bezeichnung = 'Ölfilter';
select betriebsstunden = 1250 as ok, 'Stundenzähler nachgeführt' as test from maschinen;
select not ueberfaellig and faellig_stunden = 1500 as ok, 'Nächste Wartung bei 1500 h' as test from wartung_faelligkeit;
select public.maschineneintrag_loeschen((select id from ids where name='e1'));
select bestand = 3 as ok, 'Löschen bucht Teil zurück' as test from lagerbestand where bezeichnung = 'Ölfilter';

-- Feldarbeit mit Maschine und Lohnunternehmer
insert into partner (betrieb_id, name, art) values (mein_betrieb(), 'Lohnunternehmen Beispiel', 'Lohnunternehmen');
select public.feldarbeit_speichern(jsonb_build_object(
  'datum', current_date, 'arbeitsart', 'Mähen', 'status', 'erledigt',
  'maschine_id', (select id from maschinen), 'partner_id', (select id from partner where art = 'Lohnunternehmen'),
  'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where name='Grossmatt'))))) is not null as ok,
  'Feldarbeit mit Maschine' as test;

-- Mitarbeiter darf Hinweis melden, aber keine Maschine anlegen
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
insert into feld_hinweise (betrieb_id, feld_id, text) select mein_betrieb(), id, 'Stein am Rand' from felder where name = 'Grossmatt';
select count(*) = 2 as ok, 'Mitarbeiter meldet Hinweis' as test from feld_hinweise;
\set ON_ERROR_STOP 0
insert into maschinen (betrieb_id, kategorie, name) values (mein_betrieb(), 'Anhänger', 'Unerlaubt');

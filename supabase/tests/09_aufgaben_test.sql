-- Tests für Migration 11 (Aufgaben). Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id) values ('eeeeeeee-0000-0000-0000-000000000001') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef') is not null as betrieb;
insert into felder (betrieb_id, feldnummer, name, flaeche_m2) values (mein_betrieb(), '1', 'Acker', 20000);
insert into maschinen (betrieb_id, kategorie, name, betriebsstunden) values
  (mein_betrieb(), 'Traktor', 'Fendt', 1200), (mein_betrieb(), 'Düngerstreuer', 'Streuer', null);
insert into lagerartikel (betrieb_id, bezeichnung, kategorie, einheit) values (mein_betrieb(), 'Ammonsalpeter', 'Dünger', 'kg');
insert into lagerbewegungen (betrieb_id, artikel_id, art, menge) select mein_betrieb(), id, 'Eingang', 1000 from lagerartikel;

-- Geplante Düngung: 100 kg/ha auf 2 ha
create temp table ids (name text, id uuid);
insert into ids select 'fa', public.feldarbeit_speichern(jsonb_build_object(
  'datum', current_date + 3, 'arbeitsart', 'Düngen', 'status', 'geplant',
  'maschine_id', (select id from maschinen where name = 'Fendt'), 'geraet_id', (select id from maschinen where name = 'Streuer'),
  'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder))),
  'mittel', jsonb_build_array(jsonb_build_object('artikel_id', (select id from lagerartikel), 'menge_je_ha', 100))));
select bestand = 1000 as ok, 'Geplant bucht nicht' as test from lagerbestand;

-- Erledigen mit effektiv 180 kg, Zählerständen und Beobachtung
select public.feldarbeit_erledigen((select id from ids where name = 'fa'), jsonb_build_object(
  'datum', current_date, 'dauer_h', 1.5, 'maschine_stunden', 1203.5, 'maschine_km', 8800, 'geraet_stunden', 40,
  'mittel', jsonb_build_array(jsonb_build_object('artikel_id', (select id from lagerartikel), 'gesamtmenge', 180)),
  'beobachtung', 'Streuscheibe links schleift', 'beobachtung_an_maschine', (select id from maschinen where name = 'Streuer')));
select bestand = 820 as ok, 'Effektive Menge gebucht' as test from lagerbestand;
select menge_je_ha = 90 as ok, 'Menge je ha nachgerechnet' as test from feldarbeit_mittel;
select betriebsstunden = 1203.5 and kilometerstand = 8800 as ok, 'Traktorzähler nachgeführt' as test from maschinen where name = 'Fendt';
select count(*) = 1 as ok, 'Beobachtung an Gerät gemeldet' as test from maschinen_eintraege where art = 'Beobachtung' and offen;
\set ON_ERROR_STOP 0
select public.feldarbeit_erledigen((select id from ids where name = 'fa'), '{}');
\set ON_ERROR_STOP 1

-- Reparatur-Aufgabe zur Beobachtung
insert into aufgaben (betrieb_id, art, titel, maschine_id, eintragsart, beobachtung_id, faellig_am)
select mein_betrieb(), 'Maschine', 'Streuscheibe richten', maschine_id, 'Reparatur', id, current_date + 7 from maschinen_eintraege;
select public.aufgabe_erledigen((select id from aufgaben), jsonb_build_object('datum', current_date, 'dauer_h', 2, 'kosten', 85, 'ergebnis', 'Lager ersetzt', 'betriebsstunden', 41));
select status = 'erledigt' and eintrag_id is not null as ok, 'Aufgabe erledigt mit Eintrag' as test from aufgaben;
select count(*) = 0 as ok, 'Beobachtung geschlossen' as test from maschinen_eintraege where art = 'Beobachtung' and offen;
select betriebsstunden = 41 as ok, 'Gerätezähler aus Reparatur' as test from maschinen where name = 'Streuer';
insert into aufgaben (betrieb_id, art, titel) values (mein_betrieb(), 'Allgemein', 'Zaun flicken');
select public.aufgabe_erledigen((select id from aufgaben where art = 'Allgemein'), '{"dauer_h": 3}');
select count(*) = 2 as ok, 'Allgemeine Aufgabe erledigt' as test from aufgaben where status = 'erledigt';

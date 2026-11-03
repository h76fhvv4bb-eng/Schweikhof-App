-- Tests für Migration 17 (Verknüpfungen). Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id) values ('eeeeeeee-0000-0000-0000-000000000001') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef') is not null as betrieb;
insert into felder (betrieb_id, feldnummer, name, flaeche_m2) values (mein_betrieb(), '1', 'Acker', 20000);
insert into partner (betrieb_id, name, art) values (mein_betrieb(), 'LU', 'Lohnunternehmen');
insert into lagerartikel (betrieb_id, bezeichnung, kategorie, einheit) values (mein_betrieb(), 'Saatgut', 'Saatgut', 'kg');
insert into lagerbewegungen (betrieb_id, artikel_id, art, menge) select mein_betrieb(), id, 'Eingang', 1000 from lagerartikel;
create temp table ids (name text, id uuid);

-- Teilfläche 0.5 ha, 200 kg/ha, als Lohnauftrag
insert into ids select 'fa', public.feldarbeit_speichern(jsonb_build_object('datum', current_date + 1, 'arbeitsart', 'Säen', 'status', 'geplant',
  'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder), 'flaeche_m2', 5000)),
  'mittel', jsonb_build_array(jsonb_build_object('artikel_id', (select id from lagerartikel), 'menge_je_ha', 200))));
insert into ids select 'auf', public.auftrag_speichern(jsonb_build_object('art', 'Lohnarbeit', 'partner_id', (select id from partner), 'titel', 'Säen',
  'arbeitsart', 'Säen', 'feldarbeit_id', (select id from ids where name = 'fa'), 'felder', jsonb_build_array((select id from felder)),
  'mittel', jsonb_build_array(jsonb_build_object('artikel_id', (select id from lagerartikel), 'kategorie', 'Saatgut', 'menge_je_ha', 200, 'bereitstellung', 'Betrieb'))));
\set ON_ERROR_STOP 0
-- direkt in der Erfassung auf «erledigt» setzen: verhindert
select public.feldarbeit_speichern(jsonb_build_object('id', (select id from ids where name = 'fa'), 'datum', current_date, 'arbeitsart', 'Säen', 'status', 'erledigt',
  'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder), 'flaeche_m2', 5000))));
-- Feld löschen, solange verplant: verhindert
select public.feld_loeschen((select id from felder));
\set ON_ERROR_STOP 1
select status = 'geplant' as ok, 'Arbeit mit Auftrag nicht direkt erledigt' as test from feldarbeiten where id = (select id from ids where name = 'fa');
select geloescht_am is null as ok, 'Verplantes Feld nicht gelöscht' as test from felder;
select public.auftrag_abschliessen((select id from ids where name = 'auf'), current_date);
select bestand = 900 as ok, 'Teilfläche übernommen: 100 kg statt 400 kg' as test from lagerbestand;
select count(*) = 1 as ok, 'Keine doppelte Arbeit' as test from feldarbeiten;

-- Kultur nachträglich zuordnen
insert into anbau (betrieb_id, feld_id, kultur_id, jahr, art, status)
select mein_betrieb(), (select id from felder), id, extract(year from current_date)::int, 'Hauptkultur', 'ist' from kulturen where name = 'Winterweizen' and betrieb_id is null;
select anbau_id is not null as ok, 'Kultur nachträglich zugeordnet' as test from feldarbeit_felder;

-- Vorgängerin löschen gibt Folgearbeit frei
insert into ids select 'v1', public.feldarbeit_speichern(jsonb_build_object('datum', current_date + 2, 'arbeitsart', 'Pflügen', 'status', 'geplant',
  'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder)))));
insert into ids select 'v2', public.feldarbeit_speichern(jsonb_build_object('datum', current_date + 3, 'arbeitsart', 'Eggen', 'status', 'geplant',
  'vorgaenger_id', (select id from ids where name = 'v1'), 'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder)))));
select public.feldarbeit_loeschen((select id from ids where name = 'v1'));
select vorgaenger_id is null as ok, 'Folgearbeit freigegeben' as test from feldarbeiten where id = (select id from ids where name = 'v2');

-- Wartung über Aufgabe setzt den Wartungsplan zurück
insert into maschinen (betrieb_id, kategorie, name, betriebsstunden) values (mein_betrieb(), 'Traktor', 'Fendt', 100);
insert into wartungsplaene (betrieb_id, maschine_id, bezeichnung, intervall_tage) select mein_betrieb(), id, 'Motoröl', 365 from maschinen;
insert into aufgaben (betrieb_id, art, titel, maschine_id, eintragsart, wartungsplan_id)
select mein_betrieb(), 'Maschine', 'Motoröl', m.id, 'Wartung', w.id from maschinen m, wartungsplaene w;
select public.aufgabe_erledigen((select id from aufgaben), jsonb_build_object('datum', current_date));
select zuletzt_am = current_date as ok, 'Wartungsplan zurückgesetzt' as test from wartung_faelligkeit;

-- Tests für Migration 13 (Mitarbeitende, Folgearbeiten, Aufträge aus Aufgaben). Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id) values ('eeeeeeee-0000-0000-0000-000000000001') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef') is not null as betrieb;
select count(*) = 1 as ok, 'Konto ist automatisch Mitarbeiter' as test from mitarbeiter where benutzer_id = auth.uid();
insert into mitarbeiter (betrieb_id, name, funktion, stundenansatz_chf) values (mein_betrieb(), 'Hans Aushilfe', 'Aushilfe', 28);
insert into felder (betrieb_id, feldnummer, name, flaeche_m2) values (mein_betrieb(), '1', 'Acker', 20000);
insert into partner (betrieb_id, name, art) values (mein_betrieb(), 'LU Meier', 'Lohnunternehmen');

-- Kette: Pflügen → Kreiselegge (Lohnauftrag) → Säen
create temp table ids (name text, id uuid);
insert into ids select 'pfl', public.feldarbeit_speichern(jsonb_build_object('datum', current_date + 1, 'arbeitsart', 'Pflügen', 'status', 'geplant',
  'mitarbeiter_id', (select id from mitarbeiter where name = 'Hans Aushilfe'), 'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder)))));
insert into ids select 'egg', public.feldarbeit_speichern(jsonb_build_object('datum', current_date + 2, 'arbeitsart', 'Eggen', 'status', 'geplant',
  'vorgaenger_id', (select id from ids where name = 'pfl'), 'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder)))));
insert into ids select 'sae', public.feldarbeit_speichern(jsonb_build_object('datum', current_date + 3, 'arbeitsart', 'Säen', 'status', 'geplant',
  'vorgaenger_id', (select id from ids where name = 'egg'), 'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder)))));
insert into ids select 'auf', public.auftrag_speichern(jsonb_build_object('art', 'Lohnarbeit', 'partner_id', (select id from partner), 'titel', 'Kreiselegge',
  'arbeitsart', 'Eggen', 'feldarbeit_id', (select id from ids where name = 'egg'), 'felder', jsonb_build_array((select id from felder))));

\set ON_ERROR_STOP 0
-- Säen vor Pflügen geht nicht
select public.feldarbeit_erledigen((select id from ids where name = 'sae'), jsonb_build_object('datum', current_date));
-- Auftrag vor Pflügen abschliessen geht nicht
select public.auftrag_abschliessen((select id from ids where name = 'auf'), current_date);
-- Kreis verhindern
select public.feldarbeit_speichern(jsonb_build_object('id', (select id from ids where name = 'pfl'), 'datum', current_date + 1, 'arbeitsart', 'Pflügen',
  'status', 'geplant', 'vorgaenger_id', (select id from ids where name = 'sae'), 'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder)))));
-- Lohnarbeit nicht direkt erledigen, solange der Auftrag läuft
\set ON_ERROR_STOP 1
select public.feldarbeit_erledigen((select id from ids where name = 'pfl'), jsonb_build_object('datum', current_date, 'dauer_h', 3));
select status = 'erledigt' and mitarbeiter_id = (select id from mitarbeiter where name = 'Hans Aushilfe') as ok, 'Pflügen erledigt durch Aushilfe' as test
  from feldarbeiten where id = (select id from ids where name = 'pfl');
\set ON_ERROR_STOP 0
select public.feldarbeit_erledigen((select id from ids where name = 'egg'), jsonb_build_object('datum', current_date));
\set ON_ERROR_STOP 1
select public.auftrag_abschliessen((select id from ids where name = 'auf'), current_date);
select status = 'erledigt' and partner_id = (select id from partner) as ok, 'Auftrag erledigt die geplante Arbeit' as test
  from feldarbeiten where id = (select id from ids where name = 'egg');
select count(*) = 3 as ok, 'Keine doppelte Arbeit' as test from feldarbeiten;
select public.feldarbeit_erledigen((select id from ids where name = 'sae'), jsonb_build_object('datum', current_date, 'dauer_h', 1));
select count(*) = 3 as ok, 'Ganze Kette erledigt' as test from feldarbeiten where status = 'erledigt';
select stunden = 3 as ok, 'Stunden der Aushilfe' as test from mitarbeiter_stunden where mitarbeiter_id = (select id from mitarbeiter where name = 'Hans Aushilfe');

-- Werkstattauftrag aus Aufgabe
insert into maschinen (betrieb_id, kategorie, name) values (mein_betrieb(), 'Traktor', 'Fendt');
insert into aufgaben (betrieb_id, art, titel, maschine_id, eintragsart) select mein_betrieb(), 'Maschine', 'Kupplung', id, 'Reparatur' from maschinen;
insert into ids select 'werk', public.auftrag_speichern(jsonb_build_object('art', 'Werkstatt', 'partner_id', (select id from partner), 'titel', 'Kupplung',
  'maschine_id', (select id from maschinen), 'aufgabe_id', (select id from aufgaben)));
\set ON_ERROR_STOP 0
select public.aufgabe_erledigen((select id from aufgaben), '{}');
\set ON_ERROR_STOP 1
select public.auftrag_abschliessen((select id from ids where name = 'werk'), current_date, 450);
select status = 'erledigt' and eintrag_id is not null as ok, 'Aufgabe mit Werkstattauftrag erledigt' as test from aufgaben;

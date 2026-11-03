-- Tests für Migration 20 (mehrere Rollen je Partner). Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id) values ('cdcdcdcd-0000-0000-0000-000000000001') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', 'cdcdcdcd-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef') is not null as betrieb;

-- alte Art: nur «art»
insert into partner (betrieb_id, name, art) values (mein_betrieb(), 'Alt', 'Lohnunternehmen');
select rollen = array['Lohnunternehmen'] as ok, 'Rolle aus art übernommen' as test from partner where name = 'Alt';

-- neue Art: mehrere Rollen, art folgt der ersten
insert into partner (betrieb_id, name, art, rollen) values (mein_betrieb(), 'Muster', 'Andere', array['Tierhalter', 'Abnehmer/Käufer', 'Tierhalter']);
select art = 'Tierhalter' and rollen = array['Tierhalter', 'Abnehmer/Käufer'] as ok, 'Mehrere Rollen, doppelte entfernt' as test from partner where name = 'Muster';

update partner set rollen = array['Abnehmer/Käufer', 'Lohnunternehmen'], version = version where name = 'Muster';
select art = 'Abnehmer/Käufer' as ok, 'Hauptrolle nachgeführt' as test from partner where name = 'Muster';

update partner set art = 'Berater', version = version where name = 'Alt';
select rollen = array['Berater', 'Lohnunternehmen'] as ok, 'Nur art geändert: Rolle ergänzt' as test from partner where name = 'Alt';

\set ON_ERROR_STOP 0
update partner set rollen = array['Gibtsnicht'] where name = 'Alt';
\set ON_ERROR_STOP 1
select rollen = array['Berater', 'Lohnunternehmen'] as ok, 'Unbekannte Rolle abgelehnt' as test from partner where name = 'Alt';

-- Weide mit einem Partner, der Tierhalter nur als zweite Rolle hat
insert into felder (betrieb_id, feldnummer, name, flaeche_m2) values (mein_betrieb(), '1', 'A', 10000);
update partner set rollen = array['Abnehmer/Käufer', 'Tierhalter'] where name = 'Muster';
select public.beweidung_speichern(jsonb_build_object('partner_id', (select id from partner where name = 'Muster'), 'tierart', 'Schafe', 'anzahl', 5,
  'von', '2026-05-01', 'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder))))) is not null as ok, 'Weide mit Zweitrolle' as test;

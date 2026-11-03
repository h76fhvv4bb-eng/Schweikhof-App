-- Tests für Migration 16. Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id) values ('eeeeeeee-0000-0000-0000-000000000001') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef') is not null as betrieb;
insert into felder (betrieb_id, feldnummer, name, flaeche_m2) values (mein_betrieb(), '1', 'Wiese', 10000);
select public.feldarbeit_speichern(jsonb_build_object('datum', current_date, 'arbeitsart', 'Wenden', 'status', 'erledigt',
  'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder))))) is not null as ok, 'Arbeitsart Wenden' as test;
insert into maschinen (betrieb_id, kategorie, name) values (mein_betrieb(), 'Mähwerk', 'Mähwerk');
insert into lagerartikel (betrieb_id, bezeichnung, kategorie, einheit, warengruppe) values (mein_betrieb(), 'Mähmesser', 'Ersatzteile', 'Stk', 'Messer');
insert into maschine_teile (betrieb_id, maschine_id, artikel_id, art, einbauort, vorrat)
select mein_betrieb(), m.id, a.id, 'Verschleissteil', 'Scheibe 1-6', 12 from maschinen m, lagerartikel a;
select count(*) = 1 as ok, 'Verschleissteil zugeordnet' as test from maschine_teile;
\set ON_ERROR_STOP 0
insert into maschine_teile (betrieb_id, maschine_id, artikel_id) select mein_betrieb(), m.id, a.id from maschinen m, lagerartikel a;
\set ON_ERROR_STOP 1
select count(*) = 1 as ok, 'Teil nur einmal je Maschine' as test from maschine_teile;

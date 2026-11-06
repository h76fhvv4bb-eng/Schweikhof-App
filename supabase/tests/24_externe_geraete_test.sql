-- Tests für Migration 27 (externe Geräte, Mietkosten). Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id) values ('80808080-0000-0000-0000-000000000001') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', '80808080-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef') is not null as betrieb;
insert into partner (betrieb_id, name, art, rollen) values (mein_betrieb(), 'Muster AG', 'Maschinenvermieter', array['Maschinenvermieter', 'Lohnunternehmen']);
select art = 'Maschinenvermieter' as ok, 'Rolle Maschinenvermieter' as test from partner;
insert into felder (betrieb_id, feldnummer, name, flaeche_m2) values (mein_betrieb(), '1', 'Acker A', 20000), (mein_betrieb(), '2', 'Acker B', 10000);
insert into maschinen (betrieb_id, name, kategorie) values (mein_betrieb(), 'Traktor', 'Traktor');
insert into maschinen (betrieb_id, name, kategorie, eigentum, partner_id, miet_abrechnung, mietpreis)
  select mein_betrieb(), 'Sämaschine Muster', 'Sämaschine', 'gemietet', id, 'Hektare', 40 from partner;
insert into maschinen (betrieb_id, name, kategorie, eigentum, partner_id, miet_abrechnung, mietpreis)
  select mein_betrieb(), 'Walze Muster', 'Walze', 'gemietet', id, 'Tag', 60 from partner;
select eigentum = 'eigen' as ok, 'Standard: eigene Maschine' as test from maschinen where name = 'Traktor';

-- Säen auf beiden Feldern mit Traktor + gemieteter Sämaschine (über feldarbeit_geraete)
select feldarbeit_speichern_geraete(jsonb_build_object('datum', '2026-10-04', 'arbeitsart', 'Säen', 'status', 'erledigt', 'dauer_h', 3,
  'maschine_id', (select id from maschinen where name = 'Traktor'),
  'geraete', jsonb_build_array((select id from maschinen where name = 'Sämaschine Muster')),
  'felder', (select jsonb_agg(jsonb_build_object('feld_id', id)) from felder))) is not null as gespeichert;
-- Walze zweimal am selben Tag (Tagespreis wird verteilt)
select feldarbeit_speichern_geraete(jsonb_build_object('datum', '2026-10-05', 'arbeitsart', 'Walzen', 'status', 'erledigt',
  'geraete', jsonb_build_array((select id from maschinen where name = 'Walze Muster')),
  'felder', (select jsonb_agg(jsonb_build_object('feld_id', id)) from felder where name = 'Acker A'))) is not null as gespeichert;
select feldarbeit_speichern_geraete(jsonb_build_object('datum', '2026-10-05', 'arbeitsart', 'Walzen', 'status', 'erledigt',
  'geraete', jsonb_build_array((select id from maschinen where name = 'Walze Muster')),
  'felder', (select jsonb_agg(jsonb_build_object('feld_id', id)) from felder where name = 'Acker B'))) is not null as gespeichert;
-- geplante Arbeit zählt nicht
select feldarbeit_speichern_geraete(jsonb_build_object('datum', '2026-12-01', 'arbeitsart', 'Säen', 'status', 'geplant',
  'geraete', jsonb_build_array((select id from maschinen where name = 'Sämaschine Muster')),
  'felder', (select jsonb_agg(jsonb_build_object('feld_id', id)) from felder where name = 'Acker A'))) is not null as gespeichert;

select count(*) = 1 and sum(flaeche_ha) = 3 and sum(kosten_chf) = 120 as ok, 'Sämaschine: 3 ha × 40 = 120' as test
  from geraete_einsaetze where maschine = 'Sämaschine Muster';
select count(*) = 2 and sum(kosten_chf) = 60 as ok, 'Walze: Tagespreis einmal' as test from geraete_einsaetze where maschine = 'Walze Muster';
select not exists (select 1 from geraete_einsaetze where maschine = 'Traktor') as ok, 'Eigene Maschinen nicht in der Miete' as test;
\set ON_ERROR_STOP 0
update maschinen set eigentum = 'gekauft', version = version where name = 'Traktor';
\set ON_ERROR_STOP 1
select eigentum = 'eigen' as ok, 'Ungültiger Besitz abgelehnt' as test from maschinen where name = 'Traktor';

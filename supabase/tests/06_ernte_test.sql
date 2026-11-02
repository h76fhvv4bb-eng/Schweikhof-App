-- Tests für Migration 7 (Ernte). Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id) values ('eeeeeeee-0000-0000-0000-000000000001') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef') is not null as betrieb;
insert into felder (betrieb_id, feldnummer, name, flaeche_m2) values (mein_betrieb(), '9', 'Obere Suterweid', 8000);
insert into partner (betrieb_id, name, art) values (mein_betrieb(), 'Hof Nachbar', 'Abnehmer/Käufer'), (mein_betrieb(), 'LU Presse', 'Lohnunternehmen');

create temp table ids (name text, id uuid);
insert into ids select 'e1', public.ernte_speichern(jsonb_build_object(
  'feld_id', (select id from felder), 'datum', current_date, 'produkt', 'Heu', 'schnitt', 1,
  'ballen', 12, 'ballenart', 'Rundballen', 'menge_kg', 3600,
  'lohnunternehmen_id', (select id from partner where art = 'Lohnunternehmen'),
  'abnehmer', jsonb_build_array(
    jsonb_build_object('partner_id', (select id from partner where art = 'Abnehmer/Käufer'), 'art', 'Verkauf', 'ballen', 10, 'menge_kg', 3000, 'preis_chf', 600),
    jsonb_build_object('art', 'Lager', 'ballen', 2, 'menge_kg', 600))));
select kg_je_ha = 4500 and ballen_je_ha = 15 as ok, 'Ertrag je ha' as test from ertraege;
select ballen_abgegeben = 10 and erloes_chf = 600 and offen_chf = 600 as ok, 'Abgaben und Erlös' as test from ertraege;
update ernte_abnehmer set bezahlt = true where art = 'Verkauf';
select offen_chf = 0 as ok, 'Bezahlt markiert' as test from ertraege;

\set ON_ERROR_STOP 0
select public.ernte_speichern(jsonb_build_object(
  'feld_id', (select id from felder), 'datum', current_date, 'produkt', 'Emd', 'ballen', 5,
  'abnehmer', jsonb_build_array(jsonb_build_object('partner_id', (select id from partner where art = 'Abnehmer/Käufer'), 'ballen', 6))));
select public.ernte_speichern(jsonb_build_object('feld_id', (select id from felder), 'datum', current_date + 2, 'produkt', 'Emd', 'ballen', 5));
\set ON_ERROR_STOP 1
select count(*) = 1 as ok, 'Ungültige Ernten nicht gespeichert' as test from ernten;
select public.ernte_loeschen((select id from ids where name = 'e1'));
select count(*) = 0 as ok, 'Ernte gelöscht' as test from ernte_abnehmer;

-- Tests für Migration 26 (Lagerartikel löschen). Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id) values ('79797979-0000-0000-0000-000000000001') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', '79797979-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef') is not null as betrieb;
insert into lagerartikel (betrieb_id, bezeichnung, kategorie, einheit) values
  (mein_betrieb(), 'Nie benutzt', 'Dünger', 'kg'),
  (mein_betrieb(), 'Benutzt, leer', 'Dünger', 'kg'),
  (mein_betrieb(), 'Mit Bestand', 'Dünger', 'kg'),
  (mein_betrieb(), 'Ohne Lagerführung', 'Dünger', 't');
update lagerartikel set lagerfuehrung = false, version = version where bezeichnung = 'Ohne Lagerführung';
insert into maschinen (betrieb_id, name, kategorie) values (mein_betrieb(), 'Traktor', 'Traktor');
insert into maschine_teile (betrieb_id, maschine_id, artikel_id)
  select mein_betrieb(), m.id, a.id from maschinen m, lagerartikel a where a.bezeichnung = 'Nie benutzt';
insert into lagerbewegungen (betrieb_id, artikel_id, datum, art, menge)
  select mein_betrieb(), id, '2026-03-01', 'Eingang', 100 from lagerartikel where bezeichnung in ('Benutzt, leer', 'Mit Bestand');
insert into lagerbewegungen (betrieb_id, artikel_id, datum, art, menge)
  select mein_betrieb(), id, '2026-04-01', 'Verbrauch', -100 from lagerartikel where bezeichnung = 'Benutzt, leer';

select r ->> 'geloescht' = '2' and r ->> 'ausgeblendet' = '1' and jsonb_array_length(r -> 'behalten') = 1
       and r -> 'behalten' ->> 0 like 'Mit Bestand (100 kg)' as ok, 'Ergebnis' as test
  from (select lagerartikel_loeschen(array_agg(id)) r from lagerartikel) x;
select not exists (select 1 from lagerartikel where bezeichnung in ('Nie benutzt', 'Ohne Lagerführung')) as ok, 'Unbenutzte gelöscht' as test;
select (select not aktiv from lagerartikel where bezeichnung = 'Benutzt, leer')
   and (select count(*) from lagerbewegungen) = 3 as ok, 'Benutzte ausgeblendet, Journal bleibt' as test;
select (select aktiv from lagerartikel where bezeichnung = 'Mit Bestand') as ok, 'Artikel mit Bestand bleibt' as test;
select not exists (select 1 from maschine_teile) as ok, 'Maschinenzuordnung entfernt' as test;
select not exists (select 1 from lagerbestand where aktiv and bezeichnung = 'Benutzt, leer') as ok, 'Nicht mehr in der Lagerliste' as test;

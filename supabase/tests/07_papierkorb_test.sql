-- Tests für Migration 8 (Papierkorb, mehrere Kulturen). Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id) values ('eeeeeeee-0000-0000-0000-000000000001') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef') is not null as betrieb;
insert into felder (betrieb_id, feldnummer, name, flaeche_m2) values
  (mein_betrieb(), '1', 'Acker A', 10000), (mein_betrieb(), '2', 'Acker B', 20000);

-- Mehrere Kulturen im gleichen Jahr
insert into anbau (betrieb_id, feld_id, kultur_id, jahr, art, status)
select mein_betrieb(), f.id, k.id, 2027, a.art, 'geplant'
  from felder f, (values ('Wintergerste', 'Hauptkultur'), ('Silomais', 'Zweitkultur'),
                         ('Gründüngung', 'Zwischenkultur'), ('Zwischenfutter', 'Zwischenkultur')) a (kultur, art)
  join kulturen k on k.name = a.kultur and k.betrieb_id is null
 where f.feldnummer = '1';
select count(*) = 4 as ok, 'Vier Kulturen im gleichen Jahr' as test from anbau where jahr = 2027;

\set ON_ERROR_STOP 0
-- zweite Hauptkultur im gleichen Jahr
insert into anbau (betrieb_id, feld_id, kultur_id, jahr, art)
select mein_betrieb(), (select id from felder where feldnummer = '1'), id, 2027, 'Hauptkultur' from kulturen where name = 'Hafer' and betrieb_id is null;
-- Teilfläche grösser als Feld
insert into anbau (betrieb_id, feld_id, kultur_id, jahr, art, flaeche_m2)
select mein_betrieb(), (select id from felder where feldnummer = '1'), id, 2028, 'Zweitkultur', 15000 from kulturen where name = 'Hafer' and betrieb_id is null;
\set ON_ERROR_STOP 1
select count(*) = 4 as ok, 'Zweite Hauptkultur und zu grosse Teilfläche abgelehnt' as test from anbau;

-- Löschen, Nummer neu vergeben, Wiederherstellen
select public.feld_loeschen((select id from felder where feldnummer = '1'));
insert into felder (betrieb_id, feldnummer, name, flaeche_m2) values (mein_betrieb(), '1', 'Neu', 5000);
\set ON_ERROR_STOP 0
select public.feld_wiederherstellen((select id from felder where name = 'Acker A'));
\set ON_ERROR_STOP 1
select geloescht_am is not null as ok, 'Wiederherstellen bei vergebener Nummer verhindert' as test from felder where name = 'Acker A';
update felder set feldnummer = '1b', version = version where name = 'Neu';
select public.feld_wiederherstellen((select id from felder where name = 'Acker A'));
select geloescht_am is null as ok, 'Wiederhergestellt' as test from felder where name = 'Acker A';

-- Abgelaufen: nach 24 h endgültig entfernt
select public.feld_loeschen((select id from felder where name = 'Acker A'));
reset role;
update felder set geloescht_am = now() - interval '25 hours' where name = 'Acker A';
set role authenticated;
select public.papierkorb_leeren() = 1 as ok, 'Abgelaufenes Feld entfernt' as test;
select count(*) = 0 as ok, 'Anbau mit entfernt' as test from anbau;
\set ON_ERROR_STOP 0
select public.feld_wiederherstellen((select id from felder where name = 'Acker B'));
\set ON_ERROR_STOP 1

-- Felder mit Ernte bleiben archiviert
select public.ernte_speichern(jsonb_build_object('feld_id', (select id from felder where name = 'Acker B'), 'datum', current_date, 'produkt', 'Heu', 'ballen', 4));
select public.feld_loeschen((select id from felder where name = 'Acker B'));
\set ON_ERROR_STOP 0
select public.papierkorb_leeren((select id from felder where name = 'Acker B'));
\set ON_ERROR_STOP 1
select count(*) = 1 as ok, 'Feld mit Ernte bleibt archiviert' as test from felder where name = 'Acker B';

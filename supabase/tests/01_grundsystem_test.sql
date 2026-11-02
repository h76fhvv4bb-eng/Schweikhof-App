\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;
insert into auth.users values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select public.betrieb_einrichten('Schweikhof', 'Test Admin') is not null as betrieb_ok;
insert into felder (betrieb_id, feldnummer, name, flaeche_m2) values (mein_betrieb(), '1', 'Oberacker', 24000);
insert into anbau (betrieb_id, feld_id, kultur_id, jahr, status)
  select mein_betrieb(), f.id, k.id, 2026, 'ist' from felder f, kulturen k where f.name='Oberacker' and k.name='Kunstwiese';
update felder set name = 'Oberacker Nord' where feldnummer = '1';
select name, version from felder;
select kultur, flaeche_m2 from flaeche_je_kultur;
-- veraltete Version muss abgelehnt werden
\set ON_ERROR_STOP 0
update felder set name = 'X', version = 1 where feldnummer = '1';
\set ON_ERROR_STOP 1
select count(*) as protokolleintraege from aenderungsprotokoll;

-- zweiter Benutzer ohne Profil sieht nichts und kann keinen zweiten Betrieb anlegen
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select count(*) as fremd_sichtbare_felder from felder;
\set ON_ERROR_STOP 0
select public.betrieb_einrichten('Fremdhof', 'Eindringling');
insert into felder (betrieb_id, feldnummer, name, flaeche_m2) select id, '9', 'Hack', 1 from betriebe;

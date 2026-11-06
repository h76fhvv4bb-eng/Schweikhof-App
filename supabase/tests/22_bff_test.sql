-- Tests für Migration 25 (BFF, Zone). Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id) values ('78787878-0000-0000-0000-000000000001') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', '78787878-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef') is not null as betrieb;
update betriebe set zone = 'Hügelzone', version = version;
select zone = 'Hügelzone' as ok, 'Zone gespeichert' as test from betriebe;
insert into felder (betrieb_id, feldnummer, name, flaeche_m2, nutzungsart, bff_typ, bff_qualitaet, bff_vernetzung, schnitt_ab)
values (mein_betrieb(), '1', 'öko Wiese', 5000, 'Dauergrünland', 'Extensiv genutzte Wiese', 2, true, '07-01');
select bff_typ = 'Extensiv genutzte Wiese' and bff_qualitaet = 2 and bff_vernetzung and schnitt_ab = '07-01' as ok, 'BFF am Feld' as test from felder;
\set ON_ERROR_STOP 0
update felder set schnitt_ab = '7.1.', version = version;
update felder set bff_typ = 'Gibtsnicht', version = version;
\set ON_ERROR_STOP 1
select schnitt_ab = '07-01' and bff_typ = 'Extensiv genutzte Wiese' as ok, 'Ungültige Werte abgelehnt' as test from felder;

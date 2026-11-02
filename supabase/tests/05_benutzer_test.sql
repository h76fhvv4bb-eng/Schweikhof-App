-- Tests für Migration 6 (Benutzerverwaltung). Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id, email, email_confirmed_at) values
  ('dddddddd-0000-0000-0000-000000000001', 'chef@example.ch', now()),
  ('dddddddd-0000-0000-0000-000000000002', 'Anna@Example.ch', now()),
  ('dddddddd-0000-0000-0000-000000000003', 'fremd@example.ch', now()),
  ('dddddddd-0000-0000-0000-000000000004', 'unbestaetigt@example.ch', null)
  on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef') is not null as betrieb;
insert into einladungen (betrieb_id, email, name, rolle) values
  (mein_betrieb(), 'anna@example.ch', 'Anna', 'mitarbeiter'),
  (mein_betrieb(), 'unbestaetigt@example.ch', 'U', 'lesen');
select count(*) = 2 as ok, 'Einladungen sichtbar für Admin' as test from einladungen;

-- Anna nimmt an (Gross-/Kleinschreibung egal)
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000002', false);
select public.einladung_annehmen() is not null as ok, 'Einladung angenommen' as test;
select rolle = 'mitarbeiter' and name = 'Anna' as ok, 'Rolle aus Einladung' as test from benutzer_profile where id = auth.uid();
select count(*) = 0 as ok, 'Mitarbeiter sieht keine Einladungen' as test from einladungen;
\set ON_ERROR_STOP 0
select public.einladung_annehmen();
select public.benutzer_aendern('dddddddd-0000-0000-0000-000000000002', 'administrator', true);
-- Fremde und unbestätigte Konten
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000003', false);
select public.einladung_annehmen();
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', false);
select public.einladung_annehmen();
\set ON_ERROR_STOP 1
select public.betrieb_vorhanden() as ok, 'Betrieb vorhanden' as test;

-- Admin verwaltet
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000001', false);
select public.benutzer_aendern('dddddddd-0000-0000-0000-000000000002', 'betriebsleiter', true);
select rolle = 'betriebsleiter' as ok, 'Rolle geändert' as test from benutzer_profile where id = 'dddddddd-0000-0000-0000-000000000002';
\set ON_ERROR_STOP 0
select public.benutzer_aendern('dddddddd-0000-0000-0000-000000000001', 'mitarbeiter', true);
update benutzer_profile set rolle = 'lesen' where id = 'dddddddd-0000-0000-0000-000000000001';
\set ON_ERROR_STOP 1
select rolle = 'administrator' as ok, 'Letzter Admin bleibt' as test from benutzer_profile where id = auth.uid();
select public.benutzer_aendern('dddddddd-0000-0000-0000-000000000002', 'betriebsleiter', false);
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000002', false);
select count(*) = 0 as ok, 'Deaktiviert sieht nichts' as test from felder;
select mein_betrieb() is null as ok, 'Deaktiviert ohne Betrieb' as test;

-- Betrieb mit Administrator für Daten-Importe (CI)
insert into auth.users (id) values ('99999999-0000-0000-0000-000000000001') on conflict do nothing;
select set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef');

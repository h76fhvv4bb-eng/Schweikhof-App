-- Tests für Migration 5 (Aufträge). Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users values ('cccccccc-0000-0000-0000-000000000001'), ('cccccccc-0000-0000-0000-000000000002') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('Testhof5', 'Admin') is not null as betrieb;
reset role;
insert into benutzer_profile (id, betrieb_id, name, rolle) select 'cccccccc-0000-0000-0000-000000000002', id, 'MA', 'mitarbeiter' from betriebe;
set role authenticated;

insert into felder (betrieb_id, feldnummer, name, flaeche_m2) values (mein_betrieb(), '1', 'Oberacker', 20000), (mein_betrieb(), '2', 'Unterfeld', 10000);
insert into partner (betrieb_id, name, art) values (mein_betrieb(), 'LU Beispiel', 'Lohnunternehmen'), (mein_betrieb(), 'Werkstatt Beispiel', 'Mechaniker/Werkstatt');
insert into lagerartikel (betrieb_id, bezeichnung, kategorie, einheit, n_je_einheit) values (mein_betrieb(), 'Ammonsalpeter', 'Dünger', 'kg', 0.275);
insert into lagerbewegungen (betrieb_id, artikel_id, art, menge) select mein_betrieb(), id, 'Eingang', 1000 from lagerartikel;

-- Lohnauftrag: Säen auf beiden Feldern, Saatgut bringt der LU, Dünger stellt der Betrieb
create temp table ids (name text, id uuid);
insert into ids select 'a1', public.auftrag_speichern(jsonb_build_object(
  'art', 'Lohnarbeit', 'partner_id', (select id from partner where art = 'Lohnunternehmen'), 'titel', 'Weizen säen',
  'arbeitsart', 'Säen', 'termin_von', current_date,
  'felder', (select jsonb_agg(id) from felder),
  'mittel', jsonb_build_array(
    jsonb_build_object('bezeichnung', 'Winterweizen Arina', 'kategorie', 'Saatgut', 'einheit', 'kg', 'menge_je_ha', 180, 'bereitstellung', 'Dienstleister'),
    jsonb_build_object('artikel_id', (select id from lagerartikel where bezeichnung = 'Ammonsalpeter'), 'menge_je_ha', 100, 'bereitstellung', 'Betrieb'))));
select nummer = to_char(current_date, 'YYYY') || '-001' as ok, 'Auftragsnummer' as test from auftraege;
select public.auftrag_status((select id from ids where name='a1'), 'Gesendet');
select status = 'Gesendet' and gesendet_am is not null as ok, 'Gesendet' as test from auftraege;

select public.auftrag_abschliessen((select id from ids where name='a1'), current_date) is not null as ok, 'Abgeschlossen' as test;
select bestand = 700 as ok, 'Nur eigener Dünger gebucht (3 ha × 100 kg)' as test from lagerbestand where bezeichnung = 'Ammonsalpeter';
select count(*) = 2 as ok, 'Beide Mittel in der Kartei' as test from feldarbeit_mittel;
select lagerfuehrung = false as ok, 'Saatgut des LU ohne Bestand angelegt' as test from lagerartikel where bezeichnung = 'Winterweizen Arina';
select fa.partner_id = (select id from partner where art = 'Lohnunternehmen') as ok, 'Partner in Feldarbeit' as test
  from feldarbeiten fa where fa.id = (select feldarbeit_id from auftraege);
\set ON_ERROR_STOP 0
select public.auftrag_abschliessen((select id from ids where name='a1'), current_date);
\set ON_ERROR_STOP 1

-- Werkstattauftrag mit Beobachtung
insert into maschinen (betrieb_id, kategorie, name) values (mein_betrieb(), 'Traktor', 'Traktor 1');
select public.maschineneintrag_speichern(jsonb_build_object('maschine_id', (select id from maschinen), 'art', 'Beobachtung',
  'datum', current_date, 'titel', 'Hydraulik verliert Öl', 'offen', true)) is not null as erfasst;
insert into ids select 'w1', public.auftrag_speichern(jsonb_build_object(
  'art', 'Werkstatt', 'partner_id', (select id from partner where art = 'Mechaniker/Werkstatt'), 'titel', 'Hydraulik prüfen',
  'maschine_id', (select id from maschinen),
  'beobachtungen', (select jsonb_agg(id) from maschinen_eintraege where offen)));
select nummer = to_char(current_date, 'YYYY') || '-002' as ok, 'Zweite Nummer' as test from auftraege where id = (select id from ids where name='w1');
select public.auftrag_abschliessen((select id from ids where name='w1'), current_date, 420) is not null as ok, 'Werkstatt abgeschlossen' as test;
select count(*) = 0 as ok, 'Beobachtung geschlossen' as test from maschinen_eintraege where offen;
select kosten = 420 and art = 'Reparatur' as ok, 'Reparatur mit Kosten' as test from maschinen_eintraege where art = 'Reparatur';

-- Mitarbeiter darf keine Aufträge anlegen
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000002', false);
\set ON_ERROR_STOP 0
select public.auftrag_speichern(jsonb_build_object('art', 'Lohnarbeit', 'partner_id', (select id from partner limit 1), 'titel', 'x'));

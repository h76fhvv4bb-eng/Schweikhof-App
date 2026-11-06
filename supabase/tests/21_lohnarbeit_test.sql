-- Tests für Migration 24 (Lohnarbeit: Aufträge automatisch, Abrechnung). Spalte "ok" muss überall t sein.
\set ON_ERROR_STOP 1
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id) values ('56565656-0000-0000-0000-000000000001') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', '56565656-0000-0000-0000-000000000001', false);
select public.betrieb_einrichten('SchweikFarm', 'Chef') is not null as betrieb;
insert into felder (betrieb_id, feldnummer, name, flaeche_m2) values (mein_betrieb(), '1', 'A', 20000), (mein_betrieb(), '2', 'B', 10000);
insert into partner (betrieb_id, name, art) values (mein_betrieb(), 'LU Muster', 'Lohnunternehmen'), (mein_betrieb(), 'LU Andere', 'Lohnunternehmen');
create temp table ids (name text, id uuid);

-- 1) Geplante Arbeit mit Lohnunternehmen → Auftrag (Entwurf) mit Feldern
insert into ids select 'plan', public.feldarbeit_speichern_geraete(jsonb_build_object('datum', current_date + 3, 'arbeitsart', 'Pressen', 'status', 'geplant',
  'partner_id', (select id from partner where name = 'LU Muster'),
  'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where name = 'A')), jsonb_build_object('feld_id', (select id from felder where name = 'B')))));
select count(*) = 1 and min(a.status) = 'Entwurf' and (select count(*) from auftrag_felder) = 2 and min(a.titel) like 'Pressen%' as ok,
       'Auftrag automatisch angelegt' as test from auftraege a where a.feldarbeit_id = (select id from ids where name = 'plan');

-- 2) Gesendet, dann anderer Lohnunternehmer in der Planung → zurück auf Entwurf, Partner gleich
select public.auftrag_status((select id from auftraege), 'Gesendet');
select public.feldarbeit_speichern_geraete(jsonb_build_object('id', (select id from ids where name = 'plan'), 'version', (select version from feldarbeiten where id = (select id from ids where name = 'plan')),
  'datum', current_date + 4, 'arbeitsart', 'Pressen', 'status', 'geplant', 'partner_id', (select id from partner where name = 'LU Andere'),
  'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where name = 'A')))));
select a.status = 'Entwurf' and a.partner_id = (select id from partner where name = 'LU Andere') and a.termin_von = current_date + 4
       and (select count(*) from auftrag_felder) = 1 and (select count(*) from auftraege) = 1 as ok,
       'Partner, Termin, Felder nachgeführt' as test from auftraege a;

-- 3) Direkt erledigen ist gesperrt, solange der Auftrag offen ist
\set ON_ERROR_STOP 0
select public.feldarbeit_erledigen((select id from ids where name = 'plan'), jsonb_build_object('datum', current_date));
\set ON_ERROR_STOP 1
select status = 'geplant' as ok, 'Erledigen nur über den Auftrag' as test from feldarbeiten where id = (select id from ids where name = 'plan');

-- 4) Abrechnung je Ballen: Menge fehlt → Fehler; dann 38 Ballen à 14.50
select public.auftrag_speichern_abrechnung(jsonb_build_object('id', (select id from auftraege), 'version', (select version from auftraege),
  'art', 'Lohnarbeit', 'partner_id', (select partner_id from auftraege), 'titel', 'Pressen A', 'arbeitsart', 'Pressen',
  'felder', jsonb_build_array((select id from felder where name = 'A')), 'feldarbeit_id', (select id from ids where name = 'plan'),
  'abrechnung', 'Ballen', 'preis_je_einheit', 14.5));
select abrechnung = 'Ballen' and preis_je_einheit = 14.5 as ok, 'Abrechnungsart gespeichert' as test from auftraege;
\set ON_ERROR_STOP 0
select public.auftrag_abschliessen_abrechnung((select id from auftraege), jsonb_build_object('datum', current_date));
\set ON_ERROR_STOP 1
select public.auftrag_abschliessen_abrechnung((select id from auftraege), jsonb_build_object('datum', current_date, 'menge', 38));
select a.status = 'Erledigt' and a.kosten_chf = 551 and a.menge_abgerechnet = 38
       and fa.status = 'erledigt' and fa.bemerkungen like '%Kosten CHF 551.00 (38 Ballen à 14.50)%' and fa.mitarbeiter_id is null as ok,
       'Kosten = Ballen × Preis, Arbeit erledigt, ohne eigene Person' as test
  from auftraege a join feldarbeiten fa on fa.id = a.feldarbeit_id;

-- 5) Nachtragen: je Hektare 2 ha à 120
select public.auftrag_abrechnung_nachtragen((select id from auftraege), jsonb_build_object('abrechnung', 'Hektare', 'preis_je_einheit', 120, 'menge', 2)) = 240 as ok,
       'Nachgetragen: Fläche × Hektarpreis' as test;
select public.auftrag_abrechnung_nachtragen((select id from auftraege), jsonb_build_object('abrechnung', 'Pauschale', 'preis_je_einheit', 300)) = 300 as ok,
       'Pauschale' as test;

-- 6) Direkt erfasste erledigte Lohnarbeit → erledigter Auftrag
insert into ids select 'direkt', public.feldarbeit_speichern_geraete(jsonb_build_object('datum', current_date, 'arbeitsart', 'Ernten', 'status', 'erledigt',
  'partner_id', (select id from partner where name = 'LU Muster'), 'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where name = 'B')))));
select status = 'Erledigt' and erledigt_am = current_date as ok, 'Erledigte Lohnarbeit erscheint als Auftrag' as test
  from auftraege where feldarbeit_id = (select id from ids where name = 'direkt');

-- 7) Geplante Arbeit löschen bzw. Lohnunternehmen entfernen → Auftrag abgebrochen
insert into ids select 'plan2', public.feldarbeit_speichern_geraete(jsonb_build_object('datum', current_date + 5, 'arbeitsart', 'Pflügen', 'status', 'geplant',
  'partner_id', (select id from partner where name = 'LU Muster'), 'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where name = 'B')))));
select public.feldarbeit_loeschen((select id from ids where name = 'plan2'));
select status = 'Abgebrochen' as ok, 'Gelöschte Arbeit: Auftrag abgebrochen' as test from auftraege where feldarbeit_id = (select id from ids where name = 'plan2');
insert into ids select 'plan3', public.feldarbeit_speichern_geraete(jsonb_build_object('datum', current_date + 5, 'arbeitsart', 'Eggen', 'status', 'geplant',
  'partner_id', (select id from partner where name = 'LU Muster'), 'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where name = 'B')))));
select public.feldarbeit_speichern_geraete(jsonb_build_object('id', (select id from ids where name = 'plan3'), 'version', (select version from feldarbeiten where id = (select id from ids where name = 'plan3')),
  'datum', current_date + 5, 'arbeitsart', 'Eggen', 'status', 'geplant', 'partner_id', null,
  'felder', jsonb_build_array(jsonb_build_object('feld_id', (select id from felder where name = 'B')))));
select status = 'Abgebrochen' as ok, 'Ohne Lohnunternehmen: Auftrag abgebrochen' as test from auftraege where feldarbeit_id = (select id from ids where name = 'plan3');

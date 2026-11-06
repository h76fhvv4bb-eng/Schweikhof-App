-- =====================================================================
-- Arbeiten 2026 nachtragen (einmalig, im Supabase SQL-Editor ausführen)
-- Felder werden über Kultur, Nutzung bzw. Namen gefunden. Läuft als Ganzes: bei einem Fehler wird nichts geändert.
-- Mehrfaches Ausführen erzeugt keine Doppel: Gibt es auf einem Feld schon dieselbe Arbeit am selben Tag, wird es übersprungen.
-- =====================================================================

begin;

-- Anteil der öko-Flächen, der am 4. Juli gemäht wurde (Rest = Rückzugsstreifen). 0.85 = 85 % gemäht, 15 % stehen gelassen.
-- Falls nur 15 % gemäht wurden: hier 0.15 eintragen.
create temp table einstellung on commit drop as select 0.85::numeric as anteil_oeko;

create or replace function pg_temp.nachtrag(p_datum date, p_art text, p_felder uuid[], p_anteil numeric, p_partner uuid, p_bem text)
returns int
language plpgsql as $$
declare
  v_liste jsonb;
  v_id    uuid;
begin
  select jsonb_agg(jsonb_build_object('feld_id', f.id,
           'flaeche_m2', case when p_anteil is null or p_anteil >= 1 then null else round(f.flaeche_m2 * p_anteil, 1) end) order by f.feldnummer)
    into v_liste
    from felder f
   where f.id = any(p_felder)
     and not exists (select 1 from feldarbeiten fa join feldarbeit_felder ff on ff.feldarbeit_id = fa.id
                      where ff.feld_id = f.id and fa.datum = p_datum and fa.arbeitsart = p_art and fa.geloescht_am is null);
  if v_liste is null then return 0; end if;
  if to_regprocedure('public.feldarbeit_speichern_geraete(jsonb)') is not null then
    v_id := feldarbeit_speichern_geraete(jsonb_build_object('datum', p_datum, 'arbeitsart', p_art, 'status', 'erledigt',
              'partner_id', p_partner, 'bemerkungen', p_bem, 'felder', v_liste));
  else
    v_id := feldarbeit_speichern(jsonb_build_object('datum', p_datum, 'arbeitsart', p_art, 'status', 'erledigt',
              'partner_id', p_partner, 'bemerkungen', p_bem, 'felder', v_liste));
  end if;
  insert into pg_temp.ergebnis
  select p_datum, p_art, f.name, case when p_anteil is null or p_anteil >= 1 then null else round(f.flaeche_m2 * p_anteil / 10000, 2) end, p_bem
    from felder f join feldarbeit_felder ff on ff.feld_id = f.id where ff.feldarbeit_id = v_id;
  return jsonb_array_length(v_liste);
end $$;

drop table if exists pg_temp.ergebnis;
create temp table ergebnis (datum date, arbeit text, feld text, teilflaeche_ha numeric, bemerkung text);

-- als Administrator des Betriebs handeln (für Berechtigungen und «erfasst von»)
select set_config('request.jwt.claim.sub',
  (select id::text from benutzer_profile where rolle = 'administrator' and aktiv order by erstellt_am limit 1), true);
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from benutzer_profile where rolle = 'administrator' and aktiv order by erstellt_am limit 1), 'role', 'authenticated')::text, true);

-- Lohnunternehmen «Häckis» (falls noch nicht vorhanden)
insert into partner (betrieb_id, name, art)
select mein_betrieb(), 'Häckis', 'Lohnunternehmen'
 where not exists (select 1 from partner where betrieb_id = mein_betrieb() and name ilike 'häckis%');

-- Feldgruppen
create temp table gruppe (name text, feld_id uuid) on commit drop;
-- Wintergerste (Saat Herbst 2026 für 2027)
insert into gruppe select distinct 'wintergerste', a.feld_id from anbau a join kulturen k on k.id = a.kultur_id join felder f on f.id = a.feld_id
 where a.art = 'Hauptkultur' and a.jahr = 2027 and k.name ilike 'wintergerste%' and f.geloescht_am is null;
-- Weizen 2026, danach Wintergerste oder Kunstwiese
insert into gruppe select distinct 'stoppelsturz', a.feld_id from anbau a join kulturen k on k.id = a.kultur_id join felder f on f.id = a.feld_id
 where a.art = 'Hauptkultur' and a.jahr = 2026 and k.name ilike '%weizen%' and f.geloescht_am is null
   and exists (select 1 from anbau b join kulturen kb on kb.id = b.kultur_id
                where b.feld_id = a.feld_id and b.art = 'Hauptkultur' and b.jahr = 2027 and (kb.name ilike 'wintergerste%' or kb.name ilike 'kunstwiese%'));
-- Oberer und unterer Dreizopf (ohne öko und Rand)
insert into gruppe select 'dreizopf', id from felder where geloescht_am is null and (name ilike 'oberer dreizopf' or name ilike 'unterer dreizopf');
-- öko-Flächen (ohne Brachen)
insert into gruppe select 'oeko', f.id from felder f where f.geloescht_am is null and f.status = 'bewirtschaftet' and f.name ilike 'öko%'
   and not exists (select 1 from anbau a join kulturen k on k.id = a.kultur_id where a.feld_id = f.id and a.jahr = 2026 and k.name ilike '%brache%');
-- Buntbrachen 2026
insert into gruppe select distinct 'buntbrache', a.feld_id from anbau a join kulturen k on k.id = a.kultur_id join felder f on f.id = a.feld_id
 where a.art = 'Hauptkultur' and a.jahr = 2026 and k.name ilike 'buntbrache%' and f.geloescht_am is null;
-- Dauergrünland, Weiden und Kunstwiesen, die am 6. März bestanden
insert into gruppe select 'wiesenegge', f.id from felder f where f.geloescht_am is null and f.status = 'bewirtschaftet'
   and (f.nutzungsart in ('Dauergrünland', 'Weide')
        or exists (select 1 from anbau a join kulturen k on k.id = a.kultur_id
                    where a.feld_id = f.id and a.art = 'Hauptkultur' and a.jahr = 2026 and k.name ilike 'kunstwiese%'
                      and (a.saatdatum is null or a.saatdatum < '2026-03-06')))
   and not exists (select 1 from anbau a join kulturen k on k.id = a.kultur_id where a.feld_id = f.id and a.jahr = 2026 and k.name ilike '%brache%');
insert into gruppe select 'bienenhaus', id from felder where geloescht_am is null and name ilike 'untere bienenhausweide%';

-- Arbeiten
select pg_temp.nachtrag('2026-03-06', 'Eggen', array(select feld_id from gruppe where name = 'wiesenegge'), 1, null, 'Wiesenegge');
select pg_temp.nachtrag('2026-03-06', 'Säen', array(select feld_id from gruppe where name = 'bienenhaus'), 0.10, null, 'Nachsaat Kunstwiese nach Umbau der Wiese (ca. 10 %)');

select pg_temp.nachtrag('2026-04-11', 'Pflügen', array(select feld_id from gruppe where name = 'buntbrache'), 1, null, null);
select pg_temp.nachtrag('2026-04-11', 'Eggen', array(select feld_id from gruppe where name = 'buntbrache'), 1, null, null);
select pg_temp.nachtrag('2026-04-18', 'Eggen', array(select feld_id from gruppe where name = 'buntbrache'), 1, null, null);
select pg_temp.nachtrag('2026-05-23', 'Säen', array(select feld_id from gruppe where name = 'buntbrache'), 1, null, 'Buntbrache');

select pg_temp.nachtrag('2026-07-04', 'Mähen', array(select feld_id from gruppe where name = 'oeko'), (select anteil_oeko from einstellung), null,
                        'öko-Fläche, Rückzugsstreifen stehen gelassen');
select pg_temp.nachtrag('2026-07-06', 'Pressen', array(select feld_id from gruppe where name = 'oeko'), (select anteil_oeko from einstellung),
                        (select id from partner where betrieb_id = mein_betrieb() and name ilike 'häckis%' order by erstellt_am limit 1), null);

select pg_temp.nachtrag('2026-07-25', 'Grubbern', array(select feld_id from gruppe where name = 'stoppelsturz'), 1, null, 'Stoppelsturz');

select pg_temp.nachtrag('2026-08-13', 'Eggen', array(select feld_id from gruppe where name = 'dreizopf'), 1, null, null);
select pg_temp.nachtrag('2026-08-13', 'Säen', array(select feld_id from gruppe where name = 'dreizopf'), 1, null, 'Kunstwiese, Saatgut Helvetia');

select pg_temp.nachtrag('2026-10-02', 'Pflügen', array(select feld_id from gruppe where name = 'wintergerste'), 1, null, null);
select pg_temp.nachtrag('2026-10-03', 'Eggen', array(select feld_id from gruppe where name = 'wintergerste'), 1, null, null);
select pg_temp.nachtrag('2026-10-04', 'Säen', array(select feld_id from gruppe where name = 'wintergerste'), 1, null, 'Wintergerste Esprit, TKG 46 g');

-- Sorten bei den Kulturen eintragen (falls noch leer)
update anbau a set sorte = 'Esprit', version = a.version from kulturen k
 where k.id = a.kultur_id and a.jahr = 2027 and a.art = 'Hauptkultur' and k.name ilike 'wintergerste%'
   and a.feld_id in (select feld_id from gruppe where name = 'wintergerste') and coalesce(a.sorte, '') = '';
update anbau a set sorte = 'Helvetia', version = a.version from kulturen k
 where k.id = a.kultur_id and a.jahr = 2027 and a.art = 'Hauptkultur' and k.name ilike 'kunstwiese%'
   and a.feld_id in (select feld_id from gruppe where name = 'dreizopf') and coalesce(a.sorte, '') = '';

commit;

-- Was eingetragen wurde (Felder ohne Eintrag hatten die Arbeit schon oder passen nicht)
select to_char(datum, 'DD.MM.YYYY') as datum, arbeit, feld, teilflaeche_ha, bemerkung from ergebnis order by ergebnis.datum, arbeit, feld;

-- Hofmanager SchweikFarm: Migrationen 08 bis 17 in einem Durchgang.
-- Nur einspielen, wenn Migration 07 schon gelaufen ist und 08 noch nicht.
-- Läuft als Ganzes: bei einem Fehler wird nichts geändert.


-- ===== 20261102000008_papierkorb_mehrfachkulturen.sql =====
-- =====================================================================
-- Migration 8: Felder löschen mit Papierkorb (24 h) und mehrere Kulturen je Feld und Jahr
-- =====================================================================

-- ---------------------------------------------------------------------
-- Papierkorb für Felder
-- Gelöschte Felder sind 24 Stunden wiederherstellbar. Danach werden sie endgültig entfernt,
-- ausser es gibt dazu Aufzeichnungen (Feldarbeiten, Ernten, Aufträge): Diese bleiben erhalten,
-- das Feld bleibt dann ausgeblendet im Archiv.
-- ---------------------------------------------------------------------

-- Feldnummern gelöschter Felder dürfen wieder vergeben werden
alter table public.felder drop constraint felder_betrieb_id_feldnummer_key;
create unique index felder_nummer_aktiv on public.felder (betrieb_id, feldnummer) where geloescht_am is null;

alter table public.felder add column geloescht_von uuid references auth.users (id) on delete set null;

-- Hat das Feld Aufzeichnungen, die nicht gelöscht werden dürfen?
create or replace function public.feld_aufzeichnungen(p_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'arbeiten', (select count(*) from feldarbeit_felder ff join feldarbeiten fa on fa.id = ff.feldarbeit_id
                  where ff.feld_id = p_id and fa.geloescht_am is null),
    'ernten',   (select count(*) from ernten where feld_id = p_id),
    'auftraege', (select count(*) from auftrag_felder where feld_id = p_id))
  where exists (select 1 from felder where id = p_id and betrieb_id = mein_betrieb());
$$;

create or replace function public.feld_loeschen(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  update felder set geloescht_am = now(), geloescht_von = auth.uid()
   where id = p_id and betrieb_id = mein_betrieb() and geloescht_am is null;
  if not found then raise exception 'Feld nicht gefunden oder bereits gelöscht'; end if;
end $$;

create or replace function public.feld_wiederherstellen(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v felder%rowtype;
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  select * into v from felder where id = p_id and betrieb_id = mein_betrieb() and geloescht_am is not null;
  if not found then raise exception 'Feld nicht im Papierkorb'; end if;
  if v.geloescht_am < now() - interval '24 hours' then
    raise exception 'Das Feld wurde vor mehr als 24 Stunden gelöscht und kann nicht mehr wiederhergestellt werden';
  end if;
  if exists (select 1 from felder where betrieb_id = v.betrieb_id and feldnummer = v.feldnummer and geloescht_am is null) then
    raise exception 'Die Feldnummer % ist inzwischen wieder vergeben. Bitte zuerst das andere Feld umnummerieren.', v.feldnummer;
  end if;
  update felder set geloescht_am = null, geloescht_von = null where id = p_id;
end $$;

-- Endgültig entfernen: ein Feld (sofort, aus dem Papierkorb) oder alle abgelaufenen (p_id = null)
create or replace function public.papierkorb_leeren(p_id uuid default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  v_anzahl int := 0;
  r record;
begin
  if v_betrieb is null then return 0; end if;
  if p_id is not null and not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  for r in
    select f.id from felder f
     where f.betrieb_id = v_betrieb and f.geloescht_am is not null
       and (case when p_id is null then f.geloescht_am < now() - interval '24 hours' else f.id = p_id end)
       -- Aufzeichnungen bleiben erhalten: solche Felder werden nicht entfernt
       and not exists (select 1 from feldarbeit_felder where feld_id = f.id)
       and not exists (select 1 from ernten where feld_id = f.id)
       and not exists (select 1 from auftrag_felder where feld_id = f.id)
       and not exists (select 1 from felder z where z.zusammengefuehrt_in = f.id)
  loop
    delete from feld_hinweise where feld_id = r.id;
    delete from anbau where feld_id = r.id;
    delete from feld_parzellen where feld_id = r.id;
    delete from felder where id = r.id;
    v_anzahl := v_anzahl + 1;
  end loop;
  if p_id is not null and v_anzahl = 0 then
    raise exception 'Dieses Feld hat Aufzeichnungen (Arbeiten, Ernten oder Aufträge) und bleibt archiviert';
  end if;
  return v_anzahl;
end $$;

revoke all on function public.feld_aufzeichnungen(uuid), public.feld_loeschen(uuid), public.feld_wiederherstellen(uuid),
  public.papierkorb_leeren(uuid) from public, anon;
grant execute on function public.feld_aufzeichnungen(uuid), public.feld_loeschen(uuid), public.feld_wiederherstellen(uuid),
  public.papierkorb_leeren(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Mehrere Kulturen je Feld und Jahr
-- Hauptkultur: genau eine je Feld und Jahr (Grundlage für Kartei, Ernte, Flächen).
-- Zweitkultur (z. B. Silomais nach Grünschnittroggen, oder auf einer Teilfläche),
-- Zwischenkultur und Untersaat: beliebig viele, jede Kultur einmal je Jahr.
-- ---------------------------------------------------------------------
alter table public.anbau drop constraint anbau_art_check;
alter table public.anbau add constraint anbau_art_check
  check (art in ('Hauptkultur', 'Zweitkultur', 'Zwischenkultur', 'Untersaat'));
alter table public.anbau drop constraint anbau_feld_id_jahr_art_key;
create unique index anbau_hauptkultur on public.anbau (feld_id, jahr) where art = 'Hauptkultur';
create unique index anbau_kultur_je_jahr on public.anbau (feld_id, jahr, art, kultur_id);

-- Teilfläche darf nicht grösser als das Feld sein
create or replace function public.pruefe_anbau_flaeche() returns trigger
language plpgsql as $$
declare
  v_feld numeric;
begin
  if new.flaeche_m2 is not null then
    select flaeche_m2 into v_feld from public.felder where id = new.feld_id;
    if new.flaeche_m2 > v_feld then
      raise exception 'Die Teilfläche ist grösser als das Feld (% m²)', round(v_feld);
    end if;
  end if;
  return new;
end $$;
create trigger c_anbau_flaeche before insert or update on public.anbau for each row execute function public.pruefe_anbau_flaeche();

-- ===== 20261102000009_kartenobjekte.sql =====
-- =====================================================================
-- Migration 9: Flächen und Orte ohne Fruchtfolge (Garten, ungenutzte Fläche, Brunnen …) und Bäume
-- Diese Objekte erscheinen nur auf der Karte, nicht in Felderliste, Fruchtfolge, Kartei oder Ernte.
-- =====================================================================

create table public.kartenobjekte (
  id           uuid primary key default gen_random_uuid(),
  betrieb_id   uuid not null references public.betriebe (id),
  ebene        text not null check (ebene in ('flaeche', 'ort', 'baum')),
  typ          text not null check (length(trim(typ)) between 1 and 40),
  name         text check (name is null or length(name) <= 80),
  -- Fläche: Polygon/MultiPolygon; Ort und Baum: Punkt (GeoJSON, WGS84)
  geometrie    jsonb not null,
  flaeche_m2   numeric(12, 1) check (flaeche_m2 > 0),
  -- nur Bäume
  baumart      text check (baumart is null or length(baumart) <= 60),
  sorte        text check (sorte is null or length(sorte) <= 60),
  pflanzjahr   integer check (pflanzjahr between 1800 and 2100),
  hochstamm    boolean not null default false,
  bemerkungen  text check (bemerkungen is null or length(bemerkungen) <= 2000),
  erstellt_am  timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  version      integer not null default 1,
  constraint kartenobjekt_geometrie check (
    case ebene
      when 'flaeche' then geometrie ->> 'type' in ('Polygon', 'MultiPolygon')
      else geometrie ->> 'type' = 'Point'
           and (geometrie -> 'coordinates' ->> 1)::numeric between 45 and 48.5
           and (geometrie -> 'coordinates' ->> 0)::numeric between 5.5 and 11
    end)
);
create index on public.kartenobjekte (betrieb_id, ebene);

create trigger a_version before update on public.kartenobjekte for each row execute function public.pruefe_version();
create trigger b_metadaten before insert or update on public.kartenobjekte for each row execute function public.setze_metadaten();
create trigger z_protokoll after insert or update or delete on public.kartenobjekte for each row execute function public.protokolliere();

alter table public.kartenobjekte enable row level security;
create policy ko_lesen    on public.kartenobjekte for select using (betrieb_id = public.mein_betrieb());
create policy ko_neu      on public.kartenobjekte for insert with check (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
create policy ko_aendern  on public.kartenobjekte for update using (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
create policy ko_loeschen on public.kartenobjekte for delete using (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
grant select, insert, update, delete on public.kartenobjekte to authenticated;

-- ===== 20261102000010_ernte_produkte_lager.sql =====
-- =====================================================================
-- Migration 10: Ernte mit mehreren Produkten (z. B. Getreide und Stroh), mehreren Dienstleistern
-- (Dreschen, Pressen …) und Einlagerung ins Lager mit Lagerort.
-- Bestehende Ernten werden übernommen.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Produkte einer Ernte
-- ---------------------------------------------------------------------
create table public.ernte_produkte (
  id              uuid primary key default gen_random_uuid(),
  betrieb_id      uuid not null references public.betriebe (id),
  ernte_id        uuid not null references public.ernten (id) on delete cascade,
  position        integer not null default 1,
  produkt         text not null check (produkt in (
                    'Heu', 'Emd', 'Grassilage', 'Gras frisch', 'Silomais', 'Körnermais', 'Getreide', 'Stroh',
                    'Raps', 'Eiweisserbsen', 'Kartoffeln', 'Zuckerrüben', 'Andere')),
  ballen          integer check (ballen >= 0),
  ballenart       text check (ballenart in ('Rundballen', 'Quaderballen', 'Kleinballen', 'Siloballen')),
  menge_kg        numeric(12, 1) check (menge_kg >= 0),
  feuchte_prozent numeric(4, 1) check (feuchte_prozent between 0 and 100),
  qualitaet       text,
  check (ballen is not null or menge_kg is not null)
);
create index on public.ernte_produkte (ernte_id);

-- ---------------------------------------------------------------------
-- Dienstleister einer Ernte (mehrere möglich)
-- ---------------------------------------------------------------------
create table public.ernte_dienstleister (
  id          uuid primary key default gen_random_uuid(),
  betrieb_id  uuid not null references public.betriebe (id),
  ernte_id    uuid not null references public.ernten (id) on delete cascade,
  partner_id  uuid not null references public.partner (id),
  leistung    text not null check (leistung in (
                'Mähen', 'Zetten', 'Schwaden', 'Pressen', 'Wickeln', 'Dreschen', 'Häckseln', 'Roden', 'Transport', 'Ernte', 'Andere')),
  kosten_chf  numeric(12, 2) check (kosten_chf >= 0),
  bemerkung   text
);
create index on public.ernte_dienstleister (partner_id);

-- ---------------------------------------------------------------------
-- Abnehmer: gehören zu einem Produkt; Einlagerung mit Lagerartikel und Lagerort
-- ---------------------------------------------------------------------
alter table public.ernte_abnehmer add column produkt_id uuid references public.ernte_produkte (id) on delete cascade;
alter table public.ernte_abnehmer add column lagerartikel_id uuid references public.lagerartikel (id);
alter table public.ernte_abnehmer add column lagerort_id uuid references public.hofobjekte (id) on delete set null;

-- Bestehende Daten übernehmen
insert into public.ernte_produkte (betrieb_id, ernte_id, position, produkt, ballen, ballenart, menge_kg, feuchte_prozent, qualitaet)
select betrieb_id, id, 1, produkt, ballen, ballenart, menge_kg, feuchte_prozent, qualitaet from public.ernten;
update public.ernte_abnehmer a set produkt_id = p.id from public.ernte_produkte p where p.ernte_id = a.ernte_id;
alter table public.ernte_abnehmer alter column produkt_id set not null;
insert into public.ernte_dienstleister (betrieb_id, ernte_id, partner_id, leistung)
select betrieb_id, id, lohnunternehmen_id, 'Ernte' from public.ernten where lohnunternehmen_id is not null;

drop view public.ertraege;
alter table public.ernten
  drop column produkt, drop column ballen, drop column ballenart, drop column menge_kg,
  drop column feuchte_prozent, drop column qualitaet, drop column lohnunternehmen_id;

create trigger z_protokoll after insert or update or delete on public.ernte_produkte for each row execute function public.protokolliere();
create trigger z_protokoll after insert or update or delete on public.ernte_dienstleister for each row execute function public.protokolliere();

alter table public.ernte_produkte      enable row level security;
alter table public.ernte_dienstleister enable row level security;
create policy ep_lesen on public.ernte_produkte      for select using (betrieb_id = public.mein_betrieb());
create policy ed_lesen on public.ernte_dienstleister for select using (betrieb_id = public.mein_betrieb());
grant select on public.ernte_produkte, public.ernte_dienstleister to authenticated;

-- ---------------------------------------------------------------------
-- Ernte speichern
-- p: {"id"?, "version"?, "feld_id", "datum", "schnitt"?, "flaeche_m2"?, "bemerkungen"?,
--     "produkte": [{"produkt", "ballen"?, "ballenart"?, "menge_kg"?, "feuchte_prozent"?, "qualitaet"?}],
--     "dienstleister": [{"partner_id", "leistung", "kosten_chf"?, "bemerkung"?}],
--     "abnehmer": [{"produkt_index" (0-basiert), "art", "partner_id"?, "ballen"?, "menge_kg"?, "preis_chf"?,
--                   "preis_einheit"?, "bezahlt"?, "bemerkung"?, "lagerartikel_id"?, "lagerort_id"?}]}
-- Abnehmer mit Art «Lager» buchen als Eingang ins Lager. Ohne Lagerartikel wird einer angelegt
-- (z. B. «Heu Rundballen 2026 – Scheune»).
-- ---------------------------------------------------------------------
create or replace function public.ernte_lagerbuchungen_entfernen(p_ernte uuid)
returns void
language sql security definer set search_path = public as $$
  delete from lagerbewegungen
   where quelle_typ = 'ernte_abgabe'
     and quelle_id in (select id from ernte_abnehmer where ernte_id = p_ernte);
$$;
revoke all on function public.ernte_lagerbuchungen_entfernen(uuid) from public, anon, authenticated;

drop function public.ernte_speichern(jsonb);
create function public.ernte_speichern(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  v_id      uuid := nullif(p ->> 'id', '')::uuid;
  v_feld    felder%rowtype;
  v_datum   date := (p ->> 'datum')::date;
  v_produkte uuid[] := '{}';
  v_prod    ernte_produkte%rowtype;
  v_abn     uuid;
  v_idx     int;
  v_artikel lagerartikel%rowtype;
  v_ort     hofobjekte%rowtype;
  v_name    text;
  v_einheit text;
  v_menge   numeric;
  v_ballen  int;
  v_kg      numeric;
  x         jsonb;
  i         int := 0;
begin
  if v_betrieb is null or not darf_erfassen() then raise exception 'Keine Berechtigung'; end if;
  select * into v_feld from felder where id = (p ->> 'feld_id')::uuid and betrieb_id = v_betrieb;
  if not found then raise exception 'Unbekanntes Feld'; end if;
  if v_datum is null or v_datum > current_date then raise exception 'Erntedatum fehlt oder liegt in der Zukunft'; end if;
  if jsonb_array_length(coalesce(p -> 'produkte', '[]')) = 0 then raise exception 'Bitte mindestens ein Produkt erfassen'; end if;

  if v_id is null then
    insert into ernten (betrieb_id, feld_id, anbau_id, datum, schnitt, flaeche_m2, bemerkungen)
    values (v_betrieb, v_feld.id,
            (select id from anbau where feld_id = v_feld.id and jahr = extract(year from v_datum)::int and art = 'Hauptkultur'),
            v_datum, nullif(p ->> 'schnitt', '')::int, coalesce(nullif(p ->> 'flaeche_m2', '')::numeric, v_feld.flaeche_m2),
            nullif(p ->> 'bemerkungen', ''))
    returning id into v_id;
  else
    if not darf_verwalten() and not exists (select 1 from ernten where id = v_id and erstellt_von = auth.uid()) then
      raise exception 'Nur eigene Einträge können geändert werden';
    end if;
    update ernten set
      feld_id = v_feld.id, datum = v_datum, schnitt = nullif(p ->> 'schnitt', '')::int,
      flaeche_m2 = coalesce(nullif(p ->> 'flaeche_m2', '')::numeric, v_feld.flaeche_m2),
      bemerkungen = nullif(p ->> 'bemerkungen', ''),
      anbau_id = (select id from anbau where feld_id = v_feld.id and jahr = extract(year from v_datum)::int and art = 'Hauptkultur'),
      version = coalesce((p ->> 'version')::int, version)
    where id = v_id and betrieb_id = v_betrieb;
    if not found then raise exception 'Ernte nicht gefunden'; end if;
    perform ernte_lagerbuchungen_entfernen(v_id);
    delete from ernte_abnehmer where ernte_id = v_id;
    delete from ernte_produkte where ernte_id = v_id;
    delete from ernte_dienstleister where ernte_id = v_id;
  end if;

  -- Produkte
  for x in select * from jsonb_array_elements(p -> 'produkte') loop
    i := i + 1;
    if nullif(x ->> 'ballen', '') is null and nullif(x ->> 'menge_kg', '') is null then
      raise exception 'Bei «%» bitte Anzahl Ballen oder Gewicht angeben', x ->> 'produkt';
    end if;
    insert into ernte_produkte (betrieb_id, ernte_id, position, produkt, ballen, ballenart, menge_kg, feuchte_prozent, qualitaet)
    values (v_betrieb, v_id, i, x ->> 'produkt', nullif(x ->> 'ballen', '')::int,
            case when nullif(x ->> 'ballen', '') is not null then nullif(x ->> 'ballenart', '') end,
            nullif(x ->> 'menge_kg', '')::numeric, nullif(x ->> 'feuchte_prozent', '')::numeric, nullif(x ->> 'qualitaet', ''))
    returning id into v_abn;
    v_produkte := v_produkte || v_abn;
  end loop;

  -- Dienstleister
  for x in select * from jsonb_array_elements(coalesce(p -> 'dienstleister', '[]')) loop
    if not exists (select 1 from partner where id = (x ->> 'partner_id')::uuid and betrieb_id = v_betrieb) then
      raise exception 'Unbekannter Dienstleister';
    end if;
    insert into ernte_dienstleister (betrieb_id, ernte_id, partner_id, leistung, kosten_chf, bemerkung)
    values (v_betrieb, v_id, (x ->> 'partner_id')::uuid, coalesce(nullif(x ->> 'leistung', ''), 'Ernte'),
            nullif(x ->> 'kosten_chf', '')::numeric, nullif(x ->> 'bemerkung', ''));
  end loop;

  -- Abnehmer
  for x in select * from jsonb_array_elements(coalesce(p -> 'abnehmer', '[]')) loop
    v_idx := coalesce(nullif(x ->> 'produkt_index', '')::int, 0) + 1;
    if v_idx < 1 or v_idx > cardinality(v_produkte) then raise exception 'Abgabe ohne gültiges Produkt'; end if;
    select * into v_prod from ernte_produkte where id = v_produkte[v_idx];
    if nullif(x ->> 'partner_id', '') is not null
       and not exists (select 1 from partner where id = (x ->> 'partner_id')::uuid and betrieb_id = v_betrieb) then
      raise exception 'Unbekannter Partner';
    end if;
    v_ballen := nullif(x ->> 'ballen', '')::int;
    v_kg := nullif(x ->> 'menge_kg', '')::numeric;
    v_artikel := null;
    v_ort := null;

    if x ->> 'art' = 'Lager' then
      if nullif(x ->> 'lagerort_id', '') is not null then
        select * into v_ort from hofobjekte where id = (x ->> 'lagerort_id')::uuid and betrieb_id = v_betrieb;
        if not found then raise exception 'Unbekannter Lagerort'; end if;
      end if;
      if nullif(x ->> 'lagerartikel_id', '') is not null then
        select * into v_artikel from lagerartikel where id = (x ->> 'lagerartikel_id')::uuid and betrieb_id = v_betrieb;
        if not found then raise exception 'Unbekannter Lagerartikel'; end if;
      else
        v_einheit := case when v_ballen is not null then 'Ballen' else 'kg' end;
        v_name := v_prod.produkt || coalesce(' ' || case when v_ballen is not null then v_prod.ballenart end, '')
                  || ' ' || extract(year from v_datum)::int || coalesce(' – ' || v_ort.name, '');
        select * into v_artikel from lagerartikel
         where betrieb_id = v_betrieb and bezeichnung = v_name and einheit = v_einheit and aktiv limit 1;
        if not found then
          insert into lagerartikel (betrieb_id, bezeichnung, kategorie, einheit, lagerort, bemerkungen)
          values (v_betrieb, v_name, 'Erzeugnisse', v_einheit, v_ort.name, 'Aus der Ernte angelegt')
          returning * into v_artikel;
        end if;
      end if;
      v_menge := case v_artikel.einheit
                   when 'Ballen' then v_ballen
                   when 'Stk' then v_ballen
                   when 'kg' then v_kg
                   when 't' then v_kg / 1000
                 end;
      if v_menge is null or v_menge <= 0 then
        raise exception 'Für die Einlagerung in «%» (Einheit %) fehlt die Menge in %', v_artikel.bezeichnung, v_artikel.einheit,
          case when v_artikel.einheit in ('Ballen', 'Stk') then 'Ballen' else 'kg' end;
      end if;
    end if;

    insert into ernte_abnehmer (betrieb_id, ernte_id, produkt_id, partner_id, art, ballen, menge_kg, preis_chf, preis_einheit, bezahlt,
                                bemerkung, lagerartikel_id, lagerort_id)
    values (v_betrieb, v_id, v_prod.id, nullif(x ->> 'partner_id', '')::uuid, coalesce(nullif(x ->> 'art', ''), 'Verkauf'),
            v_ballen, v_kg, nullif(x ->> 'preis_chf', '')::numeric, nullif(x ->> 'preis_einheit', ''),
            coalesce((x ->> 'bezahlt')::boolean, false), nullif(x ->> 'bemerkung', ''), v_artikel.id, v_ort.id)
    returning id into v_abn;

    if x ->> 'art' = 'Lager' then
      insert into lagerbewegungen (betrieb_id, artikel_id, datum, art, menge, quelle_typ, quelle_id, bemerkung)
      values (v_betrieb, v_artikel.id, v_datum, 'Ernte', v_menge, 'ernte_abgabe', v_abn,
              'Ernte ' || v_feld.name || coalesce(', ' || v_ort.name, ''));
    end if;
  end loop;

  -- Abgaben je Produkt dürfen die Ernte nicht übersteigen
  for v_prod in select * from ernte_produkte where ernte_id = v_id loop
    select sum(ballen), sum(menge_kg) into v_ballen, v_kg from ernte_abnehmer where produkt_id = v_prod.id;
    if v_prod.ballen is not null and coalesce(v_ballen, 0) > v_prod.ballen then
      raise exception 'Bei «%» wurden mehr Ballen abgegeben (%) als geerntet (%)', v_prod.produkt, v_ballen, v_prod.ballen;
    end if;
    if v_prod.menge_kg is not null and coalesce(v_kg, 0) > v_prod.menge_kg * 1.001 then
      raise exception 'Bei «%» wurde mehr Gewicht abgegeben (% kg) als geerntet (% kg)', v_prod.produkt, v_kg, v_prod.menge_kg;
    end if;
  end loop;
  return v_id;
end $$;

create or replace function public.ernte_loeschen(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not darf_verwalten() and not exists (select 1 from ernten where id = p_id and erstellt_von = auth.uid() and betrieb_id = mein_betrieb()) then
    raise exception 'Keine Berechtigung';
  end if;
  if not exists (select 1 from ernten where id = p_id and betrieb_id = mein_betrieb()) then raise exception 'Ernte nicht gefunden'; end if;
  perform ernte_lagerbuchungen_entfernen(p_id);
  delete from ernten where id = p_id;
end $$;

revoke all on function public.ernte_speichern(jsonb), public.ernte_loeschen(uuid) from public, anon;
grant execute on function public.ernte_speichern(jsonb), public.ernte_loeschen(uuid) to authenticated;

-- Erträge je Produkt
create view public.ertraege with (security_invoker = true) as
select p.id, e.id as ernte_id, e.betrieb_id, e.feld_id, e.datum, extract(year from e.datum)::int as jahr, p.produkt, e.schnitt,
       e.flaeche_m2, p.ballen, p.menge_kg,
       round(p.menge_kg / (e.flaeche_m2 / 10000), 0) as kg_je_ha,
       round(p.ballen / (e.flaeche_m2 / 10000), 1) as ballen_je_ha,
       coalesce(sum(a.ballen) filter (where a.art in ('Verkauf', 'Abgabe')), 0) as ballen_abgegeben,
       coalesce(sum(a.menge_kg) filter (where a.art in ('Verkauf', 'Abgabe')), 0) as kg_abgegeben,
       coalesce(sum(a.preis_chf) filter (where a.art = 'Verkauf'), 0) as erloes_chf,
       coalesce(sum(a.preis_chf) filter (where a.art = 'Verkauf' and not a.bezahlt), 0) as offen_chf
from public.ernte_produkte p
join public.ernten e on e.id = p.ernte_id
left join public.ernte_abnehmer a on a.produkt_id = p.id
group by p.id, e.id;
grant select on public.ertraege to authenticated;

-- ===== 20261102000011_aufgaben.sql =====
-- =====================================================================
-- Migration 11: Aufgaben und Arbeitsplanung
-- Geplante Feldarbeiten bleiben Feldarbeiten mit Status «geplant».
-- Maschinen- und allgemeine Aufgaben stehen in «aufgaben».
-- Beim Erledigen werden Zählerstände, effektive Mengen, Zeit und Beobachtungen festgehalten.
-- =====================================================================

-- Zählerstände
alter table public.maschinen add column kilometerstand numeric(9, 1) check (kilometerstand >= 0);
alter table public.maschinen_eintraege add column kilometerstand numeric(9, 1) check (kilometerstand >= 0);
alter table public.feldarbeiten add column maschine_stunden numeric(9, 1) check (maschine_stunden >= 0);
alter table public.feldarbeiten add column maschine_km numeric(9, 1) check (maschine_km >= 0);
alter table public.feldarbeiten add column geraet_stunden numeric(9, 1) check (geraet_stunden >= 0);
alter table public.feldarbeiten add column beobachtung text;

-- ---------------------------------------------------------------------
-- Aufgaben (Maschinen und Allgemein)
-- ---------------------------------------------------------------------
create table public.aufgaben (
  id             uuid primary key default gen_random_uuid(),
  betrieb_id     uuid not null references public.betriebe (id),
  art            text not null check (art in ('Maschine', 'Allgemein')),
  titel          text not null check (length(trim(titel)) between 1 and 120),
  faellig_am     date,
  zugewiesen_an  uuid references public.benutzer_profile (id) on delete set null,
  wichtig        boolean not null default false,
  maschine_id    uuid references public.maschinen (id) on delete cascade,
  eintragsart    text check (eintragsart in ('Wartung', 'Reparatur', 'Kontrolle')),
  partner_id     uuid references public.partner (id) on delete set null,   -- z. B. Werkstatt
  beobachtung_id uuid references public.maschinen_eintraege (id) on delete set null, -- Anlass
  bemerkungen    text,
  status         text not null default 'offen' check (status in ('offen', 'erledigt')),
  erledigt_am    date,
  erledigt_von   uuid references auth.users (id) on delete set null,
  dauer_h        numeric(6, 2) check (dauer_h >= 0),
  ergebnis       text,
  eintrag_id     uuid references public.maschinen_eintraege (id) on delete set null, -- daraus entstandener Eintrag
  erstellt_von   uuid default auth.uid(),
  erstellt_am    timestamptz not null default now(),
  geaendert_am   timestamptz not null default now(),
  version        integer not null default 1,
  check (art <> 'Maschine' or (maschine_id is not null and eintragsart is not null))
);
create index on public.aufgaben (betrieb_id, status, faellig_am);

create trigger a_version before update on public.aufgaben for each row execute function public.pruefe_version();
create trigger b_metadaten before insert or update on public.aufgaben for each row execute function public.setze_metadaten();
create trigger z_protokoll after insert or update or delete on public.aufgaben for each row execute function public.protokolliere();

alter table public.aufgaben enable row level security;
create policy au_lesen   on public.aufgaben for select using (betrieb_id = public.mein_betrieb());
create policy au_neu     on public.aufgaben for insert with check (betrieb_id = public.mein_betrieb() and public.darf_erfassen() and status = 'offen');
create policy au_aendern on public.aufgaben for update using (
  betrieb_id = public.mein_betrieb() and (public.darf_verwalten() or erstellt_von = auth.uid() or zugewiesen_an = auth.uid()));
create policy au_loeschen on public.aufgaben for delete using (
  betrieb_id = public.mein_betrieb() and (public.darf_verwalten() or erstellt_von = auth.uid()));
grant select, insert, update, delete on public.aufgaben to authenticated;

-- Zählerstände nur nach oben nachführen
create or replace function public.zaehler_nachfuehren(p_maschine uuid, p_stunden numeric, p_km numeric)
returns void
language sql security definer set search_path = public as $$
  update maschinen set
    betriebsstunden = case when p_stunden is not null and (betriebsstunden is null or p_stunden > betriebsstunden) then p_stunden else betriebsstunden end,
    kilometerstand  = case when p_km is not null and (kilometerstand is null or p_km > kilometerstand) then p_km else kilometerstand end
  where id = p_maschine and betrieb_id = mein_betrieb();
$$;
revoke all on function public.zaehler_nachfuehren(uuid, numeric, numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Geplante Feldarbeit erledigen
-- p: {"datum", "dauer_h"?, "maschine_stunden"?, "maschine_km"?, "geraet_stunden"?,
--     "mittel": [{"artikel_id", "gesamtmenge"}]? (effektiv verbraucht), "beobachtung"?, "beobachtung_an_maschine"?: uuid}
-- ---------------------------------------------------------------------
create or replace function public.feldarbeit_erledigen(p_id uuid, p jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_a     feldarbeiten%rowtype;
  v_datum date := coalesce((p ->> 'datum')::date, current_date);
  v_ha    numeric;
  m       jsonb;
  v_masch uuid := nullif(p ->> 'beobachtung_an_maschine', '')::uuid;
begin
  if not darf_erfassen() then raise exception 'Keine Berechtigung'; end if;
  select * into v_a from feldarbeiten where id = p_id and betrieb_id = mein_betrieb() and geloescht_am is null for update;
  if not found then raise exception 'Arbeit nicht gefunden'; end if;
  if v_a.status <> 'geplant' then raise exception 'Diese Arbeit ist bereits erledigt'; end if;
  if v_datum > current_date then raise exception 'Das Datum der Erledigung liegt in der Zukunft'; end if;

  update feldarbeiten set
    status = 'erledigt', datum = v_datum,
    dauer_h = coalesce(nullif(p ->> 'dauer_h', '')::numeric, dauer_h),
    maschine_stunden = nullif(p ->> 'maschine_stunden', '')::numeric,
    maschine_km = nullif(p ->> 'maschine_km', '')::numeric,
    geraet_stunden = nullif(p ->> 'geraet_stunden', '')::numeric,
    beobachtung = nullif(trim(p ->> 'beobachtung'), ''),
    ausgefuehrt_von = coalesce(ausgefuehrt_von, auth.uid())
  where id = p_id;

  -- Kultur des Erledigungsjahres zuordnen
  update feldarbeit_felder ff set anbau_id = (
    select a.id from anbau a where a.feld_id = ff.feld_id and a.jahr = extract(year from v_datum)::int and a.art = 'Hauptkultur')
  where ff.feldarbeit_id = p_id;

  -- Effektiv verbrauchte Mengen
  select sum(flaeche_m2) / 10000 into v_ha from feldarbeit_felder where feldarbeit_id = p_id;
  for m in select * from jsonb_array_elements(coalesce(p -> 'mittel', '[]')) loop
    if nullif(m ->> 'gesamtmenge', '') is null then continue; end if;
    if (m ->> 'gesamtmenge')::numeric <= 0 then
      delete from feldarbeit_mittel where feldarbeit_id = p_id and artikel_id = (m ->> 'artikel_id')::uuid;
    else
      update feldarbeit_mittel set gesamtmenge = round((m ->> 'gesamtmenge')::numeric, 3),
                                   menge_je_ha = round((m ->> 'gesamtmenge')::numeric / v_ha, 4)
       where feldarbeit_id = p_id and artikel_id = (m ->> 'artikel_id')::uuid;
    end if;
  end loop;

  -- Zähler
  if v_a.maschine_id is not null then
    perform zaehler_nachfuehren(v_a.maschine_id, nullif(p ->> 'maschine_stunden', '')::numeric, nullif(p ->> 'maschine_km', '')::numeric);
  end if;
  if v_a.geraet_id is not null then
    perform zaehler_nachfuehren(v_a.geraet_id, nullif(p ->> 'geraet_stunden', '')::numeric, null);
  end if;

  -- Beobachtung zusätzlich als offenen Punkt an der Maschine melden
  if v_masch is not null and nullif(trim(p ->> 'beobachtung'), '') is not null then
    if v_masch not in (coalesce(v_a.maschine_id, v_masch), coalesce(v_a.geraet_id, v_masch))
       or not exists (select 1 from maschinen where id = v_masch and betrieb_id = mein_betrieb()) then
      raise exception 'Unbekannte Maschine';
    end if;
    insert into maschinen_eintraege (betrieb_id, maschine_id, art, datum, betriebsstunden, kilometerstand, titel, beschreibung, offen)
    values (mein_betrieb(), v_masch, 'Beobachtung', v_datum,
            case when v_masch = v_a.maschine_id then nullif(p ->> 'maschine_stunden', '')::numeric else nullif(p ->> 'geraet_stunden', '')::numeric end,
            case when v_masch = v_a.maschine_id then nullif(p ->> 'maschine_km', '')::numeric end,
            left(trim(p ->> 'beobachtung'), 80), 'Bei ' || v_a.arbeitsart || ' am ' || to_char(v_datum, 'DD.MM.YYYY') || ': ' || trim(p ->> 'beobachtung'),
            true);
  end if;

  perform feldarbeit_buchen(p_id);
end $$;

-- ---------------------------------------------------------------------
-- Aufgabe erledigen. Bei Maschinen entsteht ein Eintrag (Wartung/Reparatur/Kontrolle).
-- p: {"datum", "dauer_h"?, "ergebnis"?, "betriebsstunden"?, "kilometerstand"?, "kosten"?, "partner_id"?,
--     "noch_offen"?: bool (Mangel besteht weiter), "beobachtung_schliessen"?: bool}
-- ---------------------------------------------------------------------
create or replace function public.aufgabe_erledigen(p_id uuid, p jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v       aufgaben%rowtype;
  v_datum date := coalesce((p ->> 'datum')::date, current_date);
  v_eintrag uuid;
begin
  if not darf_erfassen() then raise exception 'Keine Berechtigung'; end if;
  select * into v from aufgaben where id = p_id and betrieb_id = mein_betrieb() for update;
  if not found then raise exception 'Aufgabe nicht gefunden'; end if;
  if v.status = 'erledigt' then raise exception 'Aufgabe ist bereits erledigt'; end if;
  if v_datum > current_date then raise exception 'Das Datum der Erledigung liegt in der Zukunft'; end if;

  if v.art = 'Maschine' then
    v_eintrag := maschineneintrag_speichern(jsonb_build_object(
      'maschine_id', v.maschine_id, 'art', v.eintragsart, 'datum', v_datum, 'titel', v.titel,
      'beschreibung', concat_ws(E'\n', nullif(v.bemerkungen, ''), nullif(trim(p ->> 'ergebnis'), '')),
      'betriebsstunden', nullif(p ->> 'betriebsstunden', ''), 'kosten', nullif(p ->> 'kosten', ''),
      'arbeitszeit_h', nullif(p ->> 'dauer_h', ''), 'partner_id', coalesce(nullif(p ->> 'partner_id', ''), v.partner_id::text),
      'offen', coalesce((p ->> 'noch_offen')::boolean, false)));
    update maschinen_eintraege set kilometerstand = nullif(p ->> 'kilometerstand', '')::numeric where id = v_eintrag;
    perform zaehler_nachfuehren(v.maschine_id, nullif(p ->> 'betriebsstunden', '')::numeric, nullif(p ->> 'kilometerstand', '')::numeric);
    if v.beobachtung_id is not null and coalesce((p ->> 'beobachtung_schliessen')::boolean, true) then
      update maschinen_eintraege set offen = false where id = v.beobachtung_id;
    end if;
  end if;

  update aufgaben set
    status = 'erledigt', erledigt_am = v_datum, erledigt_von = auth.uid(),
    dauer_h = nullif(p ->> 'dauer_h', '')::numeric, ergebnis = nullif(trim(p ->> 'ergebnis'), ''), eintrag_id = v_eintrag
  where id = p_id;
end $$;

revoke all on function public.feldarbeit_erledigen(uuid, jsonb), public.aufgabe_erledigen(uuid, jsonb) from public, anon;
grant execute on function public.feldarbeit_erledigen(uuid, jsonb), public.aufgabe_erledigen(uuid, jsonb) to authenticated;

-- ===== 20261102000012_ernten_sammel.sql =====
-- =====================================================================
-- Migration 12: Mehrere Ernten gemeinsam speichern (alles oder nichts)
-- p: {"ernten": [<gleicher Inhalt wie bei ernte_speichern>, …]}
-- =====================================================================
create or replace function public.ernten_speichern(p jsonb)
returns uuid[]
language plpgsql security definer set search_path = public as $$
declare
  x     jsonb;
  i     int := 0;
  ids   uuid[] := '{}';
  v_name text;
begin
  if jsonb_array_length(coalesce(p -> 'ernten', '[]')) = 0 then raise exception 'Keine Ernten zum Speichern'; end if;
  if jsonb_array_length(p -> 'ernten') > 100 then raise exception 'Höchstens 100 Ernten auf einmal'; end if;
  for x in select * from jsonb_array_elements(p -> 'ernten') loop
    i := i + 1;
    begin
      ids := ids || ernte_speichern(x);
    exception when others then
      select name into v_name from felder where id = nullif(x ->> 'feld_id', '')::uuid;
      raise exception 'Zeile % (%): %', i, coalesce(v_name, 'ohne Feld'), sqlerrm;
    end;
  end loop;
  return ids;
end $$;

revoke all on function public.ernten_speichern(jsonb) from public, anon;
grant execute on function public.ernten_speichern(jsonb) to authenticated;

-- ===== 20261102000013_mitarbeiter_folgearbeiten.sql =====
-- =====================================================================
-- Migration 13: Mitarbeitende, Folgearbeiten (Arbeitsketten), Lohn- und Werkstattaufträge aus Aufgaben
-- =====================================================================

-- ---------------------------------------------------------------------
-- Mitarbeitende (mit oder ohne App-Zugang)
-- ---------------------------------------------------------------------
create table public.mitarbeiter (
  id                uuid primary key default gen_random_uuid(),
  betrieb_id        uuid not null references public.betriebe (id),
  name              text not null check (length(trim(name)) between 1 and 80),
  funktion          text check (funktion is null or length(funktion) <= 60),   -- z. B. Betriebsleiter, Aushilfe, Lernender
  telefon           text,
  email             text,
  stundenansatz_chf numeric(8, 2) check (stundenansatz_chf >= 0),
  benutzer_id       uuid unique references public.benutzer_profile (id) on delete set null,  -- App-Zugang
  aktiv             boolean not null default true,
  bemerkungen       text,
  erstellt_am       timestamptz not null default now(),
  geaendert_am      timestamptz not null default now(),
  version           integer not null default 1
);
create trigger a_version before update on public.mitarbeiter for each row execute function public.pruefe_version();
create trigger b_metadaten before insert or update on public.mitarbeiter for each row execute function public.setze_metadaten();
create trigger z_protokoll after insert or update or delete on public.mitarbeiter for each row execute function public.protokolliere();

alter table public.mitarbeiter enable row level security;
create policy mi_lesen   on public.mitarbeiter for select using (betrieb_id = public.mein_betrieb());
create policy mi_neu     on public.mitarbeiter for insert with check (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
create policy mi_aendern on public.mitarbeiter for update using (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
grant select, insert, update on public.mitarbeiter to authenticated;

-- Jedes App-Konto ist automatisch auch Mitarbeiter/in
insert into public.mitarbeiter (betrieb_id, name, benutzer_id, aktiv)
select betrieb_id, name, id, aktiv from public.benutzer_profile;

create or replace function public.mitarbeiter_aus_benutzer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into mitarbeiter (betrieb_id, name, benutzer_id, aktiv)
  values (new.betrieb_id, new.name, new.id, new.aktiv)
  on conflict (benutzer_id) do nothing;
  return new;
end $$;
create trigger mitarbeiter_anlegen after insert on public.benutzer_profile for each row execute function public.mitarbeiter_aus_benutzer();

-- Mitarbeiter-ID des angemeldeten Kontos
create or replace function public.ich_mitarbeiter() returns uuid
language sql stable security definer set search_path = public as $$
  select id from mitarbeiter where benutzer_id = auth.uid();
$$;
grant execute on function public.ich_mitarbeiter() to authenticated;

-- Zuordnung bei Arbeiten und Aufgaben
alter table public.feldarbeiten add column mitarbeiter_id uuid references public.mitarbeiter (id) on delete set null;
alter table public.aufgaben     add column mitarbeiter_id uuid references public.mitarbeiter (id) on delete set null;
update public.feldarbeiten f set mitarbeiter_id = m.id from public.mitarbeiter m where m.benutzer_id = f.ausgefuehrt_von;
update public.aufgaben a     set mitarbeiter_id = m.id from public.mitarbeiter m where m.benutzer_id = a.zugewiesen_an;

-- Zugewiesene dürfen ihre Aufgaben bearbeiten
drop policy au_aendern on public.aufgaben;
create policy au_aendern on public.aufgaben for update using (
  betrieb_id = public.mein_betrieb()
  and (public.darf_verwalten() or erstellt_von = auth.uid() or zugewiesen_an = auth.uid() or mitarbeiter_id = public.ich_mitarbeiter()));

-- ---------------------------------------------------------------------
-- Folgearbeiten: eine geplante Arbeit wartet auf ihre Vorgängerin (z. B. Pflügen → Kreiselegge → Säen)
-- ---------------------------------------------------------------------
alter table public.feldarbeiten add column vorgaenger_id uuid references public.feldarbeiten (id) on delete set null;
create index on public.feldarbeiten (vorgaenger_id);

-- Liefert die Bezeichnung einer noch offenen Vorgängerin, sonst null
create or replace function public.offene_vorgaengerin(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select v.arbeitsart || coalesce(' (' || to_char(v.datum, 'DD.MM.YYYY') || ')', '')
    from feldarbeiten a join feldarbeiten v on v.id = a.vorgaenger_id
   where a.id = p_id and v.status = 'geplant' and v.geloescht_am is null;
$$;

-- Lohn- und Werkstattaufträge aus Aufgaben
alter table public.auftraege add column aufgabe_id uuid references public.aufgaben (id) on delete set null;

-- ---------------------------------------------------------------------
-- feldarbeit_speichern: zusätzlich mitarbeiter_id und vorgaenger_id
-- ---------------------------------------------------------------------
create or replace function public.feldarbeit_speichern(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  v_id      uuid := nullif(p ->> 'id', '')::uuid;
  v_datum   date := (p ->> 'datum')::date;
  v_status  text := coalesce(p ->> 'status', 'erledigt');
  v_vorg    uuid := nullif(p ->> 'vorgaenger_id', '')::uuid;
  v_mitarb  uuid := nullif(p ->> 'mitarbeiter_id', '')::uuid;
  v_offen   text;
  v_ha      numeric;
  f         jsonb;
  m         jsonb;
  v_flaeche numeric;
  v_feld    felder%rowtype;
begin
  if v_betrieb is null or not darf_erfassen() then
    raise exception 'Keine Berechtigung, Arbeiten zu erfassen';
  end if;
  if v_datum is null then raise exception 'Datum fehlt'; end if;
  if v_datum > current_date + 400 then raise exception 'Datum liegt zu weit in der Zukunft'; end if;
  if v_status = 'erledigt' and v_datum > current_date then
    raise exception 'Eine erledigte Arbeit kann nicht in der Zukunft liegen';
  end if;
  if jsonb_array_length(coalesce(p -> 'felder', '[]')) = 0 then
    raise exception 'Mindestens ein Feld wählen';
  end if;
  if nullif(p ->> 'maschine_id', '') is not null and not exists (select 1 from maschinen where id = (p ->> 'maschine_id')::uuid and betrieb_id = v_betrieb)
     or nullif(p ->> 'geraet_id', '') is not null and not exists (select 1 from maschinen where id = (p ->> 'geraet_id')::uuid and betrieb_id = v_betrieb)
     or nullif(p ->> 'partner_id', '') is not null and not exists (select 1 from partner where id = (p ->> 'partner_id')::uuid and betrieb_id = v_betrieb) then
    raise exception 'Unbekannte Maschine oder unbekannter Partner';
  end if;
  if v_mitarb is not null and not exists (select 1 from mitarbeiter where id = v_mitarb and betrieb_id = v_betrieb) then
    raise exception 'Unbekannte Person';
  end if;
  if v_vorg is not null then
    if v_vorg = v_id or not exists (select 1 from feldarbeiten where id = v_vorg and betrieb_id = v_betrieb and geloescht_am is null) then
      raise exception 'Unbekannte Vorgängerarbeit';
    end if;
    -- keine Kreise
    if v_id is not null and exists (
      with recursive kette(id) as (
        select v_vorg union all select fa.vorgaenger_id from feldarbeiten fa join kette k on fa.id = k.id where fa.vorgaenger_id is not null)
      select 1 from kette where id = v_id) then
      raise exception 'Eine Arbeit kann nicht auf sich selbst warten';
    end if;
    if v_status = 'erledigt' then
      select arbeitsart into v_offen from feldarbeiten where id = v_vorg and status = 'geplant' and geloescht_am is null;
      if v_offen is not null then raise exception 'Zuerst die vorherige Arbeit «%» erledigen', v_offen; end if;
    end if;
  end if;

  if v_id is null then
    insert into feldarbeiten (betrieb_id, datum, arbeitsart, status, dauer_h, maschine, geraet, ausgefuehrt_von, ausbringung, bemerkungen,
                              maschine_id, geraet_id, partner_id, mitarbeiter_id, vorgaenger_id)
    values (v_betrieb, v_datum, p ->> 'arbeitsart', v_status, nullif(p ->> 'dauer_h', '')::numeric,
            nullif(p ->> 'maschine', ''), nullif(p ->> 'geraet', ''),
            coalesce(nullif(p ->> 'ausgefuehrt_von', '')::uuid, case when v_mitarb is null then auth.uid() end),
            nullif(p ->> 'ausbringung', ''), nullif(p ->> 'bemerkungen', ''),
            nullif(p ->> 'maschine_id', '')::uuid, nullif(p ->> 'geraet_id', '')::uuid, nullif(p ->> 'partner_id', '')::uuid,
            coalesce(v_mitarb, case when nullif(p ->> 'partner_id', '') is null and v_status = 'erledigt' then ich_mitarbeiter() end),
            v_vorg)
    returning id into v_id;
  else
    if not darf_verwalten() and not exists (
      select 1 from feldarbeiten where id = v_id and (erstellt_von = auth.uid() or mitarbeiter_id = ich_mitarbeiter())) then
      raise exception 'Nur eigene Einträge können geändert werden';
    end if;
    update feldarbeiten set
      datum = v_datum, arbeitsart = p ->> 'arbeitsart', status = v_status,
      dauer_h = nullif(p ->> 'dauer_h', '')::numeric,
      maschine = nullif(p ->> 'maschine', ''), geraet = nullif(p ->> 'geraet', ''),
      ausgefuehrt_von = nullif(p ->> 'ausgefuehrt_von', '')::uuid,
      ausbringung = nullif(p ->> 'ausbringung', ''), bemerkungen = nullif(p ->> 'bemerkungen', ''),
      maschine_id = nullif(p ->> 'maschine_id', '')::uuid, geraet_id = nullif(p ->> 'geraet_id', '')::uuid,
      partner_id = nullif(p ->> 'partner_id', '')::uuid,
      mitarbeiter_id = v_mitarb, vorgaenger_id = v_vorg,
      version = coalesce((p ->> 'version')::int, version)
    where id = v_id and betrieb_id = v_betrieb and geloescht_am is null;
    if not found then raise exception 'Arbeit nicht gefunden'; end if;
    delete from feldarbeit_felder where feldarbeit_id = v_id;
    delete from feldarbeit_mittel where feldarbeit_id = v_id;
  end if;

  for f in select * from jsonb_array_elements(p -> 'felder') loop
    select * into v_feld from felder
     where id = (f ->> 'feld_id')::uuid and betrieb_id = v_betrieb and geloescht_am is null;
    if not found then raise exception 'Unbekanntes Feld'; end if;
    v_flaeche := coalesce(nullif(f ->> 'flaeche_m2', '')::numeric, v_feld.flaeche_m2);
    if v_flaeche <= 0 or v_flaeche > v_feld.flaeche_m2 * 1.001 then
      raise exception 'Bearbeitete Fläche auf % muss zwischen 0 und der Feldfläche liegen', v_feld.name;
    end if;
    insert into feldarbeit_felder (betrieb_id, feldarbeit_id, feld_id, anbau_id, flaeche_m2)
    values (v_betrieb, v_id, v_feld.id,
            (select a.id from anbau a where a.feld_id = v_feld.id and a.jahr = extract(year from v_datum)::int
               and a.art = 'Hauptkultur'),
            v_flaeche);
  end loop;

  select sum(flaeche_m2) / 10000 into v_ha from feldarbeit_felder where feldarbeit_id = v_id;

  for m in select * from jsonb_array_elements(coalesce(p -> 'mittel', '[]')) loop
    if not exists (select 1 from lagerartikel where id = (m ->> 'artikel_id')::uuid and betrieb_id = v_betrieb) then
      raise exception 'Unbekannter Artikel';
    end if;
    insert into feldarbeit_mittel (betrieb_id, feldarbeit_id, artikel_id, menge_je_ha, gesamtmenge, vom_lager)
    values (v_betrieb, v_id, (m ->> 'artikel_id')::uuid, (m ->> 'menge_je_ha')::numeric,
            round((m ->> 'menge_je_ha')::numeric * v_ha, 3), coalesce((m ->> 'vom_lager')::boolean, true));
  end loop;

  perform feldarbeit_buchen(v_id);
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- feldarbeit_erledigen: Reihenfolge der Kette beachten, Person festhalten
-- ---------------------------------------------------------------------
create or replace function public.feldarbeit_erledigen(p_id uuid, p jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_a     feldarbeiten%rowtype;
  v_datum date := coalesce((p ->> 'datum')::date, current_date);
  v_ha    numeric;
  m       jsonb;
  v_masch uuid := nullif(p ->> 'beobachtung_an_maschine', '')::uuid;
  v_mitarb uuid := nullif(p ->> 'mitarbeiter_id', '')::uuid;
  v_offen text;
begin
  if not darf_erfassen() then raise exception 'Keine Berechtigung'; end if;
  select * into v_a from feldarbeiten where id = p_id and betrieb_id = mein_betrieb() and geloescht_am is null for update;
  if not found then raise exception 'Arbeit nicht gefunden'; end if;
  if v_a.status <> 'geplant' then raise exception 'Diese Arbeit ist bereits erledigt'; end if;
  if v_datum > current_date then raise exception 'Das Datum der Erledigung liegt in der Zukunft'; end if;
  v_offen := offene_vorgaengerin(p_id);
  if v_offen is not null then raise exception 'Zuerst die vorherige Arbeit «%» erledigen', v_offen; end if;
  if exists (select 1 from auftraege where feldarbeit_id = p_id and status not in ('Erledigt', 'Abgebrochen')) then
    raise exception 'Zu dieser Arbeit läuft ein Lohnauftrag. Bitte den Auftrag abschliessen.';
  end if;
  if v_mitarb is not null and not exists (select 1 from mitarbeiter where id = v_mitarb and betrieb_id = mein_betrieb()) then
    raise exception 'Unbekannte Person';
  end if;

  update feldarbeiten set
    status = 'erledigt', datum = v_datum,
    dauer_h = coalesce(nullif(p ->> 'dauer_h', '')::numeric, dauer_h),
    maschine_stunden = nullif(p ->> 'maschine_stunden', '')::numeric,
    maschine_km = nullif(p ->> 'maschine_km', '')::numeric,
    geraet_stunden = nullif(p ->> 'geraet_stunden', '')::numeric,
    beobachtung = nullif(trim(p ->> 'beobachtung'), ''),
    mitarbeiter_id = coalesce(v_mitarb, mitarbeiter_id, ich_mitarbeiter()),
    ausgefuehrt_von = coalesce(ausgefuehrt_von, auth.uid())
  where id = p_id;

  update feldarbeit_felder ff set anbau_id = (
    select a.id from anbau a where a.feld_id = ff.feld_id and a.jahr = extract(year from v_datum)::int and a.art = 'Hauptkultur')
  where ff.feldarbeit_id = p_id;

  select sum(flaeche_m2) / 10000 into v_ha from feldarbeit_felder where feldarbeit_id = p_id;
  for m in select * from jsonb_array_elements(coalesce(p -> 'mittel', '[]')) loop
    if nullif(m ->> 'gesamtmenge', '') is null then continue; end if;
    if (m ->> 'gesamtmenge')::numeric <= 0 then
      delete from feldarbeit_mittel where feldarbeit_id = p_id and artikel_id = (m ->> 'artikel_id')::uuid;
    else
      update feldarbeit_mittel set gesamtmenge = round((m ->> 'gesamtmenge')::numeric, 3),
                                   menge_je_ha = round((m ->> 'gesamtmenge')::numeric / v_ha, 4)
       where feldarbeit_id = p_id and artikel_id = (m ->> 'artikel_id')::uuid;
    end if;
  end loop;

  if v_a.maschine_id is not null then
    perform zaehler_nachfuehren(v_a.maschine_id, nullif(p ->> 'maschine_stunden', '')::numeric, nullif(p ->> 'maschine_km', '')::numeric);
  end if;
  if v_a.geraet_id is not null then
    perform zaehler_nachfuehren(v_a.geraet_id, nullif(p ->> 'geraet_stunden', '')::numeric, null);
  end if;

  if v_masch is not null and nullif(trim(p ->> 'beobachtung'), '') is not null then
    if not exists (select 1 from maschinen where id = v_masch and betrieb_id = mein_betrieb()) then
      raise exception 'Unbekannte Maschine';
    end if;
    insert into maschinen_eintraege (betrieb_id, maschine_id, art, datum, betriebsstunden, kilometerstand, titel, beschreibung, offen)
    values (mein_betrieb(), v_masch, 'Beobachtung', v_datum,
            case when v_masch = v_a.maschine_id then nullif(p ->> 'maschine_stunden', '')::numeric else nullif(p ->> 'geraet_stunden', '')::numeric end,
            case when v_masch = v_a.maschine_id then nullif(p ->> 'maschine_km', '')::numeric end,
            left(trim(p ->> 'beobachtung'), 80), 'Bei ' || v_a.arbeitsart || ' am ' || to_char(v_datum, 'DD.MM.YYYY') || ': ' || trim(p ->> 'beobachtung'),
            true);
  end if;

  perform feldarbeit_buchen(p_id);
end $$;

-- ---------------------------------------------------------------------
-- auftrag_speichern: optional mit geplanter Feldarbeit (Lohnarbeit) bzw. Aufgabe (Werkstatt)
-- ---------------------------------------------------------------------
create or replace function public.auftrag_speichern(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  v_id      uuid := nullif(p ->> 'id', '')::uuid;
  v_jahr    text := to_char(current_date, 'YYYY');
  v_nr      text;
  v_fa      uuid := nullif(p ->> 'feldarbeit_id', '')::uuid;
  v_aufgabe uuid := nullif(p ->> 'aufgabe_id', '')::uuid;
  x         jsonb;
begin
  if v_betrieb is null or not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  if not exists (select 1 from partner where id = (p ->> 'partner_id')::uuid and betrieb_id = v_betrieb) then
    raise exception 'Bitte einen Partner wählen';
  end if;
  if p ->> 'art' = 'Werkstatt' and not exists (
    select 1 from maschinen where id = nullif(p ->> 'maschine_id', '')::uuid and betrieb_id = v_betrieb) then
    raise exception 'Bitte eine Maschine wählen';
  end if;
  if v_fa is not null and (p ->> 'art' <> 'Lohnarbeit'
     or not exists (select 1 from feldarbeiten where id = v_fa and betrieb_id = v_betrieb and status = 'geplant' and geloescht_am is null)) then
    raise exception 'Die verknüpfte Arbeit ist nicht (mehr) geplant';
  end if;
  if v_aufgabe is not null and not exists (select 1 from aufgaben where id = v_aufgabe and betrieb_id = v_betrieb) then
    raise exception 'Unbekannte Aufgabe';
  end if;

  if v_id is null then
    perform pg_advisory_xact_lock(hashtext('auftrag-' || v_betrieb::text));
    select v_jahr || '-' || lpad((coalesce(max(split_part(nummer, '-', 2)::int), 0) + 1)::text, 3, '0') into v_nr
      from auftraege where betrieb_id = v_betrieb and nummer like v_jahr || '-%';
    insert into auftraege (betrieb_id, nummer, art, partner_id, titel, arbeitsart, maschine_id, termin_von, termin_bis, beschreibung,
                           feldarbeit_id, aufgabe_id)
    values (v_betrieb, v_nr, p ->> 'art', (p ->> 'partner_id')::uuid, trim(p ->> 'titel'), nullif(p ->> 'arbeitsart', ''),
            nullif(p ->> 'maschine_id', '')::uuid, nullif(p ->> 'termin_von', '')::date, nullif(p ->> 'termin_bis', '')::date,
            nullif(p ->> 'beschreibung', ''), v_fa, v_aufgabe)
    returning id into v_id;
  else
    update auftraege set
      partner_id = (p ->> 'partner_id')::uuid, titel = trim(p ->> 'titel'), arbeitsart = nullif(p ->> 'arbeitsart', ''),
      maschine_id = nullif(p ->> 'maschine_id', '')::uuid, termin_von = nullif(p ->> 'termin_von', '')::date,
      termin_bis = nullif(p ->> 'termin_bis', '')::date, beschreibung = nullif(p ->> 'beschreibung', ''),
      feldarbeit_id = coalesce(v_fa, feldarbeit_id), aufgabe_id = coalesce(v_aufgabe, aufgabe_id),
      version = coalesce((p ->> 'version')::int, version)
    where id = v_id and betrieb_id = v_betrieb and status not in ('Erledigt', 'Abgebrochen');
    if not found then raise exception 'Auftrag nicht gefunden oder bereits abgeschlossen'; end if;
    delete from auftrag_felder where auftrag_id = v_id;
    delete from auftrag_mittel where auftrag_id = v_id;
    delete from auftrag_beobachtungen where auftrag_id = v_id;
  end if;

  for x in select * from jsonb_array_elements(coalesce(p -> 'felder', '[]')) loop
    if not exists (select 1 from felder where id = (x #>> '{}')::uuid and betrieb_id = v_betrieb) then raise exception 'Unbekanntes Feld'; end if;
    insert into auftrag_felder (betrieb_id, auftrag_id, feld_id) values (v_betrieb, v_id, (x #>> '{}')::uuid);
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'mittel', '[]')) loop
    if nullif(x ->> 'artikel_id', '') is not null
       and not exists (select 1 from lagerartikel where id = (x ->> 'artikel_id')::uuid and betrieb_id = v_betrieb) then
      raise exception 'Unbekannter Artikel';
    end if;
    insert into auftrag_mittel (betrieb_id, auftrag_id, artikel_id, bezeichnung, kategorie, einheit, menge_je_ha, bereitstellung, bemerkung)
    values (v_betrieb, v_id, nullif(x ->> 'artikel_id', '')::uuid, nullif(trim(x ->> 'bezeichnung'), ''),
            coalesce(nullif(x ->> 'kategorie', ''), 'Saatgut'), nullif(x ->> 'einheit', ''), nullif(x ->> 'menge_je_ha', '')::numeric,
            coalesce(nullif(x ->> 'bereitstellung', ''), 'Betrieb'), nullif(x ->> 'bemerkung', ''));
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'beobachtungen', '[]')) loop
    if not exists (select 1 from maschinen_eintraege where id = (x #>> '{}')::uuid and betrieb_id = v_betrieb) then
      raise exception 'Unbekannte Beobachtung';
    end if;
    insert into auftrag_beobachtungen (betrieb_id, auftrag_id, eintrag_id) values (v_betrieb, v_id, (x #>> '{}')::uuid);
  end loop;

  -- Lohnunternehmen bei der geplanten Arbeit eintragen
  if v_fa is not null then
    update feldarbeiten set partner_id = (p ->> 'partner_id')::uuid where id = v_fa;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- auftrag_abschliessen: geplante Arbeit erledigen statt neue anlegen; Aufgabe mit abschliessen
-- ---------------------------------------------------------------------
create or replace function public.auftrag_abschliessen(p_id uuid, p_datum date, p_kosten numeric default null, p_bemerkung text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_a       auftraege%rowtype;
  v_fa      feldarbeiten%rowtype;
  v_mittel  jsonb := '[]';
  v_artikel uuid;
  m         auftrag_mittel%rowtype;
  v_ziel    uuid;
  v_offen   text;
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  select * into v_a from auftraege where id = p_id and betrieb_id = mein_betrieb() for update;
  if not found then raise exception 'Auftrag nicht gefunden'; end if;
  if v_a.status in ('Erledigt', 'Abgebrochen') then raise exception 'Auftrag ist bereits abgeschlossen'; end if;
  if p_datum is null or p_datum > current_date then raise exception 'Erledigt-Datum fehlt oder liegt in der Zukunft'; end if;

  if v_a.art = 'Lohnarbeit' then
    if not exists (select 1 from auftrag_felder where auftrag_id = p_id) then raise exception 'Der Auftrag hat keine Felder'; end if;
    if v_a.feldarbeit_id is not null then
      v_offen := offene_vorgaengerin(v_a.feldarbeit_id);
      if v_offen is not null then raise exception 'Zuerst die vorherige Arbeit «%» erledigen', v_offen; end if;
      select * into v_fa from feldarbeiten where id = v_a.feldarbeit_id and status = 'geplant' and geloescht_am is null;
    end if;
    for m in select * from auftrag_mittel where auftrag_id = p_id and menge_je_ha is not null loop
      v_artikel := m.artikel_id;
      if v_artikel is null then
        select id into v_artikel from lagerartikel
         where betrieb_id = v_a.betrieb_id and lower(bezeichnung) = lower(m.bezeichnung) limit 1;
        if v_artikel is null then
          insert into lagerartikel (betrieb_id, bezeichnung, kategorie, einheit, lagerfuehrung, bemerkungen)
          values (v_a.betrieb_id, m.bezeichnung, m.kategorie, coalesce(nullif(m.einheit, ''), 'kg'), false,
                  'Vom Dienstleister gestellt (Auftrag ' || v_a.nummer || ')')
          returning id into v_artikel;
        end if;
      end if;
      v_mittel := v_mittel || jsonb_build_object('artikel_id', v_artikel, 'menge_je_ha', m.menge_je_ha,
                                                 'vom_lager', m.bereitstellung = 'Betrieb');
    end loop;
    v_ziel := feldarbeit_speichern(jsonb_build_object(
      'id', v_fa.id, 'version', v_fa.version,
      'datum', p_datum, 'arbeitsart', coalesce(v_a.arbeitsart, v_fa.arbeitsart, 'Andere'), 'status', 'erledigt',
      'partner_id', v_a.partner_id, 'maschine_id', v_fa.maschine_id, 'geraet_id', v_fa.geraet_id,
      'mitarbeiter_id', v_fa.mitarbeiter_id, 'vorgaenger_id', v_fa.vorgaenger_id, 'dauer_h', v_fa.dauer_h,
      'ausgefuehrt_von', v_fa.ausgefuehrt_von, 'ausbringung', v_fa.ausbringung,
      'bemerkungen', concat_ws(' · ', 'Auftrag ' || v_a.nummer, nullif(v_fa.bemerkungen, ''), nullif(p_bemerkung, '')),
      'felder', (select jsonb_agg(jsonb_build_object('feld_id', feld_id)) from auftrag_felder where auftrag_id = p_id),
      'mittel', v_mittel));
    update auftraege set status = 'Erledigt', erledigt_am = p_datum, feldarbeit_id = v_ziel where id = p_id;
  else
    insert into maschinen_eintraege (betrieb_id, maschine_id, art, datum, titel, beschreibung, kosten, partner_id)
    values (v_a.betrieb_id, v_a.maschine_id, 'Reparatur', p_datum, v_a.titel,
            concat_ws(E'\n', 'Werkstattauftrag ' || v_a.nummer, v_a.beschreibung, nullif(p_bemerkung, '')), p_kosten, v_a.partner_id)
    returning id into v_ziel;
    update maschinen_eintraege set offen = false
     where id in (select eintrag_id from auftrag_beobachtungen where auftrag_id = p_id);
    update auftraege set status = 'Erledigt', erledigt_am = p_datum, eintrag_id = v_ziel where id = p_id;
  end if;

  if v_a.aufgabe_id is not null then
    update aufgaben set status = 'erledigt', erledigt_am = p_datum, erledigt_von = auth.uid(),
                        eintrag_id = case when v_a.art = 'Werkstatt' then v_ziel end,
                        ergebnis = concat_ws(' · ', 'Auftrag ' || v_a.nummer, nullif(p_bemerkung, ''))
     where id = v_a.aufgabe_id and status = 'offen';
  end if;
  return v_ziel;
end $$;

-- ---------------------------------------------------------------------
-- aufgabe_erledigen: Person festhalten; nicht erledigen, solange ein Auftrag dazu läuft
-- ---------------------------------------------------------------------
create or replace function public.aufgabe_erledigen(p_id uuid, p jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v       aufgaben%rowtype;
  v_datum date := coalesce((p ->> 'datum')::date, current_date);
  v_eintrag uuid;
  v_mitarb uuid := nullif(p ->> 'mitarbeiter_id', '')::uuid;
begin
  if not darf_erfassen() then raise exception 'Keine Berechtigung'; end if;
  select * into v from aufgaben where id = p_id and betrieb_id = mein_betrieb() for update;
  if not found then raise exception 'Aufgabe nicht gefunden'; end if;
  if v.status = 'erledigt' then raise exception 'Aufgabe ist bereits erledigt'; end if;
  if v_datum > current_date then raise exception 'Das Datum der Erledigung liegt in der Zukunft'; end if;
  if exists (select 1 from auftraege where aufgabe_id = p_id and status not in ('Erledigt', 'Abgebrochen')) then
    raise exception 'Zu dieser Aufgabe läuft ein Auftrag. Bitte den Auftrag abschliessen.';
  end if;
  if v_mitarb is not null and not exists (select 1 from mitarbeiter where id = v_mitarb and betrieb_id = mein_betrieb()) then
    raise exception 'Unbekannte Person';
  end if;

  if v.art = 'Maschine' then
    v_eintrag := maschineneintrag_speichern(jsonb_build_object(
      'maschine_id', v.maschine_id, 'art', v.eintragsart, 'datum', v_datum, 'titel', v.titel,
      'beschreibung', concat_ws(E'\n', nullif(v.bemerkungen, ''), nullif(trim(p ->> 'ergebnis'), '')),
      'betriebsstunden', nullif(p ->> 'betriebsstunden', ''), 'kosten', nullif(p ->> 'kosten', ''),
      'arbeitszeit_h', nullif(p ->> 'dauer_h', ''), 'partner_id', coalesce(nullif(p ->> 'partner_id', ''), v.partner_id::text),
      'offen', coalesce((p ->> 'noch_offen')::boolean, false)));
    update maschinen_eintraege set kilometerstand = nullif(p ->> 'kilometerstand', '')::numeric where id = v_eintrag;
    perform zaehler_nachfuehren(v.maschine_id, nullif(p ->> 'betriebsstunden', '')::numeric, nullif(p ->> 'kilometerstand', '')::numeric);
    if v.beobachtung_id is not null and coalesce((p ->> 'beobachtung_schliessen')::boolean, true) then
      update maschinen_eintraege set offen = false where id = v.beobachtung_id;
    end if;
  end if;

  update aufgaben set
    status = 'erledigt', erledigt_am = v_datum, erledigt_von = auth.uid(),
    mitarbeiter_id = coalesce(v_mitarb, mitarbeiter_id, ich_mitarbeiter()),
    dauer_h = nullif(p ->> 'dauer_h', '')::numeric, ergebnis = nullif(trim(p ->> 'ergebnis'), ''), eintrag_id = v_eintrag
  where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- Stunden je Person und Jahr (Feldarbeiten und Aufgaben)
-- ---------------------------------------------------------------------
create view public.mitarbeiter_stunden with (security_invoker = true) as
select m.id as mitarbeiter_id, m.betrieb_id, x.jahr, sum(x.stunden) as stunden, sum(x.anzahl) as anzahl
from public.mitarbeiter m
join (
  select mitarbeiter_id, extract(year from datum)::int as jahr, coalesce(dauer_h, 0) as stunden, 1 as anzahl
    from public.feldarbeiten where status = 'erledigt' and geloescht_am is null and mitarbeiter_id is not null
  union all
  select mitarbeiter_id, extract(year from erledigt_am)::int, coalesce(dauer_h, 0), 1
    from public.aufgaben where status = 'erledigt' and mitarbeiter_id is not null
) x on x.mitarbeiter_id = m.id
group by m.id, m.betrieb_id, x.jahr;
grant select on public.mitarbeiter_stunden to authenticated;

revoke all on function public.offene_vorgaengerin(uuid) from public, anon;
grant execute on function public.offene_vorgaengerin(uuid) to authenticated;

-- ===== 20261102000014_verkauf_fotos.sql =====
-- =====================================================================
-- Migration 14: Materialverkauf mit Rechnung und Quittung, Fotos zu Maschinen und Beobachtungen
-- =====================================================================

-- ---------------------------------------------------------------------
-- Betriebsangaben für Rechnungen (QR-Rechnung braucht Adresse und IBAN)
-- ---------------------------------------------------------------------
alter table public.betriebe add column strasse text;
alter table public.betriebe add column hausnummer text;
alter table public.betriebe add column plz text check (plz is null or plz ~ '^[0-9]{4}$');
alter table public.betriebe add column ort text;
alter table public.betriebe add column iban text check (iban is null or iban ~ '^(CH|LI)[0-9]{2}[0-9A-Z]{17}$');
alter table public.betriebe add column mwst_nr text;
alter table public.betriebe add column zahlungsfrist_tage integer not null default 30 check (zahlungsfrist_tage between 0 and 120);

-- ---------------------------------------------------------------------
-- Verkäufe (Belege) und Positionen
-- ---------------------------------------------------------------------
create table public.verkaeufe (
  id            uuid primary key default gen_random_uuid(),
  betrieb_id    uuid not null references public.betriebe (id),
  nummer        text not null,                       -- z. B. 2026-007
  art           text not null check (art in ('Rechnung', 'Quittung')),
  datum         date not null,
  partner_id    uuid references public.partner (id),
  kunde_name    text,                                -- falls kein Partner
  kunde_adresse text,
  zahlungsart   text check (zahlungsart in ('Bar', 'TWINT', 'Überweisung', 'Andere')),
  faellig_am    date,
  bezahlt       boolean not null default false,
  bezahlt_am    date,
  mwst_satz     numeric(4, 2) check (mwst_satz between 0 and 20),  -- leer = ohne MWST
  total_chf     numeric(12, 2) not null default 0,
  bemerkungen   text,
  storniert     boolean not null default false,
  erstellt_von  uuid default auth.uid(),
  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz not null default now(),
  version       integer not null default 1,
  unique (betrieb_id, nummer),
  check (partner_id is not null or length(trim(coalesce(kunde_name, ''))) > 0)
);
create index on public.verkaeufe (betrieb_id, datum desc);

create table public.verkauf_positionen (
  id                uuid primary key default gen_random_uuid(),
  betrieb_id        uuid not null references public.betriebe (id),
  verkauf_id        uuid not null references public.verkaeufe (id) on delete cascade,
  position          integer not null,
  bezeichnung       text not null check (length(trim(bezeichnung)) > 0),
  menge             numeric(14, 3) not null check (menge > 0),
  einheit           text not null,
  preis_je_einheit  numeric(12, 4) not null check (preis_je_einheit >= 0),
  betrag            numeric(12, 2) not null,
  artikel_id        uuid references public.lagerartikel (id),
  vom_lager         boolean not null default false,
  -- Verkauf aus der Ernte; die Prüfung erfolgt am Transaktionsende, damit Ernten neu gespeichert werden können.
  -- Eine verrechnete Abgabe kann erst nach dem Stornieren des Belegs gelöscht werden.
  ernte_abnehmer_id uuid references public.ernte_abnehmer (id) deferrable initially deferred
);
create unique index verkauf_ernte_einmal on public.verkauf_positionen (ernte_abnehmer_id) where ernte_abnehmer_id is not null;

create trigger a_version before update on public.verkaeufe for each row execute function public.pruefe_version();
create trigger b_metadaten before insert or update on public.verkaeufe for each row execute function public.setze_metadaten();
create trigger z_protokoll after insert or update or delete on public.verkaeufe for each row execute function public.protokolliere();
create trigger z_protokoll after insert or update or delete on public.verkauf_positionen for each row execute function public.protokolliere();

alter table public.verkaeufe          enable row level security;
alter table public.verkauf_positionen enable row level security;
create policy vk_lesen on public.verkaeufe          for select using (betrieb_id = public.mein_betrieb());
create policy vp_lesen on public.verkauf_positionen for select using (betrieb_id = public.mein_betrieb());
grant select on public.verkaeufe, public.verkauf_positionen to authenticated;

-- ---------------------------------------------------------------------
-- Beleg speichern
-- p: {"id"?, "version"?, "art", "datum", "partner_id"?, "kunde_name"?, "kunde_adresse"?, "zahlungsart"?, "faellig_am"?,
--     "mwst_satz"?, "bemerkungen"?,
--     "positionen": [{"bezeichnung", "menge", "einheit", "preis_je_einheit", "artikel_id"?, "vom_lager"?, "ernte_abnehmer_id"?}]}
-- Positionen «vom Lager» buchen einen Ausgang (Art «Verkauf»). Eine Quittung ist sofort bezahlt.
-- ---------------------------------------------------------------------
create or replace function public.verkauf_speichern(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  v_id      uuid := nullif(p ->> 'id', '')::uuid;
  v_datum   date := (p ->> 'datum')::date;
  v_art     text := p ->> 'art';
  v_jahr    text;
  v_nr      text;
  v_total   numeric := 0;
  v_betrag  numeric;
  v_pos     uuid;
  v_artikel lagerartikel%rowtype;
  v_menge   numeric;
  x         jsonb;
  i         int := 0;
begin
  if v_betrieb is null or not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  if v_datum is null then raise exception 'Datum fehlt'; end if;
  if v_art not in ('Rechnung', 'Quittung') then raise exception 'Ungültige Belegart'; end if;
  if nullif(p ->> 'partner_id', '') is not null
     and not exists (select 1 from partner where id = (p ->> 'partner_id')::uuid and betrieb_id = v_betrieb) then
    raise exception 'Unbekannter Kunde';
  end if;
  if jsonb_array_length(coalesce(p -> 'positionen', '[]')) = 0 then raise exception 'Bitte mindestens eine Position erfassen'; end if;

  if v_id is null then
    v_jahr := to_char(v_datum, 'YYYY');
    perform pg_advisory_xact_lock(hashtext('verkauf-' || v_betrieb::text));
    select v_jahr || '-' || lpad((coalesce(max(split_part(nummer, '-', 2)::int), 0) + 1)::text, 3, '0') into v_nr
      from verkaeufe where betrieb_id = v_betrieb and nummer like v_jahr || '-%';
    insert into verkaeufe (betrieb_id, nummer, art, datum, partner_id, kunde_name, kunde_adresse, zahlungsart, faellig_am,
                           bezahlt, bezahlt_am, mwst_satz, bemerkungen)
    values (v_betrieb, v_nr, v_art, v_datum, nullif(p ->> 'partner_id', '')::uuid, nullif(trim(p ->> 'kunde_name'), ''),
            nullif(trim(p ->> 'kunde_adresse'), ''), nullif(p ->> 'zahlungsart', ''), nullif(p ->> 'faellig_am', '')::date,
            v_art = 'Quittung', case when v_art = 'Quittung' then v_datum end,
            nullif(p ->> 'mwst_satz', '')::numeric, nullif(trim(p ->> 'bemerkungen'), ''))
    returning id into v_id;
  else
    update verkaeufe set
      art = v_art, datum = v_datum, partner_id = nullif(p ->> 'partner_id', '')::uuid,
      kunde_name = nullif(trim(p ->> 'kunde_name'), ''), kunde_adresse = nullif(trim(p ->> 'kunde_adresse'), ''),
      zahlungsart = nullif(p ->> 'zahlungsart', ''), faellig_am = nullif(p ->> 'faellig_am', '')::date,
      bezahlt = bezahlt or v_art = 'Quittung', bezahlt_am = coalesce(bezahlt_am, case when v_art = 'Quittung' then v_datum end),
      mwst_satz = nullif(p ->> 'mwst_satz', '')::numeric, bemerkungen = nullif(trim(p ->> 'bemerkungen'), ''),
      version = coalesce((p ->> 'version')::int, version)
    where id = v_id and betrieb_id = v_betrieb and not storniert;
    if not found then raise exception 'Beleg nicht gefunden oder storniert'; end if;
    delete from lagerbewegungen where quelle_typ = 'verkauf' and quelle_id in (select id from verkauf_positionen where verkauf_id = v_id);
    delete from verkauf_positionen where verkauf_id = v_id;
  end if;

  for x in select * from jsonb_array_elements(p -> 'positionen') loop
    i := i + 1;
    v_menge := (x ->> 'menge')::numeric;
    v_betrag := round(v_menge * (x ->> 'preis_je_einheit')::numeric, 2);
    v_total := v_total + v_betrag;
    v_artikel := null;
    if nullif(x ->> 'artikel_id', '') is not null then
      select * into v_artikel from lagerartikel where id = (x ->> 'artikel_id')::uuid and betrieb_id = v_betrieb;
      if not found then raise exception 'Unbekannter Artikel'; end if;
    end if;
    if nullif(x ->> 'ernte_abnehmer_id', '') is not null
       and not exists (select 1 from ernte_abnehmer where id = (x ->> 'ernte_abnehmer_id')::uuid and betrieb_id = v_betrieb) then
      raise exception 'Unbekannte Ernte-Abgabe';
    end if;
    insert into verkauf_positionen (betrieb_id, verkauf_id, position, bezeichnung, menge, einheit, preis_je_einheit, betrag,
                                    artikel_id, vom_lager, ernte_abnehmer_id)
    values (v_betrieb, v_id, i, trim(x ->> 'bezeichnung'), v_menge, coalesce(nullif(x ->> 'einheit', ''), v_artikel.einheit, 'Stk'),
            (x ->> 'preis_je_einheit')::numeric, v_betrag, v_artikel.id,
            coalesce(v_artikel.id is not null and coalesce((x ->> 'vom_lager')::boolean, true) and v_artikel.lagerfuehrung, false),
            nullif(x ->> 'ernte_abnehmer_id', '')::uuid)
    returning id into v_pos;
    if v_artikel.id is not null and coalesce((x ->> 'vom_lager')::boolean, true) and v_artikel.lagerfuehrung then
      insert into lagerbewegungen (betrieb_id, artikel_id, datum, art, menge, preis_je_einheit, quelle_typ, quelle_id, bemerkung)
      select v_betrieb, v_artikel.id, v_datum, 'Verkauf', -v_menge, (x ->> 'preis_je_einheit')::numeric, 'verkauf', v_pos,
             v_art || ' ' || nummer from verkaeufe where id = v_id;
    end if;
  end loop;

  update verkaeufe set total_chf = round(v_total * (1 + coalesce(mwst_satz, 0) / 100), 2) where id = v_id;
  -- Verkaufte Ernte-Abgaben: Preis übernehmen, Zahlungsstatus angleichen
  update ernte_abnehmer a set preis_chf = vp.betrag, bezahlt = v.bezahlt
    from verkauf_positionen vp join verkaeufe v on v.id = vp.verkauf_id
   where vp.verkauf_id = v_id and a.id = vp.ernte_abnehmer_id;
  return v_id;
end $$;

create or replace function public.verkauf_bezahlt(p_id uuid, p_bezahlt boolean, p_datum date default current_date)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  update verkaeufe set bezahlt = p_bezahlt, bezahlt_am = case when p_bezahlt then coalesce(p_datum, current_date) end
   where id = p_id and betrieb_id = mein_betrieb() and not storniert;
  if not found then raise exception 'Beleg nicht gefunden oder storniert'; end if;
  update ernte_abnehmer a set bezahlt = p_bezahlt
    from verkauf_positionen vp where vp.verkauf_id = p_id and a.id = vp.ernte_abnehmer_id;
end $$;

-- Stornieren: Nummer bleibt erhalten, Lagerbuchungen und Verknüpfungen zur Ernte werden aufgehoben
create or replace function public.verkauf_stornieren(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  update verkaeufe set storniert = true where id = p_id and betrieb_id = mein_betrieb() and not storniert;
  if not found then raise exception 'Beleg nicht gefunden oder bereits storniert'; end if;
  delete from lagerbewegungen where quelle_typ = 'verkauf' and quelle_id in (select id from verkauf_positionen where verkauf_id = p_id);
  update verkauf_positionen set ernte_abnehmer_id = null where verkauf_id = p_id;
end $$;

revoke all on function public.verkauf_speichern(jsonb), public.verkauf_bezahlt(uuid, boolean, date), public.verkauf_stornieren(uuid) from public, anon;
grant execute on function public.verkauf_speichern(jsonb), public.verkauf_bezahlt(uuid, boolean, date), public.verkauf_stornieren(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Ernte: Abgaben behalten beim erneuten Speichern ihre ID (damit Belege verknüpft bleiben)
-- ---------------------------------------------------------------------
create or replace function public.ernte_speichern(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  v_id      uuid := nullif(p ->> 'id', '')::uuid;
  v_feld    felder%rowtype;
  v_datum   date := (p ->> 'datum')::date;
  v_produkte uuid[] := '{}';
  v_prod    ernte_produkte%rowtype;
  v_abn     uuid;
  v_idx     int;
  v_artikel lagerartikel%rowtype;
  v_ort     hofobjekte%rowtype;
  v_name    text;
  v_einheit text;
  v_menge   numeric;
  v_ballen  int;
  v_kg      numeric;
  x         jsonb;
  i         int := 0;
begin
  if v_betrieb is null or not darf_erfassen() then raise exception 'Keine Berechtigung'; end if;
  select * into v_feld from felder where id = (p ->> 'feld_id')::uuid and betrieb_id = v_betrieb;
  if not found then raise exception 'Unbekanntes Feld'; end if;
  if v_datum is null or v_datum > current_date then raise exception 'Erntedatum fehlt oder liegt in der Zukunft'; end if;
  if jsonb_array_length(coalesce(p -> 'produkte', '[]')) = 0 then raise exception 'Bitte mindestens ein Produkt erfassen'; end if;

  if v_id is null then
    insert into ernten (betrieb_id, feld_id, anbau_id, datum, schnitt, flaeche_m2, bemerkungen)
    values (v_betrieb, v_feld.id,
            (select id from anbau where feld_id = v_feld.id and jahr = extract(year from v_datum)::int and art = 'Hauptkultur'),
            v_datum, nullif(p ->> 'schnitt', '')::int, coalesce(nullif(p ->> 'flaeche_m2', '')::numeric, v_feld.flaeche_m2),
            nullif(p ->> 'bemerkungen', ''))
    returning id into v_id;
  else
    if not darf_verwalten() and not exists (select 1 from ernten where id = v_id and erstellt_von = auth.uid()) then
      raise exception 'Nur eigene Einträge können geändert werden';
    end if;
    update ernten set
      feld_id = v_feld.id, datum = v_datum, schnitt = nullif(p ->> 'schnitt', '')::int,
      flaeche_m2 = coalesce(nullif(p ->> 'flaeche_m2', '')::numeric, v_feld.flaeche_m2),
      bemerkungen = nullif(p ->> 'bemerkungen', ''),
      anbau_id = (select id from anbau where feld_id = v_feld.id and jahr = extract(year from v_datum)::int and art = 'Hauptkultur'),
      version = coalesce((p ->> 'version')::int, version)
    where id = v_id and betrieb_id = v_betrieb;
    if not found then raise exception 'Ernte nicht gefunden'; end if;
    perform ernte_lagerbuchungen_entfernen(v_id);
    delete from ernte_abnehmer where ernte_id = v_id;
    delete from ernte_produkte where ernte_id = v_id;
    delete from ernte_dienstleister where ernte_id = v_id;
  end if;

  -- Produkte
  for x in select * from jsonb_array_elements(p -> 'produkte') loop
    i := i + 1;
    if nullif(x ->> 'ballen', '') is null and nullif(x ->> 'menge_kg', '') is null then
      raise exception 'Bei «%» bitte Anzahl Ballen oder Gewicht angeben', x ->> 'produkt';
    end if;
    insert into ernte_produkte (betrieb_id, ernte_id, position, produkt, ballen, ballenart, menge_kg, feuchte_prozent, qualitaet)
    values (v_betrieb, v_id, i, x ->> 'produkt', nullif(x ->> 'ballen', '')::int,
            case when nullif(x ->> 'ballen', '') is not null then nullif(x ->> 'ballenart', '') end,
            nullif(x ->> 'menge_kg', '')::numeric, nullif(x ->> 'feuchte_prozent', '')::numeric, nullif(x ->> 'qualitaet', ''))
    returning id into v_abn;
    v_produkte := v_produkte || v_abn;
  end loop;

  -- Dienstleister
  for x in select * from jsonb_array_elements(coalesce(p -> 'dienstleister', '[]')) loop
    if not exists (select 1 from partner where id = (x ->> 'partner_id')::uuid and betrieb_id = v_betrieb) then
      raise exception 'Unbekannter Dienstleister';
    end if;
    insert into ernte_dienstleister (betrieb_id, ernte_id, partner_id, leistung, kosten_chf, bemerkung)
    values (v_betrieb, v_id, (x ->> 'partner_id')::uuid, coalesce(nullif(x ->> 'leistung', ''), 'Ernte'),
            nullif(x ->> 'kosten_chf', '')::numeric, nullif(x ->> 'bemerkung', ''));
  end loop;

  -- Abnehmer
  for x in select * from jsonb_array_elements(coalesce(p -> 'abnehmer', '[]')) loop
    v_idx := coalesce(nullif(x ->> 'produkt_index', '')::int, 0) + 1;
    if v_idx < 1 or v_idx > cardinality(v_produkte) then raise exception 'Abgabe ohne gültiges Produkt'; end if;
    select * into v_prod from ernte_produkte where id = v_produkte[v_idx];
    if nullif(x ->> 'partner_id', '') is not null
       and not exists (select 1 from partner where id = (x ->> 'partner_id')::uuid and betrieb_id = v_betrieb) then
      raise exception 'Unbekannter Partner';
    end if;
    v_ballen := nullif(x ->> 'ballen', '')::int;
    v_kg := nullif(x ->> 'menge_kg', '')::numeric;
    v_artikel := null;
    v_ort := null;

    if x ->> 'art' = 'Lager' then
      if nullif(x ->> 'lagerort_id', '') is not null then
        select * into v_ort from hofobjekte where id = (x ->> 'lagerort_id')::uuid and betrieb_id = v_betrieb;
        if not found then raise exception 'Unbekannter Lagerort'; end if;
      end if;
      if nullif(x ->> 'lagerartikel_id', '') is not null then
        select * into v_artikel from lagerartikel where id = (x ->> 'lagerartikel_id')::uuid and betrieb_id = v_betrieb;
        if not found then raise exception 'Unbekannter Lagerartikel'; end if;
      else
        v_einheit := case when v_ballen is not null then 'Ballen' else 'kg' end;
        v_name := v_prod.produkt || coalesce(' ' || case when v_ballen is not null then v_prod.ballenart end, '')
                  || ' ' || extract(year from v_datum)::int || coalesce(' – ' || v_ort.name, '');
        select * into v_artikel from lagerartikel
         where betrieb_id = v_betrieb and bezeichnung = v_name and einheit = v_einheit and aktiv limit 1;
        if not found then
          insert into lagerartikel (betrieb_id, bezeichnung, kategorie, einheit, lagerort, bemerkungen)
          values (v_betrieb, v_name, 'Erzeugnisse', v_einheit, v_ort.name, 'Aus der Ernte angelegt')
          returning * into v_artikel;
        end if;
      end if;
      v_menge := case v_artikel.einheit
                   when 'Ballen' then v_ballen
                   when 'Stk' then v_ballen
                   when 'kg' then v_kg
                   when 't' then v_kg / 1000
                 end;
      if v_menge is null or v_menge <= 0 then
        raise exception 'Für die Einlagerung in «%» (Einheit %) fehlt die Menge in %', v_artikel.bezeichnung, v_artikel.einheit,
          case when v_artikel.einheit in ('Ballen', 'Stk') then 'Ballen' else 'kg' end;
      end if;
    end if;

    insert into ernte_abnehmer (id, betrieb_id, ernte_id, produkt_id, partner_id, art, ballen, menge_kg, preis_chf, preis_einheit, bezahlt,
                                bemerkung, lagerartikel_id, lagerort_id)
    values (coalesce(nullif(x ->> 'id', '')::uuid, gen_random_uuid()),
            v_betrieb, v_id, v_prod.id, nullif(x ->> 'partner_id', '')::uuid, coalesce(nullif(x ->> 'art', ''), 'Verkauf'),
            v_ballen, v_kg, nullif(x ->> 'preis_chf', '')::numeric, nullif(x ->> 'preis_einheit', ''),
            coalesce((x ->> 'bezahlt')::boolean, false), nullif(x ->> 'bemerkung', ''), v_artikel.id, v_ort.id)
    returning id into v_abn;

    if x ->> 'art' = 'Lager' then
      insert into lagerbewegungen (betrieb_id, artikel_id, datum, art, menge, quelle_typ, quelle_id, bemerkung)
      values (v_betrieb, v_artikel.id, v_datum, 'Ernte', v_menge, 'ernte_abgabe', v_abn,
              'Ernte ' || v_feld.name || coalesce(', ' || v_ort.name, ''));
    end if;
  end loop;

  -- Abgaben je Produkt dürfen die Ernte nicht übersteigen
  for v_prod in select * from ernte_produkte where ernte_id = v_id loop
    select sum(ballen), sum(menge_kg) into v_ballen, v_kg from ernte_abnehmer where produkt_id = v_prod.id;
    if v_prod.ballen is not null and coalesce(v_ballen, 0) > v_prod.ballen then
      raise exception 'Bei «%» wurden mehr Ballen abgegeben (%) als geerntet (%)', v_prod.produkt, v_ballen, v_prod.ballen;
    end if;
    if v_prod.menge_kg is not null and coalesce(v_kg, 0) > v_prod.menge_kg * 1.001 then
      raise exception 'Bei «%» wurde mehr Gewicht abgegeben (% kg) als geerntet (% kg)', v_prod.produkt, v_kg, v_prod.menge_kg;
    end if;
  end loop;
  if exists (select 1 from verkauf_positionen vp where vp.betrieb_id = v_betrieb and vp.ernte_abnehmer_id is not null
               and not exists (select 1 from ernte_abnehmer a where a.id = vp.ernte_abnehmer_id)) then
    raise exception 'Eine bereits verrechnete Abgabe wurde entfernt. Bitte zuerst den Beleg stornieren.';
  end if;
  return v_id;
end $$;


create or replace function public.ernte_loeschen(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not darf_verwalten() and not exists (select 1 from ernten where id = p_id and erstellt_von = auth.uid() and betrieb_id = mein_betrieb()) then
    raise exception 'Keine Berechtigung';
  end if;
  if not exists (select 1 from ernten where id = p_id and betrieb_id = mein_betrieb()) then raise exception 'Ernte nicht gefunden'; end if;
  if exists (select 1 from verkauf_positionen vp join ernte_abnehmer a on a.id = vp.ernte_abnehmer_id where a.ernte_id = p_id) then
    raise exception 'Zu dieser Ernte gibt es Rechnungen oder Quittungen. Bitte zuerst den Beleg stornieren.';
  end if;
  perform ernte_lagerbuchungen_entfernen(p_id);
  delete from ernten where id = p_id;
end $$;

revoke all on function public.ernte_speichern(jsonb) from public, anon;
grant execute on function public.ernte_speichern(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Fotos (Maschinen, Wartungen/Reparaturen/Beobachtungen, Felder)
-- Dateien liegen in Supabase Storage, Bucket «fotos», Ordner = Betrieb-ID
-- ---------------------------------------------------------------------
create table public.fotos (
  id           uuid primary key default gen_random_uuid(),
  betrieb_id   uuid not null references public.betriebe (id),
  pfad         text not null unique,
  maschine_id  uuid references public.maschinen (id) on delete cascade,
  eintrag_id   uuid references public.maschinen_eintraege (id) on delete cascade,
  feld_id      uuid references public.felder (id) on delete cascade,
  beschreibung text,
  erstellt_von uuid default auth.uid(),
  erstellt_am  timestamptz not null default now(),
  check (maschine_id is not null or eintrag_id is not null or feld_id is not null),
  check (split_part(pfad, '/', 1) = betrieb_id::text)
);
create index on public.fotos (maschine_id);
create index on public.fotos (eintrag_id);
create trigger z_protokoll after insert or update or delete on public.fotos for each row execute function public.protokolliere();

alter table public.fotos enable row level security;
create policy fo_lesen    on public.fotos for select using (betrieb_id = public.mein_betrieb());
create policy fo_neu      on public.fotos for insert with check (betrieb_id = public.mein_betrieb() and public.darf_erfassen());
create policy fo_aendern  on public.fotos for update using (betrieb_id = public.mein_betrieb() and public.darf_erfassen());
create policy fo_loeschen on public.fotos for delete using (
  betrieb_id = public.mein_betrieb() and (public.darf_verwalten() or erstellt_von = auth.uid()));
grant select, insert, update, delete on public.fotos to authenticated;

-- Speicher-Bucket und Zugriffsregeln (nur wenn Supabase Storage vorhanden ist)
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('fotos', 'fotos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
    execute $p$create policy "fotos_lesen" on storage.objects for select to authenticated
      using (bucket_id = 'fotos' and (storage.foldername(name))[1] = public.mein_betrieb()::text)$p$;
    execute $p$create policy "fotos_hochladen" on storage.objects for insert to authenticated
      with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = public.mein_betrieb()::text and public.darf_erfassen())$p$;
    execute $p$create policy "fotos_loeschen" on storage.objects for delete to authenticated
      using (bucket_id = 'fotos' and (storage.foldername(name))[1] = public.mein_betrieb()::text and public.darf_erfassen())$p$;
  end if;
end $$;

-- ===== 20261102000015_arbeit_abschluss.sql =====
-- =====================================================================
-- Migration 15: Zählerstände und Beobachtung auch beim direkten Erfassen einer erledigten Arbeit
-- =====================================================================
alter table public.feldarbeiten add column beobachtung_eintrag_id uuid references public.maschinen_eintraege (id) on delete set null;

-- p: {"maschine_stunden"?, "maschine_km"?, "geraet_stunden"?, "beobachtung"?, "beobachtung_an_maschine"?: uuid}
create or replace function public.feldarbeit_abschluss(p_id uuid, p jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_a     feldarbeiten%rowtype;
  v_masch uuid := nullif(p ->> 'beobachtung_an_maschine', '')::uuid;
  v_text  text := nullif(trim(p ->> 'beobachtung'), '');
begin
  if not darf_erfassen() then raise exception 'Keine Berechtigung'; end if;
  select * into v_a from feldarbeiten where id = p_id and betrieb_id = mein_betrieb() and geloescht_am is null for update;
  if not found then raise exception 'Arbeit nicht gefunden'; end if;
  if not darf_verwalten() and v_a.erstellt_von is distinct from auth.uid() and v_a.mitarbeiter_id is distinct from ich_mitarbeiter() then
    raise exception 'Nur eigene Einträge können geändert werden';
  end if;
  if v_a.status <> 'erledigt' then return; end if;

  update feldarbeiten set
    maschine_stunden = nullif(p ->> 'maschine_stunden', '')::numeric,
    maschine_km = nullif(p ->> 'maschine_km', '')::numeric,
    geraet_stunden = nullif(p ->> 'geraet_stunden', '')::numeric,
    beobachtung = v_text
  where id = p_id;

  if v_a.maschine_id is not null then
    perform zaehler_nachfuehren(v_a.maschine_id, nullif(p ->> 'maschine_stunden', '')::numeric, nullif(p ->> 'maschine_km', '')::numeric);
  end if;
  if v_a.geraet_id is not null then
    perform zaehler_nachfuehren(v_a.geraet_id, nullif(p ->> 'geraet_stunden', '')::numeric, null);
  end if;

  -- Beobachtung als offener Punkt bei der Maschine: einmal anlegen, beim erneuten Speichern nachführen
  if v_masch is not null and v_text is not null then
    if not exists (select 1 from maschinen where id = v_masch and betrieb_id = mein_betrieb()) then raise exception 'Unbekannte Maschine'; end if;
    if v_a.beobachtung_eintrag_id is not null and exists (select 1 from maschinen_eintraege where id = v_a.beobachtung_eintrag_id) then
      update maschinen_eintraege set maschine_id = v_masch, titel = left(v_text, 80),
             beschreibung = 'Bei ' || v_a.arbeitsart || ' am ' || to_char(v_a.datum, 'DD.MM.YYYY') || ': ' || v_text
       where id = v_a.beobachtung_eintrag_id;
    else
      insert into maschinen_eintraege (betrieb_id, maschine_id, art, datum, betriebsstunden, kilometerstand, titel, beschreibung, offen)
      values (mein_betrieb(), v_masch, 'Beobachtung', v_a.datum,
              case when v_masch = v_a.maschine_id then nullif(p ->> 'maschine_stunden', '')::numeric else nullif(p ->> 'geraet_stunden', '')::numeric end,
              case when v_masch = v_a.maschine_id then nullif(p ->> 'maschine_km', '')::numeric end,
              left(v_text, 80), 'Bei ' || v_a.arbeitsart || ' am ' || to_char(v_a.datum, 'DD.MM.YYYY') || ': ' || v_text, true)
      returning id into v_masch;
      update feldarbeiten set beobachtung_eintrag_id = v_masch where id = p_id;
    end if;
  end if;
end $$;

revoke all on function public.feldarbeit_abschluss(uuid, jsonb) from public, anon;
grant execute on function public.feldarbeit_abschluss(uuid, jsonb) to authenticated;

-- ===== 20261102000016_teile_kontrolle.sql =====
-- =====================================================================
-- Migration 16: Arbeit «Wenden», Ersatz-/Verschleissteile je Maschine, Warengruppen im Lager,
-- Sorte bei der Kultur, Betriebsnummer (für Parzellenblätter und Kontrolle)
-- =====================================================================

-- Arbeitsarten und Ernte-Leistungen um «Wenden» ergänzen
alter table public.feldarbeiten drop constraint feldarbeiten_arbeitsart_check;
alter table public.feldarbeiten add constraint feldarbeiten_arbeitsart_check check (arbeitsart in (
  'Pflügen', 'Grubbern', 'Eggen', 'Säen', 'Walzen', 'Düngen', 'Pflanzenschutz',
  'Mähen', 'Zetten', 'Wenden', 'Schwaden', 'Pressen', 'Ernten', 'Mulchen', 'Hacken', 'Striegeln', 'Andere'));
alter table public.ernte_dienstleister drop constraint ernte_dienstleister_leistung_check;
alter table public.ernte_dienstleister add constraint ernte_dienstleister_leistung_check check (leistung in (
  'Mähen', 'Zetten', 'Wenden', 'Schwaden', 'Pressen', 'Wickeln', 'Dreschen', 'Häckseln', 'Roden', 'Transport', 'Ernte', 'Andere'));

-- Warengruppe als Untergruppe der Kategorie (z. B. Dünger → «Stickstoff», Ersatzteile → «Filter»)
alter table public.lagerartikel add column warengruppe text check (warengruppe is null or length(warengruppe) <= 60);

-- Sorte der Kultur (die Betriebsnummer gibt es bereits in «betriebe»)
alter table public.anbau add column sorte text check (sorte is null or length(sorte) <= 80);

-- ---------------------------------------------------------------------
-- Ersatz- und Verschleissteile je Maschine (Verweis auf Lagerartikel)
-- ---------------------------------------------------------------------
create table public.maschine_teile (
  id           uuid primary key default gen_random_uuid(),
  betrieb_id   uuid not null references public.betriebe (id),
  maschine_id  uuid not null references public.maschinen (id) on delete cascade,
  artikel_id   uuid not null references public.lagerartikel (id),
  art          text not null default 'Ersatzteil' check (art in ('Ersatzteil', 'Verschleissteil', 'Betriebsstoff')),
  einbauort    text check (einbauort is null or length(einbauort) <= 80),   -- z. B. «Messerbalken links»
  vorrat       numeric(14, 3) check (vorrat >= 0),                           -- gewünschter Vorrat für diese Maschine
  bemerkung    text,
  erstellt_am  timestamptz not null default now(),
  unique (maschine_id, artikel_id)
);
create index on public.maschine_teile (artikel_id);
create trigger z_protokoll after insert or update or delete on public.maschine_teile for each row execute function public.protokolliere();

alter table public.maschine_teile enable row level security;
create policy mt_lesen   on public.maschine_teile for select using (betrieb_id = public.mein_betrieb());
create policy mt_neu     on public.maschine_teile for insert with check (
  betrieb_id = public.mein_betrieb() and public.darf_verwalten()
  and exists (select 1 from public.maschinen m where m.id = maschine_id and m.betrieb_id = public.mein_betrieb())
  and exists (select 1 from public.lagerartikel a where a.id = artikel_id and a.betrieb_id = public.mein_betrieb()));
create policy mt_aendern on public.maschine_teile for update using (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
create policy mt_loeschen on public.maschine_teile for delete using (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
grant select, insert, update, delete on public.maschine_teile to authenticated;

-- ===== 20261102000017_verknuepfungen.sql =====
-- =====================================================================
-- Migration 17: Korrekturen an den Verknüpfungen zwischen den Modulen (Ergebnis einer Durchsicht)
-- =====================================================================

-- 1) Geplante Arbeit mit laufendem Lohnauftrag nur über den Auftrag erledigen (sonst doppelte Arbeit/Lagerbuchung)
create or replace function public.feldarbeit_auftrag_pruefen() returns trigger
language plpgsql as $$
begin
  if old.status = 'geplant' and new.status = 'erledigt'
     and coalesce(current_setting('hofmanager.auftrag_abschluss', true), '') <> 'ja'
     and exists (select 1 from public.auftraege where feldarbeit_id = new.id and status not in ('Erledigt', 'Abgebrochen')) then
    raise exception 'Zu dieser Arbeit läuft ein Lohnauftrag. Bitte den Auftrag abschliessen.';
  end if;
  return new;
end $$;
create trigger c_auftrag_pruefen before update on public.feldarbeiten for each row execute function public.feldarbeit_auftrag_pruefen();

-- 2) Gelöschte Vorgängerin gibt ihre Folgearbeiten frei
create or replace function public.feldarbeit_folgen_freigeben() returns trigger
language plpgsql as $$
begin
  if new.geloescht_am is not null and old.geloescht_am is null then
    update public.feldarbeiten set vorgaenger_id = null where vorgaenger_id = new.id;
  end if;
  return null;
end $$;
create trigger z_folgen_freigeben after update of geloescht_am on public.feldarbeiten for each row execute function public.feldarbeit_folgen_freigeben();
update public.feldarbeiten f set vorgaenger_id = null
  where vorgaenger_id in (select id from public.feldarbeiten where geloescht_am is not null);

-- 3) Wartung über Aufgabe/Werkstattauftrag setzt den Wartungsplan zurück
alter table public.aufgaben add column wartungsplan_id uuid references public.wartungsplaene (id) on delete set null;

create or replace function public.aufgabe_erledigen(p_id uuid, p jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v       aufgaben%rowtype;
  v_datum date := coalesce((p ->> 'datum')::date, current_date);
  v_eintrag uuid;
  v_mitarb uuid := nullif(p ->> 'mitarbeiter_id', '')::uuid;
begin
  if not darf_erfassen() then raise exception 'Keine Berechtigung'; end if;
  select * into v from aufgaben where id = p_id and betrieb_id = mein_betrieb() for update;
  if not found then raise exception 'Aufgabe nicht gefunden'; end if;
  if v.status = 'erledigt' then raise exception 'Aufgabe ist bereits erledigt'; end if;
  if v_datum > current_date then raise exception 'Das Datum der Erledigung liegt in der Zukunft'; end if;
  if exists (select 1 from auftraege where aufgabe_id = p_id and status not in ('Erledigt', 'Abgebrochen')) then
    raise exception 'Zu dieser Aufgabe läuft ein Auftrag. Bitte den Auftrag abschliessen.';
  end if;
  if v_mitarb is not null and not exists (select 1 from mitarbeiter where id = v_mitarb and betrieb_id = mein_betrieb()) then
    raise exception 'Unbekannte Person';
  end if;

  if v.art = 'Maschine' then
    v_eintrag := maschineneintrag_speichern(jsonb_build_object(
      'maschine_id', v.maschine_id, 'art', v.eintragsart, 'datum', v_datum, 'titel', v.titel,
      'beschreibung', concat_ws(E'\n', nullif(v.bemerkungen, ''), nullif(trim(p ->> 'ergebnis'), '')),
      'betriebsstunden', nullif(p ->> 'betriebsstunden', ''), 'kosten', nullif(p ->> 'kosten', ''),
      'arbeitszeit_h', nullif(p ->> 'dauer_h', ''), 'partner_id', coalesce(nullif(p ->> 'partner_id', ''), v.partner_id::text),
      'offen', coalesce((p ->> 'noch_offen')::boolean, false), 'wartungsplan_id', v.wartungsplan_id));
    update maschinen_eintraege set kilometerstand = nullif(p ->> 'kilometerstand', '')::numeric where id = v_eintrag;
    perform zaehler_nachfuehren(v.maschine_id, nullif(p ->> 'betriebsstunden', '')::numeric, nullif(p ->> 'kilometerstand', '')::numeric);
    if v.beobachtung_id is not null and coalesce((p ->> 'beobachtung_schliessen')::boolean, true) then
      update maschinen_eintraege set offen = false where id = v.beobachtung_id;
    end if;
  end if;

  update aufgaben set
    status = 'erledigt', erledigt_am = v_datum, erledigt_von = auth.uid(),
    mitarbeiter_id = coalesce(v_mitarb, mitarbeiter_id, ich_mitarbeiter()),
    dauer_h = nullif(p ->> 'dauer_h', '')::numeric, ergebnis = nullif(trim(p ->> 'ergebnis'), ''), eintrag_id = v_eintrag
  where id = p_id;
end $$;

create or replace function public.auftrag_abschliessen(p_id uuid, p_datum date, p_kosten numeric default null, p_bemerkung text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_a       auftraege%rowtype;
  v_fa      feldarbeiten%rowtype;
  v_mittel  jsonb := '[]';
  v_artikel uuid;
  m         auftrag_mittel%rowtype;
  v_ziel    uuid;
  v_offen   text;
  v_ohne    text;
  v_plan    aufgaben%rowtype;
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  select * into v_a from auftraege where id = p_id and betrieb_id = mein_betrieb() for update;
  if not found then raise exception 'Auftrag nicht gefunden'; end if;
  if v_a.status in ('Erledigt', 'Abgebrochen') then raise exception 'Auftrag ist bereits abgeschlossen'; end if;
  if p_datum is null or p_datum > current_date then raise exception 'Erledigt-Datum fehlt oder liegt in der Zukunft'; end if;

  if v_a.art = 'Lohnarbeit' then
    if not exists (select 1 from auftrag_felder where auftrag_id = p_id) then raise exception 'Der Auftrag hat keine Felder'; end if;
    if v_a.feldarbeit_id is not null then
      v_offen := offene_vorgaengerin(v_a.feldarbeit_id);
      if v_offen is not null then raise exception 'Zuerst die vorherige Arbeit «%» erledigen', v_offen; end if;
      select * into v_fa from feldarbeiten where id = v_a.feldarbeit_id and status = 'geplant' and geloescht_am is null;
      if not found then
        raise exception 'Die verknüpfte geplante Arbeit ist bereits erledigt oder gelöscht. Bitte den Auftrag abbrechen.';
      end if;
    end if;
    -- Mittel ohne Menge werden in den Bemerkungen dokumentiert
    select string_agg(coalesce(l.bezeichnung, am.bezeichnung) || case when am.bereitstellung = 'Dienstleister' then ' (vom Dienstleister)' else '' end, ', ')
      into v_ohne
      from auftrag_mittel am left join lagerartikel l on l.id = am.artikel_id
     where am.auftrag_id = p_id and am.menge_je_ha is null;
    for m in select * from auftrag_mittel where auftrag_id = p_id and menge_je_ha is not null loop
      v_artikel := m.artikel_id;
      if v_artikel is null then
        select id into v_artikel from lagerartikel
         where betrieb_id = v_a.betrieb_id and lower(bezeichnung) = lower(m.bezeichnung) limit 1;
        if v_artikel is null then
          insert into lagerartikel (betrieb_id, bezeichnung, kategorie, einheit, lagerfuehrung, bemerkungen)
          values (v_a.betrieb_id, m.bezeichnung, m.kategorie, coalesce(nullif(m.einheit, ''), 'kg'), false,
                  'Vom Dienstleister gestellt (Auftrag ' || v_a.nummer || ')')
          returning id into v_artikel;
        end if;
      end if;
      v_mittel := v_mittel || jsonb_build_object('artikel_id', v_artikel, 'menge_je_ha', m.menge_je_ha,
                                                 'vom_lager', m.bereitstellung = 'Betrieb');
    end loop;
    perform set_config('hofmanager.auftrag_abschluss', 'ja', true);
    v_ziel := feldarbeit_speichern(jsonb_build_object(
      'id', v_fa.id, 'version', v_fa.version,
      'datum', p_datum, 'arbeitsart', coalesce(v_a.arbeitsart, v_fa.arbeitsart, 'Andere'), 'status', 'erledigt',
      'partner_id', v_a.partner_id, 'maschine_id', v_fa.maschine_id, 'geraet_id', v_fa.geraet_id,
      'mitarbeiter_id', v_fa.mitarbeiter_id, 'vorgaenger_id', v_fa.vorgaenger_id, 'dauer_h', v_fa.dauer_h,
      'ausgefuehrt_von', v_fa.ausgefuehrt_von, 'ausbringung', v_fa.ausbringung,
      'bemerkungen', concat_ws(' · ', 'Auftrag ' || v_a.nummer, nullif(v_fa.bemerkungen, ''), nullif(p_bemerkung, ''),
                               case when v_ohne is not null then 'Mittel ohne Mengenangabe: ' || v_ohne end),
      -- Teilflächen der geplanten Arbeit übernehmen
      'felder', (select jsonb_agg(jsonb_build_object('feld_id', af.feld_id, 'flaeche_m2', ff.flaeche_m2))
                   from auftrag_felder af
                   left join feldarbeit_felder ff on ff.feldarbeit_id = v_fa.id and ff.feld_id = af.feld_id
                  where af.auftrag_id = p_id),
      'mittel', v_mittel));
    perform set_config('hofmanager.auftrag_abschluss', '', true);
    update auftraege set status = 'Erledigt', erledigt_am = p_datum, feldarbeit_id = v_ziel where id = p_id;
  else
    if v_a.aufgabe_id is not null then select * into v_plan from aufgaben where id = v_a.aufgabe_id; end if;
    insert into maschinen_eintraege (betrieb_id, maschine_id, art, datum, titel, beschreibung, kosten, partner_id, wartungsplan_id)
    values (v_a.betrieb_id, v_a.maschine_id, coalesce(v_plan.eintragsart, 'Reparatur'), p_datum, v_a.titel,
            concat_ws(E'\n', 'Werkstattauftrag ' || v_a.nummer, v_a.beschreibung, nullif(p_bemerkung, '')), p_kosten, v_a.partner_id,
            v_plan.wartungsplan_id)
    returning id into v_ziel;
    if v_plan.beobachtung_id is not null then update maschinen_eintraege set offen = false where id = v_plan.beobachtung_id; end if;
    update maschinen_eintraege set offen = false
     where id in (select eintrag_id from auftrag_beobachtungen where auftrag_id = p_id);
    update auftraege set status = 'Erledigt', erledigt_am = p_datum, eintrag_id = v_ziel where id = p_id;
  end if;

  if v_a.aufgabe_id is not null then
    update aufgaben set status = 'erledigt', erledigt_am = p_datum, erledigt_von = auth.uid(),
                        eintrag_id = case when v_a.art = 'Werkstatt' then v_ziel end,
                        ergebnis = concat_ws(' · ', 'Auftrag ' || v_a.nummer, nullif(p_bemerkung, ''))
     where id = v_a.aufgabe_id and status = 'offen';
  end if;
  return v_ziel;
end $$;

-- Abgebrochener Lohnauftrag: Lohnunternehmen wieder von der geplanten Arbeit entfernen
create or replace function public.auftrag_status(p_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v auftraege%rowtype;
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  if p_status not in ('Entwurf', 'Gesendet', 'Bestätigt', 'Abgebrochen') then raise exception 'Ungültiger Status'; end if;
  update auftraege set status = p_status,
         gesendet_am = case when p_status = 'Gesendet' then coalesce(gesendet_am, now()) else gesendet_am end
   where id = p_id and betrieb_id = mein_betrieb() and status <> 'Erledigt'
  returning * into v;
  if not found then raise exception 'Auftrag nicht gefunden oder bereits erledigt'; end if;
  if p_status = 'Abgebrochen' and v.feldarbeit_id is not null then
    update feldarbeiten set partner_id = null where id = v.feldarbeit_id and status = 'geplant' and partner_id = v.partner_id;
  end if;
end $$;

-- 4) Zahlungsstatus und Preis einer verrechneten Ernte-Abgabe kommen immer vom Beleg
create or replace function public.ernte_abgabe_beleg() returns trigger
language plpgsql as $$
declare
  v_bezahlt boolean;
  v_betrag  numeric;
begin
  select v.bezahlt, vp.betrag into v_bezahlt, v_betrag
    from public.verkauf_positionen vp join public.verkaeufe v on v.id = vp.verkauf_id
   where vp.ernte_abnehmer_id = new.id and not v.storniert;
  if found then
    new.bezahlt := v_bezahlt;
    new.preis_chf := v_betrag;
  end if;
  return new;
end $$;
create trigger b_beleg before insert or update on public.ernte_abnehmer for each row execute function public.ernte_abgabe_beleg();

create or replace function public.verkauf_stornieren(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  update verkaeufe set storniert = true where id = p_id and betrieb_id = mein_betrieb() and not storniert;
  if not found then raise exception 'Beleg nicht gefunden oder bereits storniert'; end if;
  delete from lagerbewegungen where quelle_typ = 'verkauf' and quelle_id in (select id from verkauf_positionen where verkauf_id = p_id);
  update ernte_abnehmer set bezahlt = false where id in (select ernte_abnehmer_id from verkauf_positionen where verkauf_id = p_id);
  update verkauf_positionen set ernte_abnehmer_id = null where verkauf_id = p_id;
end $$;

-- 5) Fläche je Kultur: zusammengeführte und aufgegebene Felder nicht mitzählen
create or replace view public.flaeche_je_kultur with (security_invoker = true) as
select a.betrieb_id, a.jahr, k.id as kultur_id, k.name as kultur, k.farbe,
       sum(coalesce(a.flaeche_m2, f.flaeche_m2)) as flaeche_m2,
       count(*) as anzahl_felder
from public.anbau a
join public.felder f on f.id = a.feld_id and f.geloescht_am is null and f.status not in ('zusammengeführt', 'aufgegeben')
join public.kulturen k on k.id = a.kultur_id
where a.art = 'Hauptkultur'
group by a.betrieb_id, a.jahr, k.id, k.name, k.farbe;

-- 7) Kultur nachträglich zuordnen (Arbeit vor der Fruchtfolge erfasst) und Löschen geplanter Kulturen nicht blockieren
alter table public.feldarbeit_felder drop constraint feldarbeit_felder_anbau_id_fkey;
alter table public.feldarbeit_felder add constraint feldarbeit_felder_anbau_id_fkey foreign key (anbau_id) references public.anbau (id) on delete set null;
alter table public.ernten drop constraint ernten_anbau_id_fkey;
alter table public.ernten add constraint ernten_anbau_id_fkey foreign key (anbau_id) references public.anbau (id) on delete set null;

create or replace function public.anbau_zuordnen() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.art = 'Hauptkultur' then
    update feldarbeit_felder ff set anbau_id = new.id
      from feldarbeiten fa
     where fa.id = ff.feldarbeit_id and ff.feld_id = new.feld_id and ff.anbau_id is null
       and extract(year from fa.datum)::int = new.jahr;
    update ernten set anbau_id = new.id
     where feld_id = new.feld_id and anbau_id is null and extract(year from datum)::int = new.jahr;
  end if;
  return null;
end $$;
create trigger z_zuordnen after insert or update of art, jahr, feld_id on public.anbau for each row execute function public.anbau_zuordnen();
update public.feldarbeit_felder ff set anbau_id = a.id
  from public.feldarbeiten fa, public.anbau a
 where fa.id = ff.feldarbeit_id and ff.anbau_id is null and a.feld_id = ff.feld_id and a.art = 'Hauptkultur'
   and a.jahr = extract(year from fa.datum)::int;
update public.ernten e set anbau_id = a.id
  from public.anbau a
 where e.anbau_id is null and a.feld_id = e.feld_id and a.art = 'Hauptkultur' and a.jahr = extract(year from e.datum)::int;

-- 11) Feld mit geplanten Arbeiten oder laufenden Aufträgen nicht löschen
create or replace function public.feld_loeschen(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_text text;
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  select string_agg(distinct t, ', ') into v_text from (
    select 'geplante Arbeit «' || fa.arbeitsart || '»' as t
      from feldarbeit_felder ff join feldarbeiten fa on fa.id = ff.feldarbeit_id
     where ff.feld_id = p_id and fa.status = 'geplant' and fa.geloescht_am is null
    union all
    select 'Auftrag ' || a.nummer
      from auftrag_felder af join auftraege a on a.id = af.auftrag_id
     where af.feld_id = p_id and a.status not in ('Erledigt', 'Abgebrochen')) x;
  if v_text is not null then
    raise exception 'Dieses Feld ist noch verplant (%). Bitte zuerst erledigen, löschen oder abbrechen.', v_text;
  end if;
  update felder set geloescht_am = now(), geloescht_von = auth.uid()
   where id = p_id and betrieb_id = mein_betrieb() and geloescht_am is null;
  if not found then raise exception 'Feld nicht gefunden oder bereits gelöscht'; end if;
end $$;

-- 12) Maschineneinträge aus Werkstattaufträgen bleiben löschbar
alter table public.auftraege drop constraint auftraege_eintrag_id_fkey;
alter table public.auftraege add constraint auftraege_eintrag_id_fkey foreign key (eintrag_id) references public.maschinen_eintraege (id) on delete set null;
alter table public.auftrag_beobachtungen drop constraint auftrag_beobachtungen_eintrag_id_fkey;
alter table public.auftrag_beobachtungen add constraint auftrag_beobachtungen_eintrag_id_fkey foreign key (eintrag_id) references public.maschinen_eintraege (id) on delete cascade;

-- 13) Beobachtung beim Erledigen merken (kein doppeltes Melden beim späteren Bearbeiten)
create or replace function public.feldarbeit_erledigen(p_id uuid, p jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_a     feldarbeiten%rowtype;
  v_datum date := coalesce((p ->> 'datum')::date, current_date);
  v_ha    numeric;
  m       jsonb;
  v_masch uuid := nullif(p ->> 'beobachtung_an_maschine', '')::uuid;
  v_mitarb uuid := nullif(p ->> 'mitarbeiter_id', '')::uuid;
  v_offen text;
begin
  if not darf_erfassen() then raise exception 'Keine Berechtigung'; end if;
  select * into v_a from feldarbeiten where id = p_id and betrieb_id = mein_betrieb() and geloescht_am is null for update;
  if not found then raise exception 'Arbeit nicht gefunden'; end if;
  if v_a.status <> 'geplant' then raise exception 'Diese Arbeit ist bereits erledigt'; end if;
  if v_datum > current_date then raise exception 'Das Datum der Erledigung liegt in der Zukunft'; end if;
  v_offen := offene_vorgaengerin(p_id);
  if v_offen is not null then raise exception 'Zuerst die vorherige Arbeit «%» erledigen', v_offen; end if;
  if exists (select 1 from auftraege where feldarbeit_id = p_id and status not in ('Erledigt', 'Abgebrochen')) then
    raise exception 'Zu dieser Arbeit läuft ein Lohnauftrag. Bitte den Auftrag abschliessen.';
  end if;
  if v_mitarb is not null and not exists (select 1 from mitarbeiter where id = v_mitarb and betrieb_id = mein_betrieb()) then
    raise exception 'Unbekannte Person';
  end if;

  update feldarbeiten set
    status = 'erledigt', datum = v_datum,
    dauer_h = coalesce(nullif(p ->> 'dauer_h', '')::numeric, dauer_h),
    maschine_stunden = nullif(p ->> 'maschine_stunden', '')::numeric,
    maschine_km = nullif(p ->> 'maschine_km', '')::numeric,
    geraet_stunden = nullif(p ->> 'geraet_stunden', '')::numeric,
    beobachtung = nullif(trim(p ->> 'beobachtung'), ''),
    mitarbeiter_id = coalesce(v_mitarb, mitarbeiter_id, ich_mitarbeiter()),
    ausgefuehrt_von = coalesce(ausgefuehrt_von, auth.uid())
  where id = p_id;

  update feldarbeit_felder ff set anbau_id = (
    select a.id from anbau a where a.feld_id = ff.feld_id and a.jahr = extract(year from v_datum)::int and a.art = 'Hauptkultur')
  where ff.feldarbeit_id = p_id;

  select sum(flaeche_m2) / 10000 into v_ha from feldarbeit_felder where feldarbeit_id = p_id;
  for m in select * from jsonb_array_elements(coalesce(p -> 'mittel', '[]')) loop
    if nullif(m ->> 'gesamtmenge', '') is null then continue; end if;
    if (m ->> 'gesamtmenge')::numeric <= 0 then
      delete from feldarbeit_mittel where feldarbeit_id = p_id and artikel_id = (m ->> 'artikel_id')::uuid;
    else
      update feldarbeit_mittel set gesamtmenge = round((m ->> 'gesamtmenge')::numeric, 3),
                                   menge_je_ha = round((m ->> 'gesamtmenge')::numeric / v_ha, 4)
       where feldarbeit_id = p_id and artikel_id = (m ->> 'artikel_id')::uuid;
    end if;
  end loop;

  if v_a.maschine_id is not null then
    perform zaehler_nachfuehren(v_a.maschine_id, nullif(p ->> 'maschine_stunden', '')::numeric, nullif(p ->> 'maschine_km', '')::numeric);
  end if;
  if v_a.geraet_id is not null then
    perform zaehler_nachfuehren(v_a.geraet_id, nullif(p ->> 'geraet_stunden', '')::numeric, null);
  end if;

  if v_masch is not null and nullif(trim(p ->> 'beobachtung'), '') is not null then
    if not exists (select 1 from maschinen where id = v_masch and betrieb_id = mein_betrieb()) then
      raise exception 'Unbekannte Maschine';
    end if;
    insert into maschinen_eintraege (betrieb_id, maschine_id, art, datum, betriebsstunden, kilometerstand, titel, beschreibung, offen)
    values (mein_betrieb(), v_masch, 'Beobachtung', v_datum,
            case when v_masch = v_a.maschine_id then nullif(p ->> 'maschine_stunden', '')::numeric else nullif(p ->> 'geraet_stunden', '')::numeric end,
            case when v_masch = v_a.maschine_id then nullif(p ->> 'maschine_km', '')::numeric end,
            left(trim(p ->> 'beobachtung'), 80), 'Bei ' || v_a.arbeitsart || ' am ' || to_char(v_datum, 'DD.MM.YYYY') || ': ' || trim(p ->> 'beobachtung'),
            true)
    returning id into v_masch;
    update feldarbeiten set beobachtung_eintrag_id = v_masch where id = p_id;
  end if;

  perform feldarbeit_buchen(p_id);
end $$;

-- 15) Name und Aktiv-Status eines App-Kontos auf die Mitarbeiter-Karte übertragen
create or replace function public.mitarbeiter_von_benutzer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update mitarbeiter set name = new.name, aktiv = new.aktiv
   where benutzer_id = new.id and (name is distinct from new.name or aktiv is distinct from new.aktiv);
  return null;
end $$;
create trigger mitarbeiter_nachfuehren after update of name, aktiv on public.benutzer_profile for each row execute function public.mitarbeiter_von_benutzer();

revoke all on function public.feldarbeit_erledigen(uuid, jsonb), public.aufgabe_erledigen(uuid, jsonb),
  public.auftrag_abschliessen(uuid, date, numeric, text), public.auftrag_status(uuid, text), public.verkauf_stornieren(uuid), public.feld_loeschen(uuid)
  from public, anon;
grant execute on function public.feldarbeit_erledigen(uuid, jsonb), public.aufgabe_erledigen(uuid, jsonb),
  public.auftrag_abschliessen(uuid, date, numeric, text), public.auftrag_status(uuid, text), public.verkauf_stornieren(uuid), public.feld_loeschen(uuid)
  to authenticated;

-- Hofmanager SchweikFarm: fehlende Migrationen nachholen (10, 14, 15, 16, 17).
-- Für eine Datenbank, in der 08, 09, 11, 12 und 13 schon gelaufen sind.
-- Läuft als Ganzes: bei einem Fehler wird nichts geändert.

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
alter table public.feldarbeiten add column if not exists beobachtung_eintrag_id uuid references public.maschinen_eintraege (id) on delete set null;

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

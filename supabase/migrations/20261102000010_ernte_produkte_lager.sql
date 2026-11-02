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

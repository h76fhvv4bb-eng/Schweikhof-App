-- =====================================================================
-- Hofmanager SchweikFarm – Migration 7: Ernte mit Abnehmern, genauere Fruchtfolgeplanung, Bodenproben
-- Einspielen: Supabase › SQL Editor › gesamten Inhalt einfügen › Run
-- Voraussetzung: Migrationen 1–6 sind eingespielt.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Weitere Standardkulturen
-- ---------------------------------------------------------------------
insert into public.kulturen (name, kulturgruppe, farbe, anbaupause_jahre, ist_grasland)
select * from (values
  ('Gründüngung', 'Zwischenkultur', '#B7D69F', 0, false),
  ('Zwischenfutter', 'Zwischenkultur', '#A3CD8A', 0, false),
  ('Buntbrache', 'Brache', '#E8B7C8', 0, false),
  ('Rotationsbrache', 'Brache', '#DDB0C0', 0, false),
  ('Kleegras', 'Kunstwiese', '#8CC17A', 0, true)
) as neu (name, kulturgruppe, farbe, anbaupause_jahre, ist_grasland)
where not exists (select 1 from public.kulturen k where k.betrieb_id is null and k.name = neu.name);

-- ---------------------------------------------------------------------
-- Anbau: Saat und Ernte können monatsgenau (Planung) oder tagesgenau erfasst werden
-- ---------------------------------------------------------------------
alter table public.anbau add column nur_monat boolean not null default false;
alter table public.anbau add constraint anbau_daten_check check (erntedatum is null or saatdatum is null or erntedatum >= saatdatum);

-- Bodenprobe: Korrekturfaktoren (Suisse-Bilanz) je Feld
alter table public.felder add column korrektur_p2o5 numeric(4, 2) check (korrektur_p2o5 between 0 and 3);
alter table public.felder add column korrektur_k2o  numeric(4, 2) check (korrektur_k2o between 0 and 3);
alter table public.felder add column korrektur_mg   numeric(4, 2) check (korrektur_mg between 0 and 3);
alter table public.felder add column bodenprobe_jahr integer check (bodenprobe_jahr between 1990 and 2100);

-- Anbau direkt bearbeiten (Datum, Art): Mitarbeiter dürfen das nicht, Verwaltende schon (Regeln aus Migration 1).

-- ---------------------------------------------------------------------
-- Ernten und Abnehmer
-- ---------------------------------------------------------------------
create table public.ernten (
  id               uuid primary key default gen_random_uuid(),
  betrieb_id       uuid not null references public.betriebe (id),
  feld_id          uuid not null references public.felder (id),
  anbau_id         uuid references public.anbau (id),
  datum            date not null,
  produkt          text not null check (produkt in (
                     'Heu', 'Emd', 'Grassilage', 'Gras frisch', 'Silomais', 'Körnermais', 'Getreide', 'Stroh',
                     'Raps', 'Eiweisserbsen', 'Kartoffeln', 'Zuckerrüben', 'Andere')),
  schnitt          integer check (schnitt between 1 and 8),  -- Grasland: 1. bis 8. Schnitt
  flaeche_m2       numeric(12, 1) not null check (flaeche_m2 > 0),
  ballen           integer check (ballen >= 0),
  ballenart        text check (ballenart in ('Rundballen', 'Quaderballen', 'Kleinballen', 'Siloballen')),
  menge_kg         numeric(12, 1) check (menge_kg >= 0),      -- Gesamtgewicht der Ernte
  feuchte_prozent  numeric(4, 1) check (feuchte_prozent between 0 and 100),
  qualitaet        text,
  lohnunternehmen_id uuid references public.partner (id),     -- wer geerntet / gepresst hat
  bemerkungen      text,
  erstellt_von     uuid default auth.uid(),
  erstellt_am      timestamptz not null default now(),
  geaendert_am     timestamptz not null default now(),
  version          integer not null default 1,
  check (ballen is not null or menge_kg is not null)
);
create index on public.ernten (feld_id, datum desc);

create table public.ernte_abnehmer (
  id            uuid primary key default gen_random_uuid(),
  betrieb_id    uuid not null references public.betriebe (id),
  ernte_id      uuid not null references public.ernten (id) on delete cascade,
  partner_id    uuid references public.partner (id),   -- leer = Eigenbedarf/Lager
  art           text not null default 'Verkauf' check (art in ('Verkauf', 'Abgabe', 'Eigenbedarf', 'Lager')),
  ballen        integer check (ballen >= 0),
  menge_kg      numeric(12, 1) check (menge_kg >= 0),
  preis_chf     numeric(12, 2) check (preis_chf >= 0),   -- Gesamtbetrag dieser Abgabe
  preis_einheit text check (preis_einheit in ('total', 'je Ballen', 'je 100 kg', 'je t')),
  bezahlt       boolean not null default false,
  bemerkung     text,
  check (ballen is not null or menge_kg is not null),
  check (art not in ('Verkauf', 'Abgabe') or partner_id is not null)
);
create index on public.ernte_abnehmer (partner_id);

create trigger a_version before update on public.ernten for each row execute function public.pruefe_version();
create trigger b_metadaten before insert or update on public.ernten for each row execute function public.setze_metadaten();
create trigger z_protokoll after insert or update or delete on public.ernten for each row execute function public.protokolliere();
create trigger z_protokoll after insert or update or delete on public.ernte_abnehmer for each row execute function public.protokolliere();

-- Ernte speichern (mit Abnehmern) – eine Transaktion
-- p: {"id"?, "version"?, "feld_id", "datum", "produkt", "schnitt"?, "flaeche_m2"?, "ballen"?, "ballenart"?, "menge_kg"?,
--     "feuchte_prozent"?, "qualitaet"?, "lohnunternehmen_id"?, "bemerkungen"?,
--     "abnehmer": [{"partner_id"?, "art", "ballen"?, "menge_kg"?, "preis_chf"?, "preis_einheit"?, "bezahlt"?, "bemerkung"?}]}
create or replace function public.ernte_speichern(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  v_id      uuid := nullif(p ->> 'id', '')::uuid;
  v_feld    felder%rowtype;
  v_datum   date := (p ->> 'datum')::date;
  v_ballen  int := nullif(p ->> 'ballen', '')::int;
  v_kg      numeric := nullif(p ->> 'menge_kg', '')::numeric;
  v_summe_b int;
  v_summe_kg numeric;
  x         jsonb;
begin
  if v_betrieb is null or not darf_erfassen() then raise exception 'Keine Berechtigung'; end if;
  select * into v_feld from felder where id = (p ->> 'feld_id')::uuid and betrieb_id = v_betrieb;
  if not found then raise exception 'Unbekanntes Feld'; end if;
  if v_datum is null or v_datum > current_date then raise exception 'Erntedatum fehlt oder liegt in der Zukunft'; end if;
  if v_ballen is null and v_kg is null then raise exception 'Bitte Anzahl Ballen oder Gewicht angeben'; end if;

  if v_id is null then
    insert into ernten (betrieb_id, feld_id, anbau_id, datum, produkt, schnitt, flaeche_m2, ballen, ballenart, menge_kg,
                        feuchte_prozent, qualitaet, lohnunternehmen_id, bemerkungen)
    values (v_betrieb, v_feld.id,
            (select id from anbau where feld_id = v_feld.id and jahr = extract(year from v_datum)::int and art = 'Hauptkultur'),
            v_datum, p ->> 'produkt', nullif(p ->> 'schnitt', '')::int,
            coalesce(nullif(p ->> 'flaeche_m2', '')::numeric, v_feld.flaeche_m2), v_ballen, nullif(p ->> 'ballenart', ''), v_kg,
            nullif(p ->> 'feuchte_prozent', '')::numeric, nullif(p ->> 'qualitaet', ''), nullif(p ->> 'lohnunternehmen_id', '')::uuid,
            nullif(p ->> 'bemerkungen', ''))
    returning id into v_id;
  else
    if not darf_verwalten() and not exists (select 1 from ernten where id = v_id and erstellt_von = auth.uid()) then
      raise exception 'Nur eigene Einträge können geändert werden';
    end if;
    update ernten set
      feld_id = v_feld.id, datum = v_datum, produkt = p ->> 'produkt', schnitt = nullif(p ->> 'schnitt', '')::int,
      flaeche_m2 = coalesce(nullif(p ->> 'flaeche_m2', '')::numeric, v_feld.flaeche_m2), ballen = v_ballen,
      ballenart = nullif(p ->> 'ballenart', ''), menge_kg = v_kg, feuchte_prozent = nullif(p ->> 'feuchte_prozent', '')::numeric,
      qualitaet = nullif(p ->> 'qualitaet', ''), lohnunternehmen_id = nullif(p ->> 'lohnunternehmen_id', '')::uuid,
      bemerkungen = nullif(p ->> 'bemerkungen', ''),
      anbau_id = (select id from anbau where feld_id = v_feld.id and jahr = extract(year from v_datum)::int and art = 'Hauptkultur'),
      version = coalesce((p ->> 'version')::int, version)
    where id = v_id and betrieb_id = v_betrieb;
    if not found then raise exception 'Ernte nicht gefunden'; end if;
    delete from ernte_abnehmer where ernte_id = v_id;
  end if;

  for x in select * from jsonb_array_elements(coalesce(p -> 'abnehmer', '[]')) loop
    if nullif(x ->> 'partner_id', '') is not null
       and not exists (select 1 from partner where id = (x ->> 'partner_id')::uuid and betrieb_id = v_betrieb) then
      raise exception 'Unbekannter Partner';
    end if;
    insert into ernte_abnehmer (betrieb_id, ernte_id, partner_id, art, ballen, menge_kg, preis_chf, preis_einheit, bezahlt, bemerkung)
    values (v_betrieb, v_id, nullif(x ->> 'partner_id', '')::uuid, coalesce(nullif(x ->> 'art', ''), 'Verkauf'),
            nullif(x ->> 'ballen', '')::int, nullif(x ->> 'menge_kg', '')::numeric, nullif(x ->> 'preis_chf', '')::numeric,
            nullif(x ->> 'preis_einheit', ''), coalesce((x ->> 'bezahlt')::boolean, false), nullif(x ->> 'bemerkung', ''));
  end loop;

  -- Abgaben dürfen die Ernte nicht übersteigen
  select sum(ballen), sum(menge_kg) into v_summe_b, v_summe_kg from ernte_abnehmer where ernte_id = v_id;
  if v_ballen is not null and coalesce(v_summe_b, 0) > v_ballen then
    raise exception 'Es wurden mehr Ballen abgegeben (%) als geerntet (%)', v_summe_b, v_ballen;
  end if;
  if v_kg is not null and coalesce(v_summe_kg, 0) > v_kg * 1.001 then
    raise exception 'Es wurde mehr Gewicht abgegeben (% kg) als geerntet (% kg)', v_summe_kg, v_kg;
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
  delete from ernten where id = p_id and betrieb_id = mein_betrieb();
  if not found then raise exception 'Ernte nicht gefunden'; end if;
end $$;

revoke all on function public.ernte_speichern(jsonb), public.ernte_loeschen(uuid) from public, anon;
grant execute on function public.ernte_speichern(jsonb), public.ernte_loeschen(uuid) to authenticated;

-- Erträge: je Ernte kg/ha bzw. Ballen/ha, dazu die Summen der Abgaben
create view public.ertraege with (security_invoker = true) as
select e.id, e.betrieb_id, e.feld_id, e.datum, extract(year from e.datum)::int as jahr, e.produkt, e.schnitt,
       e.flaeche_m2, e.ballen, e.menge_kg,
       round(e.menge_kg / (e.flaeche_m2 / 10000), 0) as kg_je_ha,
       round(e.ballen / (e.flaeche_m2 / 10000), 1) as ballen_je_ha,
       coalesce(sum(a.ballen) filter (where a.art in ('Verkauf', 'Abgabe')), 0) as ballen_abgegeben,
       coalesce(sum(a.menge_kg) filter (where a.art in ('Verkauf', 'Abgabe')), 0) as kg_abgegeben,
       coalesce(sum(a.preis_chf) filter (where a.art = 'Verkauf'), 0) as erloes_chf,
       coalesce(sum(a.preis_chf) filter (where a.art = 'Verkauf' and not a.bezahlt), 0) as offen_chf
from public.ernten e
left join public.ernte_abnehmer a on a.ernte_id = e.id
group by e.id;

alter table public.ernten        enable row level security;
alter table public.ernte_abnehmer enable row level security;
create policy er_lesen on public.ernten         for select using (betrieb_id = public.mein_betrieb());
create policy ea_lesen on public.ernte_abnehmer for select using (betrieb_id = public.mein_betrieb());
-- Zahlungsstatus darf direkt nachgeführt werden
create policy ea_bezahlt on public.ernte_abnehmer for update using (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
grant select on public.ernten, public.ernte_abnehmer, public.ertraege to authenticated;
grant update (bezahlt) on public.ernte_abnehmer to authenticated;

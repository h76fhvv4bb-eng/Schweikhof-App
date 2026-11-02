-- =====================================================================
-- Hofmanager – Migration 2: Lager, Feldarbeiten, Düngung, Nährstoffe
-- Einspielen: Supabase › SQL Editor › gesamten Inhalt einfügen › Run
-- Voraussetzung: Migration 1 ist eingespielt.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Lagerartikel
-- Nährstoffgehalte in kg Nährstoff JE EINHEIT des Artikels
-- (Einheit kg: 27 % N = 0.27; Einheit t: 270; Einheit m³ Gülle: z. B. 2.5 kg N/m³).
-- ---------------------------------------------------------------------
create table public.lagerartikel (
  id              uuid primary key default gen_random_uuid(),
  betrieb_id      uuid not null references public.betriebe (id),
  artikelnummer   text,
  bezeichnung     text not null check (length(trim(bezeichnung)) > 0),
  kategorie       text not null check (kategorie in (
                    'Dünger', 'Saatgut', 'Pflanzenschutzmittel', 'Ersatzteile', 'Betriebsstoffe',
                    'Erzeugnisse', 'Verbrauchsmaterial', 'Sonstiges')),
  einheit         text not null check (einheit in ('kg', 't', 'l', 'm³', 'Stk', 'Ballen', 'Einheit')),
  hersteller      text,
  lieferant       text,
  lagerort        text,
  mindestbestand  numeric(14, 3) not null default 0 check (mindestbestand >= 0),
  einkaufspreis   numeric(12, 2) check (einkaufspreis >= 0), -- CHF je Einheit
  lagerfuehrung   boolean not null default true,            -- false z. B. für zugekauften Hofdünger ohne Bestand
  n_je_einheit    numeric(12, 5) check (n_je_einheit >= 0),
  p2o5_je_einheit numeric(12, 5) check (p2o5_je_einheit >= 0),
  k2o_je_einheit  numeric(12, 5) check (k2o_je_einheit >= 0),
  mg_je_einheit   numeric(12, 5) check (mg_je_einheit >= 0),
  s_je_einheit    numeric(12, 5) check (s_je_einheit >= 0),
  naehrstoffquelle text check (naehrstoffquelle in ('Deklaration', 'Analyse', 'Richtwert')),
  bemerkungen     text,
  aktiv           boolean not null default true,
  erstellt_am     timestamptz not null default now(),
  geaendert_am    timestamptz not null default now(),
  version         integer not null default 1
);
create unique index lagerartikel_nummer on public.lagerartikel (betrieb_id, artikelnummer) where artikelnummer is not null;

-- ---------------------------------------------------------------------
-- Lagerbewegungen = Buchungsjournal. Der Bestand ist immer die Summe der Mengen.
-- Positive Menge = Zugang, negative Menge = Abgang.
-- Automatische Buchungen tragen ihre Quelle; je Quelle und Artikel gibt es höchstens EINE Buchung.
-- ---------------------------------------------------------------------
create table public.lagerbewegungen (
  id               uuid primary key default gen_random_uuid(),
  betrieb_id       uuid not null references public.betriebe (id),
  artikel_id       uuid not null references public.lagerartikel (id),
  datum            date not null default current_date,
  art              text not null check (art in ('Eingang', 'Verbrauch', 'Verkauf', 'Korrektur', 'Inventur', 'Ernte')),
  menge            numeric(14, 3) not null check (menge <> 0),
  preis_je_einheit numeric(12, 2) check (preis_je_einheit >= 0),
  quelle_typ       text,
  quelle_id        uuid,
  bemerkung        text,
  erstellt_von     uuid default auth.uid(),
  erstellt_am      timestamptz not null default now(),
  geaendert_am     timestamptz not null default now(),
  version          integer not null default 1,
  check ((quelle_typ is null) = (quelle_id is null))
);
create unique index lagerbewegung_je_quelle on public.lagerbewegungen (quelle_typ, quelle_id, artikel_id) where quelle_id is not null;
create index on public.lagerbewegungen (artikel_id, datum);

create view public.lagerbestand with (security_invoker = true) as
select a.*,
       coalesce(sum(b.menge), 0)::numeric(14, 3) as bestand,
       (a.lagerfuehrung and coalesce(sum(b.menge), 0) < a.mindestbestand) as unter_mindestbestand,
       (coalesce(sum(b.menge), 0) * coalesce(a.einkaufspreis, 0))::numeric(14, 2) as lagerwert
from public.lagerartikel a
left join public.lagerbewegungen b on b.artikel_id = a.id
group by a.id;

-- ---------------------------------------------------------------------
-- Feldarbeiten (Ackerschlagkartei)
-- ---------------------------------------------------------------------
create table public.feldarbeiten (
  id            uuid primary key default gen_random_uuid(),
  betrieb_id    uuid not null references public.betriebe (id),
  datum         date not null,
  arbeitsart    text not null check (arbeitsart in (
                  'Pflügen', 'Grubbern', 'Eggen', 'Säen', 'Walzen', 'Düngen', 'Pflanzenschutz',
                  'Mähen', 'Zetten', 'Schwaden', 'Pressen', 'Ernten', 'Mulchen', 'Hacken', 'Striegeln', 'Andere')),
  status        text not null default 'erledigt' check (status in ('erledigt', 'geplant')),
  dauer_h       numeric(6, 2) check (dauer_h >= 0 and dauer_h <= 200),
  maschine      text,
  geraet        text,
  ausgefuehrt_von uuid references public.benutzer_profile (id),
  ausbringung   text, -- z. B. Breitstreuer, Schleppschlauch
  bemerkungen   text,
  geloescht_am  timestamptz,
  erstellt_von  uuid default auth.uid(),
  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz not null default now(),
  version       integer not null default 1
);
create index on public.feldarbeiten (betrieb_id, datum desc);

create table public.feldarbeit_felder (
  id            uuid primary key default gen_random_uuid(),
  betrieb_id    uuid not null references public.betriebe (id),
  feldarbeit_id uuid not null references public.feldarbeiten (id) on delete cascade,
  feld_id       uuid not null references public.felder (id),
  anbau_id      uuid references public.anbau (id),
  flaeche_m2    numeric(12, 1) not null check (flaeche_m2 > 0),
  unique (feldarbeit_id, feld_id)
);
create index on public.feldarbeit_felder (feld_id);

create table public.feldarbeit_mittel (
  id            uuid primary key default gen_random_uuid(),
  betrieb_id    uuid not null references public.betriebe (id),
  feldarbeit_id uuid not null references public.feldarbeiten (id) on delete cascade,
  artikel_id    uuid not null references public.lagerartikel (id),
  menge_je_ha   numeric(14, 4) not null check (menge_je_ha > 0), -- in der Einheit des Artikels
  gesamtmenge   numeric(14, 3) not null check (gesamtmenge > 0), -- berechnet: menge_je_ha × bearbeitete ha
  unique (feldarbeit_id, artikel_id)
);

-- ---------------------------------------------------------------------
-- Trigger und Protokoll
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['lagerartikel', 'lagerbewegungen', 'feldarbeiten'] loop
    execute format('create trigger a_version before update on public.%I for each row execute function public.pruefe_version()', t);
    execute format('create trigger b_metadaten before insert or update on public.%I for each row execute function public.setze_metadaten()', t);
  end loop;
  foreach t in array array['lagerartikel', 'lagerbewegungen', 'feldarbeiten', 'feldarbeit_felder', 'feldarbeit_mittel'] loop
    execute format('create trigger z_protokoll after insert or update or delete on public.%I for each row execute function public.protokolliere()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Feldarbeit speichern: ALLES in einer Transaktion.
-- Legt an oder ändert, ersetzt Felder und Mittel und gleicht die Lagerbuchungen ab.
-- Geplante Arbeiten buchen nichts; erst "erledigt" bucht. Gelöschte buchen zurück.
-- p: {"id"?, "version"?, "datum", "arbeitsart", "status", "dauer_h"?, "maschine"?, "geraet"?,
--     "ausgefuehrt_von"?, "ausbringung"?, "bemerkungen"?,
--     "felder": [{"feld_id", "flaeche_m2"?}], "mittel": [{"artikel_id", "menge_je_ha"}]}
-- ---------------------------------------------------------------------
create or replace function public.feldarbeit_speichern(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  v_id      uuid := nullif(p ->> 'id', '')::uuid;
  v_datum   date := (p ->> 'datum')::date;
  v_status  text := coalesce(p ->> 'status', 'erledigt');
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

  if v_id is null then
    insert into feldarbeiten (betrieb_id, datum, arbeitsart, status, dauer_h, maschine, geraet, ausgefuehrt_von, ausbringung, bemerkungen)
    values (v_betrieb, v_datum, p ->> 'arbeitsart', v_status, nullif(p ->> 'dauer_h', '')::numeric,
            nullif(p ->> 'maschine', ''), nullif(p ->> 'geraet', ''),
            coalesce(nullif(p ->> 'ausgefuehrt_von', '')::uuid, auth.uid()),
            nullif(p ->> 'ausbringung', ''), nullif(p ->> 'bemerkungen', ''))
    returning id into v_id;
  else
    -- Mitarbeiter dürfen nur eigene Einträge ändern, Verwaltende alle.
    if not darf_verwalten() and not exists (
      select 1 from feldarbeiten where id = v_id and erstellt_von = auth.uid()) then
      raise exception 'Nur eigene Einträge können geändert werden';
    end if;
    update feldarbeiten set
      datum = v_datum, arbeitsart = p ->> 'arbeitsart', status = v_status,
      dauer_h = nullif(p ->> 'dauer_h', '')::numeric,
      maschine = nullif(p ->> 'maschine', ''), geraet = nullif(p ->> 'geraet', ''),
      ausgefuehrt_von = nullif(p ->> 'ausgefuehrt_von', '')::uuid,
      ausbringung = nullif(p ->> 'ausbringung', ''), bemerkungen = nullif(p ->> 'bemerkungen', ''),
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
    insert into feldarbeit_mittel (betrieb_id, feldarbeit_id, artikel_id, menge_je_ha, gesamtmenge)
    values (v_betrieb, v_id, (m ->> 'artikel_id')::uuid, (m ->> 'menge_je_ha')::numeric,
            round((m ->> 'menge_je_ha')::numeric * v_ha, 3));
  end loop;

  perform feldarbeit_buchen(v_id);
  return v_id;
end $$;

-- Gleicht die Lagerbuchungen einer Feldarbeit mit ihren Mitteln ab (idempotent).
create or replace function public.feldarbeit_buchen(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_arbeit feldarbeiten%rowtype;
begin
  select * into v_arbeit from feldarbeiten where id = p_id;

  -- Buchungen entfernen, die nicht mehr gelten (Mittel entfernt, Arbeit geplant oder gelöscht)
  delete from lagerbewegungen b
   where b.quelle_typ = 'feldarbeit' and b.quelle_id = p_id
     and (v_arbeit.status <> 'erledigt' or v_arbeit.geloescht_am is not null
          or not exists (select 1 from feldarbeit_mittel m where m.feldarbeit_id = p_id and m.artikel_id = b.artikel_id));

  if v_arbeit.status = 'erledigt' and v_arbeit.geloescht_am is null then
    insert into lagerbewegungen (betrieb_id, artikel_id, datum, art, menge, preis_je_einheit, quelle_typ, quelle_id, bemerkung)
    select m.betrieb_id, m.artikel_id, v_arbeit.datum, 'Verbrauch', -m.gesamtmenge, a.einkaufspreis, 'feldarbeit', p_id,
           v_arbeit.arbeitsart
      from feldarbeit_mittel m
      join lagerartikel a on a.id = m.artikel_id
     where m.feldarbeit_id = p_id and a.lagerfuehrung
    on conflict (quelle_typ, quelle_id, artikel_id) where quelle_id is not null
    do update set menge = excluded.menge, datum = excluded.datum, bemerkung = excluded.bemerkung
      where lagerbewegungen.menge is distinct from excluded.menge or lagerbewegungen.datum is distinct from excluded.datum;
  end if;
end $$;

-- Löschen = weich löschen + Lagerbuchungen zurücknehmen.
create or replace function public.feldarbeit_loeschen(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not darf_verwalten() and not exists (
    select 1 from feldarbeiten where id = p_id and erstellt_von = auth.uid() and betrieb_id = mein_betrieb()) then
    raise exception 'Keine Berechtigung';
  end if;
  update feldarbeiten set geloescht_am = now() where id = p_id and betrieb_id = mein_betrieb() and geloescht_am is null;
  if not found then raise exception 'Arbeit nicht gefunden'; end if;
  perform feldarbeit_buchen(p_id);
end $$;

-- Inventur: gezählten Bestand eingeben, Differenz wird gebucht.
create or replace function public.inventur_buchen(p_artikel uuid, p_gezaehlt numeric, p_datum date default current_date)
returns numeric
language plpgsql security definer set search_path = public as $$
declare v_diff numeric;
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  if p_gezaehlt < 0 then raise exception 'Bestand kann nicht negativ sein'; end if;
  select p_gezaehlt - coalesce(sum(menge), 0) into v_diff
    from lagerbewegungen where artikel_id = p_artikel and betrieb_id = mein_betrieb();
  if not exists (select 1 from lagerartikel where id = p_artikel and betrieb_id = mein_betrieb()) then
    raise exception 'Unbekannter Artikel';
  end if;
  if v_diff <> 0 then
    insert into lagerbewegungen (betrieb_id, artikel_id, datum, art, menge, bemerkung)
    values (mein_betrieb(), p_artikel, p_datum, 'Inventur', v_diff, 'Inventur: gezählt ' || p_gezaehlt);
  end if;
  return v_diff;
end $$;

revoke all on function public.feldarbeit_speichern(jsonb), public.feldarbeit_buchen(uuid),
  public.feldarbeit_loeschen(uuid), public.inventur_buchen(uuid, numeric, date) from public, anon;
grant execute on function public.feldarbeit_speichern(jsonb), public.feldarbeit_loeschen(uuid),
  public.inventur_buchen(uuid, numeric, date) to authenticated;
-- feldarbeit_buchen nur intern

-- ---------------------------------------------------------------------
-- Nährstoffe je Feld, Jahr und Status (aus Feldarbeiten mit Mitteln)
-- Das ist die AUSGEBRACHTE bzw. GEPLANTE Menge, kein Bodenvorrat.
-- ---------------------------------------------------------------------
create view public.naehrstoffe_je_feld with (security_invoker = true) as
select ff.betrieb_id, ff.feld_id, extract(year from fa.datum)::int as jahr, fa.status,
       round(sum(m.menge_je_ha * coalesce(a.n_je_einheit, 0)), 1)    as n_kg_ha,
       round(sum(m.menge_je_ha * coalesce(a.p2o5_je_einheit, 0)), 1) as p2o5_kg_ha,
       round(sum(m.menge_je_ha * coalesce(a.k2o_je_einheit, 0)), 1)  as k2o_kg_ha,
       round(sum(m.menge_je_ha * coalesce(a.mg_je_einheit, 0)), 1)   as mg_kg_ha,
       round(sum(m.menge_je_ha * coalesce(a.n_je_einheit, 0) * ff.flaeche_m2 / 10000), 1)    as n_kg,
       round(sum(m.menge_je_ha * coalesce(a.p2o5_je_einheit, 0) * ff.flaeche_m2 / 10000), 1) as p2o5_kg,
       round(sum(m.menge_je_ha * coalesce(a.k2o_je_einheit, 0) * ff.flaeche_m2 / 10000), 1)  as k2o_kg,
       count(distinct fa.id) as anzahl_gaben
from public.feldarbeit_felder ff
join public.feldarbeiten fa on fa.id = ff.feldarbeit_id and fa.geloescht_am is null
join public.feldarbeit_mittel m on m.feldarbeit_id = fa.id
join public.lagerartikel a on a.id = m.artikel_id
where a.n_je_einheit is not null or a.p2o5_je_einheit is not null or a.k2o_je_einheit is not null
group by ff.betrieb_id, ff.feld_id, extract(year from fa.datum), fa.status;

-- ---------------------------------------------------------------------
-- Zugriffsregeln
-- ---------------------------------------------------------------------
alter table public.lagerartikel      enable row level security;
alter table public.lagerbewegungen   enable row level security;
alter table public.feldarbeiten      enable row level security;
alter table public.feldarbeit_felder enable row level security;
alter table public.feldarbeit_mittel enable row level security;

create policy la_lesen   on public.lagerartikel for select using (betrieb_id = public.mein_betrieb());
create policy la_neu     on public.lagerartikel for insert with check (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
create policy la_aendern on public.lagerartikel for update using (betrieb_id = public.mein_betrieb() and public.darf_verwalten());

-- Manuelle Buchungen (ohne Quelle) dürfen Verwaltende anlegen. Ändern/Löschen nie direkt: Fehler werden mit einer Korrektur gebucht.
create policy lb_lesen   on public.lagerbewegungen for select using (betrieb_id = public.mein_betrieb());
create policy lb_neu     on public.lagerbewegungen for insert with check (
  betrieb_id = public.mein_betrieb() and public.darf_verwalten() and quelle_id is null
  and art in ('Eingang', 'Korrektur', 'Verbrauch'));

-- Feldarbeiten: lesen alle im Betrieb; schreiben nur über feldarbeit_speichern / feldarbeit_loeschen.
create policy fa_lesen   on public.feldarbeiten      for select using (betrieb_id = public.mein_betrieb());
create policy faf_lesen  on public.feldarbeit_felder for select using (betrieb_id = public.mein_betrieb());
create policy fam_lesen  on public.feldarbeit_mittel for select using (betrieb_id = public.mein_betrieb());

-- Supabase-Standardrechte für neue Tabellen sicherstellen (RLS regelt den Rest)
grant select, insert, update on public.lagerartikel to authenticated;
grant select, insert on public.lagerbewegungen to authenticated;
grant select on public.feldarbeiten, public.feldarbeit_felder, public.feldarbeit_mittel,
  public.lagerbestand, public.naehrstoffe_je_feld to authenticated;

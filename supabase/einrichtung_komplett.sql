-- =====================================================================
-- Hofmanager SchweikFarm – KOMPLETTE Ersteinrichtung der Datenbank (alle Migrationen)
-- Nur EINMAL in einer LEEREN Datenbank ausführen: Supabase › SQL Editor › einfügen › Run
-- Bestehende Datenbank: stattdessen nur die neuen Dateien aus supabase/migrations einspielen.
-- Erzeugt mit scripts/einrichtung_erstellen.sh – nicht von Hand ändern.
-- =====================================================================

-- >>> supabase/migrations/20261102000001_grundsystem.sql
-- =====================================================================
-- Hofmanager – Migration 1: Grundsystem, Felder, Kulturen, Anbau
-- Einspielen: Supabase › SQL Editor › gesamten Inhalt einfügen › Run
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Rollen und Betrieb
-- ---------------------------------------------------------------------
create type public.rolle as enum ('administrator', 'betriebsleiter', 'mitarbeiter', 'lesen');

create table public.betriebe (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) > 0),
  adresse       text,
  betriebsnummer text,
  kanton        text not null default 'ZH',
  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz not null default now(),
  version       integer not null default 1
);

create table public.benutzer_profile (
  id           uuid primary key references auth.users (id) on delete cascade,
  betrieb_id   uuid not null references public.betriebe (id),
  name         text not null,
  rolle        public.rolle not null default 'mitarbeiter',
  aktiv        boolean not null default true,
  erstellt_am  timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  version      integer not null default 1
);

-- Hilfsfunktionen für Zugriffsregeln (security definer, damit RLS sie nutzen kann)
create or replace function public.mein_betrieb() returns uuid
language sql stable security definer set search_path = public as $$
  select betrieb_id from benutzer_profile where id = auth.uid() and aktiv
$$;

create or replace function public.meine_rolle() returns public.rolle
language sql stable security definer set search_path = public as $$
  select rolle from benutzer_profile where id = auth.uid() and aktiv
$$;

-- darf Stammdaten bearbeiten (Felder, Kulturen, Lager …)
create or replace function public.darf_verwalten() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.meine_rolle() in ('administrator', 'betriebsleiter'), false)
$$;

-- darf Arbeiten erfassen (alle ausser "lesen")
create or replace function public.darf_erfassen() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.meine_rolle() in ('administrator', 'betriebsleiter', 'mitarbeiter'), false)
$$;

-- ---------------------------------------------------------------------
-- Gemeinsame Trigger: Zeitstempel, Benutzer, Version
-- ---------------------------------------------------------------------
create or replace function public.setze_metadaten() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.erstellt_am := coalesce(new.erstellt_am, now());
    new.geaendert_am := now();
    new.version := 1;
  else
    new.erstellt_am := old.erstellt_am;
    new.geaendert_am := now();
    new.version := old.version + 1;
  end if;
  return new;
end $$;

-- Optimistische Sperre: Client sendet die gelesene Version mit; passt sie nicht, wird abgelehnt.
-- (Wird beim späteren Offline-Abgleich wichtig.)
create or replace function public.pruefe_version() returns trigger
language plpgsql as $$
begin
  if new.version is distinct from old.version then
    raise exception 'Datensatz wurde inzwischen geändert (Version % statt %). Bitte neu laden.', new.version, old.version
      using errcode = '40001';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Änderungsprotokoll
-- ---------------------------------------------------------------------
create table public.aenderungsprotokoll (
  id           bigint generated always as identity primary key,
  betrieb_id   uuid,
  tabelle      text not null,
  datensatz_id uuid not null,
  aktion       text not null check (aktion in ('INSERT', 'UPDATE', 'DELETE')),
  alt          jsonb,
  neu          jsonb,
  benutzer_id  uuid default auth.uid(),
  zeitpunkt    timestamptz not null default now()
);
create index on public.aenderungsprotokoll (tabelle, datensatz_id);

-- Schreibt jede Änderung als alt/neu-JSON ins Protokoll.
-- Tabellen ohne eigene id (feld_parzellen) werden über feld_id protokolliert.
create or replace function public.protokolliere() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into aenderungsprotokoll (betrieb_id, tabelle, datensatz_id, aktion, alt, neu)
  values (
    nullif(r ->> 'betrieb_id', '')::uuid,
    tg_table_name,
    coalesce((r ->> 'id')::uuid, (r ->> 'feld_id')::uuid),
    tg_op,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- ---------------------------------------------------------------------
-- Kulturen (Katalog: betrieb_id null = Standardkultur für alle)
-- ---------------------------------------------------------------------
create table public.kulturen (
  id               uuid primary key default gen_random_uuid(),
  betrieb_id       uuid references public.betriebe (id),
  name             text not null,
  kulturgruppe     text not null,
  farbe            text not null default '#9DCB88' check (farbe ~ '^#[0-9A-Fa-f]{6}$'),
  anbaupause_jahre integer not null default 0 check (anbaupause_jahre between 0 and 10),
  ist_grasland     boolean not null default false,
  aktiv            boolean not null default true,
  erstellt_am      timestamptz not null default now(),
  geaendert_am     timestamptz not null default now(),
  version          integer not null default 1,
  unique nulls not distinct (betrieb_id, name)
);

-- Anbaupausen sind Startwerte für Hinweise, keine Rechtsgrundlage. Bitte mit eigener Praxis/Beratung abgleichen.
insert into public.kulturen (name, kulturgruppe, farbe, anbaupause_jahre, ist_grasland) values
  ('Winterweizen',  'Getreide',     '#EBC35A', 1, false),
  ('Sommerweizen',  'Getreide',     '#E8BD4F', 1, false),
  ('Wintergerste',  'Getreide',     '#D9B26F', 1, false),
  ('Sommergerste',  'Getreide',     '#D3A962', 1, false),
  ('Triticale',     'Getreide',     '#CFA55A', 1, false),
  ('Dinkel',        'Getreide',     '#C99A50', 1, false),
  ('Hafer',         'Getreide',     '#E0C68A', 1, false),
  ('Silomais',      'Mais',         '#F0954A', 0, false),
  ('Körnermais',    'Mais',         '#E8823A', 0, false),
  ('Raps',          'Raps',         '#F5D447', 3, false),
  ('Zuckerrüben',   'Rüben',        '#C77DA8', 3, false),
  ('Kartoffeln',    'Kartoffeln',   '#B98B6E', 3, false),
  ('Sonnenblumen',  'Sonnenblumen', '#F2B705', 3, false),
  ('Eiweisserbsen', 'Leguminosen',  '#8FB8DE', 4, false),
  ('Ackerbohnen',   'Leguminosen',  '#7AA6CF', 4, false),
  ('Soja',          'Leguminosen',  '#9DC3E6', 3, false),
  ('Kunstwiese',    'Kunstwiese',   '#7DB86A', 0, true),
  ('Naturwiese',    'Dauergrünland','#A9D18E', 0, true),
  ('Weide',         'Dauergrünland','#B9DB9F', 0, true),
  ('Brache',        'Brache',       '#C9C2B0', 0, false);

-- ---------------------------------------------------------------------
-- Felder und Parzellen
-- ---------------------------------------------------------------------
create table public.felder (
  id            uuid primary key default gen_random_uuid(),
  betrieb_id    uuid not null references public.betriebe (id),
  feldnummer    text not null,
  name          text not null check (length(trim(name)) > 0),
  flaeche_m2    numeric(12, 1) not null check (flaeche_m2 > 0),
  gemeinde      text,
  nutzungsart   text not null default 'Ackerland'
                check (nutzungsart in ('Ackerland', 'Kunstwiese', 'Dauergrünland', 'Weide', 'Spezialkultur', 'Andere')),
  bodenart      text,
  hangneigung_prozent numeric(4, 1) check (hangneigung_prozent between 0 and 100),
  status        text not null default 'bewirtschaftet'
                check (status in ('bewirtschaftet', 'verpachtet', 'nicht bewirtschaftet', 'aufgegeben')),
  bemerkungen   text,
  geloescht_am  timestamptz,
  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz not null default now(),
  version       integer not null default 1,
  unique (betrieb_id, feldnummer)
);

create table public.parzellen (
  id              uuid primary key default gen_random_uuid(),
  betrieb_id      uuid not null references public.betriebe (id),
  parzellennummer text not null,
  gemeinde        text not null,
  flaeche_m2      numeric(12, 1) check (flaeche_m2 > 0),
  bemerkungen     text,
  erstellt_am     timestamptz not null default now(),
  geaendert_am    timestamptz not null default now(),
  version         integer not null default 1,
  unique (betrieb_id, gemeinde, parzellennummer)
);

create table public.feld_parzellen (
  feld_id     uuid not null references public.felder (id) on delete cascade,
  parzelle_id uuid not null references public.parzellen (id) on delete cascade,
  betrieb_id  uuid not null references public.betriebe (id),
  primary key (feld_id, parzelle_id)
);

-- ---------------------------------------------------------------------
-- Anbau = Kultur je Feld und Jahr (Grundlage für Fruchtfolge und Historie)
-- ---------------------------------------------------------------------
create table public.anbau (
  id           uuid primary key default gen_random_uuid(),
  betrieb_id   uuid not null references public.betriebe (id),
  feld_id      uuid not null references public.felder (id),
  kultur_id    uuid not null references public.kulturen (id),
  jahr         integer not null check (jahr between 1990 and 2100),
  art          text not null default 'Hauptkultur' check (art in ('Hauptkultur', 'Zwischenkultur')),
  status       text not null default 'geplant' check (status in ('geplant', 'ist')),
  flaeche_m2   numeric(12, 1) check (flaeche_m2 > 0), -- leer = ganzes Feld
  saatdatum    date,
  erntedatum   date,
  bemerkungen  text,
  erstellt_am  timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  version      integer not null default 1,
  unique (feld_id, jahr, art)
);
create index on public.anbau (betrieb_id, jahr);

-- ---------------------------------------------------------------------
-- Trigger anhängen
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['betriebe', 'benutzer_profile', 'kulturen', 'felder', 'parzellen', 'anbau'] loop
    execute format('create trigger a_version before update on public.%I for each row execute function public.pruefe_version()', t);
    execute format('create trigger b_metadaten before insert or update on public.%I for each row execute function public.setze_metadaten()', t);
  end loop;
  foreach t in array array['benutzer_profile', 'kulturen', 'felder', 'parzellen', 'feld_parzellen', 'anbau'] loop
    execute format('create trigger z_protokoll after insert or update or delete on public.%I for each row execute function public.protokolliere()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Zugriffsregeln (Row Level Security)
-- ---------------------------------------------------------------------
alter table public.betriebe            enable row level security;
alter table public.benutzer_profile    enable row level security;
alter table public.aenderungsprotokoll enable row level security;
alter table public.kulturen            enable row level security;
alter table public.felder              enable row level security;
alter table public.parzellen           enable row level security;
alter table public.feld_parzellen      enable row level security;
alter table public.anbau               enable row level security;

create policy betrieb_lesen    on public.betriebe for select using (id = public.mein_betrieb());
create policy betrieb_aendern  on public.betriebe for update using (id = public.mein_betrieb() and public.meine_rolle() = 'administrator');

create policy profile_lesen    on public.benutzer_profile for select using (betrieb_id = public.mein_betrieb());
create policy profile_admin    on public.benutzer_profile for update using (betrieb_id = public.mein_betrieb() and public.meine_rolle() = 'administrator');

create policy protokoll_lesen  on public.aenderungsprotokoll for select
  using (betrieb_id = public.mein_betrieb() and public.darf_verwalten());

create policy kulturen_lesen   on public.kulturen for select using (betrieb_id is null or betrieb_id = public.mein_betrieb());
create policy kulturen_neu     on public.kulturen for insert with check (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
create policy kulturen_aendern on public.kulturen for update using (betrieb_id = public.mein_betrieb() and public.darf_verwalten());

-- Felder, Parzellen, Anbau: alle im Betrieb lesen, nur Verwaltende ändern. Löschen nur weich (geloescht_am).
create policy felder_lesen     on public.felder for select using (betrieb_id = public.mein_betrieb());
create policy felder_neu       on public.felder for insert with check (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
create policy felder_aendern   on public.felder for update using (betrieb_id = public.mein_betrieb() and public.darf_verwalten());

create policy parz_lesen       on public.parzellen for select using (betrieb_id = public.mein_betrieb());
create policy parz_neu         on public.parzellen for insert with check (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
create policy parz_aendern     on public.parzellen for update using (betrieb_id = public.mein_betrieb() and public.darf_verwalten());

create policy fp_lesen         on public.feld_parzellen for select using (betrieb_id = public.mein_betrieb());
create policy fp_neu           on public.feld_parzellen for insert with check (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
create policy fp_loeschen      on public.feld_parzellen for delete using (betrieb_id = public.mein_betrieb() and public.darf_verwalten());

create policy anbau_lesen      on public.anbau for select using (betrieb_id = public.mein_betrieb());
create policy anbau_neu        on public.anbau for insert with check (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
create policy anbau_aendern    on public.anbau for update using (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
create policy anbau_loeschen   on public.anbau for delete using (betrieb_id = public.mein_betrieb() and public.darf_verwalten() and status = 'geplant');

-- ---------------------------------------------------------------------
-- Ersteinrichtung: Der erste angemeldete Benutzer legt den Betrieb an und wird Administrator.
-- ---------------------------------------------------------------------
create or replace function public.betrieb_einrichten(p_betriebsname text, p_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;
  if exists (select 1 from benutzer_profile where id = auth.uid()) then
    raise exception 'Dieser Benutzer ist bereits einem Betrieb zugeordnet';
  end if;
  if exists (select 1 from betriebe) then
    raise exception 'Es existiert bereits ein Betrieb. Bitte vom Administrator einladen lassen.';
  end if;
  insert into betriebe (name) values (trim(p_betriebsname)) returning id into v_betrieb;
  insert into benutzer_profile (id, betrieb_id, name, rolle) values (auth.uid(), v_betrieb, trim(p_name), 'administrator');
  return v_betrieb;
end $$;

revoke all on function public.betrieb_einrichten(text, text) from public, anon;
grant execute on function public.betrieb_einrichten(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Auswertungssicht: Fläche je Kultur und Jahr
-- ---------------------------------------------------------------------
create view public.flaeche_je_kultur with (security_invoker = true) as
select a.betrieb_id, a.jahr, k.id as kultur_id, k.name as kultur, k.farbe,
       sum(coalesce(a.flaeche_m2, f.flaeche_m2)) as flaeche_m2,
       count(*) as anzahl_felder
from public.anbau a
join public.felder f on f.id = a.feld_id and f.geloescht_am is null
join public.kulturen k on k.id = a.kultur_id
where a.art = 'Hauptkultur'
group by a.betrieb_id, a.jahr, k.id, k.name, k.farbe;

-- >>> supabase/migrations/20261102000002_lager_feldarbeiten.sql
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

-- >>> supabase/migrations/20261102000003_hofkarte.sql
-- =====================================================================
-- Hofmanager – Migration 3: Hof-Ansicht (Feldgrenzen, Gebäude auf der Karte)
-- Einspielen: Supabase › SQL Editor › gesamten Inhalt einfügen › Run
-- =====================================================================

-- Feldgrenze als GeoJSON-Geometrie (Polygon oder MultiPolygon, Koordinaten WGS84 [Länge, Breite]).
alter table public.felder add column geometrie jsonb
  check (geometrie is null or (geometrie ->> 'type') in ('Polygon', 'MultiPolygon'));
-- Aus der Zeichnung berechnete Fläche (zur Kontrolle neben der erfassten Fläche)
alter table public.felder add column flaeche_gezeichnet_m2 numeric(12, 1) check (flaeche_gezeichnet_m2 > 0);

-- Gebäude und Orte auf dem Hof
create table public.hofobjekte (
  id           uuid primary key default gen_random_uuid(),
  betrieb_id   uuid not null references public.betriebe (id),
  typ          text not null check (typ in ('Hof', 'Wohnhaus', 'Scheune', 'Lager', 'Maschinenhalle', 'Silo', 'Werkstatt', 'Düngerlager', 'Andere')),
  name         text not null check (length(trim(name)) > 0),
  breite       numeric(10, 7) not null check (breite between 45 and 48.5),  -- Schweiz
  laenge       numeric(10, 7) not null check (laenge between 5.5 and 11),
  link         text check (link is null or link ~ '^/[a-z0-9/_-]*$'),         -- interne Seite, z. B. /lager
  bemerkungen  text,
  erstellt_am  timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  version      integer not null default 1
);

create trigger a_version before update on public.hofobjekte for each row execute function public.pruefe_version();
create trigger b_metadaten before insert or update on public.hofobjekte for each row execute function public.setze_metadaten();
create trigger z_protokoll after insert or update or delete on public.hofobjekte for each row execute function public.protokolliere();

alter table public.hofobjekte enable row level security;
create policy ho_lesen    on public.hofobjekte for select using (betrieb_id = public.mein_betrieb());
create policy ho_neu      on public.hofobjekte for insert with check (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
create policy ho_aendern  on public.hofobjekte for update using (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
create policy ho_loeschen on public.hofobjekte for delete using (betrieb_id = public.mein_betrieb() and public.darf_verwalten());

grant select, insert, update, delete on public.hofobjekte to authenticated;

-- >>> supabase/migrations/20261102000004_maschinen_partner_hinweise.sql
-- =====================================================================
-- Hofmanager – Migration 4: Partner, Maschinen, Wartung, Feldhinweise,
--                           Felder teilen und zusammenführen
-- Einspielen: Supabase › SQL Editor › gesamten Inhalt einfügen › Run
-- Voraussetzung: Migrationen 1–3 sind eingespielt.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Partner (Lohnunternehmen, Mechaniker, Händler …)
-- ---------------------------------------------------------------------
create table public.partner (
  id            uuid primary key default gen_random_uuid(),
  betrieb_id    uuid not null references public.betriebe (id),
  name          text not null check (length(trim(name)) > 0),
  art           text not null check (art in (
                  'Lohnunternehmen', 'Mechaniker/Werkstatt', 'Händler/Lieferant', 'Berater',
                  'Abnehmer/Käufer', 'Behörde/Kontrolle', 'Andere')),
  kontaktperson text,
  telefon       text,
  mobile        text,
  email         text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  adresse       text,
  leistungen    text,
  bemerkungen   text,
  aktiv         boolean not null default true,
  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz not null default now(),
  version       integer not null default 1
);

-- ---------------------------------------------------------------------
-- Maschinen und Geräte
-- ---------------------------------------------------------------------
create table public.maschinen (
  id                uuid primary key default gen_random_uuid(),
  betrieb_id        uuid not null references public.betriebe (id),
  kategorie         text not null check (kategorie in (
                      'Traktor', 'Hoflader/Teleskoplader', 'Mähwerk', 'Kreiselheuer/Zetter', 'Schwader', 'Ladewagen', 'Presse',
                      'Kreiselegge', 'Pflug', 'Grubber', 'Sämaschine', 'Walze', 'Düngerstreuer', 'Feldspritze',
                      'Güllefass', 'Anhänger', 'Mulcher', 'Andere')),
  name              text not null check (length(trim(name)) > 0),
  hersteller        text,
  modell            text,
  baujahr           integer check (baujahr between 1900 and 2100),
  seriennummer      text,
  kennzeichen       text,           -- Kontrollschild
  stammnummer       text,           -- Fahrzeugausweis
  leistung_ps       numeric(6, 1) check (leistung_ps > 0),
  leergewicht_kg    numeric(8, 0) check (leergewicht_kg > 0),
  gesamtgewicht_kg  numeric(8, 0) check (gesamtgewicht_kg > 0),
  hoechstgeschw_kmh numeric(5, 1) check (hoechstgeschw_kmh > 0),
  arbeitsbreite_m   numeric(5, 2) check (arbeitsbreite_m > 0),
  reifen_vorne      text,
  reifen_hinten     text,
  motoroel          text,
  hydraulikoel      text,
  getriebeoel       text,
  tankinhalt_l      numeric(6, 1) check (tankinhalt_l > 0),
  mfk_faellig       date,           -- nächste Motorfahrzeugkontrolle
  versicherung      text,
  kaufdatum         date,
  kaufpreis         numeric(12, 2) check (kaufpreis >= 0),
  betriebsstunden   numeric(9, 1) check (betriebsstunden >= 0),
  standort_id       uuid references public.hofobjekte (id) on delete set null,
  status            text not null default 'in Betrieb' check (status in ('in Betrieb', 'ausser Betrieb', 'verkauft')),
  bemerkungen       text,
  erstellt_am       timestamptz not null default now(),
  geaendert_am      timestamptz not null default now(),
  version           integer not null default 1
);

create table public.wartungsplaene (
  id                uuid primary key default gen_random_uuid(),
  betrieb_id        uuid not null references public.betriebe (id),
  maschine_id       uuid not null references public.maschinen (id) on delete cascade,
  bezeichnung       text not null check (length(trim(bezeichnung)) > 0),
  intervall_tage    integer check (intervall_tage > 0),
  intervall_stunden numeric(8, 1) check (intervall_stunden > 0),
  aktiv             boolean not null default true,
  erstellt_am       timestamptz not null default now(),
  geaendert_am      timestamptz not null default now(),
  version           integer not null default 1,
  check (intervall_tage is not null or intervall_stunden is not null)
);

create table public.maschinen_eintraege (
  id               uuid primary key default gen_random_uuid(),
  betrieb_id       uuid not null references public.betriebe (id),
  maschine_id      uuid not null references public.maschinen (id),
  art              text not null check (art in ('Wartung', 'Reparatur', 'Beobachtung', 'Kontrolle')),
  datum            date not null,
  betriebsstunden  numeric(9, 1) check (betriebsstunden >= 0),
  titel            text not null check (length(trim(titel)) > 0),
  beschreibung     text,
  kosten           numeric(12, 2) check (kosten >= 0),
  arbeitszeit_h    numeric(6, 2) check (arbeitszeit_h >= 0),
  partner_id       uuid references public.partner (id),
  wartungsplan_id  uuid references public.wartungsplaene (id) on delete set null,
  offen            boolean not null default false, -- offene Beobachtung / offener Mangel
  erstellt_von     uuid default auth.uid(),
  erstellt_am      timestamptz not null default now(),
  geaendert_am     timestamptz not null default now(),
  version          integer not null default 1
);
create index on public.maschinen_eintraege (maschine_id, datum desc);

create table public.eintrag_teile (
  id          uuid primary key default gen_random_uuid(),
  betrieb_id  uuid not null references public.betriebe (id),
  eintrag_id  uuid not null references public.maschinen_eintraege (id) on delete cascade,
  artikel_id  uuid not null references public.lagerartikel (id),
  menge       numeric(14, 3) not null check (menge > 0),
  unique (eintrag_id, artikel_id)
);

-- Fälligkeit je Wartungsplan: letzte Ausführung + Intervall
create view public.wartung_faelligkeit with (security_invoker = true) as
select p.id as plan_id, p.betrieb_id, p.maschine_id, p.bezeichnung, p.intervall_tage, p.intervall_stunden,
       l.datum as zuletzt_am, l.betriebsstunden as zuletzt_stunden, m.betriebsstunden as stunden_aktuell,
       case when p.intervall_tage is not null then coalesce(l.datum, m.erstellt_am::date) + p.intervall_tage end as faellig_am,
       case when p.intervall_stunden is not null then coalesce(l.betriebsstunden, 0) + p.intervall_stunden end as faellig_stunden,
       (
         (p.intervall_tage is not null and coalesce(l.datum, m.erstellt_am::date) + p.intervall_tage <= current_date + 14)
         or (p.intervall_stunden is not null and m.betriebsstunden is not null
             and m.betriebsstunden >= coalesce(l.betriebsstunden, 0) + p.intervall_stunden - 10)
       ) as bald_faellig,
       (
         (p.intervall_tage is not null and coalesce(l.datum, m.erstellt_am::date) + p.intervall_tage < current_date)
         or (p.intervall_stunden is not null and m.betriebsstunden is not null
             and m.betriebsstunden >= coalesce(l.betriebsstunden, 0) + p.intervall_stunden)
       ) as ueberfaellig
from public.wartungsplaene p
join public.maschinen m on m.id = p.maschine_id
left join lateral (
  select e.datum, e.betriebsstunden from public.maschinen_eintraege e
   where e.wartungsplan_id = p.id order by e.datum desc, e.betriebsstunden desc nulls last limit 1
) l on true
where p.aktiv and m.status <> 'verkauft';

-- ---------------------------------------------------------------------
-- Feldarbeiten: Maschine, Gerät, Partner verknüpfen
-- ---------------------------------------------------------------------
alter table public.feldarbeiten add column maschine_id uuid references public.maschinen (id);
alter table public.feldarbeiten add column geraet_id   uuid references public.maschinen (id);
alter table public.feldarbeiten add column partner_id  uuid references public.partner (id);

-- ---------------------------------------------------------------------
-- Feldhinweise (z. B. «Achtung: 3 Metallschächte»)
-- ---------------------------------------------------------------------
create table public.feld_hinweise (
  id           uuid primary key default gen_random_uuid(),
  betrieb_id   uuid not null references public.betriebe (id),
  feld_id      uuid not null references public.felder (id),
  art          text not null default 'Hinweis' check (art in ('Gefahr', 'Hinweis', 'Info')),
  text         text not null check (length(trim(text)) > 0),
  breite       numeric(10, 7) check (breite between 45 and 48.5),
  laenge       numeric(10, 7) check (laenge between 5.5 and 11),
  aktiv        boolean not null default true,
  erstellt_von uuid default auth.uid(),
  erstellt_am  timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  version      integer not null default 1,
  check ((breite is null) = (laenge is null))
);
create index on public.feld_hinweise (feld_id);

-- ---------------------------------------------------------------------
-- Felder: Herkunft für Teilen/Zusammenführen
-- ---------------------------------------------------------------------
alter table public.felder add column vorgaenger uuid[] not null default '{}';
alter table public.felder add column zusammengefuehrt_in uuid references public.felder (id);
alter table public.felder drop constraint if exists felder_status_check;
alter table public.felder add constraint felder_status_check
  check (status in ('bewirtschaftet', 'verpachtet', 'nicht bewirtschaftet', 'aufgegeben', 'zusammengeführt'));

-- ---------------------------------------------------------------------
-- Trigger, Protokoll
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['partner', 'maschinen', 'wartungsplaene', 'maschinen_eintraege', 'feld_hinweise'] loop
    execute format('create trigger a_version before update on public.%I for each row execute function public.pruefe_version()', t);
    execute format('create trigger b_metadaten before insert or update on public.%I for each row execute function public.setze_metadaten()', t);
  end loop;
  foreach t in array array['partner', 'maschinen', 'wartungsplaene', 'maschinen_eintraege', 'eintrag_teile', 'feld_hinweise'] loop
    execute format('create trigger z_protokoll after insert or update or delete on public.%I for each row execute function public.protokolliere()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Maschineneintrag speichern (mit Ersatzteilen und Lagerbuchung) – eine Transaktion
-- p: {"id"?, "version"?, "maschine_id", "art", "datum", "betriebsstunden"?, "titel", "beschreibung"?, "kosten"?,
--     "arbeitszeit_h"?, "partner_id"?, "wartungsplan_id"?, "offen"?, "teile": [{"artikel_id", "menge"}]}
-- ---------------------------------------------------------------------
create or replace function public.maschineneintrag_speichern(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  v_id      uuid := nullif(p ->> 'id', '')::uuid;
  v_maschine maschinen%rowtype;
  v_stunden numeric := nullif(p ->> 'betriebsstunden', '')::numeric;
  t         jsonb;
begin
  if v_betrieb is null or not darf_erfassen() then raise exception 'Keine Berechtigung'; end if;
  select * into v_maschine from maschinen where id = (p ->> 'maschine_id')::uuid and betrieb_id = v_betrieb;
  if not found then raise exception 'Unbekannte Maschine'; end if;
  if (p ->> 'datum')::date > current_date then raise exception 'Datum liegt in der Zukunft'; end if;

  if v_id is null then
    insert into maschinen_eintraege (betrieb_id, maschine_id, art, datum, betriebsstunden, titel, beschreibung, kosten,
                                     arbeitszeit_h, partner_id, wartungsplan_id, offen)
    values (v_betrieb, v_maschine.id, p ->> 'art', (p ->> 'datum')::date, v_stunden, p ->> 'titel',
            nullif(p ->> 'beschreibung', ''), nullif(p ->> 'kosten', '')::numeric, nullif(p ->> 'arbeitszeit_h', '')::numeric,
            nullif(p ->> 'partner_id', '')::uuid, nullif(p ->> 'wartungsplan_id', '')::uuid, coalesce((p ->> 'offen')::boolean, false))
    returning id into v_id;
  else
    if not darf_verwalten() and not exists (select 1 from maschinen_eintraege where id = v_id and erstellt_von = auth.uid()) then
      raise exception 'Nur eigene Einträge können geändert werden';
    end if;
    update maschinen_eintraege set
      art = p ->> 'art', datum = (p ->> 'datum')::date, betriebsstunden = v_stunden, titel = p ->> 'titel',
      beschreibung = nullif(p ->> 'beschreibung', ''), kosten = nullif(p ->> 'kosten', '')::numeric,
      arbeitszeit_h = nullif(p ->> 'arbeitszeit_h', '')::numeric, partner_id = nullif(p ->> 'partner_id', '')::uuid,
      wartungsplan_id = nullif(p ->> 'wartungsplan_id', '')::uuid, offen = coalesce((p ->> 'offen')::boolean, false),
      version = coalesce((p ->> 'version')::int, version)
    where id = v_id and betrieb_id = v_betrieb;
    if not found then raise exception 'Eintrag nicht gefunden'; end if;
    delete from eintrag_teile where eintrag_id = v_id;
  end if;

  for t in select * from jsonb_array_elements(coalesce(p -> 'teile', '[]')) loop
    if not exists (select 1 from lagerartikel where id = (t ->> 'artikel_id')::uuid and betrieb_id = v_betrieb) then
      raise exception 'Unbekannter Artikel';
    end if;
    insert into eintrag_teile (betrieb_id, eintrag_id, artikel_id, menge)
    values (v_betrieb, v_id, (t ->> 'artikel_id')::uuid, (t ->> 'menge')::numeric);
  end loop;

  -- Lagerbuchungen abgleichen: je Eintrag und Artikel höchstens eine Buchung
  delete from lagerbewegungen b where b.quelle_typ = 'maschineneintrag' and b.quelle_id = v_id
     and not exists (select 1 from eintrag_teile t2 where t2.eintrag_id = v_id and t2.artikel_id = b.artikel_id);
  insert into lagerbewegungen (betrieb_id, artikel_id, datum, art, menge, preis_je_einheit, quelle_typ, quelle_id, bemerkung)
  select v_betrieb, et.artikel_id, (p ->> 'datum')::date, 'Verbrauch', -et.menge, a.einkaufspreis, 'maschineneintrag', v_id,
         v_maschine.name || ': ' || (p ->> 'titel')
    from eintrag_teile et join lagerartikel a on a.id = et.artikel_id
   where et.eintrag_id = v_id and a.lagerfuehrung
  on conflict (quelle_typ, quelle_id, artikel_id) where quelle_id is not null
  do update set menge = excluded.menge, datum = excluded.datum, bemerkung = excluded.bemerkung
    where lagerbewegungen.menge is distinct from excluded.menge or lagerbewegungen.datum is distinct from excluded.datum;

  -- Betriebsstundenzähler nachführen (nur nach oben)
  if v_stunden is not null and (v_maschine.betriebsstunden is null or v_stunden > v_maschine.betriebsstunden) then
    update maschinen set betriebsstunden = v_stunden where id = v_maschine.id;
  end if;
  return v_id;
end $$;

create or replace function public.maschineneintrag_loeschen(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not darf_verwalten() and not exists (
    select 1 from maschinen_eintraege where id = p_id and erstellt_von = auth.uid() and betrieb_id = mein_betrieb()) then
    raise exception 'Keine Berechtigung';
  end if;
  delete from lagerbewegungen where quelle_typ = 'maschineneintrag' and quelle_id = p_id and betrieb_id = mein_betrieb();
  delete from maschinen_eintraege where id = p_id and betrieb_id = mein_betrieb();
  if not found then raise exception 'Eintrag nicht gefunden'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Feldarbeit speichern: erweitert um Maschine, Gerät, Partner
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
  if nullif(p ->> 'maschine_id', '') is not null and not exists (select 1 from maschinen where id = (p ->> 'maschine_id')::uuid and betrieb_id = v_betrieb)
     or nullif(p ->> 'geraet_id', '') is not null and not exists (select 1 from maschinen where id = (p ->> 'geraet_id')::uuid and betrieb_id = v_betrieb)
     or nullif(p ->> 'partner_id', '') is not null and not exists (select 1 from partner where id = (p ->> 'partner_id')::uuid and betrieb_id = v_betrieb) then
    raise exception 'Unbekannte Maschine oder unbekannter Partner';
  end if;

  if v_id is null then
    insert into feldarbeiten (betrieb_id, datum, arbeitsart, status, dauer_h, maschine, geraet, ausgefuehrt_von, ausbringung, bemerkungen,
                              maschine_id, geraet_id, partner_id)
    values (v_betrieb, v_datum, p ->> 'arbeitsart', v_status, nullif(p ->> 'dauer_h', '')::numeric,
            nullif(p ->> 'maschine', ''), nullif(p ->> 'geraet', ''),
            coalesce(nullif(p ->> 'ausgefuehrt_von', '')::uuid, auth.uid()),
            nullif(p ->> 'ausbringung', ''), nullif(p ->> 'bemerkungen', ''),
            nullif(p ->> 'maschine_id', '')::uuid, nullif(p ->> 'geraet_id', '')::uuid, nullif(p ->> 'partner_id', '')::uuid)
    returning id into v_id;
  else
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
      maschine_id = nullif(p ->> 'maschine_id', '')::uuid, geraet_id = nullif(p ->> 'geraet_id', '')::uuid,
      partner_id = nullif(p ->> 'partner_id', '')::uuid,
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

-- ---------------------------------------------------------------------
-- Feld teilen: ein Teil wird zum neuen Feld, der Rest bleibt im bisherigen Feld.
-- Laufende und geplante Kulturen (ab diesem Jahr) werden auf den neuen Teil übertragen.
-- ---------------------------------------------------------------------
create or replace function public.feld_teilen(
  p_feld uuid, p_name text, p_nutzungsart text, p_teil_m2 numeric,
  p_rest_m2 numeric default null, p_teil_geometrie jsonb default null, p_rest_geometrie jsonb default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_alt  felder%rowtype;
  v_neu  uuid;
  v_rest numeric;
  v_nr   text;
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  select * into v_alt from felder where id = p_feld and betrieb_id = mein_betrieb() and geloescht_am is null for update;
  if not found then raise exception 'Feld nicht gefunden'; end if;
  if p_teil_m2 is null or p_teil_m2 <= 0 then raise exception 'Fläche des Teils fehlt'; end if;
  v_rest := coalesce(p_rest_m2, v_alt.flaeche_m2 - p_teil_m2);
  if v_rest <= 0 then raise exception 'Der Teil muss kleiner sein als das Feld (% m²)', v_alt.flaeche_m2; end if;
  if (p_teil_geometrie is null) <> (p_rest_geometrie is null) then raise exception 'Beide Geometrien oder keine angeben'; end if;

  select coalesce(max(nullif(regexp_replace(feldnummer, '\D', '', 'g'), '')::int), 0) + 1 || ''
    into v_nr from felder where betrieb_id = v_alt.betrieb_id;

  insert into felder (betrieb_id, feldnummer, name, flaeche_m2, gemeinde, nutzungsart, bodenart, hangneigung_prozent,
                      status, geometrie, flaeche_gezeichnet_m2, vorgaenger, bemerkungen)
  values (v_alt.betrieb_id, v_nr, trim(p_name), round(p_teil_m2, 1), v_alt.gemeinde, coalesce(p_nutzungsart, v_alt.nutzungsart),
          v_alt.bodenart, v_alt.hangneigung_prozent, 'bewirtschaftet', p_teil_geometrie,
          case when p_teil_geometrie is not null then round(p_teil_m2, 1) end,
          array[v_alt.id], 'Abgetrennt von ' || v_alt.name || ' am ' || to_char(current_date, 'DD.MM.YYYY'))
  returning id into v_neu;

  update felder set
    flaeche_m2 = round(v_rest, 1),
    geometrie = coalesce(p_rest_geometrie, case when p_teil_geometrie is null then geometrie end),
    flaeche_gezeichnet_m2 = case when p_rest_geometrie is not null then round(v_rest, 1)
                                 when p_teil_geometrie is null then flaeche_gezeichnet_m2 end
  where id = v_alt.id;

  insert into anbau (betrieb_id, feld_id, kultur_id, jahr, art, status, saatdatum, bemerkungen)
  select betrieb_id, v_neu, kultur_id, jahr, art, status, saatdatum, 'übernommen von ' || v_alt.name
    from anbau where feld_id = v_alt.id and jahr >= extract(year from current_date)::int;

  return v_neu;
end $$;

-- ---------------------------------------------------------------------
-- Felder zusammenführen: die anderen Felder gehen im Zielfeld auf.
-- Ihre Historie bleibt erhalten (Status «zusammengeführt»), Hinweise wandern mit.
-- ---------------------------------------------------------------------
create or replace function public.felder_zusammenfuehren(
  p_ziel uuid, p_andere uuid[], p_geometrie jsonb default null, p_flaeche_m2 numeric default null, p_name text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_summe numeric;
  v_anzahl int;
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  if p_andere is null or cardinality(p_andere) = 0 or p_ziel = any (p_andere) then raise exception 'Felder für das Zusammenführen wählen'; end if;
  select count(*), sum(flaeche_m2) into v_anzahl, v_summe from felder
   where id = any (p_andere || p_ziel) and betrieb_id = mein_betrieb() and geloescht_am is null and status <> 'zusammengeführt';
  if v_anzahl <> cardinality(p_andere) + 1 then raise exception 'Mindestens ein Feld wurde nicht gefunden'; end if;

  update felder set
    flaeche_m2 = round(coalesce(p_flaeche_m2, v_summe), 1),
    geometrie = p_geometrie,
    flaeche_gezeichnet_m2 = case when p_geometrie is not null then round(coalesce(p_flaeche_m2, v_summe), 1) end,
    vorgaenger = vorgaenger || p_andere,
    name = coalesce(nullif(trim(p_name), ''), name)
  where id = p_ziel;

  update felder set status = 'zusammengeführt', zusammengefuehrt_in = p_ziel where id = any (p_andere);
  delete from anbau where feld_id = any (p_andere) and status = 'geplant' and jahr > extract(year from current_date)::int;
  update feld_hinweise set feld_id = p_ziel where feld_id = any (p_andere);
end $$;

revoke all on function public.maschineneintrag_speichern(jsonb), public.maschineneintrag_loeschen(uuid),
  public.feld_teilen(uuid, text, text, numeric, numeric, jsonb, jsonb),
  public.felder_zusammenfuehren(uuid, uuid[], jsonb, numeric, text) from public, anon;
grant execute on function public.maschineneintrag_speichern(jsonb), public.maschineneintrag_loeschen(uuid),
  public.feld_teilen(uuid, text, text, numeric, numeric, jsonb, jsonb),
  public.felder_zusammenfuehren(uuid, uuid[], jsonb, numeric, text) to authenticated;

-- ---------------------------------------------------------------------
-- Zugriffsregeln
-- ---------------------------------------------------------------------
alter table public.partner             enable row level security;
alter table public.maschinen           enable row level security;
alter table public.wartungsplaene      enable row level security;
alter table public.maschinen_eintraege enable row level security;
alter table public.eintrag_teile       enable row level security;
alter table public.feld_hinweise       enable row level security;

create policy pa_lesen   on public.partner for select using (betrieb_id = public.mein_betrieb());
create policy pa_neu     on public.partner for insert with check (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
create policy pa_aendern on public.partner for update using (betrieb_id = public.mein_betrieb() and public.darf_verwalten());

create policy ma_lesen   on public.maschinen for select using (betrieb_id = public.mein_betrieb());
create policy ma_neu     on public.maschinen for insert with check (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
create policy ma_aendern on public.maschinen for update using (betrieb_id = public.mein_betrieb() and public.darf_verwalten());

create policy wp_lesen   on public.wartungsplaene for select using (betrieb_id = public.mein_betrieb());
create policy wp_neu     on public.wartungsplaene for insert with check (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
create policy wp_aendern on public.wartungsplaene for update using (betrieb_id = public.mein_betrieb() and public.darf_verwalten());

-- Einträge und Teile nur über die Funktionen schreiben
create policy me_lesen   on public.maschinen_eintraege for select using (betrieb_id = public.mein_betrieb());
create policy et_lesen   on public.eintrag_teile for select using (betrieb_id = public.mein_betrieb());

-- Hinweise: alle, die erfassen dürfen, können Hinweise melden; löschen nur Verwaltende (sonst deaktivieren)
create policy fh_lesen   on public.feld_hinweise for select using (betrieb_id = public.mein_betrieb());
create policy fh_neu     on public.feld_hinweise for insert with check (betrieb_id = public.mein_betrieb() and public.darf_erfassen());
create policy fh_aendern on public.feld_hinweise for update using (betrieb_id = public.mein_betrieb() and public.darf_erfassen());
create policy fh_loeschen on public.feld_hinweise for delete using (betrieb_id = public.mein_betrieb() and public.darf_verwalten());

grant select, insert, update on public.partner, public.maschinen, public.wartungsplaene to authenticated;
grant select on public.maschinen_eintraege, public.eintrag_teile, public.wartung_faelligkeit to authenticated;
grant select, insert, update, delete on public.feld_hinweise to authenticated;

-- >>> supabase/migrations/20261102000005_auftraege.sql
-- =====================================================================
-- Hofmanager – Migration 5: Aufträge an Partner (Lohnarbeit, Werkstatt)
-- Einspielen: Supabase › SQL Editor › gesamten Inhalt einfügen › Run
-- Voraussetzung: Migrationen 1–4 sind eingespielt.
-- =====================================================================

-- Betriebsangaben für den Briefkopf
alter table public.betriebe add column telefon text;
alter table public.betriebe add column email text;

-- Betriebsmittel, die ein Dienstleister mitbringt, werden dokumentiert, aber nicht vom Lager gebucht.
alter table public.feldarbeit_mittel add column vom_lager boolean not null default true;

create or replace function public.feldarbeit_buchen(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_arbeit feldarbeiten%rowtype;
begin
  select * into v_arbeit from feldarbeiten where id = p_id;
  delete from lagerbewegungen b
   where b.quelle_typ = 'feldarbeit' and b.quelle_id = p_id
     and (v_arbeit.status <> 'erledigt' or v_arbeit.geloescht_am is not null
          or not exists (select 1 from feldarbeit_mittel m
                          where m.feldarbeit_id = p_id and m.artikel_id = b.artikel_id and m.vom_lager));
  if v_arbeit.status = 'erledigt' and v_arbeit.geloescht_am is null then
    insert into lagerbewegungen (betrieb_id, artikel_id, datum, art, menge, preis_je_einheit, quelle_typ, quelle_id, bemerkung)
    select m.betrieb_id, m.artikel_id, v_arbeit.datum, 'Verbrauch', -m.gesamtmenge, a.einkaufspreis, 'feldarbeit', p_id,
           v_arbeit.arbeitsart
      from feldarbeit_mittel m
      join lagerartikel a on a.id = m.artikel_id
     where m.feldarbeit_id = p_id and a.lagerfuehrung and m.vom_lager
    on conflict (quelle_typ, quelle_id, artikel_id) where quelle_id is not null
    do update set menge = excluded.menge, datum = excluded.datum, bemerkung = excluded.bemerkung
      where lagerbewegungen.menge is distinct from excluded.menge or lagerbewegungen.datum is distinct from excluded.datum;
  end if;
end $$;

-- feldarbeit_speichern: zusätzlich "vom_lager" je Mittel (Standard: true)
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
  if nullif(p ->> 'maschine_id', '') is not null and not exists (select 1 from maschinen where id = (p ->> 'maschine_id')::uuid and betrieb_id = v_betrieb)
     or nullif(p ->> 'geraet_id', '') is not null and not exists (select 1 from maschinen where id = (p ->> 'geraet_id')::uuid and betrieb_id = v_betrieb)
     or nullif(p ->> 'partner_id', '') is not null and not exists (select 1 from partner where id = (p ->> 'partner_id')::uuid and betrieb_id = v_betrieb) then
    raise exception 'Unbekannte Maschine oder unbekannter Partner';
  end if;

  if v_id is null then
    insert into feldarbeiten (betrieb_id, datum, arbeitsart, status, dauer_h, maschine, geraet, ausgefuehrt_von, ausbringung, bemerkungen,
                              maschine_id, geraet_id, partner_id)
    values (v_betrieb, v_datum, p ->> 'arbeitsart', v_status, nullif(p ->> 'dauer_h', '')::numeric,
            nullif(p ->> 'maschine', ''), nullif(p ->> 'geraet', ''),
            coalesce(nullif(p ->> 'ausgefuehrt_von', '')::uuid, auth.uid()),
            nullif(p ->> 'ausbringung', ''), nullif(p ->> 'bemerkungen', ''),
            nullif(p ->> 'maschine_id', '')::uuid, nullif(p ->> 'geraet_id', '')::uuid, nullif(p ->> 'partner_id', '')::uuid)
    returning id into v_id;
  else
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
      maschine_id = nullif(p ->> 'maschine_id', '')::uuid, geraet_id = nullif(p ->> 'geraet_id', '')::uuid,
      partner_id = nullif(p ->> 'partner_id', '')::uuid,
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
-- Aufträge
-- ---------------------------------------------------------------------
create table public.auftraege (
  id            uuid primary key default gen_random_uuid(),
  betrieb_id    uuid not null references public.betriebe (id),
  nummer        text not null,                 -- z. B. 2026-003
  art           text not null check (art in ('Lohnarbeit', 'Werkstatt')),
  partner_id    uuid not null references public.partner (id),
  titel         text not null check (length(trim(titel)) > 0),
  arbeitsart    text,                          -- bei Lohnarbeit
  maschine_id   uuid references public.maschinen (id),  -- bei Werkstatt
  termin_von    date,
  termin_bis    date,
  beschreibung  text,
  status        text not null default 'Entwurf' check (status in ('Entwurf', 'Gesendet', 'Bestätigt', 'Erledigt', 'Abgebrochen')),
  gesendet_am   timestamptz,
  erledigt_am   date,
  feldarbeit_id uuid references public.feldarbeiten (id),
  eintrag_id    uuid references public.maschinen_eintraege (id),
  erstellt_von  uuid default auth.uid(),
  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz not null default now(),
  version       integer not null default 1,
  unique (betrieb_id, nummer),
  check (termin_bis is null or termin_von is null or termin_bis >= termin_von),
  check (art <> 'Werkstatt' or maschine_id is not null)
);

create table public.auftrag_felder (
  id         uuid primary key default gen_random_uuid(),
  betrieb_id uuid not null references public.betriebe (id),
  auftrag_id uuid not null references public.auftraege (id) on delete cascade,
  feld_id    uuid not null references public.felder (id),
  unique (auftrag_id, feld_id)
);

create table public.auftrag_mittel (
  id             uuid primary key default gen_random_uuid(),
  betrieb_id     uuid not null references public.betriebe (id),
  auftrag_id     uuid not null references public.auftraege (id) on delete cascade,
  artikel_id     uuid references public.lagerartikel (id),
  bezeichnung    text,                          -- wenn kein Lagerartikel (z. B. Saatgut des Lohnunternehmers)
  kategorie      text not null default 'Saatgut' check (kategorie in (
                   'Dünger', 'Saatgut', 'Pflanzenschutzmittel', 'Ersatzteile', 'Betriebsstoffe', 'Erzeugnisse', 'Verbrauchsmaterial', 'Sonstiges')),
  einheit        text,
  menge_je_ha    numeric(14, 4) check (menge_je_ha > 0),
  bereitstellung text not null default 'Betrieb' check (bereitstellung in ('Betrieb', 'Dienstleister')),
  bemerkung      text,
  check (artikel_id is not null or length(trim(coalesce(bezeichnung, ''))) > 0)
);

create table public.auftrag_beobachtungen (
  auftrag_id uuid not null references public.auftraege (id) on delete cascade,
  eintrag_id uuid not null references public.maschinen_eintraege (id),
  betrieb_id uuid not null references public.betriebe (id),
  primary key (auftrag_id, eintrag_id)
);

create trigger a_version before update on public.auftraege for each row execute function public.pruefe_version();
create trigger b_metadaten before insert or update on public.auftraege for each row execute function public.setze_metadaten();
create trigger z_protokoll after insert or update or delete on public.auftraege for each row execute function public.protokolliere();
create trigger z_protokoll after insert or update or delete on public.auftrag_felder for each row execute function public.protokolliere();
create trigger z_protokoll after insert or update or delete on public.auftrag_mittel for each row execute function public.protokolliere();

-- ---------------------------------------------------------------------
-- Auftrag speichern (mit Feldern, Mitteln, Beobachtungen) – eine Transaktion
-- ---------------------------------------------------------------------
create or replace function public.auftrag_speichern(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  v_id      uuid := nullif(p ->> 'id', '')::uuid;
  v_jahr    text := to_char(current_date, 'YYYY');
  v_nr      text;
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

  if v_id is null then
    perform pg_advisory_xact_lock(hashtext('auftrag-' || v_betrieb::text));
    select v_jahr || '-' || lpad((coalesce(max(split_part(nummer, '-', 2)::int), 0) + 1)::text, 3, '0') into v_nr
      from auftraege where betrieb_id = v_betrieb and nummer like v_jahr || '-%';
    insert into auftraege (betrieb_id, nummer, art, partner_id, titel, arbeitsart, maschine_id, termin_von, termin_bis, beschreibung)
    values (v_betrieb, v_nr, p ->> 'art', (p ->> 'partner_id')::uuid, trim(p ->> 'titel'), nullif(p ->> 'arbeitsart', ''),
            nullif(p ->> 'maschine_id', '')::uuid, nullif(p ->> 'termin_von', '')::date, nullif(p ->> 'termin_bis', '')::date,
            nullif(p ->> 'beschreibung', ''))
    returning id into v_id;
  else
    update auftraege set
      partner_id = (p ->> 'partner_id')::uuid, titel = trim(p ->> 'titel'), arbeitsart = nullif(p ->> 'arbeitsart', ''),
      maschine_id = nullif(p ->> 'maschine_id', '')::uuid, termin_von = nullif(p ->> 'termin_von', '')::date,
      termin_bis = nullif(p ->> 'termin_bis', '')::date, beschreibung = nullif(p ->> 'beschreibung', ''),
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
  return v_id;
end $$;

create or replace function public.auftrag_status(p_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  if p_status not in ('Entwurf', 'Gesendet', 'Bestätigt', 'Abgebrochen') then raise exception 'Ungültiger Status'; end if;
  update auftraege set status = p_status,
         gesendet_am = case when p_status = 'Gesendet' then coalesce(gesendet_am, now()) else gesendet_am end
   where id = p_id and betrieb_id = mein_betrieb() and status <> 'Erledigt';
  if not found then raise exception 'Auftrag nicht gefunden oder bereits erledigt'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Auftrag abschliessen:
--   Lohnarbeit → Feldarbeit in der Ackerschlagkartei (Partner eingetragen; nur selbst gestellte Mittel buchen das Lager)
--   Werkstatt  → Reparatur-Eintrag bei der Maschine, zugeordnete Beobachtungen werden geschlossen
-- ---------------------------------------------------------------------
create or replace function public.auftrag_abschliessen(p_id uuid, p_datum date, p_kosten numeric default null, p_bemerkung text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_a       auftraege%rowtype;
  v_mittel  jsonb := '[]';
  v_artikel uuid;
  m         auftrag_mittel%rowtype;
  v_ziel    uuid;
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  select * into v_a from auftraege where id = p_id and betrieb_id = mein_betrieb() for update;
  if not found then raise exception 'Auftrag nicht gefunden'; end if;
  if v_a.status in ('Erledigt', 'Abgebrochen') then raise exception 'Auftrag ist bereits abgeschlossen'; end if;
  if p_datum is null or p_datum > current_date then raise exception 'Erledigt-Datum fehlt oder liegt in der Zukunft'; end if;

  if v_a.art = 'Lohnarbeit' then
    if not exists (select 1 from auftrag_felder where auftrag_id = p_id) then raise exception 'Der Auftrag hat keine Felder'; end if;
    for m in select * from auftrag_mittel where auftrag_id = p_id and menge_je_ha is not null loop
      v_artikel := m.artikel_id;
      if v_artikel is null then
        -- Mittel des Dienstleisters ohne Lagerartikel: als Artikel ohne Bestandsführung anlegen, damit es dokumentiert ist
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
      'datum', p_datum, 'arbeitsart', coalesce(v_a.arbeitsart, 'Andere'), 'status', 'erledigt',
      'partner_id', v_a.partner_id,
      'bemerkungen', concat_ws(' · ', 'Auftrag ' || v_a.nummer, nullif(p_bemerkung, '')),
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
  return v_ziel;
end $$;

revoke all on function public.auftrag_speichern(jsonb), public.auftrag_status(uuid, text),
  public.auftrag_abschliessen(uuid, date, numeric, text) from public, anon;
grant execute on function public.auftrag_speichern(jsonb), public.auftrag_status(uuid, text),
  public.auftrag_abschliessen(uuid, date, numeric, text) to authenticated;

-- ---------------------------------------------------------------------
-- Zugriffsregeln: lesen alle im Betrieb, schreiben nur über die Funktionen
-- ---------------------------------------------------------------------
alter table public.auftraege             enable row level security;
alter table public.auftrag_felder        enable row level security;
alter table public.auftrag_mittel        enable row level security;
alter table public.auftrag_beobachtungen enable row level security;
create policy au_lesen  on public.auftraege             for select using (betrieb_id = public.mein_betrieb());
create policy auf_lesen on public.auftrag_felder        for select using (betrieb_id = public.mein_betrieb());
create policy aum_lesen on public.auftrag_mittel        for select using (betrieb_id = public.mein_betrieb());
create policy aub_lesen on public.auftrag_beobachtungen for select using (betrieb_id = public.mein_betrieb());
grant select on public.auftraege, public.auftrag_felder, public.auftrag_mittel, public.auftrag_beobachtungen to authenticated;

-- >>> supabase/migrations/20261102000006_benutzerverwaltung.sql
-- =====================================================================
-- Hofmanager SchweikFarm – Migration 6: Benutzerverwaltung (Einladungen, Rollen)
-- Einspielen: Supabase › SQL Editor › gesamten Inhalt einfügen › Run
-- Voraussetzung: Migrationen 1–5 sind eingespielt.
-- =====================================================================

-- Einladungen: Der Administrator lädt eine E-Mail-Adresse mit einer Rolle ein.
-- Wer sich mit dieser (bestätigten) Adresse registriert, wird beim ersten Anmelden dem Betrieb zugeordnet.
create table public.einladungen (
  id             uuid primary key default gen_random_uuid(),
  betrieb_id     uuid not null references public.betriebe (id),
  email          text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name           text,
  rolle          public.rolle not null default 'mitarbeiter',
  erstellt_von   uuid default auth.uid(),
  erstellt_am    timestamptz not null default now(),
  angenommen_am  timestamptz,
  angenommen_von uuid references auth.users (id),
  widerrufen     boolean not null default false
);
create unique index einladung_offen on public.einladungen (betrieb_id, lower(email)) where angenommen_am is null and not widerrufen;
create trigger z_protokoll after insert or update or delete on public.einladungen for each row execute function public.protokolliere();

alter table public.einladungen enable row level security;
create policy ei_lesen   on public.einladungen for select using (betrieb_id = public.mein_betrieb() and public.meine_rolle() = 'administrator');
create policy ei_neu     on public.einladungen for insert with check (betrieb_id = public.mein_betrieb() and public.meine_rolle() = 'administrator'
                                                                       and angenommen_am is null and not widerrufen);
create policy ei_aendern on public.einladungen for update using (betrieb_id = public.mein_betrieb() and public.meine_rolle() = 'administrator');
grant select, insert, update on public.einladungen to authenticated;

-- Gibt es schon einen Betrieb? (für den Bildschirm nach der ersten Anmeldung)
create or replace function public.betrieb_vorhanden() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from betriebe)
$$;

-- Einladung annehmen: ordnet das angemeldete Konto anhand der bestätigten E-Mail dem Betrieb zu.
create or replace function public.einladung_annehmen() returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_e     einladungen%rowtype;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  if exists (select 1 from benutzer_profile where id = auth.uid()) then raise exception 'Dieses Konto ist bereits einem Betrieb zugeordnet'; end if;
  select lower(email) into v_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if v_email is null then raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen'; end if;
  select * into v_e from einladungen
   where lower(email) = v_email and angenommen_am is null and not widerrufen
   order by erstellt_am desc limit 1
   for update;
  if not found then raise exception 'Für % liegt keine Einladung vor. Bitte den Administrator fragen.', v_email; end if;
  insert into benutzer_profile (id, betrieb_id, name, rolle)
  values (auth.uid(), v_e.betrieb_id, coalesce(nullif(trim(v_e.name), ''), split_part(v_email, '@', 1)), v_e.rolle);
  update einladungen set angenommen_am = now(), angenommen_von = auth.uid() where id = v_e.id;
  return v_e.betrieb_id;
end $$;

-- Rolle ändern / deaktivieren (nur Administrator). Der letzte aktive Administrator bleibt immer erhalten.
create or replace function public.benutzer_aendern(p_id uuid, p_rolle public.rolle, p_aktiv boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_ziel benutzer_profile%rowtype;
begin
  if meine_rolle() is distinct from 'administrator' then raise exception 'Nur Administratoren können Benutzer verwalten'; end if;
  select * into v_ziel from benutzer_profile where id = p_id and betrieb_id = mein_betrieb() for update;
  if not found then raise exception 'Benutzer nicht gefunden'; end if;
  if v_ziel.rolle = 'administrator' and v_ziel.aktiv and (p_rolle <> 'administrator' or not p_aktiv)
     and (select count(*) from benutzer_profile where betrieb_id = v_ziel.betrieb_id and rolle = 'administrator' and aktiv) <= 1 then
    raise exception 'Es muss mindestens ein aktiver Administrator bleiben';
  end if;
  update benutzer_profile set rolle = p_rolle, aktiv = p_aktiv where id = p_id;
end $$;

-- Profile nur noch über benutzer_aendern ändern (schützt den letzten Administrator)
drop policy if exists profile_admin on public.benutzer_profile;

-- Eigenen Anzeigenamen ändern
create or replace function public.mein_name(p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Name fehlt'; end if;
  update benutzer_profile set name = trim(p_name) where id = auth.uid();
  if not found then raise exception 'Kein Profil gefunden'; end if;
end $$;

-- Aktivität je Benutzer (aus dem Änderungsprotokoll) – sichtbar für Administratoren und Betriebsleiter
create view public.benutzer_aktivitaet with (security_invoker = true) as
select benutzer_id, count(*) as aenderungen, max(zeitpunkt) as zuletzt
from public.aenderungsprotokoll
where benutzer_id is not null
group by benutzer_id;

revoke all on function public.einladung_annehmen(), public.benutzer_aendern(uuid, public.rolle, boolean),
  public.mein_name(text), public.betrieb_vorhanden() from public, anon;
grant execute on function public.einladung_annehmen(), public.benutzer_aendern(uuid, public.rolle, boolean),
  public.mein_name(text), public.betrieb_vorhanden() to authenticated;
grant select on public.benutzer_aktivitaet to authenticated;

-- >>> supabase/migrations/20261102000007_ernte_planung.sql
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

-- >>> supabase/migrations/20261102000008_papierkorb_mehrfachkulturen.sql
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

-- >>> supabase/migrations/20261102000009_kartenobjekte.sql
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

-- >>> supabase/migrations/20261102000010_ernte_produkte_lager.sql
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

-- >>> supabase/migrations/20261102000011_aufgaben.sql
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

-- >>> supabase/migrations/20261102000012_ernten_sammel.sql
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

-- >>> supabase/migrations/20261102000013_mitarbeiter_folgearbeiten.sql
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

-- >>> supabase/migrations/20261102000014_verkauf_fotos.sql
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

-- >>> supabase/migrations/20261102000015_arbeit_abschluss.sql
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

-- >>> supabase/migrations/20261102000016_teile_kontrolle.sql
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

-- >>> supabase/migrations/20261102000017_verknuepfungen.sql
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

-- >>> supabase/migrations/20261102000018_betrieb_weide.sql
-- =====================================================================
-- Migration 18: Betriebsverwaltung (weitere Angaben) und Weidegäste
-- (Tiere anderer Betriebe weiden auf eigenen Feldern: Partner, Zeitraum, Felder, Weidezins)
-- =====================================================================

-- Weitere Betriebsangaben
alter table public.betriebe add column if not exists bewirtschafter text check (bewirtschafter is null or length(bewirtschafter) <= 120);
alter table public.betriebe add column if not exists gemeinde text check (gemeinde is null or length(gemeinde) <= 80);
alter table public.betriebe add column if not exists bank text check (bank is null or length(bank) <= 120);
alter table public.betriebe add column if not exists website text check (website is null or length(website) <= 200);

-- Partnerart «Tierhalter» (Weidegast)
alter table public.partner drop constraint if exists partner_art_check;
alter table public.partner add constraint partner_art_check check (art in (
  'Lohnunternehmen', 'Mechaniker/Werkstatt', 'Händler/Lieferant', 'Berater',
  'Abnehmer/Käufer', 'Tierhalter', 'Behörde/Kontrolle', 'Andere'));

-- ---------------------------------------------------------------------
-- Weidegäste
-- ---------------------------------------------------------------------
create table public.beweidungen (
  id            uuid primary key default gen_random_uuid(),
  betrieb_id    uuid not null references public.betriebe (id),
  partner_id    uuid not null references public.partner (id),
  tierart       text not null check (length(trim(tierart)) between 1 and 60),
  anzahl        integer not null check (anzahl between 1 and 100000),
  gve           numeric(9, 2) check (gve is null or gve >= 0),
  von           date not null,
  bis           date,
  entgelt_art   text not null default 'keins'
                check (entgelt_art in ('keins', 'pauschal', 'je Tier und Tag', 'je GVE und Tag', 'je ha')),
  entgelt_satz  numeric(10, 2) check (entgelt_satz is null or entgelt_satz >= 0),
  verkauf_id    uuid references public.verkaeufe (id) on delete set null,
  bemerkungen   text check (bemerkungen is null or length(bemerkungen) <= 2000),
  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz not null default now(),
  version       integer not null default 1,
  constraint beweidung_zeitraum check (bis is null or bis >= von)
);
create index on public.beweidungen (betrieb_id, von);
create index on public.beweidungen (partner_id);

create table public.beweidung_felder (
  beweidung_id uuid not null references public.beweidungen (id) on delete cascade,
  feld_id      uuid not null references public.felder (id) on delete cascade,
  betrieb_id   uuid not null references public.betriebe (id),
  flaeche_m2   numeric(12, 1) not null check (flaeche_m2 > 0),
  primary key (beweidung_id, feld_id)
);
create index on public.beweidung_felder (feld_id);

create trigger a_version before update on public.beweidungen for each row execute function public.pruefe_version();
create trigger b_metadaten before insert or update on public.beweidungen for each row execute function public.setze_metadaten();
create trigger z_protokoll after insert or update or delete on public.beweidungen for each row execute function public.protokolliere();

alter table public.beweidungen enable row level security;
alter table public.beweidung_felder enable row level security;
create policy bw_lesen on public.beweidungen for select using (betrieb_id = public.mein_betrieb());
-- Ändern nur über die Funktionen unten; ausser der Verknüpfung mit dem Beleg
create policy bw_aendern on public.beweidungen for update using (betrieb_id = public.mein_betrieb() and public.darf_verwalten())
  with check (betrieb_id = public.mein_betrieb()
              and (verkauf_id is null or exists (select 1 from public.verkaeufe v where v.id = verkauf_id and v.betrieb_id = public.mein_betrieb())));
create policy bwf_lesen on public.beweidung_felder for select using (betrieb_id = public.mein_betrieb());
grant select, update (verkauf_id) on public.beweidungen to authenticated;
grant select on public.beweidung_felder to authenticated;

-- Speichern mit Feldern in einem Schritt
create or replace function public.beweidung_speichern(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  v_id      uuid := nullif(p ->> 'id', '')::uuid;
  v_von     date := nullif(p ->> 'von', '')::date;
  v_bis     date := nullif(p ->> 'bis', '')::date;
  v_art     text := coalesce(nullif(p ->> 'entgelt_art', ''), 'keins');
  v_feld    felder%rowtype;
  v_m2      numeric;
  x         jsonb;
begin
  if v_betrieb is null or not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  if v_von is null then raise exception 'Beginn der Weide fehlt'; end if;
  if v_bis is not null and v_bis < v_von then raise exception 'Das Ende liegt vor dem Beginn'; end if;
  if not exists (select 1 from partner where id = nullif(p ->> 'partner_id', '')::uuid and betrieb_id = v_betrieb) then
    raise exception 'Bitte den Tierhalter (Partner) wählen';
  end if;
  if coalesce(nullif(trim(p ->> 'tierart'), ''), '') = '' then raise exception 'Tierart fehlt'; end if;
  if coalesce((p ->> 'anzahl')::int, 0) < 1 then raise exception 'Anzahl Tiere fehlt'; end if;
  if jsonb_array_length(coalesce(p -> 'felder', '[]')) = 0 then raise exception 'Bitte mindestens ein Feld wählen'; end if;
  if v_art <> 'keins' and (p ->> 'entgelt_satz') is null then raise exception 'Bitte den Weidezins angeben'; end if;
  if v_art = 'je GVE und Tag' and nullif(p ->> 'gve', '') is null then raise exception 'Für den Weidezins je GVE braucht es die GVE'; end if;

  if v_id is null then
    insert into beweidungen (betrieb_id, partner_id, tierart, anzahl, gve, von, bis, entgelt_art, entgelt_satz, bemerkungen)
    values (v_betrieb, (p ->> 'partner_id')::uuid, trim(p ->> 'tierart'), (p ->> 'anzahl')::int, nullif(p ->> 'gve', '')::numeric,
            v_von, v_bis, v_art, case when v_art = 'keins' then null else (p ->> 'entgelt_satz')::numeric end,
            nullif(trim(p ->> 'bemerkungen'), ''))
    returning id into v_id;
  else
    update beweidungen set
      partner_id = (p ->> 'partner_id')::uuid, tierart = trim(p ->> 'tierart'), anzahl = (p ->> 'anzahl')::int,
      gve = nullif(p ->> 'gve', '')::numeric, von = v_von, bis = v_bis, entgelt_art = v_art,
      entgelt_satz = case when v_art = 'keins' then null else (p ->> 'entgelt_satz')::numeric end,
      bemerkungen = nullif(trim(p ->> 'bemerkungen'), ''),
      version = coalesce((p ->> 'version')::int, version)
    where id = v_id and betrieb_id = v_betrieb;
    if not found then raise exception 'Weide-Eintrag nicht gefunden'; end if;
    delete from beweidung_felder where beweidung_id = v_id;
  end if;

  for x in select * from jsonb_array_elements(p -> 'felder') loop
    select * into v_feld from felder where id = (x ->> 'feld_id')::uuid and betrieb_id = v_betrieb and geloescht_am is null;
    if not found then raise exception 'Unbekanntes Feld'; end if;
    v_m2 := coalesce(nullif(x ->> 'flaeche_m2', '')::numeric, v_feld.flaeche_m2);
    if v_m2 <= 0 or v_m2 > v_feld.flaeche_m2 * 1.001 then
      raise exception 'Weidefläche auf «%» ist grösser als das Feld', v_feld.name;
    end if;
    insert into beweidung_felder (beweidung_id, feld_id, betrieb_id, flaeche_m2) values (v_id, v_feld.id, v_betrieb, v_m2)
    on conflict (beweidung_id, feld_id) do update set flaeche_m2 = excluded.flaeche_m2;
  end loop;
  return v_id;
end $$;

create or replace function public.beweidung_loeschen(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  delete from beweidungen where id = p_id and betrieb_id = mein_betrieb();
  if not found then raise exception 'Weide-Eintrag nicht gefunden'; end if;
end $$;

revoke all on function public.beweidung_speichern(jsonb) from public, anon;
revoke all on function public.beweidung_loeschen(uuid) from public, anon;
grant execute on function public.beweidung_speichern(jsonb) to authenticated;
grant execute on function public.beweidung_loeschen(uuid) to authenticated;

-- >>> supabase/migrations/20261102000019_weide_umtrieb.sql
-- =====================================================================
-- Migration 19: Umtrieb der Weidegäste
-- Jedes Feld einer Weide hat einen eigenen Zeitraum (von/bis). So lassen sich Tiere von Feld zu Feld
-- weiterziehen (z. B. Schafe) und die Aufenthalte sauber nachtragen.
-- =====================================================================

alter table public.beweidung_felder add column if not exists id uuid not null default gen_random_uuid();
alter table public.beweidung_felder add column if not exists von date;
alter table public.beweidung_felder add column if not exists bis date;
update public.beweidung_felder bf set von = b.von, bis = b.bis from public.beweidungen b where b.id = bf.beweidung_id and bf.von is null;
alter table public.beweidung_felder alter column von set not null;
alter table public.beweidung_felder drop constraint if exists beweidung_felder_pkey;
alter table public.beweidung_felder add primary key (id);
alter table public.beweidung_felder add constraint beweidung_abschnitt_zeitraum check (bis is null or bis >= von);
create index if not exists beweidung_felder_beweidung on public.beweidung_felder (beweidung_id, von);

-- Prüft einen Abschnitt und legt ihn an
create or replace function public.beweidung_abschnitt_anlegen(p_beweidung beweidungen, x jsonb, p_von date, p_bis date)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_feld felder%rowtype;
  v_m2   numeric;
begin
  select * into v_feld from felder where id = (x ->> 'feld_id')::uuid and betrieb_id = p_beweidung.betrieb_id and geloescht_am is null;
  if not found then raise exception 'Unbekanntes Feld'; end if;
  v_m2 := coalesce(nullif(x ->> 'flaeche_m2', '')::numeric, v_feld.flaeche_m2);
  if v_m2 <= 0 or v_m2 > v_feld.flaeche_m2 * 1.001 then
    raise exception 'Weidefläche auf «%» ist grösser als das Feld', v_feld.name;
  end if;
  if p_von < p_beweidung.von then
    raise exception '«%»: Beginn % liegt vor dem Beginn der Weide', v_feld.name, to_char(p_von, 'DD.MM.YYYY');
  end if;
  if p_beweidung.bis is not null and p_von > p_beweidung.bis then
    raise exception '«%»: Beginn % liegt nach dem Ende der Weide', v_feld.name, to_char(p_von, 'DD.MM.YYYY');
  end if;
  if p_bis is not null and p_bis < p_von then
    raise exception '«%»: Ende liegt vor dem Beginn', v_feld.name;
  end if;
  insert into beweidung_felder (beweidung_id, feld_id, betrieb_id, flaeche_m2, von, bis)
  values (p_beweidung.id, v_feld.id, p_beweidung.betrieb_id, v_m2, p_von,
          case when p_beweidung.bis is null then p_bis else least(coalesce(p_bis, p_beweidung.bis), p_beweidung.bis) end);
end $$;
revoke all on function public.beweidung_abschnitt_anlegen(beweidungen, jsonb, date, date) from public, anon, authenticated;

-- Speichern mit allen Abschnitten (Feld, Fläche, von, bis); ohne Datum gilt der Zeitraum der Weide
create or replace function public.beweidung_speichern(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  v_id      uuid := nullif(p ->> 'id', '')::uuid;
  v_von     date := nullif(p ->> 'von', '')::date;
  v_bis     date := nullif(p ->> 'bis', '')::date;
  v_art     text := coalesce(nullif(p ->> 'entgelt_art', ''), 'keins');
  v_b       beweidungen%rowtype;
  x         jsonb;
begin
  if v_betrieb is null or not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  if v_von is null then raise exception 'Beginn der Weide fehlt'; end if;
  if v_bis is not null and v_bis < v_von then raise exception 'Das Ende liegt vor dem Beginn'; end if;
  if not exists (select 1 from partner where id = nullif(p ->> 'partner_id', '')::uuid and betrieb_id = v_betrieb) then
    raise exception 'Bitte den Tierhalter (Partner) wählen';
  end if;
  if coalesce(nullif(trim(p ->> 'tierart'), ''), '') = '' then raise exception 'Tierart fehlt'; end if;
  if coalesce((p ->> 'anzahl')::int, 0) < 1 then raise exception 'Anzahl Tiere fehlt'; end if;
  if jsonb_array_length(coalesce(p -> 'felder', '[]')) = 0 then raise exception 'Bitte mindestens ein Feld wählen'; end if;
  if v_art <> 'keins' and (p ->> 'entgelt_satz') is null then raise exception 'Bitte den Weidezins angeben'; end if;
  if v_art = 'je GVE und Tag' and nullif(p ->> 'gve', '') is null then raise exception 'Für den Weidezins je GVE braucht es die GVE'; end if;

  if v_id is null then
    insert into beweidungen (betrieb_id, partner_id, tierart, anzahl, gve, von, bis, entgelt_art, entgelt_satz, bemerkungen)
    values (v_betrieb, (p ->> 'partner_id')::uuid, trim(p ->> 'tierart'), (p ->> 'anzahl')::int, nullif(p ->> 'gve', '')::numeric,
            v_von, v_bis, v_art, case when v_art = 'keins' then null else (p ->> 'entgelt_satz')::numeric end,
            nullif(trim(p ->> 'bemerkungen'), ''))
    returning * into v_b;
  else
    update beweidungen set
      partner_id = (p ->> 'partner_id')::uuid, tierart = trim(p ->> 'tierart'), anzahl = (p ->> 'anzahl')::int,
      gve = nullif(p ->> 'gve', '')::numeric, von = v_von, bis = v_bis, entgelt_art = v_art,
      entgelt_satz = case when v_art = 'keins' then null else (p ->> 'entgelt_satz')::numeric end,
      bemerkungen = nullif(trim(p ->> 'bemerkungen'), ''),
      version = coalesce((p ->> 'version')::int, version)
    where id = v_id and betrieb_id = v_betrieb
    returning * into v_b;
    if not found then raise exception 'Weide-Eintrag nicht gefunden'; end if;
    delete from beweidung_felder where beweidung_id = v_id;
  end if;

  for x in select * from jsonb_array_elements(p -> 'felder') loop
    perform beweidung_abschnitt_anlegen(v_b, x, coalesce(nullif(x ->> 'von', '')::date, v_von), coalesce(nullif(x ->> 'bis', '')::date, v_bis));
  end loop;
  return v_b.id;
end $$;

-- Weiterziehen: die Tiere stehen ab p.datum auf den neuen Feldern; die bisherigen Felder enden am Vortag
create or replace function public.beweidung_umtreiben(p_id uuid, p jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_b     beweidungen%rowtype;
  v_datum date := coalesce(nullif(p ->> 'datum', '')::date, current_date);
  x       jsonb;
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  select * into v_b from beweidungen where id = p_id and betrieb_id = mein_betrieb() for update;
  if not found then raise exception 'Weide-Eintrag nicht gefunden'; end if;
  if jsonb_array_length(coalesce(p -> 'felder', '[]')) = 0 then raise exception 'Bitte das neue Feld wählen'; end if;
  if v_datum < v_b.von then raise exception 'Das Datum liegt vor dem Beginn der Weide'; end if;
  if v_b.bis is not null and v_datum > v_b.bis then raise exception 'Die Weide ist am % schon beendet', to_char(v_b.bis, 'DD.MM.YYYY'); end if;
  if exists (select 1 from beweidung_felder where beweidung_id = p_id and von > v_datum) then
    raise exception 'Nach dem % gibt es schon Feldwechsel. Bitte im Weide-Eintrag nachtragen.', to_char(v_datum, 'DD.MM.YYYY');
  end if;
  -- am selben Tag begonnene Abschnitte ersetzen (Korrektur), übrige am Vortag beenden
  delete from beweidung_felder where beweidung_id = p_id and von = v_datum;
  update beweidung_felder set bis = v_datum - 1 where beweidung_id = p_id and (bis is null or bis >= v_datum);
  for x in select * from jsonb_array_elements(p -> 'felder') loop
    perform beweidung_abschnitt_anlegen(v_b, x, v_datum, v_b.bis);
  end loop;
end $$;

-- Tiere sind weg: Weide und offene Abschnitte am Datum beenden
create or replace function public.beweidung_beenden(p_id uuid, p_datum date default current_date)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_b beweidungen%rowtype;
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  select * into v_b from beweidungen where id = p_id and betrieb_id = mein_betrieb() for update;
  if not found then raise exception 'Weide-Eintrag nicht gefunden'; end if;
  if p_datum < v_b.von then raise exception 'Das Ende liegt vor dem Beginn'; end if;
  if exists (select 1 from beweidung_felder where beweidung_id = p_id and von > p_datum) then
    raise exception 'Nach dem % gibt es noch Feldwechsel. Bitte im Weide-Eintrag nachtragen.', to_char(p_datum, 'DD.MM.YYYY');
  end if;
  update beweidung_felder set bis = p_datum where beweidung_id = p_id and (bis is null or bis > p_datum);
  update beweidungen set bis = p_datum where id = p_id;
end $$;

revoke all on function public.beweidung_umtreiben(uuid, jsonb) from public, anon;
revoke all on function public.beweidung_beenden(uuid, date) from public, anon;
grant execute on function public.beweidung_umtreiben(uuid, jsonb) to authenticated;
grant execute on function public.beweidung_beenden(uuid, date) to authenticated;
grant execute on function public.beweidung_speichern(jsonb) to authenticated;

-- >>> supabase/migrations/20261102000020_partner_rollen.sql
-- =====================================================================
-- Migration 20: Ein Partner kann mehrere Rollen haben
-- (z. B. Lohnunternehmen und Abnehmer, oder Tierhalter und Händler).
-- «art» bleibt als Hauptrolle erhalten (erste Rolle) und wird automatisch nachgeführt.
-- =====================================================================

alter table public.partner add column if not exists rollen text[];
update public.partner set rollen = array[art] where rollen is null or cardinality(rollen) = 0;
alter table public.partner alter column rollen set default '{}';
alter table public.partner alter column rollen set not null;
alter table public.partner drop constraint if exists partner_rollen_check;
alter table public.partner add constraint partner_rollen_check check (
  cardinality(rollen) >= 1
  and rollen <@ array['Lohnunternehmen', 'Mechaniker/Werkstatt', 'Händler/Lieferant', 'Berater',
                      'Abnehmer/Käufer', 'Tierhalter', 'Behörde/Kontrolle', 'Andere']::text[]);
create index if not exists partner_rollen on public.partner using gin (rollen);

create or replace function public.partner_rollen_nachfuehren() returns trigger
language plpgsql as $$
begin
  -- doppelte entfernen, Reihenfolge behalten
  if new.rollen is not null then
    new.rollen := array(select r from unnest(new.rollen) with ordinality u(r, i) group by r order by min(i));
  end if;
  if tg_op = 'INSERT' then
    if new.rollen is null or cardinality(new.rollen) = 0 then new.rollen := array[new.art]; end if;
    new.art := new.rollen[1];
  elsif new.rollen is distinct from old.rollen then
    if new.rollen is null or cardinality(new.rollen) = 0 then new.rollen := array[new.art]; end if;
    new.art := new.rollen[1];
  elsif new.art is distinct from old.art and not (new.art = any(new.rollen)) then
    -- nur die Hauptrolle geändert (ältere App-Version): an den Anfang stellen
    new.rollen := array[new.art] || new.rollen;
  end if;
  return new;
end $$;

drop trigger if exists c_rollen on public.partner;
create trigger c_rollen before insert or update on public.partner for each row execute function public.partner_rollen_nachfuehren();

-- >>> supabase/migrations/20261102000021_mehrere_geraete.sql
-- =====================================================================
-- Migration 21: Mehrere Geräte pro Arbeit (z. B. Traktor mit Kreiselegge und Sämaschine,
-- Front- und Heckmähwerk). «geraet_id» bleibt das erste Gerät und wird nachgeführt.
-- =====================================================================

create table public.feldarbeit_geraete (
  feldarbeit_id uuid not null references public.feldarbeiten (id) on delete cascade,
  maschine_id   uuid not null references public.maschinen (id),
  betrieb_id    uuid not null references public.betriebe (id),
  position      integer not null default 0,
  primary key (feldarbeit_id, maschine_id)
);
create index on public.feldarbeit_geraete (maschine_id);

alter table public.feldarbeit_geraete enable row level security;
create policy fag_lesen on public.feldarbeit_geraete for select using (betrieb_id = public.mein_betrieb());
grant select on public.feldarbeit_geraete to authenticated;

-- bisherige Geräte übernehmen
insert into public.feldarbeit_geraete (feldarbeit_id, maschine_id, betrieb_id, position)
select id, geraet_id, betrieb_id, 0 from public.feldarbeiten where geraet_id is not null
on conflict do nothing;

-- Wird «geraet_id» auf anderem Weg gesetzt (ältere App, Auftrag), bleibt die Liste stimmig
create or replace function public.feldarbeit_geraet_nachfuehren() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.geraet_id is not null and new.geraet_id is distinct from old.geraet_id then
    delete from feldarbeit_geraete where feldarbeit_id = new.id and maschine_id = old.geraet_id;
  end if;
  if new.geraet_id is not null and not exists (select 1 from feldarbeit_geraete where feldarbeit_id = new.id and maschine_id = new.geraet_id) then
    insert into feldarbeit_geraete (feldarbeit_id, maschine_id, betrieb_id, position)
    values (new.id, new.geraet_id, new.betrieb_id,
            coalesce((select min(position) from feldarbeit_geraete where feldarbeit_id = new.id), 1) - 1);
  end if;
  return null;
end $$;
create trigger z_geraete after insert or update of geraet_id on public.feldarbeiten
  for each row execute function public.feldarbeit_geraet_nachfuehren();

-- Speichert eine Arbeit wie feldarbeit_speichern und setzt alle Geräte (p.geraete: Liste von Maschinen-IDs)
create or replace function public.feldarbeit_speichern_geraete(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  v_liste   uuid[] := array(select t.x::uuid from jsonb_array_elements_text(coalesce(p -> 'geraete', '[]')) as t(x));
  v_id      uuid;
  i         int;
begin
  if (select count(*) from unnest(v_liste) g) <> (select count(*) from maschinen where id = any(v_liste) and betrieb_id = v_betrieb) then
    raise exception 'Unbekanntes Gerät';
  end if;
  if cardinality(v_liste) <> (select count(distinct g) from unnest(v_liste) g) then raise exception 'Jedes Gerät nur einmal wählen'; end if;
  v_id := feldarbeit_speichern(p || jsonb_build_object('geraet_id', v_liste[1]));
  if p ? 'geraete' then
    delete from feldarbeit_geraete where feldarbeit_id = v_id;
    for i in 1 .. coalesce(cardinality(v_liste), 0) loop
      insert into feldarbeit_geraete (feldarbeit_id, maschine_id, betrieb_id, position) values (v_id, v_liste[i], v_betrieb, i);
    end loop;
  end if;
  return v_id;
end $$;

revoke all on function public.feldarbeit_speichern_geraete(jsonb) from public, anon;
grant execute on function public.feldarbeit_speichern_geraete(jsonb) to authenticated;
revoke all on function public.feldarbeit_geraet_nachfuehren() from public, anon, authenticated;

-- >>> supabase/migrations/20261102000022_saat_uebernehmen.sql
-- =====================================================================
-- Migration 22: Saat aus der Kartei in die Fruchtfolge übernehmen
-- Wird «Säen» erledigt, bekommt die passende geplante Kultur des Feldes das echte Saatdatum und den Status «ist».
-- Die bisher wachsende Kultur endet (Umbruch) am Vortag, ausser bei Untersaaten.
-- So zeigt die App nach der Saat die neue Kultur als aktuelle Frucht (z. B. Kunstwiese im Herbst fürs nächste Jahr).
-- =====================================================================

create or replace function public.saat_uebernehmen(p_feldarbeit uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_fa    feldarbeiten%rowtype;
  v_ff    record;
  v_ziel  anbau%rowtype;
begin
  select * into v_fa from feldarbeiten where id = p_feldarbeit;
  if not found or v_fa.arbeitsart <> 'Säen' or v_fa.status <> 'erledigt' or v_fa.geloescht_am is not null then return; end if;

  for v_ff in select * from feldarbeit_felder where feldarbeit_id = p_feldarbeit loop
    v_ziel := null;
    -- 1) Kultur mit Saattermin in der Nähe (± 60 Tage), die nächstgelegene
    select a.* into v_ziel from anbau a
     where a.feld_id = v_ff.feld_id and a.saatdatum is not null
       and abs((case when a.nur_monat then date_trunc('month', a.saatdatum)::date else a.saatdatum end) - v_fa.datum) <= 60
     order by (a.status = 'geplant') desc,
              abs((case when a.nur_monat then date_trunc('month', a.saatdatum)::date else a.saatdatum end) - v_fa.datum)
     limit 1;
    -- 2) sonst die geplante Hauptkultur ohne Saattermin: ab Juli fürs nächste Jahr (Herbstsaat), sonst fürs laufende
    if v_ziel.id is null then
      select a.* into v_ziel from anbau a
       where a.feld_id = v_ff.feld_id and a.art = 'Hauptkultur' and a.saatdatum is null and a.status = 'geplant'
         and a.jahr = extract(year from v_fa.datum)::int + case when extract(month from v_fa.datum) >= 7 then 1 else 0 end
       limit 1;
    end if;
    continue when v_ziel.id is null;

    update anbau set saatdatum = v_fa.datum, nur_monat = false, status = 'ist',
                     erntedatum = case when erntedatum is not null and erntedatum < v_fa.datum then null else erntedatum end
     where id = v_ziel.id;
    update feldarbeit_felder set anbau_id = v_ziel.id where feldarbeit_id = p_feldarbeit and feld_id = v_ff.feld_id and anbau_id is distinct from v_ziel.id;

    -- bisherige Kultur endet (nicht bei Untersaat, die in die bestehende Kultur gesät wird)
    if v_ziel.art <> 'Untersaat' then
      update anbau a set erntedatum = v_fa.datum - 1
       where a.feld_id = v_ff.feld_id and a.id <> v_ziel.id and a.art <> 'Untersaat'
         and a.saatdatum is not null and a.saatdatum < v_fa.datum
         and (a.erntedatum is null or a.erntedatum >= v_fa.datum)
         and a.jahr <= v_ziel.jahr;
    end if;
  end loop;
end $$;
revoke all on function public.saat_uebernehmen(uuid) from public, anon, authenticated;

create or replace function public.saat_trigger_felder() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  perform saat_uebernehmen(new.feldarbeit_id);
  return null;
end $$;
create or replace function public.saat_trigger_arbeit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if new.arbeitsart = 'Säen' and new.status = 'erledigt' and (old.status is distinct from new.status or old.datum is distinct from new.datum) then
    perform saat_uebernehmen(new.id);
  end if;
  return null;
end $$;
revoke all on function public.saat_trigger_felder() from public, anon, authenticated;
revoke all on function public.saat_trigger_arbeit() from public, anon, authenticated;

drop trigger if exists z_saat on public.feldarbeit_felder;
create trigger z_saat after insert on public.feldarbeit_felder for each row execute function public.saat_trigger_felder();
drop trigger if exists z_saat on public.feldarbeiten;
create trigger z_saat after update of status, datum on public.feldarbeiten for each row execute function public.saat_trigger_arbeit();

-- >>> supabase/migrations/20261102000023_richtpreise.sql
-- =====================================================================
-- Migration 23: Richtpreise (Maschinen, Dienstleistungen, Futter, Arbeit)
-- Eigener Preiskatalog des Betriebs: aus Vorlagen übernommen (mit Quelle und Jahr) oder selbst erfasst.
-- Wird bei Rechnungen, Ernte-Dienstleistern und Abgaben als Vorschlag genutzt.
-- =====================================================================

create table public.richtpreise (
  id            uuid primary key default gen_random_uuid(),
  betrieb_id    uuid not null references public.betriebe (id),
  bereich       text not null check (bereich in ('Maschine', 'Dienstleistung', 'Futter', 'Arbeit', 'Andere')),
  bezeichnung   text not null check (length(trim(bezeichnung)) between 1 and 160),
  einheit       text not null check (length(trim(einheit)) between 1 and 20),
  preis_chf     numeric(10, 2) not null check (preis_chf >= 0),
  quelle        text check (quelle is null or length(quelle) <= 160),
  jahr          integer check (jahr is null or jahr between 1990 and 2100),
  bemerkung     text check (bemerkung is null or length(bemerkung) <= 500),
  aktiv         boolean not null default true,
  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz not null default now(),
  version       integer not null default 1,
  constraint richtpreis_eindeutig unique (betrieb_id, bereich, bezeichnung, einheit)
);
create trigger a_version before update on public.richtpreise for each row execute function public.pruefe_version();
create trigger b_metadaten before insert or update on public.richtpreise for each row execute function public.setze_metadaten();
create trigger z_protokoll after insert or update or delete on public.richtpreise for each row execute function public.protokolliere();

alter table public.richtpreise enable row level security;
create policy rp_lesen    on public.richtpreise for select using (betrieb_id = public.mein_betrieb());
create policy rp_neu      on public.richtpreise for insert with check (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
create policy rp_aendern  on public.richtpreise for update using (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
create policy rp_loeschen on public.richtpreise for delete using (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
grant select, insert, update, delete on public.richtpreise to authenticated;

-- Ansatz einer eigenen Maschine (z. B. für Arbeiten bei Nachbarn)
alter table public.maschinen add column if not exists richtpreis_id uuid references public.richtpreise (id) on delete set null;

-- Viele Preise auf einmal übernehmen (Vorlage oder CSV): vorhandene gleicher Bezeichnung/Einheit werden aktualisiert
create or replace function public.richtpreise_importieren(p jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  x jsonb;
  n int := 0;
begin
  if v_betrieb is null or not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  for x in select * from jsonb_array_elements(coalesce(p -> 'preise', '[]')) loop
    if coalesce(trim(x ->> 'bezeichnung'), '') = '' or coalesce(trim(x ->> 'einheit'), '') = '' or (x ->> 'preis_chf') is null then
      raise exception 'Zeile % unvollständig (Bezeichnung, Einheit und Preis nötig)', n + 1;
    end if;
    insert into richtpreise (betrieb_id, bereich, bezeichnung, einheit, preis_chf, quelle, jahr, bemerkung)
    values (v_betrieb, coalesce(nullif(x ->> 'bereich', ''), 'Andere'), trim(x ->> 'bezeichnung'), trim(x ->> 'einheit'),
            (x ->> 'preis_chf')::numeric, nullif(trim(x ->> 'quelle'), ''), nullif(x ->> 'jahr', '')::int, nullif(trim(x ->> 'bemerkung'), ''))
    on conflict (betrieb_id, bereich, bezeichnung, einheit) do update
      set preis_chf = excluded.preis_chf, quelle = excluded.quelle, jahr = excluded.jahr,
          bemerkung = coalesce(excluded.bemerkung, richtpreise.bemerkung), aktiv = true;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.richtpreise_importieren(jsonb) from public, anon;
grant execute on function public.richtpreise_importieren(jsonb) to authenticated;

-- >>> supabase/migrations/20261102000024_lohnarbeit_abrechnung.sql
-- =====================================================================
-- Migration 24: Lohnarbeit einheitlich führen und abrechnen
-- 1) Geplante oder erledigte Arbeiten mit Lohnunternehmen erscheinen automatisch als Auftrag (gleicher Status).
-- 2) Abrechnung je Stunde, Hektare, Ballen, Stück oder pauschal; Kosten = erfasste Menge × Preis.
-- =====================================================================

alter table public.auftraege add column if not exists abrechnung text
  check (abrechnung is null or abrechnung in ('Stunde', 'Hektare', 'Ballen', 'Stück', 'Pauschale'));
alter table public.auftraege add column if not exists preis_je_einheit numeric(10, 2) check (preis_je_einheit is null or preis_je_einheit >= 0);
alter table public.auftraege add column if not exists menge_abgerechnet numeric(12, 2) check (menge_abgerechnet is null or menge_abgerechnet >= 0);
alter table public.auftraege add column if not exists kosten_chf numeric(12, 2) check (kosten_chf is null or kosten_chf >= 0);

-- Kosten aus Abrechnungsart, Preis und Menge (Pauschale: Preis = Betrag)
create or replace function public.auftrag_kosten(p_art text, p_preis numeric, p_menge numeric, p_kosten numeric)
returns numeric
language sql immutable as $$
  select case
    when p_art = 'Pauschale' and p_preis is not null then p_preis
    when p_art is not null and p_preis is not null and p_menge is not null then round(p_menge * p_preis, 2)
    else p_kosten
  end
$$;

-- ---------------------------------------------------------------------
-- Auftrag einer Arbeit mit Lohnunternehmen nachführen
-- ---------------------------------------------------------------------
create or replace function public.lohnauftrag_abgleichen(p_feldarbeit uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_fa   feldarbeiten%rowtype;
  v_a    auftraege%rowtype;
  v_nr   text;
  v_jahr text;
  v_titel text;
begin
  select * into v_fa from feldarbeiten where id = p_feldarbeit;
  if not found then return null; end if;

  -- zugehöriger Auftrag: bei geplanter Arbeit der offene, bei erledigter der erledigte
  select * into v_a from auftraege
   where feldarbeit_id = v_fa.id and art = 'Lohnarbeit'
     and ((v_fa.status = 'geplant' and status not in ('Erledigt', 'Abgebrochen')) or (v_fa.status = 'erledigt' and status = 'Erledigt'))
   order by erstellt_am desc limit 1;

  -- gelöscht oder ohne Lohnunternehmen: offenen Auftrag abbrechen
  if v_fa.geloescht_am is not null or v_fa.partner_id is null then
    if v_a.id is not null and v_a.status not in ('Erledigt', 'Abgebrochen') then
      update auftraege set status = 'Abgebrochen' where id = v_a.id;
    end if;
    return null;
  end if;

  select v_fa.arbeitsart || ' ' || string_agg(f.name, ', ' order by f.feldnummer) into v_titel
    from feldarbeit_felder ff join felder f on f.id = ff.feld_id where ff.feldarbeit_id = v_fa.id;

  if v_a.id is null then
    v_jahr := to_char(coalesce(v_fa.datum, current_date), 'YYYY');
    perform pg_advisory_xact_lock(hashtext('auftrag-' || v_fa.betrieb_id::text));
    select v_jahr || '-' || lpad((coalesce(max(split_part(nummer, '-', 2)::int), 0) + 1)::text, 3, '0') into v_nr
      from auftraege where betrieb_id = v_fa.betrieb_id and nummer like v_jahr || '-%';
    insert into auftraege (betrieb_id, nummer, art, partner_id, titel, arbeitsart, termin_von, beschreibung, feldarbeit_id,
                           status, erledigt_am, erstellt_von)
    values (v_fa.betrieb_id, v_nr, 'Lohnarbeit', v_fa.partner_id, coalesce(v_titel, v_fa.arbeitsart), v_fa.arbeitsart, v_fa.datum,
            v_fa.bemerkungen, v_fa.id,
            case when v_fa.status = 'erledigt' then 'Erledigt' else 'Entwurf' end,
            case when v_fa.status = 'erledigt' then v_fa.datum end, auth.uid())
    returning * into v_a;
    -- Betriebsmittel nur beim Anlegen übernehmen (danach im Auftrag pflegen)
    insert into auftrag_mittel (betrieb_id, auftrag_id, artikel_id, kategorie, einheit, menge_je_ha, bereitstellung)
    select v_fa.betrieb_id, v_a.id, fm.artikel_id, l.kategorie, l.einheit, fm.menge_je_ha,
           case when fm.vom_lager then 'Betrieb' else 'Dienstleister' end
      from feldarbeit_mittel fm join lagerartikel l on l.id = fm.artikel_id
     where fm.feldarbeit_id = v_fa.id and l.kategorie in ('Dünger', 'Saatgut', 'Pflanzenschutzmittel', 'Ersatzteile', 'Betriebsstoffe', 'Erzeugnisse', 'Verbrauchsmaterial', 'Sonstiges');
  else
    update auftraege set
      -- anderer Lohnunternehmer: Auftrag muss neu gesendet werden
      status = case when status not in ('Erledigt', 'Abgebrochen') and partner_id <> v_fa.partner_id then 'Entwurf' else status end,
      gesendet_am = case when partner_id <> v_fa.partner_id then null else gesendet_am end,
      partner_id = v_fa.partner_id, arbeitsart = v_fa.arbeitsart,
      termin_von = case when status = 'Erledigt' then termin_von else v_fa.datum end,
      erledigt_am = case when status = 'Erledigt' then v_fa.datum else erledigt_am end
    where id = v_a.id;
  end if;

  -- Felder immer gleich wie bei der Arbeit
  delete from auftrag_felder af where af.auftrag_id = v_a.id
     and not exists (select 1 from feldarbeit_felder ff where ff.feldarbeit_id = v_fa.id and ff.feld_id = af.feld_id);
  insert into auftrag_felder (betrieb_id, auftrag_id, feld_id)
  select v_fa.betrieb_id, v_a.id, ff.feld_id from feldarbeit_felder ff where ff.feldarbeit_id = v_fa.id
  on conflict (auftrag_id, feld_id) do nothing;
  return v_a.id;
end $$;
revoke all on function public.lohnauftrag_abgleichen(uuid) from public, anon, authenticated;

-- Speichern (mit Geräten) gleicht den Lohnauftrag gleich mit ab
create or replace function public.feldarbeit_speichern_geraete(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  v_liste   uuid[] := array(select t.x::uuid from jsonb_array_elements_text(coalesce(p -> 'geraete', '[]')) as t(x));
  v_id      uuid;
  i         int;
begin
  if (select count(*) from unnest(v_liste) g) <> (select count(*) from maschinen where id = any(v_liste) and betrieb_id = v_betrieb) then
    raise exception 'Unbekanntes Gerät';
  end if;
  if cardinality(v_liste) <> (select count(distinct g) from unnest(v_liste) g) then raise exception 'Jedes Gerät nur einmal wählen'; end if;
  v_id := feldarbeit_speichern(p || jsonb_build_object('geraet_id', v_liste[1]));
  if p ? 'geraete' then
    delete from feldarbeit_geraete where feldarbeit_id = v_id;
    for i in 1 .. coalesce(cardinality(v_liste), 0) loop
      insert into feldarbeit_geraete (feldarbeit_id, maschine_id, betrieb_id, position) values (v_id, v_liste[i], v_betrieb, i);
    end loop;
  end if;
  perform lohnauftrag_abgleichen(v_id);
  return v_id;
end $$;

-- Gelöschte Arbeit: offenen Auftrag abbrechen
create or replace function public.arbeit_geloescht_auftrag() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.geloescht_am is not null and old.geloescht_am is null then
    update auftraege set status = 'Abgebrochen' where feldarbeit_id = new.id and status not in ('Erledigt', 'Abgebrochen');
  end if;
  return null;
end $$;
revoke all on function public.arbeit_geloescht_auftrag() from public, anon, authenticated;
drop trigger if exists z_auftrag_geloescht on public.feldarbeiten;
create trigger z_auftrag_geloescht after update of geloescht_am on public.feldarbeiten
  for each row execute function public.arbeit_geloescht_auftrag();

-- Bestehende geplante Arbeiten mit Lohnunternehmen ohne Auftrag nachtragen
do $$
declare r record;
begin
  for r in select fa.id from feldarbeiten fa
            where fa.status = 'geplant' and fa.partner_id is not null and fa.geloescht_am is null
              and not exists (select 1 from auftraege a where a.feldarbeit_id = fa.id and a.status not in ('Abgebrochen'))
  loop
    perform lohnauftrag_abgleichen(r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Auftrag speichern mit Abrechnungsart und Preis
-- ---------------------------------------------------------------------
create or replace function public.auftrag_speichern_abrechnung(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  v_id := auftrag_speichern(p);
  update auftraege set abrechnung = nullif(p ->> 'abrechnung', ''), preis_je_einheit = nullif(p ->> 'preis_je_einheit', '')::numeric
   where id = v_id;
  return v_id;
end $$;

-- Abschliessen mit erfasster Menge: Kosten = Menge × Preis (oder Betrag von Hand)
create or replace function public.auftrag_abschliessen_abrechnung(p_id uuid, p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_a      auftraege%rowtype;
  v_menge  numeric := nullif(p ->> 'menge', '')::numeric;
  v_kosten numeric;
  v_text   text;
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  select * into v_a from auftraege where id = p_id and betrieb_id = mein_betrieb();
  if not found then raise exception 'Auftrag nicht gefunden'; end if;
  if v_menge is not null and v_menge < 0 then raise exception 'Menge ungültig'; end if;
  if v_a.abrechnung is not null and v_a.abrechnung <> 'Pauschale' and v_a.preis_je_einheit is not null and v_menge is null then
    raise exception 'Bitte die abgerechnete Menge angeben (%)', case v_a.abrechnung when 'Hektare' then 'ha' when 'Stunde' then 'Stunden' else v_a.abrechnung end;
  end if;
  v_kosten := auftrag_kosten(v_a.abrechnung, v_a.preis_je_einheit, v_menge, nullif(p ->> 'kosten', '')::numeric);
  update auftraege set menge_abgerechnet = case when abrechnung = 'Pauschale' then 1 else v_menge end, kosten_chf = v_kosten where id = p_id;
  v_text := case when v_kosten is not null then
              'Kosten CHF ' || to_char(v_kosten, 'FM999999990.00') ||
              case when v_a.abrechnung is not null and v_a.abrechnung <> 'Pauschale' and v_menge is not null
                   then ' (' || trim(to_char(v_menge, 'FM999999990.##')) || ' ' ||
                        case v_a.abrechnung when 'Hektare' then 'ha' when 'Stunde' then 'h' else v_a.abrechnung end ||
                        ' à ' || to_char(v_a.preis_je_einheit, 'FM999999990.00') || ')'
                   when v_a.abrechnung = 'Pauschale' then ' (pauschal)' else '' end
            end;
  return auftrag_abschliessen(p_id, nullif(p ->> 'datum', '')::date, v_kosten,
                              nullif(concat_ws(' · ', nullif(trim(p ->> 'bemerkung'), ''), v_text), ''));
end $$;

-- Abrechnung eines erledigten Auftrags nachtragen oder korrigieren (z. B. wenn die Rechnung kommt)
create or replace function public.auftrag_abrechnung_nachtragen(p_id uuid, p jsonb)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_art    text := nullif(p ->> 'abrechnung', '');
  v_preis  numeric := nullif(p ->> 'preis_je_einheit', '')::numeric;
  v_menge  numeric := nullif(p ->> 'menge', '')::numeric;
  v_kosten numeric;
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  if (v_preis is not null and v_preis < 0) or (v_menge is not null and v_menge < 0) then raise exception 'Zahl ungültig'; end if;
  v_kosten := auftrag_kosten(v_art, v_preis, v_menge, nullif(p ->> 'kosten', '')::numeric);
  update auftraege set abrechnung = v_art, preis_je_einheit = v_preis,
         menge_abgerechnet = case when v_art = 'Pauschale' then 1 else v_menge end, kosten_chf = v_kosten
   where id = p_id and betrieb_id = mein_betrieb();
  if not found then raise exception 'Auftrag nicht gefunden'; end if;
  return v_kosten;
end $$;

revoke all on function public.auftrag_speichern_abrechnung(jsonb) from public, anon;
revoke all on function public.auftrag_abschliessen_abrechnung(uuid, jsonb) from public, anon;
revoke all on function public.auftrag_abrechnung_nachtragen(uuid, jsonb) from public, anon;
grant execute on function public.auftrag_speichern_abrechnung(jsonb) to authenticated;
grant execute on function public.auftrag_abschliessen_abrechnung(uuid, jsonb) to authenticated;
grant execute on function public.auftrag_abrechnung_nachtragen(uuid, jsonb) to authenticated;
grant execute on function public.feldarbeit_speichern_geraete(jsonb) to authenticated;
grant execute on function public.auftrag_kosten(text, numeric, numeric, numeric) to authenticated;

-- >>> supabase/migrations/20261102000025_bff.sql
-- =====================================================================
-- Migration 25: Biodiversitätsförderflächen (BFF, «öko») je Feld und Zone des Betriebs
-- Grundlage für Hinweise zu Schnittzeitpunkt und Düngung. Die App warnt nur; massgebend sind DZV,
-- kantonale Vorgaben und Vereinbarungen (z. B. Vernetzungsprojekt).
-- =====================================================================

alter table public.betriebe add column if not exists zone text
  check (zone is null or zone in ('Talzone', 'Hügelzone', 'Bergzone I', 'Bergzone II', 'Bergzone III', 'Bergzone IV'));

alter table public.felder add column if not exists bff_typ text check (bff_typ is null or bff_typ in (
  'Extensiv genutzte Wiese', 'Wenig intensiv genutzte Wiese', 'Extensiv genutzte Weide', 'Waldweide', 'Streuefläche', 'Uferwiese',
  'Hecke mit Krautsaum', 'Buntbrache', 'Rotationsbrache', 'Saum auf Ackerfläche', 'Andere BFF'));
alter table public.felder add column if not exists bff_qualitaet smallint check (bff_qualitaet is null or bff_qualitaet in (1, 2));
alter table public.felder add column if not exists bff_vernetzung boolean not null default false;
-- abweichender frühester Schnitt (Vernetzungsprojekt, Vereinbarung), als Monat-Tag
alter table public.felder add column if not exists schnitt_ab text check (schnitt_ab is null or schnitt_ab ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');

-- >>> supabase/migrations/20261102000026_artikel_loeschen.sql
-- =====================================================================
-- Hofmanager – Migration 26: Lagerartikel löschen
-- Einspielen: Supabase › SQL Editor › gesamten Inhalt einfügen › Run
--
-- Artikel ohne Bestand können gelöscht werden (einzeln oder mehrere auf einmal):
--  • nie verwendet → wird ganz gelöscht
--  • schon in Buchungen, Feldarbeiten, Aufträgen, Verkäufen oder Reparaturen verwendet → wird ausgeblendet,
--    damit diese Einträge vollständig bleiben
--  • Artikel mit Bestand bleiben stehen (zuerst ausbuchen bzw. Inventur auf 0)
-- Zuordnungen zu Maschinen (Ersatzteile) werden in beiden Fällen entfernt.
-- =====================================================================

create or replace function public.lagerartikel_loeschen(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  v_geloescht int := 0;
  v_ausgeblendet int := 0;
  v_behalten text[] := '{}';
begin
  if not public.darf_verwalten() then
    raise exception 'Keine Berechtigung';
  end if;

  for a in
    select l.id, l.bezeichnung, l.lagerfuehrung, l.einheit, coalesce((select sum(b.menge) from lagerbewegungen b where b.artikel_id = l.id), 0) as bestand
      from lagerartikel l
     where l.id = any (p_ids) and l.betrieb_id = public.mein_betrieb() and l.aktiv
  loop
    if a.lagerfuehrung and a.bestand <> 0 then
      v_behalten := v_behalten || (a.bezeichnung || ' (' || trim(to_char(a.bestand, 'FM999999990.###')) || ' ' || a.einheit || ')');
      continue;
    end if;

    delete from maschine_teile where artikel_id = a.id;
    update ernte_abnehmer set lagerartikel_id = null where lagerartikel_id = a.id;

    if exists (select 1 from lagerbewegungen where artikel_id = a.id)
       or exists (select 1 from feldarbeit_mittel where artikel_id = a.id)
       or exists (select 1 from verkauf_positionen where artikel_id = a.id)
       or exists (select 1 from eintrag_teile where artikel_id = a.id)
       or exists (select 1 from auftrag_mittel where artikel_id = a.id) then
      update lagerartikel set aktiv = false, version = version where id = a.id;
      v_ausgeblendet := v_ausgeblendet + 1;
    else
      delete from lagerartikel where id = a.id;
      v_geloescht := v_geloescht + 1;
    end if;
  end loop;

  return jsonb_build_object('geloescht', v_geloescht, 'ausgeblendet', v_ausgeblendet, 'behalten', to_jsonb(v_behalten));
end;
$$;

revoke all on function public.lagerartikel_loeschen(uuid[]) from public, anon;
grant execute on function public.lagerartikel_loeschen(uuid[]) to authenticated;

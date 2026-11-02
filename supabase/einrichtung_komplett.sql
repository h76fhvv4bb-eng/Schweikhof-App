-- =====================================================================
-- Hofmanager – KOMPLETTE Ersteinrichtung der Datenbank (alle Migrationen)
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

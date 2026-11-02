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

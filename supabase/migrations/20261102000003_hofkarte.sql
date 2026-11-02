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

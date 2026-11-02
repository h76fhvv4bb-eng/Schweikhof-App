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

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

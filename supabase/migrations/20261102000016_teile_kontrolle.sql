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

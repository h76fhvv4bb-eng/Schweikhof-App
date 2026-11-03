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

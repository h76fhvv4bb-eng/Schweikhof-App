-- =====================================================================
-- Hofmanager – Migration 32: Sperrflächen
-- Einspielen: Supabase › SQL Editor › gesamten Inhalt einfügen › Run
--
-- Felder vorübergehend sperren (z. B. für Hundetraining, Spaziergänger, Reiter): frisch gesät, Ernte,
-- Pflanzenschutz, nasser Boden … Für die Nutzer gibt es einen Plan als PDF mit Karte.
-- =====================================================================

create table if not exists public.sperrungen (
  id           uuid primary key default gen_random_uuid(),
  betrieb_id   uuid not null references public.betriebe (id),
  grund        text not null check (length(trim(grund)) between 1 and 120),
  fuer         text,                                   -- für wen, z. B. «Hundetraining»
  partner_id   uuid references public.partner (id) on delete set null,
  von          date not null,
  bis          date,                                   -- leer = bis auf Weiteres
  bemerkungen  text,
  erstellt_am  timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  constraint sperrung_zeitraum check (bis is null or bis >= von)
);
create table if not exists public.sperrung_felder (
  sperrung_id uuid not null references public.sperrungen (id) on delete cascade,
  feld_id     uuid not null references public.felder (id) on delete cascade,
  betrieb_id  uuid not null references public.betriebe (id),
  primary key (sperrung_id, feld_id)
);
create index if not exists sperrungen_betrieb on public.sperrungen (betrieb_id, von);

alter table public.sperrungen enable row level security;
alter table public.sperrung_felder enable row level security;
drop policy if exists sperrungen_lesen on public.sperrungen;
create policy sperrungen_lesen on public.sperrungen for select using (betrieb_id = public.mein_betrieb());
drop policy if exists sperrung_felder_lesen on public.sperrung_felder;
create policy sperrung_felder_lesen on public.sperrung_felder for select using (betrieb_id = public.mein_betrieb());
grant select on public.sperrungen, public.sperrung_felder to authenticated;

-- p = { id?, grund, fuer?, partner_id?, von, bis?, bemerkungen?, felder: [uuid] }
create or replace function public.sperrung_speichern(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_von date := nullif(p ->> 'von', '')::date;
  v_bis date := nullif(p ->> 'bis', '')::date;
begin
  if v_betrieb is null or not darf_erfassen() then raise exception 'Keine Berechtigung'; end if;
  if coalesce(trim(p ->> 'grund'), '') = '' then raise exception 'Bitte den Grund angeben'; end if;
  if v_von is null then raise exception 'Beginn fehlt'; end if;
  if v_bis is not null and v_bis < v_von then raise exception 'Das Ende liegt vor dem Beginn'; end if;
  if jsonb_array_length(coalesce(p -> 'felder', '[]')) = 0 then raise exception 'Bitte mindestens ein Feld wählen'; end if;
  if nullif(p ->> 'partner_id', '') is not null
     and not exists (select 1 from partner where id = (p ->> 'partner_id')::uuid and betrieb_id = v_betrieb) then
    raise exception 'Unbekannter Partner';
  end if;
  if v_id is null then
    insert into sperrungen (betrieb_id, grund, fuer, partner_id, von, bis, bemerkungen)
    values (v_betrieb, trim(p ->> 'grund'), nullif(trim(p ->> 'fuer'), ''), nullif(p ->> 'partner_id', '')::uuid, v_von, v_bis,
            nullif(trim(p ->> 'bemerkungen'), ''))
    returning id into v_id;
  else
    update sperrungen set grund = trim(p ->> 'grund'), fuer = nullif(trim(p ->> 'fuer'), ''), partner_id = nullif(p ->> 'partner_id', '')::uuid,
           von = v_von, bis = v_bis, bemerkungen = nullif(trim(p ->> 'bemerkungen'), ''), geaendert_am = now()
     where id = v_id and betrieb_id = v_betrieb;
    if not found then raise exception 'Sperrung nicht gefunden'; end if;
    delete from sperrung_felder where sperrung_id = v_id;
  end if;
  insert into sperrung_felder (sperrung_id, feld_id, betrieb_id)
  select v_id, f.id, v_betrieb from felder f
   where f.betrieb_id = v_betrieb and f.geloescht_am is null
     and f.id in (select (jsonb_array_elements_text(p -> 'felder'))::uuid)
  on conflict do nothing;
  if not exists (select 1 from sperrung_felder where sperrung_id = v_id) then raise exception 'Unbekannte Felder'; end if;
  return v_id;
end $$;
revoke all on function public.sperrung_speichern(jsonb) from public, anon;
grant execute on function public.sperrung_speichern(jsonb) to authenticated;

-- Löschen, oder mit p_ende «aufheben» (Ende auf dieses Datum setzen)
create or replace function public.sperrung_beenden(p_id uuid, p_ende date default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not darf_erfassen() then raise exception 'Keine Berechtigung'; end if;
  if p_ende is null then
    delete from sperrungen where id = p_id and betrieb_id = mein_betrieb();
  else
    update sperrungen set bis = greatest(p_ende, von), geaendert_am = now() where id = p_id and betrieb_id = mein_betrieb();
  end if;
  if not found then raise exception 'Sperrung nicht gefunden'; end if;
end $$;
revoke all on function public.sperrung_beenden(uuid, date) from public, anon;
grant execute on function public.sperrung_beenden(uuid, date) to authenticated;

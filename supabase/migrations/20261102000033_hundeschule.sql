-- =====================================================================
-- Hofmanager – Migration 33: Hundeschule (einfach: pro Feld frei oder gesperrt)
-- Einspielen: Supabase › SQL Editor › gesamten Inhalt einfügen › Run
--
-- Unabhängig vom Rest der App: hält nur fest, welche Felder die Hundeschule nutzen darf.
-- Felder ohne Eintrag gelten als gesperrt.
-- =====================================================================

create table if not exists public.hundeschule_felder (
  feld_id      uuid primary key references public.felder (id) on delete cascade,
  betrieb_id   uuid not null references public.betriebe (id),
  frei         boolean not null default false,
  bemerkung    text check (bemerkung is null or length(bemerkung) <= 200),
  geaendert_am timestamptz not null default now()
);
alter table public.betriebe add column if not exists hundeschule_hinweis text check (hundeschule_hinweis is null or length(hundeschule_hinweis) <= 1000);

alter table public.hundeschule_felder enable row level security;
drop policy if exists hundeschule_lesen on public.hundeschule_felder;
create policy hundeschule_lesen on public.hundeschule_felder for select using (betrieb_id = public.mein_betrieb());
grant select on public.hundeschule_felder to authenticated;

-- p = { felder: [ { feld_id, frei, bemerkung? } ], hinweis?: text }
create or replace function public.hundeschule_setzen(p jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
begin
  if v_betrieb is null or not darf_erfassen() then raise exception 'Keine Berechtigung'; end if;
  insert into hundeschule_felder (feld_id, betrieb_id, frei, bemerkung, geaendert_am)
  select f.id, v_betrieb, coalesce((x ->> 'frei')::boolean, false), nullif(trim(x ->> 'bemerkung'), ''), now()
    from jsonb_array_elements(coalesce(p -> 'felder', '[]')) x
    join felder f on f.id = (x ->> 'feld_id')::uuid and f.betrieb_id = v_betrieb
  on conflict (feld_id) do update set
    frei = excluded.frei,
    bemerkung = case when (select x2 ? 'bemerkung' from jsonb_array_elements(p -> 'felder') x2 where (x2 ->> 'feld_id')::uuid = excluded.feld_id limit 1)
                     then excluded.bemerkung else hundeschule_felder.bemerkung end,
    geaendert_am = now();
  if p ? 'hinweis' then
    update betriebe set hundeschule_hinweis = nullif(trim(p ->> 'hinweis'), '') where id = v_betrieb;
  end if;
end $$;
revoke all on function public.hundeschule_setzen(jsonb) from public, anon;
grant execute on function public.hundeschule_setzen(jsonb) to authenticated;

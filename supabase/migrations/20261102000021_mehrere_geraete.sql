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

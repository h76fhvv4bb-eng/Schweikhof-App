-- =====================================================================
-- Migration 22: Saat aus der Kartei in die Fruchtfolge übernehmen
-- Wird «Säen» erledigt, bekommt die passende geplante Kultur des Feldes das echte Saatdatum und den Status «ist».
-- Die bisher wachsende Kultur endet (Umbruch) am Vortag, ausser bei Untersaaten.
-- So zeigt die App nach der Saat die neue Kultur als aktuelle Frucht (z. B. Kunstwiese im Herbst fürs nächste Jahr).
-- =====================================================================

create or replace function public.saat_uebernehmen(p_feldarbeit uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_fa    feldarbeiten%rowtype;
  v_ff    record;
  v_ziel  anbau%rowtype;
begin
  select * into v_fa from feldarbeiten where id = p_feldarbeit;
  if not found or v_fa.arbeitsart <> 'Säen' or v_fa.status <> 'erledigt' or v_fa.geloescht_am is not null then return; end if;

  for v_ff in select * from feldarbeit_felder where feldarbeit_id = p_feldarbeit loop
    v_ziel := null;
    -- 1) Kultur mit Saattermin in der Nähe (± 60 Tage), die nächstgelegene
    select a.* into v_ziel from anbau a
     where a.feld_id = v_ff.feld_id and a.saatdatum is not null
       and abs((case when a.nur_monat then date_trunc('month', a.saatdatum)::date else a.saatdatum end) - v_fa.datum) <= 60
     order by (a.status = 'geplant') desc,
              abs((case when a.nur_monat then date_trunc('month', a.saatdatum)::date else a.saatdatum end) - v_fa.datum)
     limit 1;
    -- 2) sonst die geplante Hauptkultur ohne Saattermin: ab Juli fürs nächste Jahr (Herbstsaat), sonst fürs laufende
    if v_ziel.id is null then
      select a.* into v_ziel from anbau a
       where a.feld_id = v_ff.feld_id and a.art = 'Hauptkultur' and a.saatdatum is null and a.status = 'geplant'
         and a.jahr = extract(year from v_fa.datum)::int + case when extract(month from v_fa.datum) >= 7 then 1 else 0 end
       limit 1;
    end if;
    continue when v_ziel.id is null;

    update anbau set saatdatum = v_fa.datum, nur_monat = false, status = 'ist',
                     erntedatum = case when erntedatum is not null and erntedatum < v_fa.datum then null else erntedatum end
     where id = v_ziel.id;
    update feldarbeit_felder set anbau_id = v_ziel.id where feldarbeit_id = p_feldarbeit and feld_id = v_ff.feld_id and anbau_id is distinct from v_ziel.id;

    -- bisherige Kultur endet (nicht bei Untersaat, die in die bestehende Kultur gesät wird)
    if v_ziel.art <> 'Untersaat' then
      update anbau a set erntedatum = v_fa.datum - 1
       where a.feld_id = v_ff.feld_id and a.id <> v_ziel.id and a.art <> 'Untersaat'
         and a.saatdatum is not null and a.saatdatum < v_fa.datum
         and (a.erntedatum is null or a.erntedatum >= v_fa.datum)
         and a.jahr <= v_ziel.jahr;
    end if;
  end loop;
end $$;
revoke all on function public.saat_uebernehmen(uuid) from public, anon, authenticated;

create or replace function public.saat_trigger_felder() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  perform saat_uebernehmen(new.feldarbeit_id);
  return null;
end $$;
create or replace function public.saat_trigger_arbeit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if new.arbeitsart = 'Säen' and new.status = 'erledigt' and (old.status is distinct from new.status or old.datum is distinct from new.datum) then
    perform saat_uebernehmen(new.id);
  end if;
  return null;
end $$;
revoke all on function public.saat_trigger_felder() from public, anon, authenticated;
revoke all on function public.saat_trigger_arbeit() from public, anon, authenticated;

drop trigger if exists z_saat on public.feldarbeit_felder;
create trigger z_saat after insert on public.feldarbeit_felder for each row execute function public.saat_trigger_felder();
drop trigger if exists z_saat on public.feldarbeiten;
create trigger z_saat after update of status, datum on public.feldarbeiten for each row execute function public.saat_trigger_arbeit();

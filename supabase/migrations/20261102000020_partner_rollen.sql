-- =====================================================================
-- Migration 20: Ein Partner kann mehrere Rollen haben
-- (z. B. Lohnunternehmen und Abnehmer, oder Tierhalter und Händler).
-- «art» bleibt als Hauptrolle erhalten (erste Rolle) und wird automatisch nachgeführt.
-- =====================================================================

alter table public.partner add column if not exists rollen text[];
update public.partner set rollen = array[art] where rollen is null or cardinality(rollen) = 0;
alter table public.partner alter column rollen set default '{}';
alter table public.partner alter column rollen set not null;
alter table public.partner drop constraint if exists partner_rollen_check;
alter table public.partner add constraint partner_rollen_check check (
  cardinality(rollen) >= 1
  and rollen <@ array['Lohnunternehmen', 'Mechaniker/Werkstatt', 'Händler/Lieferant', 'Berater',
                      'Abnehmer/Käufer', 'Tierhalter', 'Behörde/Kontrolle', 'Andere']::text[]);
create index if not exists partner_rollen on public.partner using gin (rollen);

create or replace function public.partner_rollen_nachfuehren() returns trigger
language plpgsql as $$
begin
  -- doppelte entfernen, Reihenfolge behalten
  if new.rollen is not null then
    new.rollen := array(select r from unnest(new.rollen) with ordinality u(r, i) group by r order by min(i));
  end if;
  if tg_op = 'INSERT' then
    if new.rollen is null or cardinality(new.rollen) = 0 then new.rollen := array[new.art]; end if;
    new.art := new.rollen[1];
  elsif new.rollen is distinct from old.rollen then
    if new.rollen is null or cardinality(new.rollen) = 0 then new.rollen := array[new.art]; end if;
    new.art := new.rollen[1];
  elsif new.art is distinct from old.art and not (new.art = any(new.rollen)) then
    -- nur die Hauptrolle geändert (ältere App-Version): an den Anfang stellen
    new.rollen := array[new.art] || new.rollen;
  end if;
  return new;
end $$;

drop trigger if exists c_rollen on public.partner;
create trigger c_rollen before insert or update on public.partner for each row execute function public.partner_rollen_nachfuehren();

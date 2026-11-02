-- =====================================================================
-- Migration 8: Felder löschen mit Papierkorb (24 h) und mehrere Kulturen je Feld und Jahr
-- =====================================================================

-- ---------------------------------------------------------------------
-- Papierkorb für Felder
-- Gelöschte Felder sind 24 Stunden wiederherstellbar. Danach werden sie endgültig entfernt,
-- ausser es gibt dazu Aufzeichnungen (Feldarbeiten, Ernten, Aufträge): Diese bleiben erhalten,
-- das Feld bleibt dann ausgeblendet im Archiv.
-- ---------------------------------------------------------------------

-- Feldnummern gelöschter Felder dürfen wieder vergeben werden
alter table public.felder drop constraint felder_betrieb_id_feldnummer_key;
create unique index felder_nummer_aktiv on public.felder (betrieb_id, feldnummer) where geloescht_am is null;

alter table public.felder add column geloescht_von uuid references auth.users (id) on delete set null;

-- Hat das Feld Aufzeichnungen, die nicht gelöscht werden dürfen?
create or replace function public.feld_aufzeichnungen(p_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'arbeiten', (select count(*) from feldarbeit_felder ff join feldarbeiten fa on fa.id = ff.feldarbeit_id
                  where ff.feld_id = p_id and fa.geloescht_am is null),
    'ernten',   (select count(*) from ernten where feld_id = p_id),
    'auftraege', (select count(*) from auftrag_felder where feld_id = p_id))
  where exists (select 1 from felder where id = p_id and betrieb_id = mein_betrieb());
$$;

create or replace function public.feld_loeschen(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  update felder set geloescht_am = now(), geloescht_von = auth.uid()
   where id = p_id and betrieb_id = mein_betrieb() and geloescht_am is null;
  if not found then raise exception 'Feld nicht gefunden oder bereits gelöscht'; end if;
end $$;

create or replace function public.feld_wiederherstellen(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v felder%rowtype;
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  select * into v from felder where id = p_id and betrieb_id = mein_betrieb() and geloescht_am is not null;
  if not found then raise exception 'Feld nicht im Papierkorb'; end if;
  if v.geloescht_am < now() - interval '24 hours' then
    raise exception 'Das Feld wurde vor mehr als 24 Stunden gelöscht und kann nicht mehr wiederhergestellt werden';
  end if;
  if exists (select 1 from felder where betrieb_id = v.betrieb_id and feldnummer = v.feldnummer and geloescht_am is null) then
    raise exception 'Die Feldnummer % ist inzwischen wieder vergeben. Bitte zuerst das andere Feld umnummerieren.', v.feldnummer;
  end if;
  update felder set geloescht_am = null, geloescht_von = null where id = p_id;
end $$;

-- Endgültig entfernen: ein Feld (sofort, aus dem Papierkorb) oder alle abgelaufenen (p_id = null)
create or replace function public.papierkorb_leeren(p_id uuid default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  v_anzahl int := 0;
  r record;
begin
  if v_betrieb is null then return 0; end if;
  if p_id is not null and not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  for r in
    select f.id from felder f
     where f.betrieb_id = v_betrieb and f.geloescht_am is not null
       and (case when p_id is null then f.geloescht_am < now() - interval '24 hours' else f.id = p_id end)
       -- Aufzeichnungen bleiben erhalten: solche Felder werden nicht entfernt
       and not exists (select 1 from feldarbeit_felder where feld_id = f.id)
       and not exists (select 1 from ernten where feld_id = f.id)
       and not exists (select 1 from auftrag_felder where feld_id = f.id)
       and not exists (select 1 from felder z where z.zusammengefuehrt_in = f.id)
  loop
    delete from feld_hinweise where feld_id = r.id;
    delete from anbau where feld_id = r.id;
    delete from feld_parzellen where feld_id = r.id;
    delete from felder where id = r.id;
    v_anzahl := v_anzahl + 1;
  end loop;
  if p_id is not null and v_anzahl = 0 then
    raise exception 'Dieses Feld hat Aufzeichnungen (Arbeiten, Ernten oder Aufträge) und bleibt archiviert';
  end if;
  return v_anzahl;
end $$;

revoke all on function public.feld_aufzeichnungen(uuid), public.feld_loeschen(uuid), public.feld_wiederherstellen(uuid),
  public.papierkorb_leeren(uuid) from public, anon;
grant execute on function public.feld_aufzeichnungen(uuid), public.feld_loeschen(uuid), public.feld_wiederherstellen(uuid),
  public.papierkorb_leeren(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Mehrere Kulturen je Feld und Jahr
-- Hauptkultur: genau eine je Feld und Jahr (Grundlage für Kartei, Ernte, Flächen).
-- Zweitkultur (z. B. Silomais nach Grünschnittroggen, oder auf einer Teilfläche),
-- Zwischenkultur und Untersaat: beliebig viele, jede Kultur einmal je Jahr.
-- ---------------------------------------------------------------------
alter table public.anbau drop constraint anbau_art_check;
alter table public.anbau add constraint anbau_art_check
  check (art in ('Hauptkultur', 'Zweitkultur', 'Zwischenkultur', 'Untersaat'));
alter table public.anbau drop constraint anbau_feld_id_jahr_art_key;
create unique index anbau_hauptkultur on public.anbau (feld_id, jahr) where art = 'Hauptkultur';
create unique index anbau_kultur_je_jahr on public.anbau (feld_id, jahr, art, kultur_id);

-- Teilfläche darf nicht grösser als das Feld sein
create or replace function public.pruefe_anbau_flaeche() returns trigger
language plpgsql as $$
declare
  v_feld numeric;
begin
  if new.flaeche_m2 is not null then
    select flaeche_m2 into v_feld from public.felder where id = new.feld_id;
    if new.flaeche_m2 > v_feld then
      raise exception 'Die Teilfläche ist grösser als das Feld (% m²)', round(v_feld);
    end if;
  end if;
  return new;
end $$;
create trigger c_anbau_flaeche before insert or update on public.anbau for each row execute function public.pruefe_anbau_flaeche();

-- =====================================================================
-- Migration 11: Aufgaben und Arbeitsplanung
-- Geplante Feldarbeiten bleiben Feldarbeiten mit Status «geplant».
-- Maschinen- und allgemeine Aufgaben stehen in «aufgaben».
-- Beim Erledigen werden Zählerstände, effektive Mengen, Zeit und Beobachtungen festgehalten.
-- =====================================================================

-- Zählerstände
alter table public.maschinen add column kilometerstand numeric(9, 1) check (kilometerstand >= 0);
alter table public.maschinen_eintraege add column kilometerstand numeric(9, 1) check (kilometerstand >= 0);
alter table public.feldarbeiten add column maschine_stunden numeric(9, 1) check (maschine_stunden >= 0);
alter table public.feldarbeiten add column maschine_km numeric(9, 1) check (maschine_km >= 0);
alter table public.feldarbeiten add column geraet_stunden numeric(9, 1) check (geraet_stunden >= 0);
alter table public.feldarbeiten add column beobachtung text;

-- ---------------------------------------------------------------------
-- Aufgaben (Maschinen und Allgemein)
-- ---------------------------------------------------------------------
create table public.aufgaben (
  id             uuid primary key default gen_random_uuid(),
  betrieb_id     uuid not null references public.betriebe (id),
  art            text not null check (art in ('Maschine', 'Allgemein')),
  titel          text not null check (length(trim(titel)) between 1 and 120),
  faellig_am     date,
  zugewiesen_an  uuid references public.benutzer_profile (id) on delete set null,
  wichtig        boolean not null default false,
  maschine_id    uuid references public.maschinen (id) on delete cascade,
  eintragsart    text check (eintragsart in ('Wartung', 'Reparatur', 'Kontrolle')),
  partner_id     uuid references public.partner (id) on delete set null,   -- z. B. Werkstatt
  beobachtung_id uuid references public.maschinen_eintraege (id) on delete set null, -- Anlass
  bemerkungen    text,
  status         text not null default 'offen' check (status in ('offen', 'erledigt')),
  erledigt_am    date,
  erledigt_von   uuid references auth.users (id) on delete set null,
  dauer_h        numeric(6, 2) check (dauer_h >= 0),
  ergebnis       text,
  eintrag_id     uuid references public.maschinen_eintraege (id) on delete set null, -- daraus entstandener Eintrag
  erstellt_von   uuid default auth.uid(),
  erstellt_am    timestamptz not null default now(),
  geaendert_am   timestamptz not null default now(),
  version        integer not null default 1,
  check (art <> 'Maschine' or (maschine_id is not null and eintragsart is not null))
);
create index on public.aufgaben (betrieb_id, status, faellig_am);

create trigger a_version before update on public.aufgaben for each row execute function public.pruefe_version();
create trigger b_metadaten before insert or update on public.aufgaben for each row execute function public.setze_metadaten();
create trigger z_protokoll after insert or update or delete on public.aufgaben for each row execute function public.protokolliere();

alter table public.aufgaben enable row level security;
create policy au_lesen   on public.aufgaben for select using (betrieb_id = public.mein_betrieb());
create policy au_neu     on public.aufgaben for insert with check (betrieb_id = public.mein_betrieb() and public.darf_erfassen() and status = 'offen');
create policy au_aendern on public.aufgaben for update using (
  betrieb_id = public.mein_betrieb() and (public.darf_verwalten() or erstellt_von = auth.uid() or zugewiesen_an = auth.uid()));
create policy au_loeschen on public.aufgaben for delete using (
  betrieb_id = public.mein_betrieb() and (public.darf_verwalten() or erstellt_von = auth.uid()));
grant select, insert, update, delete on public.aufgaben to authenticated;

-- Zählerstände nur nach oben nachführen
create or replace function public.zaehler_nachfuehren(p_maschine uuid, p_stunden numeric, p_km numeric)
returns void
language sql security definer set search_path = public as $$
  update maschinen set
    betriebsstunden = case when p_stunden is not null and (betriebsstunden is null or p_stunden > betriebsstunden) then p_stunden else betriebsstunden end,
    kilometerstand  = case when p_km is not null and (kilometerstand is null or p_km > kilometerstand) then p_km else kilometerstand end
  where id = p_maschine and betrieb_id = mein_betrieb();
$$;
revoke all on function public.zaehler_nachfuehren(uuid, numeric, numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Geplante Feldarbeit erledigen
-- p: {"datum", "dauer_h"?, "maschine_stunden"?, "maschine_km"?, "geraet_stunden"?,
--     "mittel": [{"artikel_id", "gesamtmenge"}]? (effektiv verbraucht), "beobachtung"?, "beobachtung_an_maschine"?: uuid}
-- ---------------------------------------------------------------------
create or replace function public.feldarbeit_erledigen(p_id uuid, p jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_a     feldarbeiten%rowtype;
  v_datum date := coalesce((p ->> 'datum')::date, current_date);
  v_ha    numeric;
  m       jsonb;
  v_masch uuid := nullif(p ->> 'beobachtung_an_maschine', '')::uuid;
begin
  if not darf_erfassen() then raise exception 'Keine Berechtigung'; end if;
  select * into v_a from feldarbeiten where id = p_id and betrieb_id = mein_betrieb() and geloescht_am is null for update;
  if not found then raise exception 'Arbeit nicht gefunden'; end if;
  if v_a.status <> 'geplant' then raise exception 'Diese Arbeit ist bereits erledigt'; end if;
  if v_datum > current_date then raise exception 'Das Datum der Erledigung liegt in der Zukunft'; end if;

  update feldarbeiten set
    status = 'erledigt', datum = v_datum,
    dauer_h = coalesce(nullif(p ->> 'dauer_h', '')::numeric, dauer_h),
    maschine_stunden = nullif(p ->> 'maschine_stunden', '')::numeric,
    maschine_km = nullif(p ->> 'maschine_km', '')::numeric,
    geraet_stunden = nullif(p ->> 'geraet_stunden', '')::numeric,
    beobachtung = nullif(trim(p ->> 'beobachtung'), ''),
    ausgefuehrt_von = coalesce(ausgefuehrt_von, auth.uid())
  where id = p_id;

  -- Kultur des Erledigungsjahres zuordnen
  update feldarbeit_felder ff set anbau_id = (
    select a.id from anbau a where a.feld_id = ff.feld_id and a.jahr = extract(year from v_datum)::int and a.art = 'Hauptkultur')
  where ff.feldarbeit_id = p_id;

  -- Effektiv verbrauchte Mengen
  select sum(flaeche_m2) / 10000 into v_ha from feldarbeit_felder where feldarbeit_id = p_id;
  for m in select * from jsonb_array_elements(coalesce(p -> 'mittel', '[]')) loop
    if nullif(m ->> 'gesamtmenge', '') is null then continue; end if;
    if (m ->> 'gesamtmenge')::numeric <= 0 then
      delete from feldarbeit_mittel where feldarbeit_id = p_id and artikel_id = (m ->> 'artikel_id')::uuid;
    else
      update feldarbeit_mittel set gesamtmenge = round((m ->> 'gesamtmenge')::numeric, 3),
                                   menge_je_ha = round((m ->> 'gesamtmenge')::numeric / v_ha, 4)
       where feldarbeit_id = p_id and artikel_id = (m ->> 'artikel_id')::uuid;
    end if;
  end loop;

  -- Zähler
  if v_a.maschine_id is not null then
    perform zaehler_nachfuehren(v_a.maschine_id, nullif(p ->> 'maschine_stunden', '')::numeric, nullif(p ->> 'maschine_km', '')::numeric);
  end if;
  if v_a.geraet_id is not null then
    perform zaehler_nachfuehren(v_a.geraet_id, nullif(p ->> 'geraet_stunden', '')::numeric, null);
  end if;

  -- Beobachtung zusätzlich als offenen Punkt an der Maschine melden
  if v_masch is not null and nullif(trim(p ->> 'beobachtung'), '') is not null then
    if v_masch not in (coalesce(v_a.maschine_id, v_masch), coalesce(v_a.geraet_id, v_masch))
       or not exists (select 1 from maschinen where id = v_masch and betrieb_id = mein_betrieb()) then
      raise exception 'Unbekannte Maschine';
    end if;
    insert into maschinen_eintraege (betrieb_id, maschine_id, art, datum, betriebsstunden, kilometerstand, titel, beschreibung, offen)
    values (mein_betrieb(), v_masch, 'Beobachtung', v_datum,
            case when v_masch = v_a.maschine_id then nullif(p ->> 'maschine_stunden', '')::numeric else nullif(p ->> 'geraet_stunden', '')::numeric end,
            case when v_masch = v_a.maschine_id then nullif(p ->> 'maschine_km', '')::numeric end,
            left(trim(p ->> 'beobachtung'), 80), 'Bei ' || v_a.arbeitsart || ' am ' || to_char(v_datum, 'DD.MM.YYYY') || ': ' || trim(p ->> 'beobachtung'),
            true);
  end if;

  perform feldarbeit_buchen(p_id);
end $$;

-- ---------------------------------------------------------------------
-- Aufgabe erledigen. Bei Maschinen entsteht ein Eintrag (Wartung/Reparatur/Kontrolle).
-- p: {"datum", "dauer_h"?, "ergebnis"?, "betriebsstunden"?, "kilometerstand"?, "kosten"?, "partner_id"?,
--     "noch_offen"?: bool (Mangel besteht weiter), "beobachtung_schliessen"?: bool}
-- ---------------------------------------------------------------------
create or replace function public.aufgabe_erledigen(p_id uuid, p jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v       aufgaben%rowtype;
  v_datum date := coalesce((p ->> 'datum')::date, current_date);
  v_eintrag uuid;
begin
  if not darf_erfassen() then raise exception 'Keine Berechtigung'; end if;
  select * into v from aufgaben where id = p_id and betrieb_id = mein_betrieb() for update;
  if not found then raise exception 'Aufgabe nicht gefunden'; end if;
  if v.status = 'erledigt' then raise exception 'Aufgabe ist bereits erledigt'; end if;
  if v_datum > current_date then raise exception 'Das Datum der Erledigung liegt in der Zukunft'; end if;

  if v.art = 'Maschine' then
    v_eintrag := maschineneintrag_speichern(jsonb_build_object(
      'maschine_id', v.maschine_id, 'art', v.eintragsart, 'datum', v_datum, 'titel', v.titel,
      'beschreibung', concat_ws(E'\n', nullif(v.bemerkungen, ''), nullif(trim(p ->> 'ergebnis'), '')),
      'betriebsstunden', nullif(p ->> 'betriebsstunden', ''), 'kosten', nullif(p ->> 'kosten', ''),
      'arbeitszeit_h', nullif(p ->> 'dauer_h', ''), 'partner_id', coalesce(nullif(p ->> 'partner_id', ''), v.partner_id::text),
      'offen', coalesce((p ->> 'noch_offen')::boolean, false)));
    update maschinen_eintraege set kilometerstand = nullif(p ->> 'kilometerstand', '')::numeric where id = v_eintrag;
    perform zaehler_nachfuehren(v.maschine_id, nullif(p ->> 'betriebsstunden', '')::numeric, nullif(p ->> 'kilometerstand', '')::numeric);
    if v.beobachtung_id is not null and coalesce((p ->> 'beobachtung_schliessen')::boolean, true) then
      update maschinen_eintraege set offen = false where id = v.beobachtung_id;
    end if;
  end if;

  update aufgaben set
    status = 'erledigt', erledigt_am = v_datum, erledigt_von = auth.uid(),
    dauer_h = nullif(p ->> 'dauer_h', '')::numeric, ergebnis = nullif(trim(p ->> 'ergebnis'), ''), eintrag_id = v_eintrag
  where id = p_id;
end $$;

revoke all on function public.feldarbeit_erledigen(uuid, jsonb), public.aufgabe_erledigen(uuid, jsonb) from public, anon;
grant execute on function public.feldarbeit_erledigen(uuid, jsonb), public.aufgabe_erledigen(uuid, jsonb) to authenticated;

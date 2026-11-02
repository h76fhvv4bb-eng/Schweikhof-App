-- =====================================================================
-- Migration 15: Zählerstände und Beobachtung auch beim direkten Erfassen einer erledigten Arbeit
-- =====================================================================
alter table public.feldarbeiten add column beobachtung_eintrag_id uuid references public.maschinen_eintraege (id) on delete set null;

-- p: {"maschine_stunden"?, "maschine_km"?, "geraet_stunden"?, "beobachtung"?, "beobachtung_an_maschine"?: uuid}
create or replace function public.feldarbeit_abschluss(p_id uuid, p jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_a     feldarbeiten%rowtype;
  v_masch uuid := nullif(p ->> 'beobachtung_an_maschine', '')::uuid;
  v_text  text := nullif(trim(p ->> 'beobachtung'), '');
begin
  if not darf_erfassen() then raise exception 'Keine Berechtigung'; end if;
  select * into v_a from feldarbeiten where id = p_id and betrieb_id = mein_betrieb() and geloescht_am is null for update;
  if not found then raise exception 'Arbeit nicht gefunden'; end if;
  if not darf_verwalten() and v_a.erstellt_von is distinct from auth.uid() and v_a.mitarbeiter_id is distinct from ich_mitarbeiter() then
    raise exception 'Nur eigene Einträge können geändert werden';
  end if;
  if v_a.status <> 'erledigt' then return; end if;

  update feldarbeiten set
    maschine_stunden = nullif(p ->> 'maschine_stunden', '')::numeric,
    maschine_km = nullif(p ->> 'maschine_km', '')::numeric,
    geraet_stunden = nullif(p ->> 'geraet_stunden', '')::numeric,
    beobachtung = v_text
  where id = p_id;

  if v_a.maschine_id is not null then
    perform zaehler_nachfuehren(v_a.maschine_id, nullif(p ->> 'maschine_stunden', '')::numeric, nullif(p ->> 'maschine_km', '')::numeric);
  end if;
  if v_a.geraet_id is not null then
    perform zaehler_nachfuehren(v_a.geraet_id, nullif(p ->> 'geraet_stunden', '')::numeric, null);
  end if;

  -- Beobachtung als offener Punkt bei der Maschine: einmal anlegen, beim erneuten Speichern nachführen
  if v_masch is not null and v_text is not null then
    if not exists (select 1 from maschinen where id = v_masch and betrieb_id = mein_betrieb()) then raise exception 'Unbekannte Maschine'; end if;
    if v_a.beobachtung_eintrag_id is not null and exists (select 1 from maschinen_eintraege where id = v_a.beobachtung_eintrag_id) then
      update maschinen_eintraege set maschine_id = v_masch, titel = left(v_text, 80),
             beschreibung = 'Bei ' || v_a.arbeitsart || ' am ' || to_char(v_a.datum, 'DD.MM.YYYY') || ': ' || v_text
       where id = v_a.beobachtung_eintrag_id;
    else
      insert into maschinen_eintraege (betrieb_id, maschine_id, art, datum, betriebsstunden, kilometerstand, titel, beschreibung, offen)
      values (mein_betrieb(), v_masch, 'Beobachtung', v_a.datum,
              case when v_masch = v_a.maschine_id then nullif(p ->> 'maschine_stunden', '')::numeric else nullif(p ->> 'geraet_stunden', '')::numeric end,
              case when v_masch = v_a.maschine_id then nullif(p ->> 'maschine_km', '')::numeric end,
              left(v_text, 80), 'Bei ' || v_a.arbeitsart || ' am ' || to_char(v_a.datum, 'DD.MM.YYYY') || ': ' || v_text, true)
      returning id into v_masch;
      update feldarbeiten set beobachtung_eintrag_id = v_masch where id = p_id;
    end if;
  end if;
end $$;

revoke all on function public.feldarbeit_abschluss(uuid, jsonb) from public, anon;
grant execute on function public.feldarbeit_abschluss(uuid, jsonb) to authenticated;

-- =====================================================================
-- Migration 24: Lohnarbeit einheitlich führen und abrechnen
-- 1) Geplante oder erledigte Arbeiten mit Lohnunternehmen erscheinen automatisch als Auftrag (gleicher Status).
-- 2) Abrechnung je Stunde, Hektare, Ballen, Stück oder pauschal; Kosten = erfasste Menge × Preis.
-- =====================================================================

alter table public.auftraege add column if not exists abrechnung text
  check (abrechnung is null or abrechnung in ('Stunde', 'Hektare', 'Ballen', 'Stück', 'Pauschale'));
alter table public.auftraege add column if not exists preis_je_einheit numeric(10, 2) check (preis_je_einheit is null or preis_je_einheit >= 0);
alter table public.auftraege add column if not exists menge_abgerechnet numeric(12, 2) check (menge_abgerechnet is null or menge_abgerechnet >= 0);
alter table public.auftraege add column if not exists kosten_chf numeric(12, 2) check (kosten_chf is null or kosten_chf >= 0);

-- Kosten aus Abrechnungsart, Preis und Menge (Pauschale: Preis = Betrag)
create or replace function public.auftrag_kosten(p_art text, p_preis numeric, p_menge numeric, p_kosten numeric)
returns numeric
language sql immutable as $$
  select case
    when p_art = 'Pauschale' and p_preis is not null then p_preis
    when p_art is not null and p_preis is not null and p_menge is not null then round(p_menge * p_preis, 2)
    else p_kosten
  end
$$;

-- ---------------------------------------------------------------------
-- Auftrag einer Arbeit mit Lohnunternehmen nachführen
-- ---------------------------------------------------------------------
create or replace function public.lohnauftrag_abgleichen(p_feldarbeit uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_fa   feldarbeiten%rowtype;
  v_a    auftraege%rowtype;
  v_nr   text;
  v_jahr text;
  v_titel text;
begin
  select * into v_fa from feldarbeiten where id = p_feldarbeit;
  if not found then return null; end if;

  -- zugehöriger Auftrag: bei geplanter Arbeit der offene, bei erledigter der erledigte
  select * into v_a from auftraege
   where feldarbeit_id = v_fa.id and art = 'Lohnarbeit'
     and ((v_fa.status = 'geplant' and status not in ('Erledigt', 'Abgebrochen')) or (v_fa.status = 'erledigt' and status = 'Erledigt'))
   order by erstellt_am desc limit 1;

  -- gelöscht oder ohne Lohnunternehmen: offenen Auftrag abbrechen
  if v_fa.geloescht_am is not null or v_fa.partner_id is null then
    if v_a.id is not null and v_a.status not in ('Erledigt', 'Abgebrochen') then
      update auftraege set status = 'Abgebrochen' where id = v_a.id;
    end if;
    return null;
  end if;

  select v_fa.arbeitsart || ' ' || string_agg(f.name, ', ' order by f.feldnummer) into v_titel
    from feldarbeit_felder ff join felder f on f.id = ff.feld_id where ff.feldarbeit_id = v_fa.id;

  if v_a.id is null then
    v_jahr := to_char(coalesce(v_fa.datum, current_date), 'YYYY');
    perform pg_advisory_xact_lock(hashtext('auftrag-' || v_fa.betrieb_id::text));
    select v_jahr || '-' || lpad((coalesce(max(split_part(nummer, '-', 2)::int), 0) + 1)::text, 3, '0') into v_nr
      from auftraege where betrieb_id = v_fa.betrieb_id and nummer like v_jahr || '-%';
    insert into auftraege (betrieb_id, nummer, art, partner_id, titel, arbeitsart, termin_von, beschreibung, feldarbeit_id,
                           status, erledigt_am, erstellt_von)
    values (v_fa.betrieb_id, v_nr, 'Lohnarbeit', v_fa.partner_id, coalesce(v_titel, v_fa.arbeitsart), v_fa.arbeitsart, v_fa.datum,
            v_fa.bemerkungen, v_fa.id,
            case when v_fa.status = 'erledigt' then 'Erledigt' else 'Entwurf' end,
            case when v_fa.status = 'erledigt' then v_fa.datum end, auth.uid())
    returning * into v_a;
    -- Betriebsmittel nur beim Anlegen übernehmen (danach im Auftrag pflegen)
    insert into auftrag_mittel (betrieb_id, auftrag_id, artikel_id, kategorie, einheit, menge_je_ha, bereitstellung)
    select v_fa.betrieb_id, v_a.id, fm.artikel_id, l.kategorie, l.einheit, fm.menge_je_ha,
           case when fm.vom_lager then 'Betrieb' else 'Dienstleister' end
      from feldarbeit_mittel fm join lagerartikel l on l.id = fm.artikel_id
     where fm.feldarbeit_id = v_fa.id and l.kategorie in ('Dünger', 'Saatgut', 'Pflanzenschutzmittel', 'Ersatzteile', 'Betriebsstoffe', 'Erzeugnisse', 'Verbrauchsmaterial', 'Sonstiges');
  else
    update auftraege set
      -- anderer Lohnunternehmer: Auftrag muss neu gesendet werden
      status = case when status not in ('Erledigt', 'Abgebrochen') and partner_id <> v_fa.partner_id then 'Entwurf' else status end,
      gesendet_am = case when partner_id <> v_fa.partner_id then null else gesendet_am end,
      partner_id = v_fa.partner_id, arbeitsart = v_fa.arbeitsart,
      termin_von = case when status = 'Erledigt' then termin_von else v_fa.datum end,
      erledigt_am = case when status = 'Erledigt' then v_fa.datum else erledigt_am end
    where id = v_a.id;
  end if;

  -- Felder immer gleich wie bei der Arbeit
  delete from auftrag_felder af where af.auftrag_id = v_a.id
     and not exists (select 1 from feldarbeit_felder ff where ff.feldarbeit_id = v_fa.id and ff.feld_id = af.feld_id);
  insert into auftrag_felder (betrieb_id, auftrag_id, feld_id)
  select v_fa.betrieb_id, v_a.id, ff.feld_id from feldarbeit_felder ff where ff.feldarbeit_id = v_fa.id
  on conflict (auftrag_id, feld_id) do nothing;
  return v_a.id;
end $$;
revoke all on function public.lohnauftrag_abgleichen(uuid) from public, anon, authenticated;

-- Speichern (mit Geräten) gleicht den Lohnauftrag gleich mit ab
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
  perform lohnauftrag_abgleichen(v_id);
  return v_id;
end $$;

-- Gelöschte Arbeit: offenen Auftrag abbrechen
create or replace function public.arbeit_geloescht_auftrag() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.geloescht_am is not null and old.geloescht_am is null then
    update auftraege set status = 'Abgebrochen' where feldarbeit_id = new.id and status not in ('Erledigt', 'Abgebrochen');
  end if;
  return null;
end $$;
revoke all on function public.arbeit_geloescht_auftrag() from public, anon, authenticated;
drop trigger if exists z_auftrag_geloescht on public.feldarbeiten;
create trigger z_auftrag_geloescht after update of geloescht_am on public.feldarbeiten
  for each row execute function public.arbeit_geloescht_auftrag();

-- Bestehende geplante Arbeiten mit Lohnunternehmen ohne Auftrag nachtragen
do $$
declare r record;
begin
  for r in select fa.id from feldarbeiten fa
            where fa.status = 'geplant' and fa.partner_id is not null and fa.geloescht_am is null
              and not exists (select 1 from auftraege a where a.feldarbeit_id = fa.id and a.status not in ('Abgebrochen'))
  loop
    perform lohnauftrag_abgleichen(r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Auftrag speichern mit Abrechnungsart und Preis
-- ---------------------------------------------------------------------
create or replace function public.auftrag_speichern_abrechnung(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  v_id := auftrag_speichern(p);
  update auftraege set abrechnung = nullif(p ->> 'abrechnung', ''), preis_je_einheit = nullif(p ->> 'preis_je_einheit', '')::numeric
   where id = v_id;
  return v_id;
end $$;

-- Abschliessen mit erfasster Menge: Kosten = Menge × Preis (oder Betrag von Hand)
create or replace function public.auftrag_abschliessen_abrechnung(p_id uuid, p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_a      auftraege%rowtype;
  v_menge  numeric := nullif(p ->> 'menge', '')::numeric;
  v_kosten numeric;
  v_text   text;
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  select * into v_a from auftraege where id = p_id and betrieb_id = mein_betrieb();
  if not found then raise exception 'Auftrag nicht gefunden'; end if;
  if v_menge is not null and v_menge < 0 then raise exception 'Menge ungültig'; end if;
  if v_a.abrechnung is not null and v_a.abrechnung <> 'Pauschale' and v_a.preis_je_einheit is not null and v_menge is null then
    raise exception 'Bitte die abgerechnete Menge angeben (%)', case v_a.abrechnung when 'Hektare' then 'ha' when 'Stunde' then 'Stunden' else v_a.abrechnung end;
  end if;
  v_kosten := auftrag_kosten(v_a.abrechnung, v_a.preis_je_einheit, v_menge, nullif(p ->> 'kosten', '')::numeric);
  update auftraege set menge_abgerechnet = case when abrechnung = 'Pauschale' then 1 else v_menge end, kosten_chf = v_kosten where id = p_id;
  v_text := case when v_kosten is not null then
              'Kosten CHF ' || to_char(v_kosten, 'FM999999990.00') ||
              case when v_a.abrechnung is not null and v_a.abrechnung <> 'Pauschale' and v_menge is not null
                   then ' (' || trim(to_char(v_menge, 'FM999999990.##')) || ' ' ||
                        case v_a.abrechnung when 'Hektare' then 'ha' when 'Stunde' then 'h' else v_a.abrechnung end ||
                        ' à ' || to_char(v_a.preis_je_einheit, 'FM999999990.00') || ')'
                   when v_a.abrechnung = 'Pauschale' then ' (pauschal)' else '' end
            end;
  return auftrag_abschliessen(p_id, nullif(p ->> 'datum', '')::date, v_kosten,
                              nullif(concat_ws(' · ', nullif(trim(p ->> 'bemerkung'), ''), v_text), ''));
end $$;

-- Abrechnung eines erledigten Auftrags nachtragen oder korrigieren (z. B. wenn die Rechnung kommt)
create or replace function public.auftrag_abrechnung_nachtragen(p_id uuid, p jsonb)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_art    text := nullif(p ->> 'abrechnung', '');
  v_preis  numeric := nullif(p ->> 'preis_je_einheit', '')::numeric;
  v_menge  numeric := nullif(p ->> 'menge', '')::numeric;
  v_kosten numeric;
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  if (v_preis is not null and v_preis < 0) or (v_menge is not null and v_menge < 0) then raise exception 'Zahl ungültig'; end if;
  v_kosten := auftrag_kosten(v_art, v_preis, v_menge, nullif(p ->> 'kosten', '')::numeric);
  update auftraege set abrechnung = v_art, preis_je_einheit = v_preis,
         menge_abgerechnet = case when v_art = 'Pauschale' then 1 else v_menge end, kosten_chf = v_kosten
   where id = p_id and betrieb_id = mein_betrieb();
  if not found then raise exception 'Auftrag nicht gefunden'; end if;
  return v_kosten;
end $$;

revoke all on function public.auftrag_speichern_abrechnung(jsonb) from public, anon;
revoke all on function public.auftrag_abschliessen_abrechnung(uuid, jsonb) from public, anon;
revoke all on function public.auftrag_abrechnung_nachtragen(uuid, jsonb) from public, anon;
grant execute on function public.auftrag_speichern_abrechnung(jsonb) to authenticated;
grant execute on function public.auftrag_abschliessen_abrechnung(uuid, jsonb) to authenticated;
grant execute on function public.auftrag_abrechnung_nachtragen(uuid, jsonb) to authenticated;
grant execute on function public.feldarbeit_speichern_geraete(jsonb) to authenticated;
grant execute on function public.auftrag_kosten(text, numeric, numeric, numeric) to authenticated;

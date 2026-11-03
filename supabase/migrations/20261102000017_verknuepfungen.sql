-- =====================================================================
-- Migration 17: Korrekturen an den Verknüpfungen zwischen den Modulen (Ergebnis einer Durchsicht)
-- =====================================================================

-- 1) Geplante Arbeit mit laufendem Lohnauftrag nur über den Auftrag erledigen (sonst doppelte Arbeit/Lagerbuchung)
create or replace function public.feldarbeit_auftrag_pruefen() returns trigger
language plpgsql as $$
begin
  if old.status = 'geplant' and new.status = 'erledigt'
     and coalesce(current_setting('hofmanager.auftrag_abschluss', true), '') <> 'ja'
     and exists (select 1 from public.auftraege where feldarbeit_id = new.id and status not in ('Erledigt', 'Abgebrochen')) then
    raise exception 'Zu dieser Arbeit läuft ein Lohnauftrag. Bitte den Auftrag abschliessen.';
  end if;
  return new;
end $$;
create trigger c_auftrag_pruefen before update on public.feldarbeiten for each row execute function public.feldarbeit_auftrag_pruefen();

-- 2) Gelöschte Vorgängerin gibt ihre Folgearbeiten frei
create or replace function public.feldarbeit_folgen_freigeben() returns trigger
language plpgsql as $$
begin
  if new.geloescht_am is not null and old.geloescht_am is null then
    update public.feldarbeiten set vorgaenger_id = null where vorgaenger_id = new.id;
  end if;
  return null;
end $$;
create trigger z_folgen_freigeben after update of geloescht_am on public.feldarbeiten for each row execute function public.feldarbeit_folgen_freigeben();
update public.feldarbeiten f set vorgaenger_id = null
  where vorgaenger_id in (select id from public.feldarbeiten where geloescht_am is not null);

-- 3) Wartung über Aufgabe/Werkstattauftrag setzt den Wartungsplan zurück
alter table public.aufgaben add column wartungsplan_id uuid references public.wartungsplaene (id) on delete set null;

create or replace function public.aufgabe_erledigen(p_id uuid, p jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v       aufgaben%rowtype;
  v_datum date := coalesce((p ->> 'datum')::date, current_date);
  v_eintrag uuid;
  v_mitarb uuid := nullif(p ->> 'mitarbeiter_id', '')::uuid;
begin
  if not darf_erfassen() then raise exception 'Keine Berechtigung'; end if;
  select * into v from aufgaben where id = p_id and betrieb_id = mein_betrieb() for update;
  if not found then raise exception 'Aufgabe nicht gefunden'; end if;
  if v.status = 'erledigt' then raise exception 'Aufgabe ist bereits erledigt'; end if;
  if v_datum > current_date then raise exception 'Das Datum der Erledigung liegt in der Zukunft'; end if;
  if exists (select 1 from auftraege where aufgabe_id = p_id and status not in ('Erledigt', 'Abgebrochen')) then
    raise exception 'Zu dieser Aufgabe läuft ein Auftrag. Bitte den Auftrag abschliessen.';
  end if;
  if v_mitarb is not null and not exists (select 1 from mitarbeiter where id = v_mitarb and betrieb_id = mein_betrieb()) then
    raise exception 'Unbekannte Person';
  end if;

  if v.art = 'Maschine' then
    v_eintrag := maschineneintrag_speichern(jsonb_build_object(
      'maschine_id', v.maschine_id, 'art', v.eintragsart, 'datum', v_datum, 'titel', v.titel,
      'beschreibung', concat_ws(E'\n', nullif(v.bemerkungen, ''), nullif(trim(p ->> 'ergebnis'), '')),
      'betriebsstunden', nullif(p ->> 'betriebsstunden', ''), 'kosten', nullif(p ->> 'kosten', ''),
      'arbeitszeit_h', nullif(p ->> 'dauer_h', ''), 'partner_id', coalesce(nullif(p ->> 'partner_id', ''), v.partner_id::text),
      'offen', coalesce((p ->> 'noch_offen')::boolean, false), 'wartungsplan_id', v.wartungsplan_id));
    update maschinen_eintraege set kilometerstand = nullif(p ->> 'kilometerstand', '')::numeric where id = v_eintrag;
    perform zaehler_nachfuehren(v.maschine_id, nullif(p ->> 'betriebsstunden', '')::numeric, nullif(p ->> 'kilometerstand', '')::numeric);
    if v.beobachtung_id is not null and coalesce((p ->> 'beobachtung_schliessen')::boolean, true) then
      update maschinen_eintraege set offen = false where id = v.beobachtung_id;
    end if;
  end if;

  update aufgaben set
    status = 'erledigt', erledigt_am = v_datum, erledigt_von = auth.uid(),
    mitarbeiter_id = coalesce(v_mitarb, mitarbeiter_id, ich_mitarbeiter()),
    dauer_h = nullif(p ->> 'dauer_h', '')::numeric, ergebnis = nullif(trim(p ->> 'ergebnis'), ''), eintrag_id = v_eintrag
  where id = p_id;
end $$;

create or replace function public.auftrag_abschliessen(p_id uuid, p_datum date, p_kosten numeric default null, p_bemerkung text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_a       auftraege%rowtype;
  v_fa      feldarbeiten%rowtype;
  v_mittel  jsonb := '[]';
  v_artikel uuid;
  m         auftrag_mittel%rowtype;
  v_ziel    uuid;
  v_offen   text;
  v_ohne    text;
  v_plan    aufgaben%rowtype;
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  select * into v_a from auftraege where id = p_id and betrieb_id = mein_betrieb() for update;
  if not found then raise exception 'Auftrag nicht gefunden'; end if;
  if v_a.status in ('Erledigt', 'Abgebrochen') then raise exception 'Auftrag ist bereits abgeschlossen'; end if;
  if p_datum is null or p_datum > current_date then raise exception 'Erledigt-Datum fehlt oder liegt in der Zukunft'; end if;

  if v_a.art = 'Lohnarbeit' then
    if not exists (select 1 from auftrag_felder where auftrag_id = p_id) then raise exception 'Der Auftrag hat keine Felder'; end if;
    if v_a.feldarbeit_id is not null then
      v_offen := offene_vorgaengerin(v_a.feldarbeit_id);
      if v_offen is not null then raise exception 'Zuerst die vorherige Arbeit «%» erledigen', v_offen; end if;
      select * into v_fa from feldarbeiten where id = v_a.feldarbeit_id and status = 'geplant' and geloescht_am is null;
      if not found then
        raise exception 'Die verknüpfte geplante Arbeit ist bereits erledigt oder gelöscht. Bitte den Auftrag abbrechen.';
      end if;
    end if;
    -- Mittel ohne Menge werden in den Bemerkungen dokumentiert
    select string_agg(coalesce(l.bezeichnung, am.bezeichnung) || case when am.bereitstellung = 'Dienstleister' then ' (vom Dienstleister)' else '' end, ', ')
      into v_ohne
      from auftrag_mittel am left join lagerartikel l on l.id = am.artikel_id
     where am.auftrag_id = p_id and am.menge_je_ha is null;
    for m in select * from auftrag_mittel where auftrag_id = p_id and menge_je_ha is not null loop
      v_artikel := m.artikel_id;
      if v_artikel is null then
        select id into v_artikel from lagerartikel
         where betrieb_id = v_a.betrieb_id and lower(bezeichnung) = lower(m.bezeichnung) limit 1;
        if v_artikel is null then
          insert into lagerartikel (betrieb_id, bezeichnung, kategorie, einheit, lagerfuehrung, bemerkungen)
          values (v_a.betrieb_id, m.bezeichnung, m.kategorie, coalesce(nullif(m.einheit, ''), 'kg'), false,
                  'Vom Dienstleister gestellt (Auftrag ' || v_a.nummer || ')')
          returning id into v_artikel;
        end if;
      end if;
      v_mittel := v_mittel || jsonb_build_object('artikel_id', v_artikel, 'menge_je_ha', m.menge_je_ha,
                                                 'vom_lager', m.bereitstellung = 'Betrieb');
    end loop;
    perform set_config('hofmanager.auftrag_abschluss', 'ja', true);
    v_ziel := feldarbeit_speichern(jsonb_build_object(
      'id', v_fa.id, 'version', v_fa.version,
      'datum', p_datum, 'arbeitsart', coalesce(v_a.arbeitsart, v_fa.arbeitsart, 'Andere'), 'status', 'erledigt',
      'partner_id', v_a.partner_id, 'maschine_id', v_fa.maschine_id, 'geraet_id', v_fa.geraet_id,
      'mitarbeiter_id', v_fa.mitarbeiter_id, 'vorgaenger_id', v_fa.vorgaenger_id, 'dauer_h', v_fa.dauer_h,
      'ausgefuehrt_von', v_fa.ausgefuehrt_von, 'ausbringung', v_fa.ausbringung,
      'bemerkungen', concat_ws(' · ', 'Auftrag ' || v_a.nummer, nullif(v_fa.bemerkungen, ''), nullif(p_bemerkung, ''),
                               case when v_ohne is not null then 'Mittel ohne Mengenangabe: ' || v_ohne end),
      -- Teilflächen der geplanten Arbeit übernehmen
      'felder', (select jsonb_agg(jsonb_build_object('feld_id', af.feld_id, 'flaeche_m2', ff.flaeche_m2))
                   from auftrag_felder af
                   left join feldarbeit_felder ff on ff.feldarbeit_id = v_fa.id and ff.feld_id = af.feld_id
                  where af.auftrag_id = p_id),
      'mittel', v_mittel));
    perform set_config('hofmanager.auftrag_abschluss', '', true);
    update auftraege set status = 'Erledigt', erledigt_am = p_datum, feldarbeit_id = v_ziel where id = p_id;
  else
    if v_a.aufgabe_id is not null then select * into v_plan from aufgaben where id = v_a.aufgabe_id; end if;
    insert into maschinen_eintraege (betrieb_id, maschine_id, art, datum, titel, beschreibung, kosten, partner_id, wartungsplan_id)
    values (v_a.betrieb_id, v_a.maschine_id, coalesce(v_plan.eintragsart, 'Reparatur'), p_datum, v_a.titel,
            concat_ws(E'\n', 'Werkstattauftrag ' || v_a.nummer, v_a.beschreibung, nullif(p_bemerkung, '')), p_kosten, v_a.partner_id,
            v_plan.wartungsplan_id)
    returning id into v_ziel;
    if v_plan.beobachtung_id is not null then update maschinen_eintraege set offen = false where id = v_plan.beobachtung_id; end if;
    update maschinen_eintraege set offen = false
     where id in (select eintrag_id from auftrag_beobachtungen where auftrag_id = p_id);
    update auftraege set status = 'Erledigt', erledigt_am = p_datum, eintrag_id = v_ziel where id = p_id;
  end if;

  if v_a.aufgabe_id is not null then
    update aufgaben set status = 'erledigt', erledigt_am = p_datum, erledigt_von = auth.uid(),
                        eintrag_id = case when v_a.art = 'Werkstatt' then v_ziel end,
                        ergebnis = concat_ws(' · ', 'Auftrag ' || v_a.nummer, nullif(p_bemerkung, ''))
     where id = v_a.aufgabe_id and status = 'offen';
  end if;
  return v_ziel;
end $$;

-- Abgebrochener Lohnauftrag: Lohnunternehmen wieder von der geplanten Arbeit entfernen
create or replace function public.auftrag_status(p_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v auftraege%rowtype;
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  if p_status not in ('Entwurf', 'Gesendet', 'Bestätigt', 'Abgebrochen') then raise exception 'Ungültiger Status'; end if;
  update auftraege set status = p_status,
         gesendet_am = case when p_status = 'Gesendet' then coalesce(gesendet_am, now()) else gesendet_am end
   where id = p_id and betrieb_id = mein_betrieb() and status <> 'Erledigt'
  returning * into v;
  if not found then raise exception 'Auftrag nicht gefunden oder bereits erledigt'; end if;
  if p_status = 'Abgebrochen' and v.feldarbeit_id is not null then
    update feldarbeiten set partner_id = null where id = v.feldarbeit_id and status = 'geplant' and partner_id = v.partner_id;
  end if;
end $$;

-- 4) Zahlungsstatus und Preis einer verrechneten Ernte-Abgabe kommen immer vom Beleg
create or replace function public.ernte_abgabe_beleg() returns trigger
language plpgsql as $$
declare
  v_bezahlt boolean;
  v_betrag  numeric;
begin
  select v.bezahlt, vp.betrag into v_bezahlt, v_betrag
    from public.verkauf_positionen vp join public.verkaeufe v on v.id = vp.verkauf_id
   where vp.ernte_abnehmer_id = new.id and not v.storniert;
  if found then
    new.bezahlt := v_bezahlt;
    new.preis_chf := v_betrag;
  end if;
  return new;
end $$;
create trigger b_beleg before insert or update on public.ernte_abnehmer for each row execute function public.ernte_abgabe_beleg();

create or replace function public.verkauf_stornieren(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  update verkaeufe set storniert = true where id = p_id and betrieb_id = mein_betrieb() and not storniert;
  if not found then raise exception 'Beleg nicht gefunden oder bereits storniert'; end if;
  delete from lagerbewegungen where quelle_typ = 'verkauf' and quelle_id in (select id from verkauf_positionen where verkauf_id = p_id);
  update ernte_abnehmer set bezahlt = false where id in (select ernte_abnehmer_id from verkauf_positionen where verkauf_id = p_id);
  update verkauf_positionen set ernte_abnehmer_id = null where verkauf_id = p_id;
end $$;

-- 5) Fläche je Kultur: zusammengeführte und aufgegebene Felder nicht mitzählen
create or replace view public.flaeche_je_kultur with (security_invoker = true) as
select a.betrieb_id, a.jahr, k.id as kultur_id, k.name as kultur, k.farbe,
       sum(coalesce(a.flaeche_m2, f.flaeche_m2)) as flaeche_m2,
       count(*) as anzahl_felder
from public.anbau a
join public.felder f on f.id = a.feld_id and f.geloescht_am is null and f.status not in ('zusammengeführt', 'aufgegeben')
join public.kulturen k on k.id = a.kultur_id
where a.art = 'Hauptkultur'
group by a.betrieb_id, a.jahr, k.id, k.name, k.farbe;

-- 7) Kultur nachträglich zuordnen (Arbeit vor der Fruchtfolge erfasst) und Löschen geplanter Kulturen nicht blockieren
alter table public.feldarbeit_felder drop constraint feldarbeit_felder_anbau_id_fkey;
alter table public.feldarbeit_felder add constraint feldarbeit_felder_anbau_id_fkey foreign key (anbau_id) references public.anbau (id) on delete set null;
alter table public.ernten drop constraint ernten_anbau_id_fkey;
alter table public.ernten add constraint ernten_anbau_id_fkey foreign key (anbau_id) references public.anbau (id) on delete set null;

create or replace function public.anbau_zuordnen() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.art = 'Hauptkultur' then
    update feldarbeit_felder ff set anbau_id = new.id
      from feldarbeiten fa
     where fa.id = ff.feldarbeit_id and ff.feld_id = new.feld_id and ff.anbau_id is null
       and extract(year from fa.datum)::int = new.jahr;
    update ernten set anbau_id = new.id
     where feld_id = new.feld_id and anbau_id is null and extract(year from datum)::int = new.jahr;
  end if;
  return null;
end $$;
create trigger z_zuordnen after insert or update of art, jahr, feld_id on public.anbau for each row execute function public.anbau_zuordnen();
update public.feldarbeit_felder ff set anbau_id = a.id
  from public.feldarbeiten fa, public.anbau a
 where fa.id = ff.feldarbeit_id and ff.anbau_id is null and a.feld_id = ff.feld_id and a.art = 'Hauptkultur'
   and a.jahr = extract(year from fa.datum)::int;
update public.ernten e set anbau_id = a.id
  from public.anbau a
 where e.anbau_id is null and a.feld_id = e.feld_id and a.art = 'Hauptkultur' and a.jahr = extract(year from e.datum)::int;

-- 11) Feld mit geplanten Arbeiten oder laufenden Aufträgen nicht löschen
create or replace function public.feld_loeschen(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_text text;
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  select string_agg(distinct t, ', ') into v_text from (
    select 'geplante Arbeit «' || fa.arbeitsart || '»' as t
      from feldarbeit_felder ff join feldarbeiten fa on fa.id = ff.feldarbeit_id
     where ff.feld_id = p_id and fa.status = 'geplant' and fa.geloescht_am is null
    union all
    select 'Auftrag ' || a.nummer
      from auftrag_felder af join auftraege a on a.id = af.auftrag_id
     where af.feld_id = p_id and a.status not in ('Erledigt', 'Abgebrochen')) x;
  if v_text is not null then
    raise exception 'Dieses Feld ist noch verplant (%). Bitte zuerst erledigen, löschen oder abbrechen.', v_text;
  end if;
  update felder set geloescht_am = now(), geloescht_von = auth.uid()
   where id = p_id and betrieb_id = mein_betrieb() and geloescht_am is null;
  if not found then raise exception 'Feld nicht gefunden oder bereits gelöscht'; end if;
end $$;

-- 12) Maschineneinträge aus Werkstattaufträgen bleiben löschbar
alter table public.auftraege drop constraint auftraege_eintrag_id_fkey;
alter table public.auftraege add constraint auftraege_eintrag_id_fkey foreign key (eintrag_id) references public.maschinen_eintraege (id) on delete set null;
alter table public.auftrag_beobachtungen drop constraint auftrag_beobachtungen_eintrag_id_fkey;
alter table public.auftrag_beobachtungen add constraint auftrag_beobachtungen_eintrag_id_fkey foreign key (eintrag_id) references public.maschinen_eintraege (id) on delete cascade;

-- 13) Beobachtung beim Erledigen merken (kein doppeltes Melden beim späteren Bearbeiten)
create or replace function public.feldarbeit_erledigen(p_id uuid, p jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_a     feldarbeiten%rowtype;
  v_datum date := coalesce((p ->> 'datum')::date, current_date);
  v_ha    numeric;
  m       jsonb;
  v_masch uuid := nullif(p ->> 'beobachtung_an_maschine', '')::uuid;
  v_mitarb uuid := nullif(p ->> 'mitarbeiter_id', '')::uuid;
  v_offen text;
begin
  if not darf_erfassen() then raise exception 'Keine Berechtigung'; end if;
  select * into v_a from feldarbeiten where id = p_id and betrieb_id = mein_betrieb() and geloescht_am is null for update;
  if not found then raise exception 'Arbeit nicht gefunden'; end if;
  if v_a.status <> 'geplant' then raise exception 'Diese Arbeit ist bereits erledigt'; end if;
  if v_datum > current_date then raise exception 'Das Datum der Erledigung liegt in der Zukunft'; end if;
  v_offen := offene_vorgaengerin(p_id);
  if v_offen is not null then raise exception 'Zuerst die vorherige Arbeit «%» erledigen', v_offen; end if;
  if exists (select 1 from auftraege where feldarbeit_id = p_id and status not in ('Erledigt', 'Abgebrochen')) then
    raise exception 'Zu dieser Arbeit läuft ein Lohnauftrag. Bitte den Auftrag abschliessen.';
  end if;
  if v_mitarb is not null and not exists (select 1 from mitarbeiter where id = v_mitarb and betrieb_id = mein_betrieb()) then
    raise exception 'Unbekannte Person';
  end if;

  update feldarbeiten set
    status = 'erledigt', datum = v_datum,
    dauer_h = coalesce(nullif(p ->> 'dauer_h', '')::numeric, dauer_h),
    maschine_stunden = nullif(p ->> 'maschine_stunden', '')::numeric,
    maschine_km = nullif(p ->> 'maschine_km', '')::numeric,
    geraet_stunden = nullif(p ->> 'geraet_stunden', '')::numeric,
    beobachtung = nullif(trim(p ->> 'beobachtung'), ''),
    mitarbeiter_id = coalesce(v_mitarb, mitarbeiter_id, ich_mitarbeiter()),
    ausgefuehrt_von = coalesce(ausgefuehrt_von, auth.uid())
  where id = p_id;

  update feldarbeit_felder ff set anbau_id = (
    select a.id from anbau a where a.feld_id = ff.feld_id and a.jahr = extract(year from v_datum)::int and a.art = 'Hauptkultur')
  where ff.feldarbeit_id = p_id;

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

  if v_a.maschine_id is not null then
    perform zaehler_nachfuehren(v_a.maschine_id, nullif(p ->> 'maschine_stunden', '')::numeric, nullif(p ->> 'maschine_km', '')::numeric);
  end if;
  if v_a.geraet_id is not null then
    perform zaehler_nachfuehren(v_a.geraet_id, nullif(p ->> 'geraet_stunden', '')::numeric, null);
  end if;

  if v_masch is not null and nullif(trim(p ->> 'beobachtung'), '') is not null then
    if not exists (select 1 from maschinen where id = v_masch and betrieb_id = mein_betrieb()) then
      raise exception 'Unbekannte Maschine';
    end if;
    insert into maschinen_eintraege (betrieb_id, maschine_id, art, datum, betriebsstunden, kilometerstand, titel, beschreibung, offen)
    values (mein_betrieb(), v_masch, 'Beobachtung', v_datum,
            case when v_masch = v_a.maschine_id then nullif(p ->> 'maschine_stunden', '')::numeric else nullif(p ->> 'geraet_stunden', '')::numeric end,
            case when v_masch = v_a.maschine_id then nullif(p ->> 'maschine_km', '')::numeric end,
            left(trim(p ->> 'beobachtung'), 80), 'Bei ' || v_a.arbeitsart || ' am ' || to_char(v_datum, 'DD.MM.YYYY') || ': ' || trim(p ->> 'beobachtung'),
            true)
    returning id into v_masch;
    update feldarbeiten set beobachtung_eintrag_id = v_masch where id = p_id;
  end if;

  perform feldarbeit_buchen(p_id);
end $$;

-- 15) Name und Aktiv-Status eines App-Kontos auf die Mitarbeiter-Karte übertragen
create or replace function public.mitarbeiter_von_benutzer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update mitarbeiter set name = new.name, aktiv = new.aktiv
   where benutzer_id = new.id and (name is distinct from new.name or aktiv is distinct from new.aktiv);
  return null;
end $$;
create trigger mitarbeiter_nachfuehren after update of name, aktiv on public.benutzer_profile for each row execute function public.mitarbeiter_von_benutzer();

revoke all on function public.feldarbeit_erledigen(uuid, jsonb), public.aufgabe_erledigen(uuid, jsonb),
  public.auftrag_abschliessen(uuid, date, numeric, text), public.auftrag_status(uuid, text), public.verkauf_stornieren(uuid), public.feld_loeschen(uuid)
  from public, anon;
grant execute on function public.feldarbeit_erledigen(uuid, jsonb), public.aufgabe_erledigen(uuid, jsonb),
  public.auftrag_abschliessen(uuid, date, numeric, text), public.auftrag_status(uuid, text), public.verkauf_stornieren(uuid), public.feld_loeschen(uuid)
  to authenticated;

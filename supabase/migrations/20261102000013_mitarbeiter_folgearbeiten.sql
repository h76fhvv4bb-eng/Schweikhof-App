-- =====================================================================
-- Migration 13: Mitarbeitende, Folgearbeiten (Arbeitsketten), Lohn- und Werkstattaufträge aus Aufgaben
-- =====================================================================

-- ---------------------------------------------------------------------
-- Mitarbeitende (mit oder ohne App-Zugang)
-- ---------------------------------------------------------------------
create table public.mitarbeiter (
  id                uuid primary key default gen_random_uuid(),
  betrieb_id        uuid not null references public.betriebe (id),
  name              text not null check (length(trim(name)) between 1 and 80),
  funktion          text check (funktion is null or length(funktion) <= 60),   -- z. B. Betriebsleiter, Aushilfe, Lernender
  telefon           text,
  email             text,
  stundenansatz_chf numeric(8, 2) check (stundenansatz_chf >= 0),
  benutzer_id       uuid unique references public.benutzer_profile (id) on delete set null,  -- App-Zugang
  aktiv             boolean not null default true,
  bemerkungen       text,
  erstellt_am       timestamptz not null default now(),
  geaendert_am      timestamptz not null default now(),
  version           integer not null default 1
);
create trigger a_version before update on public.mitarbeiter for each row execute function public.pruefe_version();
create trigger b_metadaten before insert or update on public.mitarbeiter for each row execute function public.setze_metadaten();
create trigger z_protokoll after insert or update or delete on public.mitarbeiter for each row execute function public.protokolliere();

alter table public.mitarbeiter enable row level security;
create policy mi_lesen   on public.mitarbeiter for select using (betrieb_id = public.mein_betrieb());
create policy mi_neu     on public.mitarbeiter for insert with check (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
create policy mi_aendern on public.mitarbeiter for update using (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
grant select, insert, update on public.mitarbeiter to authenticated;

-- Jedes App-Konto ist automatisch auch Mitarbeiter/in
insert into public.mitarbeiter (betrieb_id, name, benutzer_id, aktiv)
select betrieb_id, name, id, aktiv from public.benutzer_profile;

create or replace function public.mitarbeiter_aus_benutzer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into mitarbeiter (betrieb_id, name, benutzer_id, aktiv)
  values (new.betrieb_id, new.name, new.id, new.aktiv)
  on conflict (benutzer_id) do nothing;
  return new;
end $$;
create trigger mitarbeiter_anlegen after insert on public.benutzer_profile for each row execute function public.mitarbeiter_aus_benutzer();

-- Mitarbeiter-ID des angemeldeten Kontos
create or replace function public.ich_mitarbeiter() returns uuid
language sql stable security definer set search_path = public as $$
  select id from mitarbeiter where benutzer_id = auth.uid();
$$;
grant execute on function public.ich_mitarbeiter() to authenticated;

-- Zuordnung bei Arbeiten und Aufgaben
alter table public.feldarbeiten add column mitarbeiter_id uuid references public.mitarbeiter (id) on delete set null;
alter table public.aufgaben     add column mitarbeiter_id uuid references public.mitarbeiter (id) on delete set null;
update public.feldarbeiten f set mitarbeiter_id = m.id from public.mitarbeiter m where m.benutzer_id = f.ausgefuehrt_von;
update public.aufgaben a     set mitarbeiter_id = m.id from public.mitarbeiter m where m.benutzer_id = a.zugewiesen_an;

-- Zugewiesene dürfen ihre Aufgaben bearbeiten
drop policy au_aendern on public.aufgaben;
create policy au_aendern on public.aufgaben for update using (
  betrieb_id = public.mein_betrieb()
  and (public.darf_verwalten() or erstellt_von = auth.uid() or zugewiesen_an = auth.uid() or mitarbeiter_id = public.ich_mitarbeiter()));

-- ---------------------------------------------------------------------
-- Folgearbeiten: eine geplante Arbeit wartet auf ihre Vorgängerin (z. B. Pflügen → Kreiselegge → Säen)
-- ---------------------------------------------------------------------
alter table public.feldarbeiten add column vorgaenger_id uuid references public.feldarbeiten (id) on delete set null;
create index on public.feldarbeiten (vorgaenger_id);

-- Liefert die Bezeichnung einer noch offenen Vorgängerin, sonst null
create or replace function public.offene_vorgaengerin(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select v.arbeitsart || coalesce(' (' || to_char(v.datum, 'DD.MM.YYYY') || ')', '')
    from feldarbeiten a join feldarbeiten v on v.id = a.vorgaenger_id
   where a.id = p_id and v.status = 'geplant' and v.geloescht_am is null;
$$;

-- Lohn- und Werkstattaufträge aus Aufgaben
alter table public.auftraege add column aufgabe_id uuid references public.aufgaben (id) on delete set null;

-- ---------------------------------------------------------------------
-- feldarbeit_speichern: zusätzlich mitarbeiter_id und vorgaenger_id
-- ---------------------------------------------------------------------
create or replace function public.feldarbeit_speichern(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  v_id      uuid := nullif(p ->> 'id', '')::uuid;
  v_datum   date := (p ->> 'datum')::date;
  v_status  text := coalesce(p ->> 'status', 'erledigt');
  v_vorg    uuid := nullif(p ->> 'vorgaenger_id', '')::uuid;
  v_mitarb  uuid := nullif(p ->> 'mitarbeiter_id', '')::uuid;
  v_offen   text;
  v_ha      numeric;
  f         jsonb;
  m         jsonb;
  v_flaeche numeric;
  v_feld    felder%rowtype;
begin
  if v_betrieb is null or not darf_erfassen() then
    raise exception 'Keine Berechtigung, Arbeiten zu erfassen';
  end if;
  if v_datum is null then raise exception 'Datum fehlt'; end if;
  if v_datum > current_date + 400 then raise exception 'Datum liegt zu weit in der Zukunft'; end if;
  if v_status = 'erledigt' and v_datum > current_date then
    raise exception 'Eine erledigte Arbeit kann nicht in der Zukunft liegen';
  end if;
  if jsonb_array_length(coalesce(p -> 'felder', '[]')) = 0 then
    raise exception 'Mindestens ein Feld wählen';
  end if;
  if nullif(p ->> 'maschine_id', '') is not null and not exists (select 1 from maschinen where id = (p ->> 'maschine_id')::uuid and betrieb_id = v_betrieb)
     or nullif(p ->> 'geraet_id', '') is not null and not exists (select 1 from maschinen where id = (p ->> 'geraet_id')::uuid and betrieb_id = v_betrieb)
     or nullif(p ->> 'partner_id', '') is not null and not exists (select 1 from partner where id = (p ->> 'partner_id')::uuid and betrieb_id = v_betrieb) then
    raise exception 'Unbekannte Maschine oder unbekannter Partner';
  end if;
  if v_mitarb is not null and not exists (select 1 from mitarbeiter where id = v_mitarb and betrieb_id = v_betrieb) then
    raise exception 'Unbekannte Person';
  end if;
  if v_vorg is not null then
    if v_vorg = v_id or not exists (select 1 from feldarbeiten where id = v_vorg and betrieb_id = v_betrieb and geloescht_am is null) then
      raise exception 'Unbekannte Vorgängerarbeit';
    end if;
    -- keine Kreise
    if v_id is not null and exists (
      with recursive kette(id) as (
        select v_vorg union all select fa.vorgaenger_id from feldarbeiten fa join kette k on fa.id = k.id where fa.vorgaenger_id is not null)
      select 1 from kette where id = v_id) then
      raise exception 'Eine Arbeit kann nicht auf sich selbst warten';
    end if;
    if v_status = 'erledigt' then
      select arbeitsart into v_offen from feldarbeiten where id = v_vorg and status = 'geplant' and geloescht_am is null;
      if v_offen is not null then raise exception 'Zuerst die vorherige Arbeit «%» erledigen', v_offen; end if;
    end if;
  end if;

  if v_id is null then
    insert into feldarbeiten (betrieb_id, datum, arbeitsart, status, dauer_h, maschine, geraet, ausgefuehrt_von, ausbringung, bemerkungen,
                              maschine_id, geraet_id, partner_id, mitarbeiter_id, vorgaenger_id)
    values (v_betrieb, v_datum, p ->> 'arbeitsart', v_status, nullif(p ->> 'dauer_h', '')::numeric,
            nullif(p ->> 'maschine', ''), nullif(p ->> 'geraet', ''),
            coalesce(nullif(p ->> 'ausgefuehrt_von', '')::uuid, case when v_mitarb is null then auth.uid() end),
            nullif(p ->> 'ausbringung', ''), nullif(p ->> 'bemerkungen', ''),
            nullif(p ->> 'maschine_id', '')::uuid, nullif(p ->> 'geraet_id', '')::uuid, nullif(p ->> 'partner_id', '')::uuid,
            coalesce(v_mitarb, case when nullif(p ->> 'partner_id', '') is null and v_status = 'erledigt' then ich_mitarbeiter() end),
            v_vorg)
    returning id into v_id;
  else
    if not darf_verwalten() and not exists (
      select 1 from feldarbeiten where id = v_id and (erstellt_von = auth.uid() or mitarbeiter_id = ich_mitarbeiter())) then
      raise exception 'Nur eigene Einträge können geändert werden';
    end if;
    update feldarbeiten set
      datum = v_datum, arbeitsart = p ->> 'arbeitsart', status = v_status,
      dauer_h = nullif(p ->> 'dauer_h', '')::numeric,
      maschine = nullif(p ->> 'maschine', ''), geraet = nullif(p ->> 'geraet', ''),
      ausgefuehrt_von = nullif(p ->> 'ausgefuehrt_von', '')::uuid,
      ausbringung = nullif(p ->> 'ausbringung', ''), bemerkungen = nullif(p ->> 'bemerkungen', ''),
      maschine_id = nullif(p ->> 'maschine_id', '')::uuid, geraet_id = nullif(p ->> 'geraet_id', '')::uuid,
      partner_id = nullif(p ->> 'partner_id', '')::uuid,
      mitarbeiter_id = v_mitarb, vorgaenger_id = v_vorg,
      version = coalesce((p ->> 'version')::int, version)
    where id = v_id and betrieb_id = v_betrieb and geloescht_am is null;
    if not found then raise exception 'Arbeit nicht gefunden'; end if;
    delete from feldarbeit_felder where feldarbeit_id = v_id;
    delete from feldarbeit_mittel where feldarbeit_id = v_id;
  end if;

  for f in select * from jsonb_array_elements(p -> 'felder') loop
    select * into v_feld from felder
     where id = (f ->> 'feld_id')::uuid and betrieb_id = v_betrieb and geloescht_am is null;
    if not found then raise exception 'Unbekanntes Feld'; end if;
    v_flaeche := coalesce(nullif(f ->> 'flaeche_m2', '')::numeric, v_feld.flaeche_m2);
    if v_flaeche <= 0 or v_flaeche > v_feld.flaeche_m2 * 1.001 then
      raise exception 'Bearbeitete Fläche auf % muss zwischen 0 und der Feldfläche liegen', v_feld.name;
    end if;
    insert into feldarbeit_felder (betrieb_id, feldarbeit_id, feld_id, anbau_id, flaeche_m2)
    values (v_betrieb, v_id, v_feld.id,
            (select a.id from anbau a where a.feld_id = v_feld.id and a.jahr = extract(year from v_datum)::int
               and a.art = 'Hauptkultur'),
            v_flaeche);
  end loop;

  select sum(flaeche_m2) / 10000 into v_ha from feldarbeit_felder where feldarbeit_id = v_id;

  for m in select * from jsonb_array_elements(coalesce(p -> 'mittel', '[]')) loop
    if not exists (select 1 from lagerartikel where id = (m ->> 'artikel_id')::uuid and betrieb_id = v_betrieb) then
      raise exception 'Unbekannter Artikel';
    end if;
    insert into feldarbeit_mittel (betrieb_id, feldarbeit_id, artikel_id, menge_je_ha, gesamtmenge, vom_lager)
    values (v_betrieb, v_id, (m ->> 'artikel_id')::uuid, (m ->> 'menge_je_ha')::numeric,
            round((m ->> 'menge_je_ha')::numeric * v_ha, 3), coalesce((m ->> 'vom_lager')::boolean, true));
  end loop;

  perform feldarbeit_buchen(v_id);
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- feldarbeit_erledigen: Reihenfolge der Kette beachten, Person festhalten
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
            true);
  end if;

  perform feldarbeit_buchen(p_id);
end $$;

-- ---------------------------------------------------------------------
-- auftrag_speichern: optional mit geplanter Feldarbeit (Lohnarbeit) bzw. Aufgabe (Werkstatt)
-- ---------------------------------------------------------------------
create or replace function public.auftrag_speichern(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  v_id      uuid := nullif(p ->> 'id', '')::uuid;
  v_jahr    text := to_char(current_date, 'YYYY');
  v_nr      text;
  v_fa      uuid := nullif(p ->> 'feldarbeit_id', '')::uuid;
  v_aufgabe uuid := nullif(p ->> 'aufgabe_id', '')::uuid;
  x         jsonb;
begin
  if v_betrieb is null or not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  if not exists (select 1 from partner where id = (p ->> 'partner_id')::uuid and betrieb_id = v_betrieb) then
    raise exception 'Bitte einen Partner wählen';
  end if;
  if p ->> 'art' = 'Werkstatt' and not exists (
    select 1 from maschinen where id = nullif(p ->> 'maschine_id', '')::uuid and betrieb_id = v_betrieb) then
    raise exception 'Bitte eine Maschine wählen';
  end if;
  if v_fa is not null and (p ->> 'art' <> 'Lohnarbeit'
     or not exists (select 1 from feldarbeiten where id = v_fa and betrieb_id = v_betrieb and status = 'geplant' and geloescht_am is null)) then
    raise exception 'Die verknüpfte Arbeit ist nicht (mehr) geplant';
  end if;
  if v_aufgabe is not null and not exists (select 1 from aufgaben where id = v_aufgabe and betrieb_id = v_betrieb) then
    raise exception 'Unbekannte Aufgabe';
  end if;

  if v_id is null then
    perform pg_advisory_xact_lock(hashtext('auftrag-' || v_betrieb::text));
    select v_jahr || '-' || lpad((coalesce(max(split_part(nummer, '-', 2)::int), 0) + 1)::text, 3, '0') into v_nr
      from auftraege where betrieb_id = v_betrieb and nummer like v_jahr || '-%';
    insert into auftraege (betrieb_id, nummer, art, partner_id, titel, arbeitsart, maschine_id, termin_von, termin_bis, beschreibung,
                           feldarbeit_id, aufgabe_id)
    values (v_betrieb, v_nr, p ->> 'art', (p ->> 'partner_id')::uuid, trim(p ->> 'titel'), nullif(p ->> 'arbeitsart', ''),
            nullif(p ->> 'maschine_id', '')::uuid, nullif(p ->> 'termin_von', '')::date, nullif(p ->> 'termin_bis', '')::date,
            nullif(p ->> 'beschreibung', ''), v_fa, v_aufgabe)
    returning id into v_id;
  else
    update auftraege set
      partner_id = (p ->> 'partner_id')::uuid, titel = trim(p ->> 'titel'), arbeitsart = nullif(p ->> 'arbeitsart', ''),
      maschine_id = nullif(p ->> 'maschine_id', '')::uuid, termin_von = nullif(p ->> 'termin_von', '')::date,
      termin_bis = nullif(p ->> 'termin_bis', '')::date, beschreibung = nullif(p ->> 'beschreibung', ''),
      feldarbeit_id = coalesce(v_fa, feldarbeit_id), aufgabe_id = coalesce(v_aufgabe, aufgabe_id),
      version = coalesce((p ->> 'version')::int, version)
    where id = v_id and betrieb_id = v_betrieb and status not in ('Erledigt', 'Abgebrochen');
    if not found then raise exception 'Auftrag nicht gefunden oder bereits abgeschlossen'; end if;
    delete from auftrag_felder where auftrag_id = v_id;
    delete from auftrag_mittel where auftrag_id = v_id;
    delete from auftrag_beobachtungen where auftrag_id = v_id;
  end if;

  for x in select * from jsonb_array_elements(coalesce(p -> 'felder', '[]')) loop
    if not exists (select 1 from felder where id = (x #>> '{}')::uuid and betrieb_id = v_betrieb) then raise exception 'Unbekanntes Feld'; end if;
    insert into auftrag_felder (betrieb_id, auftrag_id, feld_id) values (v_betrieb, v_id, (x #>> '{}')::uuid);
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'mittel', '[]')) loop
    if nullif(x ->> 'artikel_id', '') is not null
       and not exists (select 1 from lagerartikel where id = (x ->> 'artikel_id')::uuid and betrieb_id = v_betrieb) then
      raise exception 'Unbekannter Artikel';
    end if;
    insert into auftrag_mittel (betrieb_id, auftrag_id, artikel_id, bezeichnung, kategorie, einheit, menge_je_ha, bereitstellung, bemerkung)
    values (v_betrieb, v_id, nullif(x ->> 'artikel_id', '')::uuid, nullif(trim(x ->> 'bezeichnung'), ''),
            coalesce(nullif(x ->> 'kategorie', ''), 'Saatgut'), nullif(x ->> 'einheit', ''), nullif(x ->> 'menge_je_ha', '')::numeric,
            coalesce(nullif(x ->> 'bereitstellung', ''), 'Betrieb'), nullif(x ->> 'bemerkung', ''));
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'beobachtungen', '[]')) loop
    if not exists (select 1 from maschinen_eintraege where id = (x #>> '{}')::uuid and betrieb_id = v_betrieb) then
      raise exception 'Unbekannte Beobachtung';
    end if;
    insert into auftrag_beobachtungen (betrieb_id, auftrag_id, eintrag_id) values (v_betrieb, v_id, (x #>> '{}')::uuid);
  end loop;

  -- Lohnunternehmen bei der geplanten Arbeit eintragen
  if v_fa is not null then
    update feldarbeiten set partner_id = (p ->> 'partner_id')::uuid where id = v_fa;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- auftrag_abschliessen: geplante Arbeit erledigen statt neue anlegen; Aufgabe mit abschliessen
-- ---------------------------------------------------------------------
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
    end if;
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
    v_ziel := feldarbeit_speichern(jsonb_build_object(
      'id', v_fa.id, 'version', v_fa.version,
      'datum', p_datum, 'arbeitsart', coalesce(v_a.arbeitsart, v_fa.arbeitsart, 'Andere'), 'status', 'erledigt',
      'partner_id', v_a.partner_id, 'maschine_id', v_fa.maschine_id, 'geraet_id', v_fa.geraet_id,
      'mitarbeiter_id', v_fa.mitarbeiter_id, 'vorgaenger_id', v_fa.vorgaenger_id, 'dauer_h', v_fa.dauer_h,
      'ausgefuehrt_von', v_fa.ausgefuehrt_von, 'ausbringung', v_fa.ausbringung,
      'bemerkungen', concat_ws(' · ', 'Auftrag ' || v_a.nummer, nullif(v_fa.bemerkungen, ''), nullif(p_bemerkung, '')),
      'felder', (select jsonb_agg(jsonb_build_object('feld_id', feld_id)) from auftrag_felder where auftrag_id = p_id),
      'mittel', v_mittel));
    update auftraege set status = 'Erledigt', erledigt_am = p_datum, feldarbeit_id = v_ziel where id = p_id;
  else
    insert into maschinen_eintraege (betrieb_id, maschine_id, art, datum, titel, beschreibung, kosten, partner_id)
    values (v_a.betrieb_id, v_a.maschine_id, 'Reparatur', p_datum, v_a.titel,
            concat_ws(E'\n', 'Werkstattauftrag ' || v_a.nummer, v_a.beschreibung, nullif(p_bemerkung, '')), p_kosten, v_a.partner_id)
    returning id into v_ziel;
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

-- ---------------------------------------------------------------------
-- aufgabe_erledigen: Person festhalten; nicht erledigen, solange ein Auftrag dazu läuft
-- ---------------------------------------------------------------------
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
      'offen', coalesce((p ->> 'noch_offen')::boolean, false)));
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

-- ---------------------------------------------------------------------
-- Stunden je Person und Jahr (Feldarbeiten und Aufgaben)
-- ---------------------------------------------------------------------
create view public.mitarbeiter_stunden with (security_invoker = true) as
select m.id as mitarbeiter_id, m.betrieb_id, x.jahr, sum(x.stunden) as stunden, sum(x.anzahl) as anzahl
from public.mitarbeiter m
join (
  select mitarbeiter_id, extract(year from datum)::int as jahr, coalesce(dauer_h, 0) as stunden, 1 as anzahl
    from public.feldarbeiten where status = 'erledigt' and geloescht_am is null and mitarbeiter_id is not null
  union all
  select mitarbeiter_id, extract(year from erledigt_am)::int, coalesce(dauer_h, 0), 1
    from public.aufgaben where status = 'erledigt' and mitarbeiter_id is not null
) x on x.mitarbeiter_id = m.id
group by m.id, m.betrieb_id, x.jahr;
grant select on public.mitarbeiter_stunden to authenticated;

revoke all on function public.offene_vorgaengerin(uuid) from public, anon;
grant execute on function public.offene_vorgaengerin(uuid) to authenticated;

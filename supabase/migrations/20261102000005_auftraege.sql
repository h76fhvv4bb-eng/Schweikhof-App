-- =====================================================================
-- Hofmanager – Migration 5: Aufträge an Partner (Lohnarbeit, Werkstatt)
-- Einspielen: Supabase › SQL Editor › gesamten Inhalt einfügen › Run
-- Voraussetzung: Migrationen 1–4 sind eingespielt.
-- =====================================================================

-- Betriebsangaben für den Briefkopf
alter table public.betriebe add column telefon text;
alter table public.betriebe add column email text;

-- Betriebsmittel, die ein Dienstleister mitbringt, werden dokumentiert, aber nicht vom Lager gebucht.
alter table public.feldarbeit_mittel add column vom_lager boolean not null default true;

create or replace function public.feldarbeit_buchen(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_arbeit feldarbeiten%rowtype;
begin
  select * into v_arbeit from feldarbeiten where id = p_id;
  delete from lagerbewegungen b
   where b.quelle_typ = 'feldarbeit' and b.quelle_id = p_id
     and (v_arbeit.status <> 'erledigt' or v_arbeit.geloescht_am is not null
          or not exists (select 1 from feldarbeit_mittel m
                          where m.feldarbeit_id = p_id and m.artikel_id = b.artikel_id and m.vom_lager));
  if v_arbeit.status = 'erledigt' and v_arbeit.geloescht_am is null then
    insert into lagerbewegungen (betrieb_id, artikel_id, datum, art, menge, preis_je_einheit, quelle_typ, quelle_id, bemerkung)
    select m.betrieb_id, m.artikel_id, v_arbeit.datum, 'Verbrauch', -m.gesamtmenge, a.einkaufspreis, 'feldarbeit', p_id,
           v_arbeit.arbeitsart
      from feldarbeit_mittel m
      join lagerartikel a on a.id = m.artikel_id
     where m.feldarbeit_id = p_id and a.lagerfuehrung and m.vom_lager
    on conflict (quelle_typ, quelle_id, artikel_id) where quelle_id is not null
    do update set menge = excluded.menge, datum = excluded.datum, bemerkung = excluded.bemerkung
      where lagerbewegungen.menge is distinct from excluded.menge or lagerbewegungen.datum is distinct from excluded.datum;
  end if;
end $$;

-- feldarbeit_speichern: zusätzlich "vom_lager" je Mittel (Standard: true)
create or replace function public.feldarbeit_speichern(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  v_id      uuid := nullif(p ->> 'id', '')::uuid;
  v_datum   date := (p ->> 'datum')::date;
  v_status  text := coalesce(p ->> 'status', 'erledigt');
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

  if v_id is null then
    insert into feldarbeiten (betrieb_id, datum, arbeitsart, status, dauer_h, maschine, geraet, ausgefuehrt_von, ausbringung, bemerkungen,
                              maschine_id, geraet_id, partner_id)
    values (v_betrieb, v_datum, p ->> 'arbeitsart', v_status, nullif(p ->> 'dauer_h', '')::numeric,
            nullif(p ->> 'maschine', ''), nullif(p ->> 'geraet', ''),
            coalesce(nullif(p ->> 'ausgefuehrt_von', '')::uuid, auth.uid()),
            nullif(p ->> 'ausbringung', ''), nullif(p ->> 'bemerkungen', ''),
            nullif(p ->> 'maschine_id', '')::uuid, nullif(p ->> 'geraet_id', '')::uuid, nullif(p ->> 'partner_id', '')::uuid)
    returning id into v_id;
  else
    if not darf_verwalten() and not exists (
      select 1 from feldarbeiten where id = v_id and erstellt_von = auth.uid()) then
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
-- Aufträge
-- ---------------------------------------------------------------------
create table public.auftraege (
  id            uuid primary key default gen_random_uuid(),
  betrieb_id    uuid not null references public.betriebe (id),
  nummer        text not null,                 -- z. B. 2026-003
  art           text not null check (art in ('Lohnarbeit', 'Werkstatt')),
  partner_id    uuid not null references public.partner (id),
  titel         text not null check (length(trim(titel)) > 0),
  arbeitsart    text,                          -- bei Lohnarbeit
  maschine_id   uuid references public.maschinen (id),  -- bei Werkstatt
  termin_von    date,
  termin_bis    date,
  beschreibung  text,
  status        text not null default 'Entwurf' check (status in ('Entwurf', 'Gesendet', 'Bestätigt', 'Erledigt', 'Abgebrochen')),
  gesendet_am   timestamptz,
  erledigt_am   date,
  feldarbeit_id uuid references public.feldarbeiten (id),
  eintrag_id    uuid references public.maschinen_eintraege (id),
  erstellt_von  uuid default auth.uid(),
  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz not null default now(),
  version       integer not null default 1,
  unique (betrieb_id, nummer),
  check (termin_bis is null or termin_von is null or termin_bis >= termin_von),
  check (art <> 'Werkstatt' or maschine_id is not null)
);

create table public.auftrag_felder (
  id         uuid primary key default gen_random_uuid(),
  betrieb_id uuid not null references public.betriebe (id),
  auftrag_id uuid not null references public.auftraege (id) on delete cascade,
  feld_id    uuid not null references public.felder (id),
  unique (auftrag_id, feld_id)
);

create table public.auftrag_mittel (
  id             uuid primary key default gen_random_uuid(),
  betrieb_id     uuid not null references public.betriebe (id),
  auftrag_id     uuid not null references public.auftraege (id) on delete cascade,
  artikel_id     uuid references public.lagerartikel (id),
  bezeichnung    text,                          -- wenn kein Lagerartikel (z. B. Saatgut des Lohnunternehmers)
  kategorie      text not null default 'Saatgut' check (kategorie in (
                   'Dünger', 'Saatgut', 'Pflanzenschutzmittel', 'Ersatzteile', 'Betriebsstoffe', 'Erzeugnisse', 'Verbrauchsmaterial', 'Sonstiges')),
  einheit        text,
  menge_je_ha    numeric(14, 4) check (menge_je_ha > 0),
  bereitstellung text not null default 'Betrieb' check (bereitstellung in ('Betrieb', 'Dienstleister')),
  bemerkung      text,
  check (artikel_id is not null or length(trim(coalesce(bezeichnung, ''))) > 0)
);

create table public.auftrag_beobachtungen (
  auftrag_id uuid not null references public.auftraege (id) on delete cascade,
  eintrag_id uuid not null references public.maschinen_eintraege (id),
  betrieb_id uuid not null references public.betriebe (id),
  primary key (auftrag_id, eintrag_id)
);

create trigger a_version before update on public.auftraege for each row execute function public.pruefe_version();
create trigger b_metadaten before insert or update on public.auftraege for each row execute function public.setze_metadaten();
create trigger z_protokoll after insert or update or delete on public.auftraege for each row execute function public.protokolliere();
create trigger z_protokoll after insert or update or delete on public.auftrag_felder for each row execute function public.protokolliere();
create trigger z_protokoll after insert or update or delete on public.auftrag_mittel for each row execute function public.protokolliere();

-- ---------------------------------------------------------------------
-- Auftrag speichern (mit Feldern, Mitteln, Beobachtungen) – eine Transaktion
-- ---------------------------------------------------------------------
create or replace function public.auftrag_speichern(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  v_id      uuid := nullif(p ->> 'id', '')::uuid;
  v_jahr    text := to_char(current_date, 'YYYY');
  v_nr      text;
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

  if v_id is null then
    perform pg_advisory_xact_lock(hashtext('auftrag-' || v_betrieb::text));
    select v_jahr || '-' || lpad((coalesce(max(split_part(nummer, '-', 2)::int), 0) + 1)::text, 3, '0') into v_nr
      from auftraege where betrieb_id = v_betrieb and nummer like v_jahr || '-%';
    insert into auftraege (betrieb_id, nummer, art, partner_id, titel, arbeitsart, maschine_id, termin_von, termin_bis, beschreibung)
    values (v_betrieb, v_nr, p ->> 'art', (p ->> 'partner_id')::uuid, trim(p ->> 'titel'), nullif(p ->> 'arbeitsart', ''),
            nullif(p ->> 'maschine_id', '')::uuid, nullif(p ->> 'termin_von', '')::date, nullif(p ->> 'termin_bis', '')::date,
            nullif(p ->> 'beschreibung', ''))
    returning id into v_id;
  else
    update auftraege set
      partner_id = (p ->> 'partner_id')::uuid, titel = trim(p ->> 'titel'), arbeitsart = nullif(p ->> 'arbeitsart', ''),
      maschine_id = nullif(p ->> 'maschine_id', '')::uuid, termin_von = nullif(p ->> 'termin_von', '')::date,
      termin_bis = nullif(p ->> 'termin_bis', '')::date, beschreibung = nullif(p ->> 'beschreibung', ''),
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
  return v_id;
end $$;

create or replace function public.auftrag_status(p_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  if p_status not in ('Entwurf', 'Gesendet', 'Bestätigt', 'Abgebrochen') then raise exception 'Ungültiger Status'; end if;
  update auftraege set status = p_status,
         gesendet_am = case when p_status = 'Gesendet' then coalesce(gesendet_am, now()) else gesendet_am end
   where id = p_id and betrieb_id = mein_betrieb() and status <> 'Erledigt';
  if not found then raise exception 'Auftrag nicht gefunden oder bereits erledigt'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Auftrag abschliessen:
--   Lohnarbeit → Feldarbeit in der Ackerschlagkartei (Partner eingetragen; nur selbst gestellte Mittel buchen das Lager)
--   Werkstatt  → Reparatur-Eintrag bei der Maschine, zugeordnete Beobachtungen werden geschlossen
-- ---------------------------------------------------------------------
create or replace function public.auftrag_abschliessen(p_id uuid, p_datum date, p_kosten numeric default null, p_bemerkung text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_a       auftraege%rowtype;
  v_mittel  jsonb := '[]';
  v_artikel uuid;
  m         auftrag_mittel%rowtype;
  v_ziel    uuid;
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  select * into v_a from auftraege where id = p_id and betrieb_id = mein_betrieb() for update;
  if not found then raise exception 'Auftrag nicht gefunden'; end if;
  if v_a.status in ('Erledigt', 'Abgebrochen') then raise exception 'Auftrag ist bereits abgeschlossen'; end if;
  if p_datum is null or p_datum > current_date then raise exception 'Erledigt-Datum fehlt oder liegt in der Zukunft'; end if;

  if v_a.art = 'Lohnarbeit' then
    if not exists (select 1 from auftrag_felder where auftrag_id = p_id) then raise exception 'Der Auftrag hat keine Felder'; end if;
    for m in select * from auftrag_mittel where auftrag_id = p_id and menge_je_ha is not null loop
      v_artikel := m.artikel_id;
      if v_artikel is null then
        -- Mittel des Dienstleisters ohne Lagerartikel: als Artikel ohne Bestandsführung anlegen, damit es dokumentiert ist
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
      'datum', p_datum, 'arbeitsart', coalesce(v_a.arbeitsart, 'Andere'), 'status', 'erledigt',
      'partner_id', v_a.partner_id,
      'bemerkungen', concat_ws(' · ', 'Auftrag ' || v_a.nummer, nullif(p_bemerkung, '')),
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
  return v_ziel;
end $$;

revoke all on function public.auftrag_speichern(jsonb), public.auftrag_status(uuid, text),
  public.auftrag_abschliessen(uuid, date, numeric, text) from public, anon;
grant execute on function public.auftrag_speichern(jsonb), public.auftrag_status(uuid, text),
  public.auftrag_abschliessen(uuid, date, numeric, text) to authenticated;

-- ---------------------------------------------------------------------
-- Zugriffsregeln: lesen alle im Betrieb, schreiben nur über die Funktionen
-- ---------------------------------------------------------------------
alter table public.auftraege             enable row level security;
alter table public.auftrag_felder        enable row level security;
alter table public.auftrag_mittel        enable row level security;
alter table public.auftrag_beobachtungen enable row level security;
create policy au_lesen  on public.auftraege             for select using (betrieb_id = public.mein_betrieb());
create policy auf_lesen on public.auftrag_felder        for select using (betrieb_id = public.mein_betrieb());
create policy aum_lesen on public.auftrag_mittel        for select using (betrieb_id = public.mein_betrieb());
create policy aub_lesen on public.auftrag_beobachtungen for select using (betrieb_id = public.mein_betrieb());
grant select on public.auftraege, public.auftrag_felder, public.auftrag_mittel, public.auftrag_beobachtungen to authenticated;

-- =====================================================================
-- Migration 14: Materialverkauf mit Rechnung und Quittung, Fotos zu Maschinen und Beobachtungen
-- =====================================================================

-- ---------------------------------------------------------------------
-- Betriebsangaben für Rechnungen (QR-Rechnung braucht Adresse und IBAN)
-- ---------------------------------------------------------------------
alter table public.betriebe add column strasse text;
alter table public.betriebe add column hausnummer text;
alter table public.betriebe add column plz text check (plz is null or plz ~ '^[0-9]{4}$');
alter table public.betriebe add column ort text;
alter table public.betriebe add column iban text check (iban is null or iban ~ '^(CH|LI)[0-9]{2}[0-9A-Z]{17}$');
alter table public.betriebe add column mwst_nr text;
alter table public.betriebe add column zahlungsfrist_tage integer not null default 30 check (zahlungsfrist_tage between 0 and 120);

-- ---------------------------------------------------------------------
-- Verkäufe (Belege) und Positionen
-- ---------------------------------------------------------------------
create table public.verkaeufe (
  id            uuid primary key default gen_random_uuid(),
  betrieb_id    uuid not null references public.betriebe (id),
  nummer        text not null,                       -- z. B. 2026-007
  art           text not null check (art in ('Rechnung', 'Quittung')),
  datum         date not null,
  partner_id    uuid references public.partner (id),
  kunde_name    text,                                -- falls kein Partner
  kunde_adresse text,
  zahlungsart   text check (zahlungsart in ('Bar', 'TWINT', 'Überweisung', 'Andere')),
  faellig_am    date,
  bezahlt       boolean not null default false,
  bezahlt_am    date,
  mwst_satz     numeric(4, 2) check (mwst_satz between 0 and 20),  -- leer = ohne MWST
  total_chf     numeric(12, 2) not null default 0,
  bemerkungen   text,
  storniert     boolean not null default false,
  erstellt_von  uuid default auth.uid(),
  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz not null default now(),
  version       integer not null default 1,
  unique (betrieb_id, nummer),
  check (partner_id is not null or length(trim(coalesce(kunde_name, ''))) > 0)
);
create index on public.verkaeufe (betrieb_id, datum desc);

create table public.verkauf_positionen (
  id                uuid primary key default gen_random_uuid(),
  betrieb_id        uuid not null references public.betriebe (id),
  verkauf_id        uuid not null references public.verkaeufe (id) on delete cascade,
  position          integer not null,
  bezeichnung       text not null check (length(trim(bezeichnung)) > 0),
  menge             numeric(14, 3) not null check (menge > 0),
  einheit           text not null,
  preis_je_einheit  numeric(12, 4) not null check (preis_je_einheit >= 0),
  betrag            numeric(12, 2) not null,
  artikel_id        uuid references public.lagerartikel (id),
  vom_lager         boolean not null default false,
  -- Verkauf aus der Ernte; die Prüfung erfolgt am Transaktionsende, damit Ernten neu gespeichert werden können.
  -- Eine verrechnete Abgabe kann erst nach dem Stornieren des Belegs gelöscht werden.
  ernte_abnehmer_id uuid references public.ernte_abnehmer (id) deferrable initially deferred
);
create unique index verkauf_ernte_einmal on public.verkauf_positionen (ernte_abnehmer_id) where ernte_abnehmer_id is not null;

create trigger a_version before update on public.verkaeufe for each row execute function public.pruefe_version();
create trigger b_metadaten before insert or update on public.verkaeufe for each row execute function public.setze_metadaten();
create trigger z_protokoll after insert or update or delete on public.verkaeufe for each row execute function public.protokolliere();
create trigger z_protokoll after insert or update or delete on public.verkauf_positionen for each row execute function public.protokolliere();

alter table public.verkaeufe          enable row level security;
alter table public.verkauf_positionen enable row level security;
create policy vk_lesen on public.verkaeufe          for select using (betrieb_id = public.mein_betrieb());
create policy vp_lesen on public.verkauf_positionen for select using (betrieb_id = public.mein_betrieb());
grant select on public.verkaeufe, public.verkauf_positionen to authenticated;

-- ---------------------------------------------------------------------
-- Beleg speichern
-- p: {"id"?, "version"?, "art", "datum", "partner_id"?, "kunde_name"?, "kunde_adresse"?, "zahlungsart"?, "faellig_am"?,
--     "mwst_satz"?, "bemerkungen"?,
--     "positionen": [{"bezeichnung", "menge", "einheit", "preis_je_einheit", "artikel_id"?, "vom_lager"?, "ernte_abnehmer_id"?}]}
-- Positionen «vom Lager» buchen einen Ausgang (Art «Verkauf»). Eine Quittung ist sofort bezahlt.
-- ---------------------------------------------------------------------
create or replace function public.verkauf_speichern(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  v_id      uuid := nullif(p ->> 'id', '')::uuid;
  v_datum   date := (p ->> 'datum')::date;
  v_art     text := p ->> 'art';
  v_jahr    text;
  v_nr      text;
  v_total   numeric := 0;
  v_betrag  numeric;
  v_pos     uuid;
  v_artikel lagerartikel%rowtype;
  v_menge   numeric;
  x         jsonb;
  i         int := 0;
begin
  if v_betrieb is null or not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  if v_datum is null then raise exception 'Datum fehlt'; end if;
  if v_art not in ('Rechnung', 'Quittung') then raise exception 'Ungültige Belegart'; end if;
  if nullif(p ->> 'partner_id', '') is not null
     and not exists (select 1 from partner where id = (p ->> 'partner_id')::uuid and betrieb_id = v_betrieb) then
    raise exception 'Unbekannter Kunde';
  end if;
  if jsonb_array_length(coalesce(p -> 'positionen', '[]')) = 0 then raise exception 'Bitte mindestens eine Position erfassen'; end if;

  if v_id is null then
    v_jahr := to_char(v_datum, 'YYYY');
    perform pg_advisory_xact_lock(hashtext('verkauf-' || v_betrieb::text));
    select v_jahr || '-' || lpad((coalesce(max(split_part(nummer, '-', 2)::int), 0) + 1)::text, 3, '0') into v_nr
      from verkaeufe where betrieb_id = v_betrieb and nummer like v_jahr || '-%';
    insert into verkaeufe (betrieb_id, nummer, art, datum, partner_id, kunde_name, kunde_adresse, zahlungsart, faellig_am,
                           bezahlt, bezahlt_am, mwst_satz, bemerkungen)
    values (v_betrieb, v_nr, v_art, v_datum, nullif(p ->> 'partner_id', '')::uuid, nullif(trim(p ->> 'kunde_name'), ''),
            nullif(trim(p ->> 'kunde_adresse'), ''), nullif(p ->> 'zahlungsart', ''), nullif(p ->> 'faellig_am', '')::date,
            v_art = 'Quittung', case when v_art = 'Quittung' then v_datum end,
            nullif(p ->> 'mwst_satz', '')::numeric, nullif(trim(p ->> 'bemerkungen'), ''))
    returning id into v_id;
  else
    update verkaeufe set
      art = v_art, datum = v_datum, partner_id = nullif(p ->> 'partner_id', '')::uuid,
      kunde_name = nullif(trim(p ->> 'kunde_name'), ''), kunde_adresse = nullif(trim(p ->> 'kunde_adresse'), ''),
      zahlungsart = nullif(p ->> 'zahlungsart', ''), faellig_am = nullif(p ->> 'faellig_am', '')::date,
      bezahlt = bezahlt or v_art = 'Quittung', bezahlt_am = coalesce(bezahlt_am, case when v_art = 'Quittung' then v_datum end),
      mwst_satz = nullif(p ->> 'mwst_satz', '')::numeric, bemerkungen = nullif(trim(p ->> 'bemerkungen'), ''),
      version = coalesce((p ->> 'version')::int, version)
    where id = v_id and betrieb_id = v_betrieb and not storniert;
    if not found then raise exception 'Beleg nicht gefunden oder storniert'; end if;
    delete from lagerbewegungen where quelle_typ = 'verkauf' and quelle_id in (select id from verkauf_positionen where verkauf_id = v_id);
    delete from verkauf_positionen where verkauf_id = v_id;
  end if;

  for x in select * from jsonb_array_elements(p -> 'positionen') loop
    i := i + 1;
    v_menge := (x ->> 'menge')::numeric;
    v_betrag := round(v_menge * (x ->> 'preis_je_einheit')::numeric, 2);
    v_total := v_total + v_betrag;
    v_artikel := null;
    if nullif(x ->> 'artikel_id', '') is not null then
      select * into v_artikel from lagerartikel where id = (x ->> 'artikel_id')::uuid and betrieb_id = v_betrieb;
      if not found then raise exception 'Unbekannter Artikel'; end if;
    end if;
    if nullif(x ->> 'ernte_abnehmer_id', '') is not null
       and not exists (select 1 from ernte_abnehmer where id = (x ->> 'ernte_abnehmer_id')::uuid and betrieb_id = v_betrieb) then
      raise exception 'Unbekannte Ernte-Abgabe';
    end if;
    insert into verkauf_positionen (betrieb_id, verkauf_id, position, bezeichnung, menge, einheit, preis_je_einheit, betrag,
                                    artikel_id, vom_lager, ernte_abnehmer_id)
    values (v_betrieb, v_id, i, trim(x ->> 'bezeichnung'), v_menge, coalesce(nullif(x ->> 'einheit', ''), v_artikel.einheit, 'Stk'),
            (x ->> 'preis_je_einheit')::numeric, v_betrag, v_artikel.id,
            coalesce(v_artikel.id is not null and coalesce((x ->> 'vom_lager')::boolean, true) and v_artikel.lagerfuehrung, false),
            nullif(x ->> 'ernte_abnehmer_id', '')::uuid)
    returning id into v_pos;
    if v_artikel.id is not null and coalesce((x ->> 'vom_lager')::boolean, true) and v_artikel.lagerfuehrung then
      insert into lagerbewegungen (betrieb_id, artikel_id, datum, art, menge, preis_je_einheit, quelle_typ, quelle_id, bemerkung)
      select v_betrieb, v_artikel.id, v_datum, 'Verkauf', -v_menge, (x ->> 'preis_je_einheit')::numeric, 'verkauf', v_pos,
             v_art || ' ' || nummer from verkaeufe where id = v_id;
    end if;
  end loop;

  update verkaeufe set total_chf = round(v_total * (1 + coalesce(mwst_satz, 0) / 100), 2) where id = v_id;
  -- Verkaufte Ernte-Abgaben: Preis übernehmen, Zahlungsstatus angleichen
  update ernte_abnehmer a set preis_chf = vp.betrag, bezahlt = v.bezahlt
    from verkauf_positionen vp join verkaeufe v on v.id = vp.verkauf_id
   where vp.verkauf_id = v_id and a.id = vp.ernte_abnehmer_id;
  return v_id;
end $$;

create or replace function public.verkauf_bezahlt(p_id uuid, p_bezahlt boolean, p_datum date default current_date)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  update verkaeufe set bezahlt = p_bezahlt, bezahlt_am = case when p_bezahlt then coalesce(p_datum, current_date) end
   where id = p_id and betrieb_id = mein_betrieb() and not storniert;
  if not found then raise exception 'Beleg nicht gefunden oder storniert'; end if;
  update ernte_abnehmer a set bezahlt = p_bezahlt
    from verkauf_positionen vp where vp.verkauf_id = p_id and a.id = vp.ernte_abnehmer_id;
end $$;

-- Stornieren: Nummer bleibt erhalten, Lagerbuchungen und Verknüpfungen zur Ernte werden aufgehoben
create or replace function public.verkauf_stornieren(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  update verkaeufe set storniert = true where id = p_id and betrieb_id = mein_betrieb() and not storniert;
  if not found then raise exception 'Beleg nicht gefunden oder bereits storniert'; end if;
  delete from lagerbewegungen where quelle_typ = 'verkauf' and quelle_id in (select id from verkauf_positionen where verkauf_id = p_id);
  update verkauf_positionen set ernte_abnehmer_id = null where verkauf_id = p_id;
end $$;

revoke all on function public.verkauf_speichern(jsonb), public.verkauf_bezahlt(uuid, boolean, date), public.verkauf_stornieren(uuid) from public, anon;
grant execute on function public.verkauf_speichern(jsonb), public.verkauf_bezahlt(uuid, boolean, date), public.verkauf_stornieren(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Ernte: Abgaben behalten beim erneuten Speichern ihre ID (damit Belege verknüpft bleiben)
-- ---------------------------------------------------------------------
create or replace function public.ernte_speichern(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  v_id      uuid := nullif(p ->> 'id', '')::uuid;
  v_feld    felder%rowtype;
  v_datum   date := (p ->> 'datum')::date;
  v_produkte uuid[] := '{}';
  v_prod    ernte_produkte%rowtype;
  v_abn     uuid;
  v_idx     int;
  v_artikel lagerartikel%rowtype;
  v_ort     hofobjekte%rowtype;
  v_name    text;
  v_einheit text;
  v_menge   numeric;
  v_ballen  int;
  v_kg      numeric;
  x         jsonb;
  i         int := 0;
begin
  if v_betrieb is null or not darf_erfassen() then raise exception 'Keine Berechtigung'; end if;
  select * into v_feld from felder where id = (p ->> 'feld_id')::uuid and betrieb_id = v_betrieb;
  if not found then raise exception 'Unbekanntes Feld'; end if;
  if v_datum is null or v_datum > current_date then raise exception 'Erntedatum fehlt oder liegt in der Zukunft'; end if;
  if jsonb_array_length(coalesce(p -> 'produkte', '[]')) = 0 then raise exception 'Bitte mindestens ein Produkt erfassen'; end if;

  if v_id is null then
    insert into ernten (betrieb_id, feld_id, anbau_id, datum, schnitt, flaeche_m2, bemerkungen)
    values (v_betrieb, v_feld.id,
            (select id from anbau where feld_id = v_feld.id and jahr = extract(year from v_datum)::int and art = 'Hauptkultur'),
            v_datum, nullif(p ->> 'schnitt', '')::int, coalesce(nullif(p ->> 'flaeche_m2', '')::numeric, v_feld.flaeche_m2),
            nullif(p ->> 'bemerkungen', ''))
    returning id into v_id;
  else
    if not darf_verwalten() and not exists (select 1 from ernten where id = v_id and erstellt_von = auth.uid()) then
      raise exception 'Nur eigene Einträge können geändert werden';
    end if;
    update ernten set
      feld_id = v_feld.id, datum = v_datum, schnitt = nullif(p ->> 'schnitt', '')::int,
      flaeche_m2 = coalesce(nullif(p ->> 'flaeche_m2', '')::numeric, v_feld.flaeche_m2),
      bemerkungen = nullif(p ->> 'bemerkungen', ''),
      anbau_id = (select id from anbau where feld_id = v_feld.id and jahr = extract(year from v_datum)::int and art = 'Hauptkultur'),
      version = coalesce((p ->> 'version')::int, version)
    where id = v_id and betrieb_id = v_betrieb;
    if not found then raise exception 'Ernte nicht gefunden'; end if;
    perform ernte_lagerbuchungen_entfernen(v_id);
    delete from ernte_abnehmer where ernte_id = v_id;
    delete from ernte_produkte where ernte_id = v_id;
    delete from ernte_dienstleister where ernte_id = v_id;
  end if;

  -- Produkte
  for x in select * from jsonb_array_elements(p -> 'produkte') loop
    i := i + 1;
    if nullif(x ->> 'ballen', '') is null and nullif(x ->> 'menge_kg', '') is null then
      raise exception 'Bei «%» bitte Anzahl Ballen oder Gewicht angeben', x ->> 'produkt';
    end if;
    insert into ernte_produkte (betrieb_id, ernte_id, position, produkt, ballen, ballenart, menge_kg, feuchte_prozent, qualitaet)
    values (v_betrieb, v_id, i, x ->> 'produkt', nullif(x ->> 'ballen', '')::int,
            case when nullif(x ->> 'ballen', '') is not null then nullif(x ->> 'ballenart', '') end,
            nullif(x ->> 'menge_kg', '')::numeric, nullif(x ->> 'feuchte_prozent', '')::numeric, nullif(x ->> 'qualitaet', ''))
    returning id into v_abn;
    v_produkte := v_produkte || v_abn;
  end loop;

  -- Dienstleister
  for x in select * from jsonb_array_elements(coalesce(p -> 'dienstleister', '[]')) loop
    if not exists (select 1 from partner where id = (x ->> 'partner_id')::uuid and betrieb_id = v_betrieb) then
      raise exception 'Unbekannter Dienstleister';
    end if;
    insert into ernte_dienstleister (betrieb_id, ernte_id, partner_id, leistung, kosten_chf, bemerkung)
    values (v_betrieb, v_id, (x ->> 'partner_id')::uuid, coalesce(nullif(x ->> 'leistung', ''), 'Ernte'),
            nullif(x ->> 'kosten_chf', '')::numeric, nullif(x ->> 'bemerkung', ''));
  end loop;

  -- Abnehmer
  for x in select * from jsonb_array_elements(coalesce(p -> 'abnehmer', '[]')) loop
    v_idx := coalesce(nullif(x ->> 'produkt_index', '')::int, 0) + 1;
    if v_idx < 1 or v_idx > cardinality(v_produkte) then raise exception 'Abgabe ohne gültiges Produkt'; end if;
    select * into v_prod from ernte_produkte where id = v_produkte[v_idx];
    if nullif(x ->> 'partner_id', '') is not null
       and not exists (select 1 from partner where id = (x ->> 'partner_id')::uuid and betrieb_id = v_betrieb) then
      raise exception 'Unbekannter Partner';
    end if;
    v_ballen := nullif(x ->> 'ballen', '')::int;
    v_kg := nullif(x ->> 'menge_kg', '')::numeric;
    v_artikel := null;
    v_ort := null;

    if x ->> 'art' = 'Lager' then
      if nullif(x ->> 'lagerort_id', '') is not null then
        select * into v_ort from hofobjekte where id = (x ->> 'lagerort_id')::uuid and betrieb_id = v_betrieb;
        if not found then raise exception 'Unbekannter Lagerort'; end if;
      end if;
      if nullif(x ->> 'lagerartikel_id', '') is not null then
        select * into v_artikel from lagerartikel where id = (x ->> 'lagerartikel_id')::uuid and betrieb_id = v_betrieb;
        if not found then raise exception 'Unbekannter Lagerartikel'; end if;
      else
        v_einheit := case when v_ballen is not null then 'Ballen' else 'kg' end;
        v_name := v_prod.produkt || coalesce(' ' || case when v_ballen is not null then v_prod.ballenart end, '')
                  || ' ' || extract(year from v_datum)::int || coalesce(' – ' || v_ort.name, '');
        select * into v_artikel from lagerartikel
         where betrieb_id = v_betrieb and bezeichnung = v_name and einheit = v_einheit and aktiv limit 1;
        if not found then
          insert into lagerartikel (betrieb_id, bezeichnung, kategorie, einheit, lagerort, bemerkungen)
          values (v_betrieb, v_name, 'Erzeugnisse', v_einheit, v_ort.name, 'Aus der Ernte angelegt')
          returning * into v_artikel;
        end if;
      end if;
      v_menge := case v_artikel.einheit
                   when 'Ballen' then v_ballen
                   when 'Stk' then v_ballen
                   when 'kg' then v_kg
                   when 't' then v_kg / 1000
                 end;
      if v_menge is null or v_menge <= 0 then
        raise exception 'Für die Einlagerung in «%» (Einheit %) fehlt die Menge in %', v_artikel.bezeichnung, v_artikel.einheit,
          case when v_artikel.einheit in ('Ballen', 'Stk') then 'Ballen' else 'kg' end;
      end if;
    end if;

    insert into ernte_abnehmer (id, betrieb_id, ernte_id, produkt_id, partner_id, art, ballen, menge_kg, preis_chf, preis_einheit, bezahlt,
                                bemerkung, lagerartikel_id, lagerort_id)
    values (coalesce(nullif(x ->> 'id', '')::uuid, gen_random_uuid()),
            v_betrieb, v_id, v_prod.id, nullif(x ->> 'partner_id', '')::uuid, coalesce(nullif(x ->> 'art', ''), 'Verkauf'),
            v_ballen, v_kg, nullif(x ->> 'preis_chf', '')::numeric, nullif(x ->> 'preis_einheit', ''),
            coalesce((x ->> 'bezahlt')::boolean, false), nullif(x ->> 'bemerkung', ''), v_artikel.id, v_ort.id)
    returning id into v_abn;

    if x ->> 'art' = 'Lager' then
      insert into lagerbewegungen (betrieb_id, artikel_id, datum, art, menge, quelle_typ, quelle_id, bemerkung)
      values (v_betrieb, v_artikel.id, v_datum, 'Ernte', v_menge, 'ernte_abgabe', v_abn,
              'Ernte ' || v_feld.name || coalesce(', ' || v_ort.name, ''));
    end if;
  end loop;

  -- Abgaben je Produkt dürfen die Ernte nicht übersteigen
  for v_prod in select * from ernte_produkte where ernte_id = v_id loop
    select sum(ballen), sum(menge_kg) into v_ballen, v_kg from ernte_abnehmer where produkt_id = v_prod.id;
    if v_prod.ballen is not null and coalesce(v_ballen, 0) > v_prod.ballen then
      raise exception 'Bei «%» wurden mehr Ballen abgegeben (%) als geerntet (%)', v_prod.produkt, v_ballen, v_prod.ballen;
    end if;
    if v_prod.menge_kg is not null and coalesce(v_kg, 0) > v_prod.menge_kg * 1.001 then
      raise exception 'Bei «%» wurde mehr Gewicht abgegeben (% kg) als geerntet (% kg)', v_prod.produkt, v_kg, v_prod.menge_kg;
    end if;
  end loop;
  if exists (select 1 from verkauf_positionen vp where vp.betrieb_id = v_betrieb and vp.ernte_abnehmer_id is not null
               and not exists (select 1 from ernte_abnehmer a where a.id = vp.ernte_abnehmer_id)) then
    raise exception 'Eine bereits verrechnete Abgabe wurde entfernt. Bitte zuerst den Beleg stornieren.';
  end if;
  return v_id;
end $$;


create or replace function public.ernte_loeschen(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not darf_verwalten() and not exists (select 1 from ernten where id = p_id and erstellt_von = auth.uid() and betrieb_id = mein_betrieb()) then
    raise exception 'Keine Berechtigung';
  end if;
  if not exists (select 1 from ernten where id = p_id and betrieb_id = mein_betrieb()) then raise exception 'Ernte nicht gefunden'; end if;
  if exists (select 1 from verkauf_positionen vp join ernte_abnehmer a on a.id = vp.ernte_abnehmer_id where a.ernte_id = p_id) then
    raise exception 'Zu dieser Ernte gibt es Rechnungen oder Quittungen. Bitte zuerst den Beleg stornieren.';
  end if;
  perform ernte_lagerbuchungen_entfernen(p_id);
  delete from ernten where id = p_id;
end $$;

revoke all on function public.ernte_speichern(jsonb) from public, anon;
grant execute on function public.ernte_speichern(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Fotos (Maschinen, Wartungen/Reparaturen/Beobachtungen, Felder)
-- Dateien liegen in Supabase Storage, Bucket «fotos», Ordner = Betrieb-ID
-- ---------------------------------------------------------------------
create table public.fotos (
  id           uuid primary key default gen_random_uuid(),
  betrieb_id   uuid not null references public.betriebe (id),
  pfad         text not null unique,
  maschine_id  uuid references public.maschinen (id) on delete cascade,
  eintrag_id   uuid references public.maschinen_eintraege (id) on delete cascade,
  feld_id      uuid references public.felder (id) on delete cascade,
  beschreibung text,
  erstellt_von uuid default auth.uid(),
  erstellt_am  timestamptz not null default now(),
  check (maschine_id is not null or eintrag_id is not null or feld_id is not null),
  check (split_part(pfad, '/', 1) = betrieb_id::text)
);
create index on public.fotos (maschine_id);
create index on public.fotos (eintrag_id);
create trigger z_protokoll after insert or update or delete on public.fotos for each row execute function public.protokolliere();

alter table public.fotos enable row level security;
create policy fo_lesen    on public.fotos for select using (betrieb_id = public.mein_betrieb());
create policy fo_neu      on public.fotos for insert with check (betrieb_id = public.mein_betrieb() and public.darf_erfassen());
create policy fo_aendern  on public.fotos for update using (betrieb_id = public.mein_betrieb() and public.darf_erfassen());
create policy fo_loeschen on public.fotos for delete using (
  betrieb_id = public.mein_betrieb() and (public.darf_verwalten() or erstellt_von = auth.uid()));
grant select, insert, update, delete on public.fotos to authenticated;

-- Speicher-Bucket und Zugriffsregeln (nur wenn Supabase Storage vorhanden ist)
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('fotos', 'fotos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
    execute $p$create policy "fotos_lesen" on storage.objects for select to authenticated
      using (bucket_id = 'fotos' and (storage.foldername(name))[1] = public.mein_betrieb()::text)$p$;
    execute $p$create policy "fotos_hochladen" on storage.objects for insert to authenticated
      with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = public.mein_betrieb()::text and public.darf_erfassen())$p$;
    execute $p$create policy "fotos_loeschen" on storage.objects for delete to authenticated
      using (bucket_id = 'fotos' and (storage.foldername(name))[1] = public.mein_betrieb()::text and public.darf_erfassen())$p$;
  end if;
end $$;

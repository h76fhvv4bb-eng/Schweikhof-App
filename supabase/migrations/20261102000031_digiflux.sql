-- =====================================================================
-- Hofmanager – Migration 31: digiFLUX (Nachfolger von HODUFLU)
-- Einspielen: Supabase › SQL Editor › gesamten Inhalt einfügen › Run
--
-- Lieferungen an den Betrieb (Hofdünger, Mineraldünger, Pflanzenschutzmittel …) aus digiFLUX übernehmen:
--  • per Datei (Export aus digiFLUX) oder automatisch über die digiFLUX-Schnittstelle (technischer Benutzer)
--  • jede Lieferung kann einem Lagerartikel zugeordnet und als Lager-Eingang gebucht werden
--  • die Zuordnung Produkt → Artikel wird gemerkt; künftige Lieferungen desselben Produkts werden direkt gebucht
--  • abgelehnte Lieferungen werden nicht (bzw. nicht mehr) gebucht
-- =====================================================================

alter table public.betriebe add column if not exists dflid text check (dflid is null or dflid ~ '^[A-Za-z0-9]{4,20}$');

create table if not exists public.digiflux_lieferungen (
  id               uuid primary key default gen_random_uuid(),
  betrieb_id       uuid not null references public.betriebe (id),
  dfx_id           text not null check (length(dfx_id) between 1 and 120), -- digiFLUX-ID (bei Datei ohne ID: aus den Angaben gebildet)
  quelle           text not null check (quelle in ('Datei', 'API')),
  status           text,                                                    -- z. B. SENT, ACCEPTED, REJECTED
  lieferdatum      date not null,
  abgeber          text,
  abgeber_id       text,
  produkt          text,
  produkt_id       text,
  produkt_quelle   text,
  produktfamilie   text,
  menge            numeric(16, 4) not null,
  einheit          text not null,
  lieferschein_nr  text,
  kommentar        text,
  roh              jsonb,
  artikel_id       uuid references public.lagerartikel (id) on delete set null,
  lagerbewegung_id uuid references public.lagerbewegungen (id) on delete set null,
  ignoriert        boolean not null default false,
  erstellt_am      timestamptz not null default now(),
  geaendert_am     timestamptz not null default now(),
  constraint digiflux_lieferung_eindeutig unique (betrieb_id, dfx_id)
);
create index if not exists digiflux_lieferungen_datum on public.digiflux_lieferungen (betrieb_id, lieferdatum);

-- gemerkte Zuordnung Produkt → Lagerartikel
create table if not exists public.digiflux_zuordnung (
  betrieb_id   uuid not null references public.betriebe (id),
  schluessel   text not null,
  artikel_id   uuid not null references public.lagerartikel (id) on delete cascade,
  primary key (betrieb_id, schluessel)
);

alter table public.digiflux_lieferungen enable row level security;
alter table public.digiflux_zuordnung enable row level security;
drop policy if exists dfl_lesen on public.digiflux_lieferungen;
create policy dfl_lesen on public.digiflux_lieferungen for select using (betrieb_id = public.mein_betrieb());
drop policy if exists dfz_lesen on public.digiflux_zuordnung;
create policy dfz_lesen on public.digiflux_zuordnung for select using (betrieb_id = public.mein_betrieb());
grant select on public.digiflux_lieferungen, public.digiflux_zuordnung to authenticated;

-- Schlüssel eines Produkts für die Zuordnung
create or replace function public.digiflux_schluessel(l digiflux_lieferungen)
returns text language sql immutable as $$
  select case when coalesce(l.produkt_id, '') <> '' then coalesce(nullif(l.produkt_quelle, ''), '?') || ':' || l.produkt_id
              else 'name:' || lower(trim(coalesce(l.produkt, ''))) end;
$$;

-- Menge von der digiFLUX-Einheit in die Artikeleinheit umrechnen (null = nicht umrechenbar)
create or replace function public.digiflux_umrechnen(p_menge numeric, p_von text, p_nach text)
returns numeric language sql immutable as $$
  select p_menge * case
    when n.von = n.nach then 1
    when n.von = 'kg' and n.nach = 't' then 0.001
    when n.von = 't' and n.nach = 'kg' then 1000
    when n.von = 'l' and n.nach = 'm³' then 0.001
    when n.von = 'm³' and n.nach = 'l' then 1000
  end
  from (select case lower(trim(p_von)) when 'm3' then 'm³' when 'm³' then 'm³' when 'pc' then 'Stk' when 'stk' then 'Stk'
                    when 'stück' then 'Stk' else lower(trim(p_von)) end as von,
               p_nach as nach) n;
$$;

-- Eine Lieferung als Lager-Eingang buchen (intern; prüft Berechtigung nicht)
create or replace function public.digiflux_buchen(p_id uuid, p_menge numeric default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  l digiflux_lieferungen%rowtype;
  a lagerartikel%rowtype;
  v_menge numeric;
  v_bew uuid;
begin
  select * into l from digiflux_lieferungen where id = p_id for update;
  if l.artikel_id is null or l.lagerbewegung_id is not null then return; end if;
  select * into a from lagerartikel where id = l.artikel_id;
  v_menge := coalesce(p_menge, digiflux_umrechnen(l.menge, l.einheit, a.einheit));
  if v_menge is null then
    raise exception 'Die Einheit der Lieferung (%) passt nicht zum Artikel «%» (%). Bitte die Menge in % angeben.', l.einheit, a.bezeichnung, a.einheit, a.einheit;
  end if;
  if v_menge = 0 then return; end if;
  insert into lagerbewegungen (betrieb_id, artikel_id, datum, art, menge, quelle_typ, quelle_id, bemerkung)
  values (l.betrieb_id, a.id, l.lieferdatum, 'Eingang', v_menge, 'digiflux', l.id,
          left(concat_ws(' · ', 'digiFLUX', l.abgeber, nullif('LS ' || coalesce(l.lieferschein_nr, ''), 'LS ')), 300))
  returning id into v_bew;
  update digiflux_lieferungen set lagerbewegung_id = v_bew, geaendert_am = now() where id = l.id;
end $$;
revoke all on function public.digiflux_buchen(uuid, numeric) from public, anon, authenticated;

-- Buchung zurücknehmen (intern)
create or replace function public.digiflux_buchung_loeschen(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_bew uuid;
begin
  select lagerbewegung_id into v_bew from digiflux_lieferungen where id = p_id;
  if v_bew is null then return; end if;
  update digiflux_lieferungen set lagerbewegung_id = null, geaendert_am = now() where id = p_id;
  delete from lagerbewegungen where id = v_bew;
end $$;
revoke all on function public.digiflux_buchung_loeschen(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Lieferungen importieren (Datei oder Schnittstelle). Bekannte Lieferungen werden aktualisiert (Status usw.),
-- Zuordnung und Buchung bleiben. Mit gemerkter Zuordnung wird direkt gebucht; abgelehnte werden storniert.
-- p = { quelle: 'Datei'|'API', lieferungen: [ { dfx_id, status, lieferdatum, abgeber, abgeber_id, produkt, produkt_id,
--        produkt_quelle, produktfamilie, menge, einheit, lieferschein_nr, kommentar, roh } ] }
-- ---------------------------------------------------------------------
create or replace function public.digiflux_importieren(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  v_quelle text := coalesce(nullif(p ->> 'quelle', ''), 'Datei');
  x jsonb;
  l digiflux_lieferungen%rowtype;
  v_neu int := 0;
  v_alt int := 0;
  v_gebucht int := 0;
  v_storniert int := 0;
  v_fehler text[] := '{}';
  v_vorher uuid;
begin
  if v_betrieb is null or not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  for x in select * from jsonb_array_elements(coalesce(p -> 'lieferungen', '[]')) loop
    if coalesce(x ->> 'dfx_id', '') = '' or coalesce(x ->> 'lieferdatum', '') = '' or (x ->> 'menge') is null or coalesce(x ->> 'einheit', '') = '' then
      raise exception 'Lieferung unvollständig (ID, Datum, Menge und Einheit nötig): %', left(x::text, 200);
    end if;
    select id into v_vorher from digiflux_lieferungen where betrieb_id = v_betrieb and dfx_id = x ->> 'dfx_id';
    insert into digiflux_lieferungen (betrieb_id, dfx_id, quelle, status, lieferdatum, abgeber, abgeber_id, produkt, produkt_id,
                                      produkt_quelle, produktfamilie, menge, einheit, lieferschein_nr, kommentar, roh)
    values (v_betrieb, x ->> 'dfx_id', v_quelle, nullif(upper(trim(x ->> 'status')), ''), (x ->> 'lieferdatum')::date,
            nullif(trim(x ->> 'abgeber'), ''), nullif(trim(x ->> 'abgeber_id'), ''), nullif(trim(x ->> 'produkt'), ''),
            nullif(trim(x ->> 'produkt_id'), ''), nullif(trim(x ->> 'produkt_quelle'), ''), nullif(trim(x ->> 'produktfamilie'), ''),
            (x ->> 'menge')::numeric, trim(x ->> 'einheit'), nullif(trim(x ->> 'lieferschein_nr'), ''), nullif(trim(x ->> 'kommentar'), ''),
            x -> 'roh')
    on conflict (betrieb_id, dfx_id) do update set
      status = coalesce(excluded.status, digiflux_lieferungen.status),
      lieferdatum = excluded.lieferdatum,
      abgeber = coalesce(excluded.abgeber, digiflux_lieferungen.abgeber),
      abgeber_id = coalesce(excluded.abgeber_id, digiflux_lieferungen.abgeber_id),
      produkt = coalesce(excluded.produkt, digiflux_lieferungen.produkt),
      produkt_id = coalesce(excluded.produkt_id, digiflux_lieferungen.produkt_id),
      produkt_quelle = coalesce(excluded.produkt_quelle, digiflux_lieferungen.produkt_quelle),
      produktfamilie = coalesce(excluded.produktfamilie, digiflux_lieferungen.produktfamilie),
      menge = excluded.menge, einheit = excluded.einheit,
      lieferschein_nr = coalesce(excluded.lieferschein_nr, digiflux_lieferungen.lieferschein_nr),
      kommentar = coalesce(excluded.kommentar, digiflux_lieferungen.kommentar),
      roh = coalesce(excluded.roh, digiflux_lieferungen.roh),
      quelle = case when excluded.quelle = 'API' then 'API' else digiflux_lieferungen.quelle end,
      geaendert_am = now()
    returning * into l;
    if v_vorher is null then v_neu := v_neu + 1; else v_alt := v_alt + 1; end if;

    if l.status in ('REJECTED', 'CANCELLED', 'DELETED') or l.ignoriert then
      if l.lagerbewegung_id is not null then
        perform digiflux_buchung_loeschen(l.id);
        v_storniert := v_storniert + 1;
      end if;
      continue;
    end if;
    -- Menge geändert? Buchung neu
    if l.lagerbewegung_id is not null and l.artikel_id is not null
       and exists (select 1 from lagerbewegungen b join lagerartikel a on a.id = b.artikel_id
                    where b.id = l.lagerbewegung_id
                      and (b.menge is distinct from digiflux_umrechnen(l.menge, l.einheit, a.einheit) or b.datum <> l.lieferdatum)
                      and digiflux_umrechnen(l.menge, l.einheit, a.einheit) is not null) then
      perform digiflux_buchung_loeschen(l.id);
      select * into l from digiflux_lieferungen where id = l.id;
    end if;
    if l.artikel_id is null then
      update digiflux_lieferungen d set artikel_id = z.artikel_id
        from digiflux_zuordnung z join lagerartikel a on a.id = z.artikel_id and a.aktiv
       where d.id = l.id and z.betrieb_id = v_betrieb and z.schluessel = digiflux_schluessel(l)
      returning d.* into l;
      if l.id is null then select * into l from digiflux_lieferungen where betrieb_id = v_betrieb and dfx_id = x ->> 'dfx_id'; end if;
    end if;
    if l.artikel_id is not null and l.lagerbewegung_id is null then
      begin
        perform digiflux_buchen(l.id);
        if (select lagerbewegung_id from digiflux_lieferungen where id = l.id) is not null then v_gebucht := v_gebucht + 1; end if;
      exception when others then
        v_fehler := v_fehler || (coalesce(l.produkt, l.produkt_id, '?') || ': ' || sqlerrm);
      end;
    end if;
  end loop;
  return jsonb_build_object('neu', v_neu, 'aktualisiert', v_alt, 'gebucht', v_gebucht, 'storniert', v_storniert, 'fehler', to_jsonb(v_fehler));
end $$;
revoke all on function public.digiflux_importieren(jsonb) from public, anon;
grant execute on function public.digiflux_importieren(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Lieferung einem Artikel zuordnen und buchen.
-- p = { artikel_id } oder { neu: { bezeichnung, kategorie, einheit } }, optional { menge } (in der Artikeleinheit), { merken: true }
-- ---------------------------------------------------------------------
create or replace function public.digiflux_uebernehmen(p_id uuid, p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  l digiflux_lieferungen%rowtype;
  v_artikel uuid := nullif(p ->> 'artikel_id', '')::uuid;
begin
  if v_betrieb is null or not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  select * into l from digiflux_lieferungen where id = p_id and betrieb_id = v_betrieb for update;
  if not found then raise exception 'Lieferung nicht gefunden'; end if;
  if l.status in ('REJECTED', 'CANCELLED', 'DELETED') then raise exception 'Abgelehnte Lieferungen werden nicht ins Lager gebucht'; end if;
  if v_artikel is null and p ? 'neu' then
    insert into lagerartikel (betrieb_id, bezeichnung, kategorie, einheit, lieferant)
    values (v_betrieb, trim(p -> 'neu' ->> 'bezeichnung'), coalesce(nullif(p -> 'neu' ->> 'kategorie', ''), 'Dünger'),
            coalesce(nullif(p -> 'neu' ->> 'einheit', ''), digiflux_einheit(l.einheit)), l.abgeber)
    returning id into v_artikel;
  end if;
  if not exists (select 1 from lagerartikel where id = v_artikel and betrieb_id = v_betrieb) then raise exception 'Bitte einen Artikel wählen'; end if;

  perform digiflux_buchung_loeschen(l.id);
  update digiflux_lieferungen set artikel_id = v_artikel, ignoriert = false, geaendert_am = now() where id = l.id;
  perform digiflux_buchen(l.id, nullif(p ->> 'menge', '')::numeric);
  if coalesce((p ->> 'merken')::boolean, true) then
    insert into digiflux_zuordnung (betrieb_id, schluessel, artikel_id) values (v_betrieb, digiflux_schluessel(l), v_artikel)
    on conflict (betrieb_id, schluessel) do update set artikel_id = excluded.artikel_id;
  end if;
  return v_artikel;
end $$;
revoke all on function public.digiflux_uebernehmen(uuid, jsonb) from public, anon;
grant execute on function public.digiflux_uebernehmen(uuid, jsonb) to authenticated;

-- App-Einheit zu einer digiFLUX-Einheit
create or replace function public.digiflux_einheit(p text)
returns text language sql immutable as $$
  select case lower(trim(p)) when 'm3' then 'm³' when 'm³' then 'm³' when 'pc' then 'Stk' when 'kg' then 'kg' when 't' then 't' when 'l' then 'l' else 'Einheit' end;
$$;

-- Buchung zurücknehmen bzw. Lieferung ausblenden (z. B. gehört nicht ins Lager)
create or replace function public.digiflux_zuruecksetzen(p_id uuid, p_ignorieren boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  if not exists (select 1 from digiflux_lieferungen where id = p_id and betrieb_id = mein_betrieb()) then raise exception 'Lieferung nicht gefunden'; end if;
  perform digiflux_buchung_loeschen(p_id);
  update digiflux_lieferungen set artikel_id = null, ignoriert = p_ignorieren, geaendert_am = now() where id = p_id;
end $$;
revoke all on function public.digiflux_zuruecksetzen(uuid, boolean) from public, anon;
grant execute on function public.digiflux_zuruecksetzen(uuid, boolean) to authenticated;

-- Status nach Bestätigen/Ablehnen über die Schnittstelle nachführen
create or replace function public.digiflux_status(p_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  l digiflux_lieferungen%rowtype;
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  update digiflux_lieferungen set status = upper(p_status), geaendert_am = now()
   where id = p_id and betrieb_id = mein_betrieb() returning * into l;
  if not found then raise exception 'Lieferung nicht gefunden'; end if;
  if l.status in ('REJECTED', 'CANCELLED', 'DELETED') then perform digiflux_buchung_loeschen(l.id); end if;
end $$;
revoke all on function public.digiflux_status(uuid, text) from public, anon;
grant execute on function public.digiflux_status(uuid, text) to authenticated;

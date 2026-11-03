-- =====================================================================
-- Migration 19: Umtrieb der Weidegäste
-- Jedes Feld einer Weide hat einen eigenen Zeitraum (von/bis). So lassen sich Tiere von Feld zu Feld
-- weiterziehen (z. B. Schafe) und die Aufenthalte sauber nachtragen.
-- =====================================================================

alter table public.beweidung_felder add column if not exists id uuid not null default gen_random_uuid();
alter table public.beweidung_felder add column if not exists von date;
alter table public.beweidung_felder add column if not exists bis date;
update public.beweidung_felder bf set von = b.von, bis = b.bis from public.beweidungen b where b.id = bf.beweidung_id and bf.von is null;
alter table public.beweidung_felder alter column von set not null;
alter table public.beweidung_felder drop constraint if exists beweidung_felder_pkey;
alter table public.beweidung_felder add primary key (id);
alter table public.beweidung_felder add constraint beweidung_abschnitt_zeitraum check (bis is null or bis >= von);
create index if not exists beweidung_felder_beweidung on public.beweidung_felder (beweidung_id, von);

-- Prüft einen Abschnitt und legt ihn an
create or replace function public.beweidung_abschnitt_anlegen(p_beweidung beweidungen, x jsonb, p_von date, p_bis date)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_feld felder%rowtype;
  v_m2   numeric;
begin
  select * into v_feld from felder where id = (x ->> 'feld_id')::uuid and betrieb_id = p_beweidung.betrieb_id and geloescht_am is null;
  if not found then raise exception 'Unbekanntes Feld'; end if;
  v_m2 := coalesce(nullif(x ->> 'flaeche_m2', '')::numeric, v_feld.flaeche_m2);
  if v_m2 <= 0 or v_m2 > v_feld.flaeche_m2 * 1.001 then
    raise exception 'Weidefläche auf «%» ist grösser als das Feld', v_feld.name;
  end if;
  if p_von < p_beweidung.von then
    raise exception '«%»: Beginn % liegt vor dem Beginn der Weide', v_feld.name, to_char(p_von, 'DD.MM.YYYY');
  end if;
  if p_beweidung.bis is not null and p_von > p_beweidung.bis then
    raise exception '«%»: Beginn % liegt nach dem Ende der Weide', v_feld.name, to_char(p_von, 'DD.MM.YYYY');
  end if;
  if p_bis is not null and p_bis < p_von then
    raise exception '«%»: Ende liegt vor dem Beginn', v_feld.name;
  end if;
  insert into beweidung_felder (beweidung_id, feld_id, betrieb_id, flaeche_m2, von, bis)
  values (p_beweidung.id, v_feld.id, p_beweidung.betrieb_id, v_m2, p_von,
          case when p_beweidung.bis is null then p_bis else least(coalesce(p_bis, p_beweidung.bis), p_beweidung.bis) end);
end $$;
revoke all on function public.beweidung_abschnitt_anlegen(beweidungen, jsonb, date, date) from public, anon, authenticated;

-- Speichern mit allen Abschnitten (Feld, Fläche, von, bis); ohne Datum gilt der Zeitraum der Weide
create or replace function public.beweidung_speichern(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  v_id      uuid := nullif(p ->> 'id', '')::uuid;
  v_von     date := nullif(p ->> 'von', '')::date;
  v_bis     date := nullif(p ->> 'bis', '')::date;
  v_art     text := coalesce(nullif(p ->> 'entgelt_art', ''), 'keins');
  v_b       beweidungen%rowtype;
  x         jsonb;
begin
  if v_betrieb is null or not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  if v_von is null then raise exception 'Beginn der Weide fehlt'; end if;
  if v_bis is not null and v_bis < v_von then raise exception 'Das Ende liegt vor dem Beginn'; end if;
  if not exists (select 1 from partner where id = nullif(p ->> 'partner_id', '')::uuid and betrieb_id = v_betrieb) then
    raise exception 'Bitte den Tierhalter (Partner) wählen';
  end if;
  if coalesce(nullif(trim(p ->> 'tierart'), ''), '') = '' then raise exception 'Tierart fehlt'; end if;
  if coalesce((p ->> 'anzahl')::int, 0) < 1 then raise exception 'Anzahl Tiere fehlt'; end if;
  if jsonb_array_length(coalesce(p -> 'felder', '[]')) = 0 then raise exception 'Bitte mindestens ein Feld wählen'; end if;
  if v_art <> 'keins' and (p ->> 'entgelt_satz') is null then raise exception 'Bitte den Weidezins angeben'; end if;
  if v_art = 'je GVE und Tag' and nullif(p ->> 'gve', '') is null then raise exception 'Für den Weidezins je GVE braucht es die GVE'; end if;

  if v_id is null then
    insert into beweidungen (betrieb_id, partner_id, tierart, anzahl, gve, von, bis, entgelt_art, entgelt_satz, bemerkungen)
    values (v_betrieb, (p ->> 'partner_id')::uuid, trim(p ->> 'tierart'), (p ->> 'anzahl')::int, nullif(p ->> 'gve', '')::numeric,
            v_von, v_bis, v_art, case when v_art = 'keins' then null else (p ->> 'entgelt_satz')::numeric end,
            nullif(trim(p ->> 'bemerkungen'), ''))
    returning * into v_b;
  else
    update beweidungen set
      partner_id = (p ->> 'partner_id')::uuid, tierart = trim(p ->> 'tierart'), anzahl = (p ->> 'anzahl')::int,
      gve = nullif(p ->> 'gve', '')::numeric, von = v_von, bis = v_bis, entgelt_art = v_art,
      entgelt_satz = case when v_art = 'keins' then null else (p ->> 'entgelt_satz')::numeric end,
      bemerkungen = nullif(trim(p ->> 'bemerkungen'), ''),
      version = coalesce((p ->> 'version')::int, version)
    where id = v_id and betrieb_id = v_betrieb
    returning * into v_b;
    if not found then raise exception 'Weide-Eintrag nicht gefunden'; end if;
    delete from beweidung_felder where beweidung_id = v_id;
  end if;

  for x in select * from jsonb_array_elements(p -> 'felder') loop
    perform beweidung_abschnitt_anlegen(v_b, x, coalesce(nullif(x ->> 'von', '')::date, v_von), coalesce(nullif(x ->> 'bis', '')::date, v_bis));
  end loop;
  return v_b.id;
end $$;

-- Weiterziehen: die Tiere stehen ab p.datum auf den neuen Feldern; die bisherigen Felder enden am Vortag
create or replace function public.beweidung_umtreiben(p_id uuid, p jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_b     beweidungen%rowtype;
  v_datum date := coalesce(nullif(p ->> 'datum', '')::date, current_date);
  x       jsonb;
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  select * into v_b from beweidungen where id = p_id and betrieb_id = mein_betrieb() for update;
  if not found then raise exception 'Weide-Eintrag nicht gefunden'; end if;
  if jsonb_array_length(coalesce(p -> 'felder', '[]')) = 0 then raise exception 'Bitte das neue Feld wählen'; end if;
  if v_datum < v_b.von then raise exception 'Das Datum liegt vor dem Beginn der Weide'; end if;
  if v_b.bis is not null and v_datum > v_b.bis then raise exception 'Die Weide ist am % schon beendet', to_char(v_b.bis, 'DD.MM.YYYY'); end if;
  if exists (select 1 from beweidung_felder where beweidung_id = p_id and von > v_datum) then
    raise exception 'Nach dem % gibt es schon Feldwechsel. Bitte im Weide-Eintrag nachtragen.', to_char(v_datum, 'DD.MM.YYYY');
  end if;
  -- am selben Tag begonnene Abschnitte ersetzen (Korrektur), übrige am Vortag beenden
  delete from beweidung_felder where beweidung_id = p_id and von = v_datum;
  update beweidung_felder set bis = v_datum - 1 where beweidung_id = p_id and (bis is null or bis >= v_datum);
  for x in select * from jsonb_array_elements(p -> 'felder') loop
    perform beweidung_abschnitt_anlegen(v_b, x, v_datum, v_b.bis);
  end loop;
end $$;

-- Tiere sind weg: Weide und offene Abschnitte am Datum beenden
create or replace function public.beweidung_beenden(p_id uuid, p_datum date default current_date)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_b beweidungen%rowtype;
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  select * into v_b from beweidungen where id = p_id and betrieb_id = mein_betrieb() for update;
  if not found then raise exception 'Weide-Eintrag nicht gefunden'; end if;
  if p_datum < v_b.von then raise exception 'Das Ende liegt vor dem Beginn'; end if;
  if exists (select 1 from beweidung_felder where beweidung_id = p_id and von > p_datum) then
    raise exception 'Nach dem % gibt es noch Feldwechsel. Bitte im Weide-Eintrag nachtragen.', to_char(p_datum, 'DD.MM.YYYY');
  end if;
  update beweidung_felder set bis = p_datum where beweidung_id = p_id and (bis is null or bis > p_datum);
  update beweidungen set bis = p_datum where id = p_id;
end $$;

revoke all on function public.beweidung_umtreiben(uuid, jsonb) from public, anon;
revoke all on function public.beweidung_beenden(uuid, date) from public, anon;
grant execute on function public.beweidung_umtreiben(uuid, jsonb) to authenticated;
grant execute on function public.beweidung_beenden(uuid, date) to authenticated;
grant execute on function public.beweidung_speichern(jsonb) to authenticated;

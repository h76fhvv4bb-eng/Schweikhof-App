-- =====================================================================
-- Hofmanager – Migration 30: Weide-Reihenfolge ohne Datum
-- Einspielen: Supabase › SQL Editor › gesamten Inhalt einfügen › Run
--
-- Felder im Umtrieb können ohne Datum geplant werden («Datum offen»). Die Reihenfolge der Zeilen wird gespeichert;
-- der Weideplan nummeriert danach (1. Feld, 2. Feld …). Beim «Weiterziehen» erhält das geplante Feld sein Datum.
-- Geplante Felder ohne Datum zählen noch nicht als beweidet (keine Weidetage, nicht im Parzellenblatt).
-- Beim «Abgeholt» werden nicht mehr genutzte geplante Felder entfernt.
-- =====================================================================

alter table public.beweidung_felder add column if not exists position int;
update public.beweidung_felder bf set position = x.nr
  from (select id, row_number() over (partition by beweidung_id order by von, id) as nr from public.beweidung_felder) x
 where x.id = bf.id and bf.position is null;
alter table public.beweidung_felder alter column von drop not null;
alter table public.beweidung_felder drop constraint if exists beweidung_abschnitt_zeitraum;
alter table public.beweidung_felder add constraint beweidung_abschnitt_zeitraum check (bis is null or (von is not null and bis >= von));

-- Abschnitt anlegen (Datum darf fehlen = geplant)
create or replace function public.beweidung_abschnitt_planen(p_beweidung beweidungen, x jsonb, p_von date, p_bis date, p_position int)
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
  if p_von is null then
    if p_bis is not null then raise exception '«%»: Ende ohne Beginn – bitte auch den Beginn eintragen oder beides leer lassen', v_feld.name; end if;
  else
    if p_von < p_beweidung.von then
      raise exception '«%»: Beginn % liegt vor dem Beginn der Weide', v_feld.name, to_char(p_von, 'DD.MM.YYYY');
    end if;
    if p_beweidung.bis is not null and p_von > p_beweidung.bis then
      raise exception '«%»: Beginn % liegt nach dem Ende der Weide', v_feld.name, to_char(p_von, 'DD.MM.YYYY');
    end if;
    if p_bis is not null and p_bis < p_von then
      raise exception '«%»: Ende liegt vor dem Beginn', v_feld.name;
    end if;
  end if;
  insert into beweidung_felder (beweidung_id, feld_id, betrieb_id, flaeche_m2, von, bis, position)
  values (p_beweidung.id, v_feld.id, p_beweidung.betrieb_id, v_m2, p_von,
          case when p_von is null then null when p_beweidung.bis is null then p_bis else least(coalesce(p_bis, p_beweidung.bis), p_beweidung.bis) end,
          p_position);
end $$;
revoke all on function public.beweidung_abschnitt_planen(beweidungen, jsonb, date, date, int) from public, anon, authenticated;

-- Reihenfolge neu durchzählen: mit Datum nach Datum, geplante danach in ihrer Reihenfolge
create or replace function public.beweidung_reihenfolge(p_id uuid)
returns void
language sql security definer set search_path = public as $$
  update beweidung_felder bf set position = x.nr
    from (select id, row_number() over (order by von is null, von, position, id) as nr from beweidung_felder where beweidung_id = p_id) x
   where x.id = bf.id and bf.position is distinct from x.nr;
$$;
revoke all on function public.beweidung_reihenfolge(uuid) from public, anon, authenticated;

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
  v_nr      bigint;
  v_zvon    date;
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

  -- Zeilen in der erfassten Reihenfolge. Ohne Datum: erste Zeile ab Beginn der Weide, weitere = geplant (Datum offen).
  for x, v_nr in select e, n from jsonb_array_elements(p -> 'felder') with ordinality as t(e, n) loop
    v_zvon := coalesce(nullif(x ->> 'von', '')::date, case when v_nr = 1 then v_von end);
    perform beweidung_abschnitt_planen(v_b, x, v_zvon,
      case when v_zvon is null then nullif(x ->> 'bis', '')::date else coalesce(nullif(x ->> 'bis', '')::date, v_bis) end, v_nr::int);
  end loop;
  return v_b.id;
end $$;

create or replace function public.beweidung_umtreiben(p_id uuid, p jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_b     beweidungen%rowtype;
  v_datum date := coalesce(nullif(p ->> 'datum', '')::date, current_date);
  x       jsonb;
  v_plan  uuid;
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
  delete from beweidung_felder where beweidung_id = p_id and von = v_datum;
  update beweidung_felder set bis = v_datum - 1 where beweidung_id = p_id and von is not null and (bis is null or bis >= v_datum);
  for x in select * from jsonb_array_elements(p -> 'felder') loop
    -- geplantes Feld (ohne Datum) übernehmen, sonst neu anlegen
    select id into v_plan from beweidung_felder
     where beweidung_id = p_id and feld_id = (x ->> 'feld_id')::uuid and von is null order by position limit 1;
    if v_plan is not null then
      update beweidung_felder set von = v_datum, bis = v_b.bis,
             flaeche_m2 = coalesce(nullif(x ->> 'flaeche_m2', '')::numeric, flaeche_m2)
       where id = v_plan;
    else
      perform beweidung_abschnitt_planen(v_b, x, v_datum, v_b.bis, 0);
    end if;
  end loop;
  perform beweidung_reihenfolge(p_id);
end $$;

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
  delete from beweidung_felder where beweidung_id = p_id and von is null;
  update beweidung_felder set bis = p_datum where beweidung_id = p_id and (bis is null or bis > p_datum);
  update beweidungen set bis = p_datum where id = p_id;
end $$;

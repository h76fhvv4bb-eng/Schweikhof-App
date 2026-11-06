-- =====================================================================
-- Hofmanager – fehlende fehlende Migrationen ab 18 nachholen (29 separat)
-- Einspielen: Supabase › SQL Editor › gesamten Inhalt einfügen › Run
-- Bereits eingespielte Migrationen werden übersprungen. Bei einem Fehler wird nichts geändert.
-- Am Schluss zeigt eine Tabelle, welche Migrationen jetzt vorhanden sind.
-- (Automatisch erzeugt mit scripts/nachholen_erstellen.py)
-- =====================================================================
do $nachholen$
begin
  if not (to_regclass('public.beweidungen') is not null) then
    raise notice 'Spiele Migration 18 ein (20261102000018_betrieb_weide.sql)';
    execute $m18$
-- =====================================================================
-- Migration 18: Betriebsverwaltung (weitere Angaben) und Weidegäste
-- (Tiere anderer Betriebe weiden auf eigenen Feldern: Partner, Zeitraum, Felder, Weidezins)
-- =====================================================================

-- Weitere Betriebsangaben
alter table public.betriebe add column if not exists bewirtschafter text check (bewirtschafter is null or length(bewirtschafter) <= 120);
alter table public.betriebe add column if not exists gemeinde text check (gemeinde is null or length(gemeinde) <= 80);
alter table public.betriebe add column if not exists bank text check (bank is null or length(bank) <= 120);
alter table public.betriebe add column if not exists website text check (website is null or length(website) <= 200);

-- Partnerart «Tierhalter» (Weidegast)
alter table public.partner drop constraint if exists partner_art_check;
alter table public.partner add constraint partner_art_check check (art in (
  'Lohnunternehmen', 'Mechaniker/Werkstatt', 'Händler/Lieferant', 'Berater',
  'Abnehmer/Käufer', 'Tierhalter', 'Behörde/Kontrolle', 'Andere'));

-- ---------------------------------------------------------------------
-- Weidegäste
-- ---------------------------------------------------------------------
create table public.beweidungen (
  id            uuid primary key default gen_random_uuid(),
  betrieb_id    uuid not null references public.betriebe (id),
  partner_id    uuid not null references public.partner (id),
  tierart       text not null check (length(trim(tierart)) between 1 and 60),
  anzahl        integer not null check (anzahl between 1 and 100000),
  gve           numeric(9, 2) check (gve is null or gve >= 0),
  von           date not null,
  bis           date,
  entgelt_art   text not null default 'keins'
                check (entgelt_art in ('keins', 'pauschal', 'je Tier und Tag', 'je GVE und Tag', 'je ha')),
  entgelt_satz  numeric(10, 2) check (entgelt_satz is null or entgelt_satz >= 0),
  verkauf_id    uuid references public.verkaeufe (id) on delete set null,
  bemerkungen   text check (bemerkungen is null or length(bemerkungen) <= 2000),
  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz not null default now(),
  version       integer not null default 1,
  constraint beweidung_zeitraum check (bis is null or bis >= von)
);
create index on public.beweidungen (betrieb_id, von);
create index on public.beweidungen (partner_id);

create table public.beweidung_felder (
  beweidung_id uuid not null references public.beweidungen (id) on delete cascade,
  feld_id      uuid not null references public.felder (id) on delete cascade,
  betrieb_id   uuid not null references public.betriebe (id),
  flaeche_m2   numeric(12, 1) not null check (flaeche_m2 > 0),
  primary key (beweidung_id, feld_id)
);
create index on public.beweidung_felder (feld_id);

create trigger a_version before update on public.beweidungen for each row execute function public.pruefe_version();
create trigger b_metadaten before insert or update on public.beweidungen for each row execute function public.setze_metadaten();
create trigger z_protokoll after insert or update or delete on public.beweidungen for each row execute function public.protokolliere();

alter table public.beweidungen enable row level security;
alter table public.beweidung_felder enable row level security;
create policy bw_lesen on public.beweidungen for select using (betrieb_id = public.mein_betrieb());
-- Ändern nur über die Funktionen unten; ausser der Verknüpfung mit dem Beleg
create policy bw_aendern on public.beweidungen for update using (betrieb_id = public.mein_betrieb() and public.darf_verwalten())
  with check (betrieb_id = public.mein_betrieb()
              and (verkauf_id is null or exists (select 1 from public.verkaeufe v where v.id = verkauf_id and v.betrieb_id = public.mein_betrieb())));
create policy bwf_lesen on public.beweidung_felder for select using (betrieb_id = public.mein_betrieb());
grant select, update (verkauf_id) on public.beweidungen to authenticated;
grant select on public.beweidung_felder to authenticated;

-- Speichern mit Feldern in einem Schritt
create or replace function public.beweidung_speichern(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  v_id      uuid := nullif(p ->> 'id', '')::uuid;
  v_von     date := nullif(p ->> 'von', '')::date;
  v_bis     date := nullif(p ->> 'bis', '')::date;
  v_art     text := coalesce(nullif(p ->> 'entgelt_art', ''), 'keins');
  v_feld    felder%rowtype;
  v_m2      numeric;
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
    returning id into v_id;
  else
    update beweidungen set
      partner_id = (p ->> 'partner_id')::uuid, tierart = trim(p ->> 'tierart'), anzahl = (p ->> 'anzahl')::int,
      gve = nullif(p ->> 'gve', '')::numeric, von = v_von, bis = v_bis, entgelt_art = v_art,
      entgelt_satz = case when v_art = 'keins' then null else (p ->> 'entgelt_satz')::numeric end,
      bemerkungen = nullif(trim(p ->> 'bemerkungen'), ''),
      version = coalesce((p ->> 'version')::int, version)
    where id = v_id and betrieb_id = v_betrieb;
    if not found then raise exception 'Weide-Eintrag nicht gefunden'; end if;
    delete from beweidung_felder where beweidung_id = v_id;
  end if;

  for x in select * from jsonb_array_elements(p -> 'felder') loop
    select * into v_feld from felder where id = (x ->> 'feld_id')::uuid and betrieb_id = v_betrieb and geloescht_am is null;
    if not found then raise exception 'Unbekanntes Feld'; end if;
    v_m2 := coalesce(nullif(x ->> 'flaeche_m2', '')::numeric, v_feld.flaeche_m2);
    if v_m2 <= 0 or v_m2 > v_feld.flaeche_m2 * 1.001 then
      raise exception 'Weidefläche auf «%» ist grösser als das Feld', v_feld.name;
    end if;
    insert into beweidung_felder (beweidung_id, feld_id, betrieb_id, flaeche_m2) values (v_id, v_feld.id, v_betrieb, v_m2)
    on conflict (beweidung_id, feld_id) do update set flaeche_m2 = excluded.flaeche_m2;
  end loop;
  return v_id;
end $$;

create or replace function public.beweidung_loeschen(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  delete from beweidungen where id = p_id and betrieb_id = mein_betrieb();
  if not found then raise exception 'Weide-Eintrag nicht gefunden'; end if;
end $$;

revoke all on function public.beweidung_speichern(jsonb) from public, anon;
revoke all on function public.beweidung_loeschen(uuid) from public, anon;
grant execute on function public.beweidung_speichern(jsonb) to authenticated;
grant execute on function public.beweidung_loeschen(uuid) to authenticated;

$m18$;
  end if;
  if not (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'beweidung_felder' and column_name = 'von')) then
    raise notice 'Spiele Migration 19 ein (20261102000019_weide_umtrieb.sql)';
    execute $m19$
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

$m19$;
  end if;
  if not (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'partner' and column_name = 'rollen')) then
    raise notice 'Spiele Migration 20 ein (20261102000020_partner_rollen.sql)';
    execute $m20$
-- =====================================================================
-- Migration 20: Ein Partner kann mehrere Rollen haben
-- (z. B. Lohnunternehmen und Abnehmer, oder Tierhalter und Händler).
-- «art» bleibt als Hauptrolle erhalten (erste Rolle) und wird automatisch nachgeführt.
-- =====================================================================

alter table public.partner add column if not exists rollen text[];
update public.partner set rollen = array[art] where rollen is null or cardinality(rollen) = 0;
alter table public.partner alter column rollen set default '{}';
alter table public.partner alter column rollen set not null;
alter table public.partner drop constraint if exists partner_rollen_check;
alter table public.partner add constraint partner_rollen_check check (
  cardinality(rollen) >= 1
  and rollen <@ array['Lohnunternehmen', 'Mechaniker/Werkstatt', 'Händler/Lieferant', 'Berater',
                      'Abnehmer/Käufer', 'Tierhalter', 'Behörde/Kontrolle', 'Andere']::text[]);
create index if not exists partner_rollen on public.partner using gin (rollen);

create or replace function public.partner_rollen_nachfuehren() returns trigger
language plpgsql as $$
begin
  -- doppelte entfernen, Reihenfolge behalten
  if new.rollen is not null then
    new.rollen := array(select r from unnest(new.rollen) with ordinality u(r, i) group by r order by min(i));
  end if;
  if tg_op = 'INSERT' then
    if new.rollen is null or cardinality(new.rollen) = 0 then new.rollen := array[new.art]; end if;
    new.art := new.rollen[1];
  elsif new.rollen is distinct from old.rollen then
    if new.rollen is null or cardinality(new.rollen) = 0 then new.rollen := array[new.art]; end if;
    new.art := new.rollen[1];
  elsif new.art is distinct from old.art and not (new.art = any(new.rollen)) then
    -- nur die Hauptrolle geändert (ältere App-Version): an den Anfang stellen
    new.rollen := array[new.art] || new.rollen;
  end if;
  return new;
end $$;

drop trigger if exists c_rollen on public.partner;
create trigger c_rollen before insert or update on public.partner for each row execute function public.partner_rollen_nachfuehren();

$m20$;
  end if;
  if not (to_regclass('public.feldarbeit_geraete') is not null) then
    raise notice 'Spiele Migration 21 ein (20261102000021_mehrere_geraete.sql)';
    execute $m21$
-- =====================================================================
-- Migration 21: Mehrere Geräte pro Arbeit (z. B. Traktor mit Kreiselegge und Sämaschine,
-- Front- und Heckmähwerk). «geraet_id» bleibt das erste Gerät und wird nachgeführt.
-- =====================================================================

create table public.feldarbeit_geraete (
  feldarbeit_id uuid not null references public.feldarbeiten (id) on delete cascade,
  maschine_id   uuid not null references public.maschinen (id),
  betrieb_id    uuid not null references public.betriebe (id),
  position      integer not null default 0,
  primary key (feldarbeit_id, maschine_id)
);
create index on public.feldarbeit_geraete (maschine_id);

alter table public.feldarbeit_geraete enable row level security;
create policy fag_lesen on public.feldarbeit_geraete for select using (betrieb_id = public.mein_betrieb());
grant select on public.feldarbeit_geraete to authenticated;

-- bisherige Geräte übernehmen
insert into public.feldarbeit_geraete (feldarbeit_id, maschine_id, betrieb_id, position)
select id, geraet_id, betrieb_id, 0 from public.feldarbeiten where geraet_id is not null
on conflict do nothing;

-- Wird «geraet_id» auf anderem Weg gesetzt (ältere App, Auftrag), bleibt die Liste stimmig
create or replace function public.feldarbeit_geraet_nachfuehren() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.geraet_id is not null and new.geraet_id is distinct from old.geraet_id then
    delete from feldarbeit_geraete where feldarbeit_id = new.id and maschine_id = old.geraet_id;
  end if;
  if new.geraet_id is not null and not exists (select 1 from feldarbeit_geraete where feldarbeit_id = new.id and maschine_id = new.geraet_id) then
    insert into feldarbeit_geraete (feldarbeit_id, maschine_id, betrieb_id, position)
    values (new.id, new.geraet_id, new.betrieb_id,
            coalesce((select min(position) from feldarbeit_geraete where feldarbeit_id = new.id), 1) - 1);
  end if;
  return null;
end $$;
create trigger z_geraete after insert or update of geraet_id on public.feldarbeiten
  for each row execute function public.feldarbeit_geraet_nachfuehren();

-- Speichert eine Arbeit wie feldarbeit_speichern und setzt alle Geräte (p.geraete: Liste von Maschinen-IDs)
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
  return v_id;
end $$;

revoke all on function public.feldarbeit_speichern_geraete(jsonb) from public, anon;
grant execute on function public.feldarbeit_speichern_geraete(jsonb) to authenticated;
revoke all on function public.feldarbeit_geraet_nachfuehren() from public, anon, authenticated;

$m21$;
  end if;
  if not (to_regprocedure('public.saat_uebernehmen(uuid)') is not null) then
    raise notice 'Spiele Migration 22 ein (20261102000022_saat_uebernehmen.sql)';
    execute $m22$
-- =====================================================================
-- Migration 22: Saat aus der Kartei in die Fruchtfolge übernehmen
-- Wird «Säen» erledigt, bekommt die passende geplante Kultur des Feldes das echte Saatdatum und den Status «ist».
-- Die bisher wachsende Kultur endet (Umbruch) am Vortag, ausser bei Untersaaten.
-- So zeigt die App nach der Saat die neue Kultur als aktuelle Frucht (z. B. Kunstwiese im Herbst fürs nächste Jahr).
-- =====================================================================

create or replace function public.saat_uebernehmen(p_feldarbeit uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_fa    feldarbeiten%rowtype;
  v_ff    record;
  v_ziel  anbau%rowtype;
begin
  select * into v_fa from feldarbeiten where id = p_feldarbeit;
  if not found or v_fa.arbeitsart <> 'Säen' or v_fa.status <> 'erledigt' or v_fa.geloescht_am is not null then return; end if;

  for v_ff in select * from feldarbeit_felder where feldarbeit_id = p_feldarbeit loop
    v_ziel := null;
    -- 1) Kultur mit Saattermin in der Nähe (± 60 Tage), die nächstgelegene
    select a.* into v_ziel from anbau a
     where a.feld_id = v_ff.feld_id and a.saatdatum is not null
       and abs((case when a.nur_monat then date_trunc('month', a.saatdatum)::date else a.saatdatum end) - v_fa.datum) <= 60
     order by (a.status = 'geplant') desc,
              abs((case when a.nur_monat then date_trunc('month', a.saatdatum)::date else a.saatdatum end) - v_fa.datum)
     limit 1;
    -- 2) sonst die geplante Hauptkultur ohne Saattermin: ab Juli fürs nächste Jahr (Herbstsaat), sonst fürs laufende
    if v_ziel.id is null then
      select a.* into v_ziel from anbau a
       where a.feld_id = v_ff.feld_id and a.art = 'Hauptkultur' and a.saatdatum is null and a.status = 'geplant'
         and a.jahr = extract(year from v_fa.datum)::int + case when extract(month from v_fa.datum) >= 7 then 1 else 0 end
       limit 1;
    end if;
    continue when v_ziel.id is null;

    update anbau set saatdatum = v_fa.datum, nur_monat = false, status = 'ist',
                     erntedatum = case when erntedatum is not null and erntedatum < v_fa.datum then null else erntedatum end
     where id = v_ziel.id;
    update feldarbeit_felder set anbau_id = v_ziel.id where feldarbeit_id = p_feldarbeit and feld_id = v_ff.feld_id and anbau_id is distinct from v_ziel.id;

    -- bisherige Kultur endet (nicht bei Untersaat, die in die bestehende Kultur gesät wird)
    if v_ziel.art <> 'Untersaat' then
      update anbau a set erntedatum = v_fa.datum - 1
       where a.feld_id = v_ff.feld_id and a.id <> v_ziel.id and a.art <> 'Untersaat'
         and a.saatdatum is not null and a.saatdatum < v_fa.datum
         and (a.erntedatum is null or a.erntedatum >= v_fa.datum)
         and a.jahr <= v_ziel.jahr;
    end if;
  end loop;
end $$;
revoke all on function public.saat_uebernehmen(uuid) from public, anon, authenticated;

create or replace function public.saat_trigger_felder() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  perform saat_uebernehmen(new.feldarbeit_id);
  return null;
end $$;
create or replace function public.saat_trigger_arbeit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if new.arbeitsart = 'Säen' and new.status = 'erledigt' and (old.status is distinct from new.status or old.datum is distinct from new.datum) then
    perform saat_uebernehmen(new.id);
  end if;
  return null;
end $$;
revoke all on function public.saat_trigger_felder() from public, anon, authenticated;
revoke all on function public.saat_trigger_arbeit() from public, anon, authenticated;

drop trigger if exists z_saat on public.feldarbeit_felder;
create trigger z_saat after insert on public.feldarbeit_felder for each row execute function public.saat_trigger_felder();
drop trigger if exists z_saat on public.feldarbeiten;
create trigger z_saat after update of status, datum on public.feldarbeiten for each row execute function public.saat_trigger_arbeit();

$m22$;
  end if;
  if not (to_regclass('public.richtpreise') is not null) then
    raise notice 'Spiele Migration 23 ein (20261102000023_richtpreise.sql)';
    execute $m23$
-- =====================================================================
-- Migration 23: Richtpreise (Maschinen, Dienstleistungen, Futter, Arbeit)
-- Eigener Preiskatalog des Betriebs: aus Vorlagen übernommen (mit Quelle und Jahr) oder selbst erfasst.
-- Wird bei Rechnungen, Ernte-Dienstleistern und Abgaben als Vorschlag genutzt.
-- =====================================================================

create table public.richtpreise (
  id            uuid primary key default gen_random_uuid(),
  betrieb_id    uuid not null references public.betriebe (id),
  bereich       text not null check (bereich in ('Maschine', 'Dienstleistung', 'Futter', 'Arbeit', 'Andere')),
  bezeichnung   text not null check (length(trim(bezeichnung)) between 1 and 160),
  einheit       text not null check (length(trim(einheit)) between 1 and 20),
  preis_chf     numeric(10, 2) not null check (preis_chf >= 0),
  quelle        text check (quelle is null or length(quelle) <= 160),
  jahr          integer check (jahr is null or jahr between 1990 and 2100),
  bemerkung     text check (bemerkung is null or length(bemerkung) <= 500),
  aktiv         boolean not null default true,
  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz not null default now(),
  version       integer not null default 1,
  constraint richtpreis_eindeutig unique (betrieb_id, bereich, bezeichnung, einheit)
);
create trigger a_version before update on public.richtpreise for each row execute function public.pruefe_version();
create trigger b_metadaten before insert or update on public.richtpreise for each row execute function public.setze_metadaten();
create trigger z_protokoll after insert or update or delete on public.richtpreise for each row execute function public.protokolliere();

alter table public.richtpreise enable row level security;
create policy rp_lesen    on public.richtpreise for select using (betrieb_id = public.mein_betrieb());
create policy rp_neu      on public.richtpreise for insert with check (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
create policy rp_aendern  on public.richtpreise for update using (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
create policy rp_loeschen on public.richtpreise for delete using (betrieb_id = public.mein_betrieb() and public.darf_verwalten());
grant select, insert, update, delete on public.richtpreise to authenticated;

-- Ansatz einer eigenen Maschine (z. B. für Arbeiten bei Nachbarn)
alter table public.maschinen add column if not exists richtpreis_id uuid references public.richtpreise (id) on delete set null;

-- Viele Preise auf einmal übernehmen (Vorlage oder CSV): vorhandene gleicher Bezeichnung/Einheit werden aktualisiert
create or replace function public.richtpreise_importieren(p jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_betrieb uuid := mein_betrieb();
  x jsonb;
  n int := 0;
begin
  if v_betrieb is null or not darf_verwalten() then raise exception 'Keine Berechtigung'; end if;
  for x in select * from jsonb_array_elements(coalesce(p -> 'preise', '[]')) loop
    if coalesce(trim(x ->> 'bezeichnung'), '') = '' or coalesce(trim(x ->> 'einheit'), '') = '' or (x ->> 'preis_chf') is null then
      raise exception 'Zeile % unvollständig (Bezeichnung, Einheit und Preis nötig)', n + 1;
    end if;
    insert into richtpreise (betrieb_id, bereich, bezeichnung, einheit, preis_chf, quelle, jahr, bemerkung)
    values (v_betrieb, coalesce(nullif(x ->> 'bereich', ''), 'Andere'), trim(x ->> 'bezeichnung'), trim(x ->> 'einheit'),
            (x ->> 'preis_chf')::numeric, nullif(trim(x ->> 'quelle'), ''), nullif(x ->> 'jahr', '')::int, nullif(trim(x ->> 'bemerkung'), ''))
    on conflict (betrieb_id, bereich, bezeichnung, einheit) do update
      set preis_chf = excluded.preis_chf, quelle = excluded.quelle, jahr = excluded.jahr,
          bemerkung = coalesce(excluded.bemerkung, richtpreise.bemerkung), aktiv = true;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.richtpreise_importieren(jsonb) from public, anon;
grant execute on function public.richtpreise_importieren(jsonb) to authenticated;

$m23$;
  end if;
  if not (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'auftraege' and column_name = 'abrechnung')) then
    raise notice 'Spiele Migration 24 ein (20261102000024_lohnarbeit_abrechnung.sql)';
    execute $m24$
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

$m24$;
  end if;
  if not (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'felder' and column_name = 'bff_typ')) then
    raise notice 'Spiele Migration 25 ein (20261102000025_bff.sql)';
    execute $m25$
-- =====================================================================
-- Migration 25: Biodiversitätsförderflächen (BFF, «öko») je Feld und Zone des Betriebs
-- Grundlage für Hinweise zu Schnittzeitpunkt und Düngung. Die App warnt nur; massgebend sind DZV,
-- kantonale Vorgaben und Vereinbarungen (z. B. Vernetzungsprojekt).
-- =====================================================================

alter table public.betriebe add column if not exists zone text
  check (zone is null or zone in ('Talzone', 'Hügelzone', 'Bergzone I', 'Bergzone II', 'Bergzone III', 'Bergzone IV'));

alter table public.felder add column if not exists bff_typ text check (bff_typ is null or bff_typ in (
  'Extensiv genutzte Wiese', 'Wenig intensiv genutzte Wiese', 'Extensiv genutzte Weide', 'Waldweide', 'Streuefläche', 'Uferwiese',
  'Hecke mit Krautsaum', 'Buntbrache', 'Rotationsbrache', 'Saum auf Ackerfläche', 'Andere BFF'));
alter table public.felder add column if not exists bff_qualitaet smallint check (bff_qualitaet is null or bff_qualitaet in (1, 2));
alter table public.felder add column if not exists bff_vernetzung boolean not null default false;
-- abweichender frühester Schnitt (Vernetzungsprojekt, Vereinbarung), als Monat-Tag
alter table public.felder add column if not exists schnitt_ab text check (schnitt_ab is null or schnitt_ab ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');

$m25$;
  end if;
  if not (to_regprocedure('public.lagerartikel_loeschen(uuid[])') is not null) then
    raise notice 'Spiele Migration 26 ein (20261102000026_artikel_loeschen.sql)';
    execute $m26$
-- =====================================================================
-- Hofmanager – Migration 26: Lagerartikel löschen
-- Einspielen: Supabase › SQL Editor › gesamten Inhalt einfügen › Run
--
-- Artikel ohne Bestand können gelöscht werden (einzeln oder mehrere auf einmal):
--  • nie verwendet → wird ganz gelöscht
--  • schon in Buchungen, Feldarbeiten, Aufträgen, Verkäufen oder Reparaturen verwendet → wird ausgeblendet,
--    damit diese Einträge vollständig bleiben
--  • Artikel mit Bestand bleiben stehen (zuerst ausbuchen bzw. Inventur auf 0)
-- Zuordnungen zu Maschinen (Ersatzteile) werden in beiden Fällen entfernt.
-- =====================================================================

create or replace function public.lagerartikel_loeschen(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  v_geloescht int := 0;
  v_ausgeblendet int := 0;
  v_behalten text[] := '{}';
begin
  if not public.darf_verwalten() then
    raise exception 'Keine Berechtigung';
  end if;

  for a in
    select l.id, l.bezeichnung, l.lagerfuehrung, l.einheit, coalesce((select sum(b.menge) from lagerbewegungen b where b.artikel_id = l.id), 0) as bestand
      from lagerartikel l
     where l.id = any (p_ids) and l.betrieb_id = public.mein_betrieb() and l.aktiv
  loop
    if a.lagerfuehrung and a.bestand <> 0 then
      v_behalten := v_behalten || (a.bezeichnung || ' (' || trim(to_char(a.bestand, 'FM999999990.###')) || ' ' || a.einheit || ')');
      continue;
    end if;

    delete from maschine_teile where artikel_id = a.id;
    update ernte_abnehmer set lagerartikel_id = null where lagerartikel_id = a.id;

    if exists (select 1 from lagerbewegungen where artikel_id = a.id)
       or exists (select 1 from feldarbeit_mittel where artikel_id = a.id)
       or exists (select 1 from verkauf_positionen where artikel_id = a.id)
       or exists (select 1 from eintrag_teile where artikel_id = a.id)
       or exists (select 1 from auftrag_mittel where artikel_id = a.id) then
      update lagerartikel set aktiv = false, version = version where id = a.id;
      v_ausgeblendet := v_ausgeblendet + 1;
    else
      delete from lagerartikel where id = a.id;
      v_geloescht := v_geloescht + 1;
    end if;
  end loop;

  return jsonb_build_object('geloescht', v_geloescht, 'ausgeblendet', v_ausgeblendet, 'behalten', to_jsonb(v_behalten));
end;
$$;

revoke all on function public.lagerartikel_loeschen(uuid[]) from public, anon;
grant execute on function public.lagerartikel_loeschen(uuid[]) to authenticated;

$m26$;
  end if;
  if not (to_regclass('public.geraete_einsaetze') is not null) then
    raise notice 'Spiele Migration 27 ein (20261102000027_externe_geraete.sql)';
    execute $m27$
-- =====================================================================
-- Hofmanager – Migration 27: Externe Geräte (gemietet oder geliehen)
-- Einspielen: Supabase › SQL Editor › gesamten Inhalt einfügen › Run
--
-- Eine Maschine kann einem Partner gehören (z. B. regelmässig gemietete Sämaschine).
-- Mit Mietpreis und Abrechnungsart werden die Mietkosten aus den erledigten Feldarbeiten berechnet.
-- =====================================================================

alter table public.maschinen add column if not exists eigentum text not null default 'eigen';
alter table public.maschinen drop constraint if exists maschinen_eigentum_check;
alter table public.maschinen add constraint maschinen_eigentum_check check (eigentum in ('eigen', 'gemietet', 'geliehen'));
alter table public.maschinen add column if not exists partner_id uuid references public.partner (id) on delete set null;
alter table public.maschinen add column if not exists miet_abrechnung text;
alter table public.maschinen drop constraint if exists maschinen_miet_abrechnung_check;
alter table public.maschinen add constraint maschinen_miet_abrechnung_check
  check (miet_abrechnung is null or miet_abrechnung in ('Hektare', 'Stunde', 'Tag', 'Einsatz'));
alter table public.maschinen add column if not exists mietpreis numeric(10, 2) check (mietpreis >= 0);
create index if not exists maschinen_partner on public.maschinen (partner_id) where partner_id is not null;

-- Partnerrolle «Maschinenvermieter»
alter table public.partner drop constraint if exists partner_art_check;
alter table public.partner add constraint partner_art_check check (art in (
  'Lohnunternehmen', 'Mechaniker/Werkstatt', 'Händler/Lieferant', 'Maschinenvermieter', 'Berater',
  'Abnehmer/Käufer', 'Tierhalter', 'Behörde/Kontrolle', 'Andere'));
alter table public.partner drop constraint if exists partner_rollen_check;
alter table public.partner add constraint partner_rollen_check check (
  cardinality(rollen) >= 1
  and rollen <@ array['Lohnunternehmen', 'Mechaniker/Werkstatt', 'Händler/Lieferant', 'Maschinenvermieter', 'Berater',
                      'Abnehmer/Käufer', 'Tierhalter', 'Behörde/Kontrolle', 'Andere']::text[]);

-- ---------------------------------------------------------------------
-- Einsätze externer Geräte mit Mietkosten (nur erledigte Feldarbeiten)
-- Abrechnung je Tag: der Tagespreis wird auf die Arbeiten dieses Tages verteilt.
-- ---------------------------------------------------------------------
create or replace view public.geraete_einsaetze with (security_invoker = true) as
with einsatz as (
  select distinct fa.id as feldarbeit_id, m.id as maschine_id
    from public.feldarbeiten fa
    join public.maschinen m on m.eigentum <> 'eigen'
     and (m.id = fa.maschine_id or m.id = fa.geraet_id
          or exists (select 1 from public.feldarbeit_geraete g where g.feldarbeit_id = fa.id and g.maschine_id = m.id))
   where fa.status = 'erledigt' and fa.geloescht_am is null
), mit_flaeche as (
  select e.maschine_id, e.feldarbeit_id, fa.datum, fa.arbeitsart, fa.dauer_h,
         coalesce((select sum(ff.flaeche_m2) from public.feldarbeit_felder ff where ff.feldarbeit_id = fa.id), 0) / 10000.0 as flaeche_ha,
         (select string_agg(f.name, ', ' order by f.name) from public.feldarbeit_felder ff join public.felder f on f.id = ff.feld_id
           where ff.feldarbeit_id = fa.id) as felder,
         count(*) over (partition by e.maschine_id, fa.datum) as arbeiten_am_tag
    from einsatz e join public.feldarbeiten fa on fa.id = e.feldarbeit_id
)
select x.maschine_id, m.betrieb_id, m.name as maschine, m.eigentum, m.partner_id, x.feldarbeit_id, x.datum, x.arbeitsart, x.felder,
       round(x.flaeche_ha::numeric, 2) as flaeche_ha, x.dauer_h, m.miet_abrechnung, m.mietpreis,
       case when m.eigentum = 'geliehen' or m.mietpreis is null or m.miet_abrechnung is null then null
            when m.miet_abrechnung = 'Hektare' then round(x.flaeche_ha::numeric * m.mietpreis, 2)
            when m.miet_abrechnung = 'Stunde' then case when x.dauer_h is null then null else round(x.dauer_h * m.mietpreis, 2) end
            when m.miet_abrechnung = 'Tag' then round(m.mietpreis / x.arbeiten_am_tag, 2)
            else m.mietpreis end as kosten_chf
  from mit_flaeche x join public.maschinen m on m.id = x.maschine_id;

grant select on public.geraete_einsaetze to authenticated;

$m27$;
  end if;
  if not (exists (select 1 from pg_constraint where conname = 'feldarbeiten_arbeitsart_check' and pg_get_constraintdef(oid) like '%Wiesenegge%')) then
    raise notice 'Spiele Migration 28 ein (20261102000028_arbeitsarten_gruppen.sql)';
    execute $m28$
-- =====================================================================
-- Hofmanager – Migration 28: Arbeitsarten «Wiesenegge» und «Stoppelsturz»
-- Einspielen: Supabase › SQL Editor › gesamten Inhalt einfügen › Run
--
-- Die App ordnet die Arbeiten neu in Gruppen (Bodenbearbeitung, Saat, Düngung, Pflanzenschutz, Pflege, Ernte).
-- Bisher als «Eggen» mit Bemerkung «Wiesenegge» bzw. «Grubbern» mit Bemerkung «Stoppelsturz» erfasste Arbeiten
-- werden auf die neuen Arbeitsarten umgestellt.
-- =====================================================================

alter table public.feldarbeiten drop constraint if exists feldarbeiten_arbeitsart_check;
alter table public.feldarbeiten add constraint feldarbeiten_arbeitsart_check check (arbeitsart in (
  'Pflügen', 'Grubbern', 'Eggen', 'Stoppelsturz', 'Säen', 'Walzen', 'Düngen', 'Pflanzenschutz',
  'Mähen', 'Zetten', 'Wenden', 'Schwaden', 'Pressen', 'Ernten', 'Mulchen', 'Wiesenegge', 'Hacken', 'Striegeln', 'Andere'));

update public.feldarbeiten set arbeitsart = 'Wiesenegge', bemerkungen = null, version = version
 where arbeitsart = 'Eggen' and lower(trim(bemerkungen)) = 'wiesenegge';
update public.feldarbeiten set arbeitsart = 'Stoppelsturz', bemerkungen = null, version = version
 where arbeitsart = 'Grubbern' and lower(trim(bemerkungen)) = 'stoppelsturz';

$m28$;
  end if;
  if not (to_regprocedure('public.beweidung_reihenfolge(uuid)') is not null) then
    raise notice 'Spiele Migration 30 ein (20261102000030_weide_reihenfolge.sql)';
    execute $m30$
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

$m30$;
  end if;
  if not (to_regclass('public.digiflux_lieferungen') is not null) then
    raise notice 'Spiele Migration 31 ein (20261102000031_digiflux.sql)';
    execute $m31$
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

$m31$;
  end if;
end $nachholen$;

select n as migration, case when ok then 'vorhanden' else 'FEHLT' end as status from (values
  (18, to_regclass('public.beweidungen') is not null),
  (19, exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'beweidung_felder' and column_name = 'von')),
  (20, exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'partner' and column_name = 'rollen')),
  (21, to_regclass('public.feldarbeit_geraete') is not null),
  (22, to_regprocedure('public.saat_uebernehmen(uuid)') is not null),
  (23, to_regclass('public.richtpreise') is not null),
  (24, exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'auftraege' and column_name = 'abrechnung')),
  (25, exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'felder' and column_name = 'bff_typ')),
  (26, to_regprocedure('public.lagerartikel_loeschen(uuid[])') is not null),
  (27, to_regclass('public.geraete_einsaetze') is not null),
  (28, exists (select 1 from pg_constraint where conname = 'feldarbeiten_arbeitsart_check' and pg_get_constraintdef(oid) like '%Wiesenegge%')),
  (30, to_regprocedure('public.beweidung_reihenfolge(uuid)') is not null),
  (31, to_regclass('public.digiflux_lieferungen') is not null)
) x(n, ok) order by n;

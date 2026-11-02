-- =====================================================================
-- Hofmanager SchweikFarm – Migration 6: Benutzerverwaltung (Einladungen, Rollen)
-- Einspielen: Supabase › SQL Editor › gesamten Inhalt einfügen › Run
-- Voraussetzung: Migrationen 1–5 sind eingespielt.
-- =====================================================================

-- Einladungen: Der Administrator lädt eine E-Mail-Adresse mit einer Rolle ein.
-- Wer sich mit dieser (bestätigten) Adresse registriert, wird beim ersten Anmelden dem Betrieb zugeordnet.
create table public.einladungen (
  id             uuid primary key default gen_random_uuid(),
  betrieb_id     uuid not null references public.betriebe (id),
  email          text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name           text,
  rolle          public.rolle not null default 'mitarbeiter',
  erstellt_von   uuid default auth.uid(),
  erstellt_am    timestamptz not null default now(),
  angenommen_am  timestamptz,
  angenommen_von uuid references auth.users (id),
  widerrufen     boolean not null default false
);
create unique index einladung_offen on public.einladungen (betrieb_id, lower(email)) where angenommen_am is null and not widerrufen;
create trigger z_protokoll after insert or update or delete on public.einladungen for each row execute function public.protokolliere();

alter table public.einladungen enable row level security;
create policy ei_lesen   on public.einladungen for select using (betrieb_id = public.mein_betrieb() and public.meine_rolle() = 'administrator');
create policy ei_neu     on public.einladungen for insert with check (betrieb_id = public.mein_betrieb() and public.meine_rolle() = 'administrator'
                                                                       and angenommen_am is null and not widerrufen);
create policy ei_aendern on public.einladungen for update using (betrieb_id = public.mein_betrieb() and public.meine_rolle() = 'administrator');
grant select, insert, update on public.einladungen to authenticated;

-- Gibt es schon einen Betrieb? (für den Bildschirm nach der ersten Anmeldung)
create or replace function public.betrieb_vorhanden() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from betriebe)
$$;

-- Einladung annehmen: ordnet das angemeldete Konto anhand der bestätigten E-Mail dem Betrieb zu.
create or replace function public.einladung_annehmen() returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_e     einladungen%rowtype;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  if exists (select 1 from benutzer_profile where id = auth.uid()) then raise exception 'Dieses Konto ist bereits einem Betrieb zugeordnet'; end if;
  select lower(email) into v_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if v_email is null then raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen'; end if;
  select * into v_e from einladungen
   where lower(email) = v_email and angenommen_am is null and not widerrufen
   order by erstellt_am desc limit 1
   for update;
  if not found then raise exception 'Für % liegt keine Einladung vor. Bitte den Administrator fragen.', v_email; end if;
  insert into benutzer_profile (id, betrieb_id, name, rolle)
  values (auth.uid(), v_e.betrieb_id, coalesce(nullif(trim(v_e.name), ''), split_part(v_email, '@', 1)), v_e.rolle);
  update einladungen set angenommen_am = now(), angenommen_von = auth.uid() where id = v_e.id;
  return v_e.betrieb_id;
end $$;

-- Rolle ändern / deaktivieren (nur Administrator). Der letzte aktive Administrator bleibt immer erhalten.
create or replace function public.benutzer_aendern(p_id uuid, p_rolle public.rolle, p_aktiv boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_ziel benutzer_profile%rowtype;
begin
  if meine_rolle() is distinct from 'administrator' then raise exception 'Nur Administratoren können Benutzer verwalten'; end if;
  select * into v_ziel from benutzer_profile where id = p_id and betrieb_id = mein_betrieb() for update;
  if not found then raise exception 'Benutzer nicht gefunden'; end if;
  if v_ziel.rolle = 'administrator' and v_ziel.aktiv and (p_rolle <> 'administrator' or not p_aktiv)
     and (select count(*) from benutzer_profile where betrieb_id = v_ziel.betrieb_id and rolle = 'administrator' and aktiv) <= 1 then
    raise exception 'Es muss mindestens ein aktiver Administrator bleiben';
  end if;
  update benutzer_profile set rolle = p_rolle, aktiv = p_aktiv where id = p_id;
end $$;

-- Profile nur noch über benutzer_aendern ändern (schützt den letzten Administrator)
drop policy if exists profile_admin on public.benutzer_profile;

-- Eigenen Anzeigenamen ändern
create or replace function public.mein_name(p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Name fehlt'; end if;
  update benutzer_profile set name = trim(p_name) where id = auth.uid();
  if not found then raise exception 'Kein Profil gefunden'; end if;
end $$;

-- Aktivität je Benutzer (aus dem Änderungsprotokoll) – sichtbar für Administratoren und Betriebsleiter
create view public.benutzer_aktivitaet with (security_invoker = true) as
select benutzer_id, count(*) as aenderungen, max(zeitpunkt) as zuletzt
from public.aenderungsprotokoll
where benutzer_id is not null
group by benutzer_id;

revoke all on function public.einladung_annehmen(), public.benutzer_aendern(uuid, public.rolle, boolean),
  public.mein_name(text), public.betrieb_vorhanden() from public, anon;
grant execute on function public.einladung_annehmen(), public.benutzer_aendern(uuid, public.rolle, boolean),
  public.mein_name(text), public.betrieb_vorhanden() to authenticated;
grant select on public.benutzer_aktivitaet to authenticated;

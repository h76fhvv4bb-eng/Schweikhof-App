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

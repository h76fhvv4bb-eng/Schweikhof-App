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

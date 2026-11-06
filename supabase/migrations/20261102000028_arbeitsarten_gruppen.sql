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

-- =====================================================================
-- Hofmanager – Migration 29: Aktuelle Kultur aus erfassten Saaten nachführen
-- Einspielen: Supabase › SQL Editor › gesamten Inhalt einfügen › Run
--
-- Saaten, die erfasst wurden, bevor Migration 22 (Saat übernehmen) eingespielt war, haben die geplante Kultur
-- noch nicht als «gesät» markiert. Dadurch zeigten Karte und Aufträge noch die Hauptkultur (z. B. Winterweizen)
-- statt der bereits gesäten Folgekultur (z. B. Kunstwiese). Kann mehrfach ausgeführt werden.
-- =====================================================================

do $$
declare
  r record;
begin
  if to_regprocedure('public.saat_uebernehmen(uuid)') is null then
    raise exception 'Bitte zuerst Migration 22 bzw. die Datei «nachholen_ab_18.sql» einspielen.';
  end if;
  for r in
    select fa.id from public.feldarbeiten fa
     where fa.arbeitsart = 'Säen' and fa.status = 'erledigt' and fa.geloescht_am is null
       and fa.datum >= date_trunc('year', current_date) - interval '1 year'
       -- noch nicht übernommen: Feld ohne Kultur oder mit einer Kultur, die nicht an diesem Tag gesät wurde
       and exists (select 1 from public.feldarbeit_felder ff left join public.anbau a on a.id = ff.anbau_id
                    where ff.feldarbeit_id = fa.id and (a.id is null or a.saatdatum is distinct from fa.datum))
     order by fa.datum
  loop
    perform public.saat_uebernehmen(r.id);
  end loop;
end $$;

-- Übersicht: Felder mit Saat und der Kultur, die jetzt als gesät gilt
select f.feldnummer as nr, f.name as feld, to_char(fa.datum, 'DD.MM.YYYY') as saat, k.name as kultur, a.jahr as anbaujahr
  from public.feldarbeiten fa
  join public.feldarbeit_felder ff on ff.feldarbeit_id = fa.id
  join public.felder f on f.id = ff.feld_id
  left join public.anbau a on a.id = ff.anbau_id
  left join public.kulturen k on k.id = a.kultur_id
 where fa.arbeitsart = 'Säen' and fa.status = 'erledigt' and fa.geloescht_am is null
   and fa.datum >= date_trunc('year', current_date) - interval '1 year'
 order by fa.datum, f.feldnummer;

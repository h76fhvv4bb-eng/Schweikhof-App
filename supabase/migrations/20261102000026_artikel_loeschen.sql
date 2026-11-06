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

-- =====================================================================
-- Migration 12: Mehrere Ernten gemeinsam speichern (alles oder nichts)
-- p: {"ernten": [<gleicher Inhalt wie bei ernte_speichern>, …]}
-- =====================================================================
create or replace function public.ernten_speichern(p jsonb)
returns uuid[]
language plpgsql security definer set search_path = public as $$
declare
  x     jsonb;
  i     int := 0;
  ids   uuid[] := '{}';
  v_name text;
begin
  if jsonb_array_length(coalesce(p -> 'ernten', '[]')) = 0 then raise exception 'Keine Ernten zum Speichern'; end if;
  if jsonb_array_length(p -> 'ernten') > 100 then raise exception 'Höchstens 100 Ernten auf einmal'; end if;
  for x in select * from jsonb_array_elements(p -> 'ernten') loop
    i := i + 1;
    begin
      ids := ids || ernte_speichern(x);
    exception when others then
      select name into v_name from felder where id = nullif(x ->> 'feld_id', '')::uuid;
      raise exception 'Zeile % (%): %', i, coalesce(v_name, 'ohne Feld'), sqlerrm;
    end;
  end loop;
  return ids;
end $$;

revoke all on function public.ernten_speichern(jsonb) from public, anon;
grant execute on function public.ernten_speichern(jsonb) to authenticated;

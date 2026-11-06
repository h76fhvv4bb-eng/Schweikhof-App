"""Erzeugt supabase/nachholen_18_bis_28.sql: spielt jede fehlende Migration 18–28 nach (ein Block, alles oder nichts)."""
import glob, os
MERKMAL = {
    18: "to_regclass('public.beweidungen') is not null",
    19: "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'beweidung_felder' and column_name = 'von')",
    20: "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'partner' and column_name = 'rollen')",
    21: "to_regclass('public.feldarbeit_geraete') is not null",
    22: "to_regprocedure('public.saat_uebernehmen(uuid)') is not null",
    23: "to_regclass('public.richtpreise') is not null",
    24: "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'auftraege' and column_name = 'abrechnung')",
    25: "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'felder' and column_name = 'bff_typ')",
    26: "to_regprocedure('public.lagerartikel_loeschen(uuid[])') is not null",
    27: "to_regclass('public.geraete_einsaetze') is not null",
    28: "exists (select 1 from pg_constraint where conname = 'feldarbeiten_arbeitsart_check' and pg_get_constraintdef(oid) like '%Wiesenegge%')",
}
teile = ["""-- =====================================================================
-- Hofmanager – fehlende Migrationen 18 bis 28 nachholen
-- Einspielen: Supabase › SQL Editor › gesamten Inhalt einfügen › Run
-- Bereits eingespielte Migrationen werden übersprungen. Bei einem Fehler wird nichts geändert.
-- Am Schluss zeigt eine Tabelle, welche Migrationen jetzt vorhanden sind.
-- (Automatisch erzeugt mit scripts/nachholen_erstellen.py)
-- =====================================================================
do $nachholen$
begin"""]
for n, merkmal in MERKMAL.items():
    datei = glob.glob(f'supabase/migrations/202611020000{n:02d}_*.sql')[0]
    inhalt = open(datei, encoding='utf-8').read()
    tag = f'$m{n}$'
    assert tag not in inhalt
    teile.append(f"""  if not ({merkmal}) then
    raise notice 'Spiele Migration {n} ein ({os.path.basename(datei)})';
    execute {tag}
{inhalt}
{tag};
  end if;""")
teile.append("end $nachholen$;\n")
teile.append("select n as migration, case when ok then 'vorhanden' else 'FEHLT' end as status from (values\n" +
             ",\n".join(f"  ({n}, {m})" for n, m in MERKMAL.items()) + "\n) x(n, ok) order by n;\n")
open('supabase/nachholen_18_bis_28.sql', 'w', encoding='utf-8').write("\n".join(teile))

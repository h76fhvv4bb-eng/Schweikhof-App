#!/usr/bin/env python3
"""
Erzeugt aus dem Fruchtfolgerapport (Excel, Monatsraster 2023–2029) eine SQL-Importdatei
für Felder und Anbau (Haupt- und Zwischenkulturen mit Saat-/Erntemonat).

Aufruf:
  soffice --headless --convert-to csv:"Text - txt - csv (StarCalc)":44,34,76,1,,0,false,true,false,false,false,-1 Fruchtfolge.xls
  python3 scripts/fruchtfolge_import.py "Fruchtfolge-Anpassung 26.csv" > supabase/daten/import_fruchtfolge.sql
"""
import csv, sys

MEHRJAEHRIG = {'Kunstwiese', 'Buntbrache', 'Rotationsbrache', 'Kleegras', 'Naturwiese'}
ZWISCHEN = {'Gründüngung', 'Zwischenfutter'}
AKTUELL = 2026      # bis und mit diesem Jahr gilt der Anbau als «ist», danach «geplant»
BIS = 2029          # Planungshorizont der Tabelle

def lesen(pfad):
    rows = list(csv.reader(open(pfad, encoding='utf-8')))
    hdr = next(i for i, r in enumerate(rows) if r.count('1') >= 5 and 'Nr.' in r)
    col2ym, yi = {}, -1
    for c, v in enumerate(rows[hdr]):
        if v.isdigit() and c >= 20:
            if int(v) == 1:
                yi += 1
            col2ym[c] = (2023 + yi, int(v))
    start = min(col2ym)
    felder, i = [], hdr + 1
    while i < len(rows) - 1:
        r = rows[i]
        nr = r[1].strip() if len(r) > 1 else ''
        if nr and any(x.strip() for x in r[2:12]):
            werte = [v.strip() for c, v in enumerate(r) if v.strip() and 1 < c < start]
            phasen = [(col2ym[c], v.strip()) for c, v in enumerate(rows[i + 1]) if v.strip() and c in col2ym]
            felder.append({'nr': nr, 'name': werte[0], 'zahlen': [float(x) for x in werte[1:]], 'phasen': phasen})
            i += 2
        else:
            i += 1
    return felder

def anbau(phasen, tabellenstart=(2023, 1)):
    """Wandelt die Phasen (Start-Monat, Kultur) in Anbau-Einträge je Jahr um."""
    ergebnis = {}
    for k, ((y, m), kultur) in enumerate(phasen):
        ende = phasen[k + 1][0] if k + 1 < len(phasen) else None
        saat = None if (y, m) == tabellenstart else f'{y}-{m:02d}-01'
        ernte = f'{ende[0]}-{ende[1]:02d}-01' if ende else None
        if kultur in ZWISCHEN:
            jahr = y if m >= 7 else y - 1
            ergebnis[(jahr, 'Zwischenkultur')] = (kultur, saat, ernte)
        elif kultur in MEHRJAEHRIG:
            erstes = y if m <= 6 else y + 1
            letztes = (ende[0] if ende[1] >= 7 else ende[0] - 1) if ende else BIS
            for j in range(erstes, letztes + 1):
                ergebnis[(j, 'Hauptkultur')] = (kultur, saat if j == erstes else None, ernte if j == letztes else None)
        else:
            jahr = y + 1 if m >= 8 else y
            ergebnis[(jahr, 'Hauptkultur')] = (kultur, saat, ernte)
    return ergebnis

def sql_text(s):
    return "null" if s is None else "'" + str(s).replace("'", "''") + "'"

def main(pfad):
    felder = lesen(pfad)
    gesehen = {}
    out = []
    out.append('-- =====================================================================')
    out.append('-- Hofmanager SchweikFarm – Import: Ackerflächen und Fruchtfolge 2023–2029')
    out.append('-- Quelle: Fruchtfolgerapport/Parzellenregister (Excel, Blatt «Anpassung 26»)')
    out.append('-- Einspielen: Supabase › SQL Editor › gesamten Inhalt einfügen › Run (Migration 7 muss eingespielt sein)')
    out.append('-- Bestehende Felder mit gleichem Namen werden aktualisiert, Anbau-Einträge je Jahr überschrieben.')
    out.append('-- Saat-/Erntemonat stammen aus dem Monatsraster und sind als «nur Monat» markiert.')
    out.append('-- =====================================================================')
    out.append('do $$')
    out.append('declare')
    out.append('  v_betrieb uuid := (select id from public.betriebe order by erstellt_am limit 1);')
    out.append('  v_feld uuid;')
    out.append('  v_nr text;')
    out.append('begin')
    out.append("  if v_betrieb is null then raise exception 'Zuerst in der App den Betrieb einrichten'; end if;")
    for f in felder:
        nr = f['nr']
        if nr in gesehen:
            gesehen[nr] += 1
            nr = nr + 'abcdefgh'[gesehen[f['nr']] - 1]
        else:
            gesehen[nr] = 0
        z = f['zahlen'] + [None] * 4
        ha, p, k, mg = z[0], z[1], z[2], z[3]
        m2 = round(ha * 10000, 1)
        out.append(f"  -- {nr} {f['name']} ({ha} ha)")
        out.append(f"  select id into v_feld from public.felder where betrieb_id = v_betrieb and lower(name) = lower({sql_text(f['name'])}) and geloescht_am is null limit 1;")
        out.append('  if v_feld is null then')
        out.append(f"    v_nr := {sql_text(nr)};")
        out.append("    while exists (select 1 from public.felder where betrieb_id = v_betrieb and feldnummer = v_nr) loop v_nr := v_nr || 'x'; end loop;")
        out.append(f"    insert into public.felder (betrieb_id, feldnummer, name, flaeche_m2, nutzungsart, korrektur_p2o5, korrektur_k2o, korrektur_mg, bemerkungen)")
        out.append(f"    values (v_betrieb, v_nr, {sql_text(f['name'])}, {m2}, 'Ackerland', {p if p is not None else 'null'}, {k if k is not None else 'null'}, {mg if mg is not None else 'null'}, 'Importiert aus Fruchtfolgerapport 2023–2029') returning id into v_feld;")
        out.append('  else')
        out.append(f"    update public.felder set flaeche_m2 = {m2}, korrektur_p2o5 = {p if p is not None else 'korrektur_p2o5'}, korrektur_k2o = {k if k is not None else 'korrektur_k2o'}, korrektur_mg = {mg if mg is not None else 'korrektur_mg'} where id = v_feld;")
        out.append('  end if;')
        for (jahr, art), (kultur, saat, ernte) in sorted(anbau(f['phasen']).items()):
            status = 'ist' if jahr <= AKTUELL else 'geplant'
            out.append(
                f"  insert into public.anbau (betrieb_id, feld_id, kultur_id, jahr, art, status, saatdatum, erntedatum, nur_monat, bemerkungen) "
                f"select v_betrieb, v_feld, id, {jahr}, '{art}', '{status}', {sql_text(saat)}::date, {sql_text(ernte)}::date, true, 'Fruchtfolgerapport' "
                f"from public.kulturen where betrieb_id is null and name = {sql_text(kultur)} "
                f"on conflict (feld_id, jahr, art) do update set kultur_id = excluded.kultur_id, status = excluded.status, "
                f"saatdatum = excluded.saatdatum, erntedatum = excluded.erntedatum, nur_monat = true;"
            )
    out.append('end $$;')
    out.append('')
    out.append('-- Kontrolle: Felder und Anbau 2026')
    out.append("select f.feldnummer, f.name, f.flaeche_m2 / 10000 as ha, k.name as kultur_2026 from public.felder f")
    out.append("left join public.anbau a on a.feld_id = f.id and a.jahr = 2026 and a.art = 'Hauptkultur'")
    out.append("left join public.kulturen k on k.id = a.kultur_id order by f.feldnummer;")
    print('\n'.join(out))

if __name__ == '__main__':
    main(sys.argv[1])

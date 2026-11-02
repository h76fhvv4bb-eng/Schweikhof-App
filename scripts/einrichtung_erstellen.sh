#!/usr/bin/env bash
# Setzt alle Migrationen zu einer Datei für die Ersteinrichtung einer leeren Datenbank zusammen.
# Aufruf: scripts/einrichtung_erstellen.sh > supabase/einrichtung_komplett.sql
set -euo pipefail
cd "$(dirname "$0")/.."
echo "-- ====================================================================="
echo "-- Hofmanager SchweikFarm – KOMPLETTE Ersteinrichtung der Datenbank (alle Migrationen)"
echo "-- Nur EINMAL in einer LEEREN Datenbank ausführen: Supabase › SQL Editor › einfügen › Run"
echo "-- Bestehende Datenbank: stattdessen nur die neuen Dateien aus supabase/migrations einspielen."
echo "-- Erzeugt mit scripts/einrichtung_erstellen.sh – nicht von Hand ändern."
echo "-- ====================================================================="
for f in supabase/migrations/*.sql; do
  echo
  echo "-- >>> $f"
  cat "$f"
done

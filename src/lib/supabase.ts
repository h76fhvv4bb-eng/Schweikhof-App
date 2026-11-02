import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const konfigurationFehlt = !url || !key;

// Der anon-Schlüssel ist öffentlich. Geschützt werden die Daten durch die Zugriffsregeln (RLS) in der Datenbank.
export const supabase = createClient(url ?? 'http://localhost', key ?? 'fehlt', {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Wandelt Supabase-/Postgres-Fehler in verständliche deutsche Meldungen. */
export function fehlertext(e: unknown): string {
  const m = typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (m.includes('duplicate key') && m.includes('feldnummer')) return 'Diese Feldnummer gibt es schon.';
  if (m.includes('Invalid login credentials')) return 'E-Mail oder Passwort stimmt nicht.';
  if (m.includes('row-level security')) return 'Dafür fehlt dir die Berechtigung.';
  if (m.includes('Failed to fetch')) return 'Keine Verbindung zum Server. Bitte Internet prüfen.';
  return m;
}

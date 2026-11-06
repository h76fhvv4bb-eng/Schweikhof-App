import { supabase, fehlertext } from './supabase';

/**
 * Lagerartikel löschen (Migration 26). Nie verwendete Artikel werden ganz gelöscht, schon verwendete ausgeblendet,
 * Artikel mit Bestand bleiben stehen. Gibt einen Satz für die Rückmeldung zurück.
 */
export async function lagerartikelLoeschen(ids: string[]): Promise<{ text: string; fehler: boolean }> {
  const { data, error } = await supabase.rpc('lagerartikel_loeschen', { p_ids: ids });
  if (error) {
    const m = fehlertext(error);
    return { text: /lagerartikel_loeschen/.test(m) ? 'Bitte zuerst Migration 26 in Supabase einspielen.' : m, fehler: true };
  }
  const r = data as { geloescht: number; ausgeblendet: number; behalten: string[] };
  const teile: string[] = [];
  const weg = r.geloescht + r.ausgeblendet;
  if (weg) teile.push(`${weg} Artikel gelöscht.`);
  if (r.ausgeblendet)
    teile.push(`${r.ausgeblendet === 1 ? 'Einer davon wurde' : `${r.ausgeblendet} davon wurden`} schon verwendet; frühere Einträge bleiben vollständig.`);
  if (r.behalten.length) teile.push(`Nicht gelöscht, weil noch an Lager: ${r.behalten.join(', ')}. Zuerst ausbuchen oder Inventur auf 0.`);
  return { text: teile.join(' ') || 'Nichts gelöscht.', fehler: !weg };
}

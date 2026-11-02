import type { Kultur } from './typen';

/**
 * Fruchtfolge-Hinweise. Das sind Empfehlungen, keine Verbote und keine Prüfung der ÖLN-Vorschriften.
 * folge: Kulturen eines Feldes nach Jahr (fehlende Jahre = undefined).
 * Gibt für ein Jahr die Hinweise zurück, die auf diese Kultur zutreffen.
 */
export function hinweiseFuerJahr(folge: Map<number, Kultur>, jahr: number): string[] {
  const k = folge.get(jahr);
  if (!k || k.ist_grasland || k.kulturgruppe === 'Brache') return [];
  const hinweise: string[] = [];

  const vorjahr = folge.get(jahr - 1);
  if (vorjahr && vorjahr.name === k.name && k.anbaupause_jahre > 0) {
    hinweise.push(`${k.name} zwei Jahre hintereinander.`);
  }

  if (k.anbaupause_jahre > 0) {
    for (let j = jahr - 2; j >= jahr - k.anbaupause_jahre; j--) {
      const frueher = folge.get(j);
      if (frueher && frueher.kulturgruppe === k.kulturgruppe) {
        hinweise.push(`${k.kulturgruppe} bereits ${j} (${frueher.name}). Empfohlen: mindestens ${k.anbaupause_jahre} Jahre Pause dazwischen.`);
        break;
      }
    }
  }

  if (vorjahr?.kulturgruppe === 'Mais' && /weizen|triticale|dinkel/i.test(k.name)) {
    hinweise.push(`${k.name} nach Mais: erhöhtes Fusarium- und Mykotoxinrisiko.`);
  }

  if (vorjahr && vorjahr.kulturgruppe === 'Getreide' && k.kulturgruppe === 'Getreide' && !hinweise.length) {
    const vorvorjahr = folge.get(jahr - 2);
    if (vorvorjahr?.kulturgruppe === 'Getreide') hinweise.push('Drei Jahre Getreide in Folge.');
  }

  return hinweise;
}

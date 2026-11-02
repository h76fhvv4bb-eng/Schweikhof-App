import { supabase } from './supabase';

/** Verkleinert ein Bild im Browser (längste Seite max. 1600 px, JPEG), damit Upload und Speicher klein bleiben. */
export async function bildVerkleinern(datei: File, maxSeite = 1600, qualitaet = 0.82): Promise<Blob> {
  const bild = await createImageBitmap(datei).catch(() => null);
  if (!bild) return datei; // z. B. HEIC in alten Browsern: Original hochladen
  const faktor = Math.min(1, maxSeite / Math.max(bild.width, bild.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bild.width * faktor);
  canvas.height = Math.round(bild.height * faktor);
  canvas.getContext('2d')!.drawImage(bild, 0, 0, canvas.width, canvas.height);
  bild.close();
  return new Promise((ok, fehler) => canvas.toBlob((b) => (b ? ok(b) : fehler(new Error('Bild konnte nicht verarbeitet werden'))), 'image/jpeg', qualitaet));
}

export interface FotoZiel {
  maschine_id?: string | null;
  eintrag_id?: string | null;
  feld_id?: string | null;
}

/** Lädt Fotos hoch und legt die Einträge in der Tabelle «fotos» an. */
export async function fotosHochladen(dateien: File[], ziel: FotoZiel, betriebId: string, beschreibung?: string) {
  for (const datei of dateien) {
    const blob = await bildVerkleinern(datei);
    const typ = blob.type || 'image/jpeg';
    const endung = typ === 'image/png' ? 'png' : typ === 'image/webp' ? 'webp' : 'jpg';
    const pfad = `${betriebId}/${crypto.randomUUID()}.${endung}`;
    const hoch = await supabase.storage.from('fotos').upload(pfad, blob, { contentType: typ, upsert: false });
    if (hoch.error) throw new Error(`Foto konnte nicht hochgeladen werden: ${hoch.error.message}`);
    const { error } = await supabase.from('fotos').insert({ betrieb_id: betriebId, pfad, beschreibung: beschreibung || null, ...ziel });
    if (error) {
      await supabase.storage.from('fotos').remove([pfad]);
      throw error;
    }
  }
}

export async function fotoLoeschen(id: string, pfad: string) {
  const { error } = await supabase.from('fotos').delete().eq('id', id);
  if (error) throw error;
  await supabase.storage.from('fotos').remove([pfad]);
}

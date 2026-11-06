// =====================================================================
// Supabase Edge Function «digiflux»: Verbindung zur digiFLUX-Schnittstelle (BLW)
//
// Die App spricht nie direkt mit digiFLUX: der technische Benutzer (Client-ID und Secret) bleibt hier auf dem Server.
// Einrichten (einmalig, siehe docs/digiflux.md):
//   Supabase › Edge Functions › Secrets:  DIGIFLUX_CLIENT_ID, DIGIFLUX_CLIENT_SECRET
//   optional: DIGIFLUX_TOKEN_URL, DIGIFLUX_API_URL (Standard = Produktion), DIGIFLUX_DFLID (eigener Standort)
//
// Aktionen (POST JSON, nur für angemeldete Verwalter des Betriebs):
//   { aktion: 'status' }                          → { konfiguriert }
//   { aktion: 'abrufen', von?, bis? }             → Lieferungen holen und über digiflux_importieren speichern
//   { aktion: 'bestaetigen', id, status, grund? } → Lieferung in digiFLUX bestätigen (ACCEPTED) oder ablehnen (REJECTED)
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const TOKEN_URL = Deno.env.get('DIGIFLUX_TOKEN_URL') ?? 'https://idp.agate.ch/auth/realms/agate/protocol/openid-connect/token';
const API_URL = (Deno.env.get('DIGIFLUX_API_URL') ?? 'https://wsg.isceco.admin.ch/agriculture/digiflux/transactions/1/b2b/shipments').replace(/\/$/, '');
const CLIENT_ID = Deno.env.get('DIGIFLUX_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('DIGIFLUX_CLIENT_SECRET') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const antwort = (daten: unknown, status = 200) =>
  new Response(JSON.stringify(daten), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

let token: { wert: string; bis: number } | null = null;
async function zugangstoken(): Promise<string> {
  if (token && token.bis > Date.now() + 30_000) return token.wert;
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  });
  if (!r.ok) throw new Error(`Anmeldung bei digiFLUX fehlgeschlagen (${r.status}). Client-ID und Secret prüfen.`);
  const j = await r.json();
  token = { wert: j.access_token, bis: Date.now() + (Number(j.expires_in) || 300) * 1000 };
  return token.wert;
}

async function digiflux(pfad: string, init: RequestInit = {}) {
  const r = await fetch(`${API_URL}${pfad}`, {
    ...init,
    headers: { Authorization: `Bearer ${await zugangstoken()}`, Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`digiFLUX antwortet mit ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// deno-lint-ignore no-explicit-any
type Roh = Record<string, any>;
const s = (v: unknown) => (v == null || v === '' ? null : String(v));
const adresse = (a: Roh | undefined) =>
  a ? s(a.organisationName) ?? s([a.firstName, a.lastName].filter(Boolean).join(' ')) : null;

/** Lieferung der Schnittstelle (ProductShipmentType) → Zeile für digiflux_importieren */
function zeile(x: Roh) {
  const id = x.id ?? {};
  const menge = x.quantity?.value ?? x.quantity?.amount;
  return {
    dfx_id: id.id ? `${id.sourceSystemId ?? 'DIGIFLUX'}/${id.id}` : null,
    status: s(x.status ?? x.state ?? x.shipmentStatus ?? x.currentStatus),
    lieferdatum: s(x.shipmentDate)?.slice(0, 10),
    abgeber: adresse(x.shippedFromAddress) ?? s(x.shippedFromStock?.name) ?? s(x.sender?.name) ?? s(x.shippedFromStock?.id),
    abgeber_id: s(x.shippedFromStock?.id),
    empfaenger_id: s(x.shippedToStock?.id),
    produkt: s(x.product?.name ?? x.productName ?? x.product?.designation) ?? s(x.product?.id),
    produkt_id: s(x.product?.id),
    produkt_quelle: s(x.product?.sourceSystemId),
    produktfamilie: s(x.productFamily),
    menge: menge == null ? null : Number(menge),
    einheit: s(x.quantity?.unit),
    lieferschein_nr: s(x.deliveryNumber),
    kommentar: s(x.comment ?? x.rejectionReason),
    roh: x,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const auth = req.headers.get('Authorization') ?? '';
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: nutzer } = await db.auth.getUser(auth.replace(/^Bearer /, ''));
    if (!nutzer?.user) return antwort({ fehler: 'Nicht angemeldet' }, 401);
    const { data: darf } = await db.rpc('darf_verwalten');
    if (!darf) return antwort({ fehler: 'Keine Berechtigung' }, 403);

    const p = await req.json().catch(() => ({}));
    const konfiguriert = !!CLIENT_ID && !!CLIENT_SECRET;
    if (p.aktion === 'status') return antwort({ konfiguriert });
    if (!konfiguriert) return antwort({ fehler: 'digiFLUX-Zugang ist noch nicht eingerichtet (technischer Benutzer fehlt).' }, 400);

    if (p.aktion === 'abrufen') {
      const { data: betrieb } = await db.from('betriebe').select('dflid').maybeSingle();
      const eigene = (Deno.env.get('DIGIFLUX_DFLID') ?? betrieb?.dflid ?? '').toUpperCase();
      const roh = await digiflux('');
      const liste: Roh[] = Array.isArray(roh) ? roh : (roh?.content ?? roh?.items ?? roh?.shipments ?? []);
      const zeilen = liste
        .map(zeile)
        // nur Lieferungen an den eigenen Betrieb, mit gültigen Angaben, im gewünschten Zeitraum
        .filter((z) => !eigene || !z.empfaenger_id || z.empfaenger_id.toUpperCase() === eigene)
        .filter((z) => z.dfx_id && z.lieferdatum && z.menge != null && z.einheit)
        .filter((z) => (!p.von || z.lieferdatum! >= p.von) && (!p.bis || z.lieferdatum! <= p.bis));
      const { data, error } = await db.rpc('digiflux_importieren', { p: { quelle: 'API', lieferungen: zeilen } });
      if (error) throw new Error(error.message);
      return antwort({ ...data, gelesen: liste.length });
    }

    if (p.aktion === 'bestaetigen') {
      const neu = String(p.status ?? '').toUpperCase();
      if (!['ACCEPTED', 'REJECTED'].includes(neu)) return antwort({ fehler: 'Status muss ACCEPTED oder REJECTED sein' }, 400);
      if (neu === 'REJECTED' && !String(p.grund ?? '').trim()) return antwort({ fehler: 'Bitte einen Grund für die Ablehnung angeben' }, 400);
      const { data: l, error } = await db.from('digiflux_lieferungen').select('id, dfx_id, quelle').eq('id', p.id).maybeSingle();
      if (error || !l) return antwort({ fehler: 'Lieferung nicht gefunden' }, 404);
      const [quelle, ...rest] = String(l.dfx_id).split('/');
      if (l.quelle !== 'API' || !rest.length) return antwort({ fehler: 'Nur über die Schnittstelle geholte Lieferungen können hier bestätigt werden.' }, 400);
      await digiflux(`/${encodeURIComponent(quelle)}/${encodeURIComponent(rest.join('/'))}/status`, {
        method: 'PUT',
        body: JSON.stringify(neu === 'REJECTED' ? { newStatus: neu, rejectionReason: String(p.grund).slice(0, 250) } : { newStatus: neu }),
      });
      const { error: e2 } = await db.rpc('digiflux_status', { p_id: l.id, p_status: neu });
      if (e2) throw new Error(e2.message);
      return antwort({ ok: true });
    }
    return antwort({ fehler: 'Unbekannte Aktion' }, 400);
  } catch (e) {
    return antwort({ fehler: e instanceof Error ? e.message : String(e) }, 500);
  }
});

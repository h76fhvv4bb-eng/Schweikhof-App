# digiFLUX (früher HODUFLU) – Anbindung

HODUFLU wurde im September 2026 durch **digiFLUX** des BLW abgelöst. Hof- und Recyclingdünger müssen dort erfasst werden;
Lieferungen von Mineraldünger und Pflanzenschutzmitteln melden die Händler. Der Empfänger bestätigt oder lehnt ab
(Lieferungen des Vorjahrs bis 15. Februar, offene werden am 30. Januar automatisch bestätigt).

Die App übernimmt diese Lieferungen und bucht sie als **Lager-Eingang** (z. B. «Rindergülle zugeführt»). So stehen sie beim
Erfassen der Düngung zur Auswahl und fliessen in die Nährstoffbilanz.

## 1. Datei-Import (sofort nutzbar)

1. Migration 31 in Supabase einspielen.
2. In der App unter **Betrieb** die digiFLUX-Standort-ID (DFLID oder BUR-Nr.) eintragen.
3. In digiFLUX die Lieferungen als Excel/CSV exportieren.
4. In der App **digiFLUX › Datei importieren** wählen. Die Spalten werden erkannt (deutsche Überschriften oder die
   technischen Namen der digiFLUX-Vorlage); fehlende Spalten lassen sich von Hand zuordnen.
5. Pro Produkt einmal **Ins Lager** wählen (Artikel zuordnen oder neu anlegen). Mit «merken» werden weitere Lieferungen
   desselben Produkts beim nächsten Import direkt gebucht. Abgelehnte Lieferungen werden nie gebucht bzw. wieder storniert.

Ein erneuter Import derselben Datei erzeugt keine Doppel.

## 2. Schnittstelle (automatischer Abgleich, Bestätigen aus der App)

Die Zugangsdaten gehören **nie** in den Code oder in einen Chat – nur in die Secrets von Supabase.

1. Im [digiFLUX-Supportportal](https://blw-ofag-ufag.atlassian.net/servicedesk/customer/portal/42/group/81/create/144)
   einen **technischen Benutzer** für den eigenen Betrieb bestellen. Man erhält eine Client-ID und ein Client-Secret.
2. Supabase › **Edge Functions** › «Deploy a new function» › Name `digiflux` › Inhalt von
   `supabase/functions/digiflux/index.ts` einfügen › Deploy. (Oder mit der Supabase-CLI: `supabase functions deploy digiflux`.)
3. Supabase › Edge Functions › **Secrets**:
   - `DIGIFLUX_CLIENT_ID` = Client-ID
   - `DIGIFLUX_CLIENT_SECRET` = Client-Secret
   - optional `DIGIFLUX_TOKEN_URL` und `DIGIFLUX_API_URL`, falls das BLW andere Adressen nennt
     (Standard: `https://idp.agate.ch/auth/realms/agate/protocol/openid-connect/token` und
     `https://wsg.isceco.admin.ch/agriculture/digiflux/transactions/1/b2b/shipments`)
4. App neu laden: Unter **digiFLUX** erscheint «Lieferungen abrufen»; Lieferungen im Status «zu bestätigen» können
   direkt bestätigt oder (mit Grund) abgelehnt werden.

Die Funktion prüft, dass nur angemeldete Verwalter des Betriebs sie nutzen können.

Technische Dokumentation des BLW: <https://github.com/blw-ofag-ufag/digiFLUX/wiki/digiFLUX-Core>

**Hinweis:** Die Schnittstelle ist nach der öffentlichen Dokumentation des BLW gebaut, aber noch nicht mit einem echten
technischen Benutzer getestet. Beim ersten Abruf die Meldung prüfen («n Lieferungen in digiFLUX gelesen»).

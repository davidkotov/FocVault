# Stripe einrichten (≈ 20 Minuten)

FocVault rechnet Abos, Zusatzspeicher und Pay-as-you-go über **Stripe** ab. Preise pflegst du nur im
Admin-Preisbuch – Stripe bekommt sie bei jedem Kauf mitgeliefert. Die vier Produkte (Pro, Family,
Zusatzspeicher, Pay-as-you-go) legt FocVault beim ersten Kauf selbst an.

## 1. Konto
1. Auf https://dashboard.stripe.com/register registrieren (Firmenname, Land Schweiz, Bankkonto für Auszahlungen).
2. Zuerst im **Testmodus** bleiben (Schalter oben rechts). Live erst nach dem Test.

## 2. Schlüssel
- *Entwickler → API-Schlüssel* → **Geheimer Schlüssel** (`sk_test_…`) → `STRIPE_SECRET_KEY`.

## 3. Webhook
- *Entwickler → Webhooks → Endpunkt hinzufügen*
  - URL: `https://<deine-domain>/api/v1/billing/webhook`
  - Ereignisse: `checkout.session.completed`, `customer.subscription.created`,
    `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`
- **Signaturgeheimnis** (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`.
- Lokal testen: `stripe listen --forward-to localhost:3000/api/v1/billing/webhook` (Stripe CLI) – das
  angezeigte `whsec_…` in `.env.local` eintragen.

## 4. Einstellungen im Stripe-Dashboard
- *Einstellungen → Kundenportal*: aktivieren; erlauben: Zahlungsmittel ändern, Rechnungen, Kündigen
  (zum Ende der Laufzeit). Plan-Wechsel im Portal **aus** (läuft über FocVault).
- *Einstellungen → Zahlungsmethoden*: Karte, TWINT, Apple Pay, Google Pay, SEPA-Lastschrift nach Wunsch.
- *Einstellungen → Rechnungen*: Firmenadresse, MWST-Nummer, Logo.
- Optional *Stripe Tax* einrichten und `STRIPE_AUTOMATIC_TAX=1` setzen. Unsere Preise sind Endpreise
  inkl. MWST (`tax_behavior: inclusive`).
- *Einstellungen → Abrechnung → Wiederholungsversuche*: Smart Retries an, nach letztem Versuch
  „Abo kündigen“ – FocVault stellt das Konto dann automatisch auf Free (Daten bleiben).

## 5. Testen (Testmodus)
Testkarte `4242 4242 4242 4242`, beliebiges Datum in der Zukunft, beliebige Prüfziffer.
Fehlgeschlagene Zahlung: `4000 0000 0000 0341`. Admin zeigt oben „Stripe: Testmodus“.

## 6. Live schalten
Live-Schlüssel und neuen Live-Webhook eintragen (eigenes `whsec_…`), Server neu starten.
Admin zeigt „Stripe: Live“.

## Was wo passiert
| Vorgang | Ablauf |
|---|---|
| Abo abschließen | Stripe Checkout → Webhook schaltet Pro/Family frei |
| Paket wechseln (gleiche Währung) | Abo wird umgestellt, anteilig verrechnet |
| Kündigen | Läuft bis Laufzeitende, danach automatisch Free (Daten bleiben, Uploads über 5 GB gesperrt) |
| Zusatzspeicher | weitere Position im Abo, anteilig |
| Pay-as-you-go | Karte einmal hinterlegen; am Monatsanfang Rechnung nach Monatsdurchschnitt, unter dem Minimum Übertrag |
| Zahlungsmittel, Rechnungen | Stripe-Kundenportal („Zahlung & Rechnungen“) |

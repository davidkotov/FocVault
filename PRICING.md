# FocVault – Preise, Konkurrenz, Kalkulation

> Stand 27.09.2026. Alle Zahlen dieses Dokuments stammen aus `lib/pricing.ts` (dieselbe Formel
> wie Admin → Wirtschaftlichkeit / Szenario-Rechner). Preise der Konkurrenz: offizielle
> Preisseiten bzw. aktuelle Übersichten, Monatsabo, ohne Aktionen.

## 1. Unsere Pakete

| Paket | Speicher | Preis | Zusatzspeicher |
|---|---|---|---|
| Free | 5 GB | 0 CHF | Pay-as-you-go: 2 Rp / GB / Monat, ab 2 CHF Rechnungsbetrag, eigene Obergrenze |
| Pro | 1 TB | 13.90 CHF / Monat | +200 GB 2.90 · +500 GB 5.90 · +1 TB 9.90 · +2 TB 17.90 CHF / Monat |
| Family | 2 TB geteilt, bis 6 Personen | 19.90 CHF / Monat | wie Pro |
| Business | individuell | individuell | – |

Alle Werte sind im Admin unter **Preisbuch** änderbar und wirken sofort (Quota, Auswertung).
Einheiten dezimal (1 TB = 1000 GB), wie Fil One, Dropbox und MEGA.

## 2. Konkurrenz

| Anbieter | Gratis | Einstieg | ~1–2 TB | E2E / Zero-Knowledge | Positionierung |
|---|---|---|---|---|---|
| **Dropbox** | 2 GB | – | Plus 2 TB $11.99 (Jahr: $9.99), Family 2 TB $19.99 | nein (nur Business-Advanced) | Komfort, Sync |
| **MEGA** | 20 GB | Pro Lite 750 GB €5 (Jahr) | Pro I **3 TB €9.99** | ja | Preisführer mit E2E (≈ €1.25–3.33/TB) |
| **Proton Drive** | 5 GB | Plus 200 GB $4.99 | Duo 2 TB $19.99, Unlimited 500 GB $12.99 (inkl. Mail/VPN/Pass) | ja, Schweiz | Privacy-Suite |
| **Tresorit** | 3 GB | Lite 50 GB $4.75 | **Essential 1 TB $13.99** (Jahr: $11.99), Pro 4 TB $33.99 | ja, Swiss Post | Premium-Privacy, Profis |
| **pCloud** | 10 GB | 500 GB $4.99 | 2 TB $9.99, Lifetime-Pläne | nur mit Aufpreis (Crypto) | Lifetime-Deals |
| **Google One** | 15 GB | – | 2 TB ≈ $9.99 | nein | Ökosystem |

**Einordnung FocVault Pro (13.90 CHF ≈ $16 für 1 TB):** auf Höhe von **Tresorit** (Premium-Privacy),
klar über Dropbox, Google und MEGA. Das ist gewollt – wir verkaufen nicht Terabytes, sondern
Vertraulichkeit. Begründung gegenüber Kunden:

1. **Zero-Knowledge by design** – wir können Dateien, Dateinamen und Passwörter technisch nicht lesen.
2. **Alles in einem Tresor** – Dateien, Passwort-Manager, Notizen, 2FA-Authenticator (bei Proton
   braucht es dafür das 12.99-$-Bundle mit nur 500 GB).
3. **Filecoin mit nachweisbarer Integrität** – Speicher wird täglich kryptografisch geprüft.
4. **Schweiz/EU**, CHF-Preise, Login mit Google/Apple/E-Mail oder Wallet.

**Risiko ehrlich benannt:** Preissensible Nutzer landen bei MEGA (3 TB E2E für €9.99). Gegen MEGA
gewinnen wir über Produkt, Vertrauen (MEGA-Vergangenheit), Passwort-Manager/2FA und UX – nicht
über den Preis. Deshalb: **Jahresabo mit ~17 % Rabatt** einführen (Branchenstandard, siehe
Dropbox/Tresorit/Proton), z. B. Pro 139 CHF/Jahr, Family 199 CHF/Jahr.

## 3. Unsere Kosten

- **Fil One:** $4.99 / TB / Monat auf den **Tagesdurchschnitt der belegten Bytes**, keine
  Egress-/Request-Gebühren, Minimum $4.99 / Monat. Bezahlt per Kreditkarte (Stripe).
- Umrechnung 0.85 CHF/USD → **4.24 CHF pro TB und Monat = 0.42 Rappen pro GB**.
- **Stripe** (Kundenzahlungen): 2.9 % + 0.30 CHF pro Rechnung.
- Nicht enthalten: Personal, Hosting (Vercel/Postgres), Support, Marketing, MWST.

## 4. Deckungsbeitrag pro Produkt

| Produkt | Preis | Kosten bei 30 % Auslastung (typisch) | Marge | Kosten bei 100 % (Worst Case) | Marge |
|---|---|---|---|---|---|
| Pro 1 TB | 13.90 | 1.27 + Stripe 0.70 | **11.92 CHF · 86 %** | 4.24 + 0.70 | 8.96 CHF · 64 % |
| Family 2 TB | 19.90 | 2.54 + 0.88 | **16.48 CHF · 83 %** | 8.48 + 0.88 | 10.54 CHF · 53 % |
| +500 GB | 5.90 | 0.64 + 0.47 | 4.79 CHF · 81 % | 2.12 + 0.47 | 3.31 CHF · 56 % |
| +1 TB | 9.90 | 1.27 + 0.59 | 8.04 CHF · 81 % | 4.24 + 0.59 | 5.07 CHF · 51 % |
| +2 TB | 17.90 | 2.54 + 0.82 | 14.54 CHF · 81 % | 8.48 + 0.82 | 8.60 CHF · 48 % |
| PAYG | 20 CHF / TB | 4.24 CHF / TB | 4.7-facher Aufschlag – macht Pro attraktiv | | |

**Jedes Produkt bleibt auch bei voll ausgereizter Quota profitabel.** Zusatzspeicher wird auf der
gemeinsamen Monatsrechnung abgerechnet – die Stripe-Fixgebühr fällt dann nur einmal an (die Tabelle
rechnet vorsichtig mit je einer eigenen Rechnung).

## 5. Free-Tier: was die Gratis-Nutzer kosten

- Ein volles Free-Konto (5 GB) kostet **2.1 Rappen / Monat**, typisch (30 % belegt) **0.6 Rappen**.
- **100 000 Free-Nutzer:** typisch **≈ 630 CHF / Monat**, Worst Case (alle 5 GB voll) **≈ 2 060 CHF**.
- Finanziert durch **≈ 54 Pro-Kunden** (typisch) bzw. ≈ 230 im Worst Case – bei 100 000 Nutzern
  sind das 0.05–0.23 % Conversion. Branchenüblich sind 2–4 %.

**Wie bezahlt:** eine einzige Fil-One-Monatsrechnung für den gesamten Speicher. Keine Einzahlung
pro Nutzer, keine Wallet nötig. Die optionale **USDFC-Reserve** (Admin → Finanzierung) ist eine
Rücklage mit Live-Saldo und Laufzeit in Monaten – Fil One selbst nimmt kein USDFC.

**Kritisches Risiko:** Scheitert eine Fil-One-Zahlung, sperrt Fil One **sofort alle Uploads**
(für alle Nutzer). → Ersatzkarte hinterlegen, Zahlungs-Mails aktivieren, Kontostand überwachen.

**Kostenkontrolle (Admin → Preisbuch):** Monatsbudget mit Anzeige der Auslastung, Free-Quota für
neue Konten, Inaktivitätsregel (Warnung nach 12, Löschung nach 18 Monaten mit Ankündigung –
wie Dropbox/MEGA), PAYG-Obergrenzen.

## 6. Hochrechnung (Rohertrag pro Monat, vor Fixkosten)

Annahmen: 25 % der Zahlenden Family, 30 % Auslastung, 10 % der Abos mit Zusatzspeicher (Ø 5.90 CHF),
1 % der Free-Nutzer mit PAYG (Ø +150 GB).

| Nutzer | zahlend | Umsatz | Fil One + Stripe | Rohertrag | Marge | davon Free geschenkt |
|---|---|---|---|---|---|---|
| 10 000 | 3 % | 5 088 CHF | 894 CHF | **4 194 CHF** | 82 % | ≈ 65 CHF |
| 100 000 | 1 % | 18 960 CHF | 4 097 CHF | **14 863 CHF** | 78 % | ≈ 640 CHF |
| 100 000 | 3 % | 50 880 CHF | 8 941 CHF | **41 939 CHF** | 82 % | ≈ 632 CHF |
| 100 000 | 5 % | 82 800 CHF | 13 786 CHF | **69 014 CHF** | 83 % | ≈ 620 CHF |
| 1 000 000 | 3 % | 508 800 CHF | 89 414 CHF | **419 386 CHF** | 82 % | ≈ 6 300 CHF |

100 000 Nutzer bei 3 % ≈ **610 000 CHF Jahresumsatz**. Der Free-Tier ist kein Kostenproblem – die
Fil-One-Preise (keine Egress-Gebühren, Tagesdurchschnitt) machen ihn sehr günstig.

## 7. Offene Punkte

1. **MWST:** Endkundenpreise in der Schweiz inkl. 8.1 % MWST angeben → 13.90 CHF brutto = 12.86 netto.
   Die Kalkulation oben rechnet mit Bruttopreisen; die Margen sinken dadurch um ~1 Prozentpunkt.
   EU-Kunden: OSS-Verfahren (MWST des Kundenlandes).
2. **Jahresabos** (−17 %) und EUR-Preise für die EU.
3. **Stripe-Anbindung** (Abos, Zusatzspeicher, PAYG-Metering) – bis dahin schaltet der Admin frei;
   lokal werden Buchungen ohne Zahlung aktiviert (`BILLING_DEV_PURCHASES`).
4. **Fil-One-Reserved-Capacity** (1/3/5 Jahre) ab ~50 TB belegtem Speicher anfragen.

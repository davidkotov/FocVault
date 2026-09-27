# FocVault – Preise, Konkurrenz, Kalkulation

> Stand 27.09.2026. Alle Zahlen dieses Dokuments stammen aus `lib/pricing.ts` (dieselbe Formel
> wie Admin → Wirtschaftlichkeit / Szenario-Rechner). Preise der Konkurrenz: offizielle
> Preisseiten bzw. aktuelle Übersichten, Monatsabo, ohne Aktionen.

## 1. Unsere Pakete (Preisbuch v2: Monat/Jahr, CHF/EUR/USD)

Feste Preispunkte je Währung (nicht umgerechnet). Jahresabo = 2 Monate geschenkt (−17 %).

| Paket | Speicher | Monatlich CHF · EUR · USD | Jährlich CHF · EUR · USD |
|---|---|---|---|
| Free | 5 GB | 0 | 0 |
| Pro | 1 TB | 13.90 · 13.90 € · $14.90 | 139 · 139 € · $149 |
| Family | 2 TB, bis 6 Personen | 19.90 · 19.90 € · $21.90 | 199 · 199 € · $219 |
| +200 GB | Zusatz | 2.90 · 2.90 € · $2.99 | 29 · 29 € · $29.90 |
| +500 GB | Zusatz | 5.90 · 5.90 € · $6.49 | 59 · 59 € · $64.90 |
| +1 TB | Zusatz | 9.90 · 9.90 € · $10.90 | 99 · 99 € · $109 |
| +2 TB | Zusatz | 17.90 · 17.90 € · $19.90 | 179 · 179 € · $199 |

**Pay-as-you-go (Free):** 3 Rp / 3 ct / 3.5 ¢ pro GB und Monat über den 5 GB – abgerechnet nach dem
durchschnittlich belegten Speicher des Monats (wie Fil One uns abrechnet), Mindestrechnung 2 CHF/2 €/$2.50.
Kleinere Beträge werden in den Folgemonat übertragen (verfallen nicht). Eigene Obergrenze (Standard 100 GB).
Aufschlag +607 % bzw. Marge ≈ 86 % (30 CHF/TB bei 4.24 CHF Kosten mit Fil One; mit FOC direkt 3.87 CHF). Ab ~464 GB extra ist Pro günstiger – das zeigt die App an.

Alle Werte sind im Admin unter **Preisbuch** änderbar und wirken sofort (Quota, Auswertung).
Einheiten dezimal (1 TB = 1000 GB), wie Fil One, Dropbox und MEGA.

## 1b. Business (seit 09/2026)

| Stufe | Monatlich CHF · EUR · USD | Jährlich | Speicher | Nutzer inkl. | weiterer Nutzer |
|---|---|---|---|---|---|
| Business Starter | 49 · 49 € · $55 | 490 · 490 € · $550 | 3 TB | 5 | 8 CHF · 8 € · $9 / Monat |
| Business | 129 · 129 € · $139 | 1 290 · 1 290 € · $1 390 | 10 TB | 10 | 8 CHF · 8 € · $9 / Monat |
| Enterprise | ab 490 · 490 € · $529 | Vertrag | ab 50 TB | ab 50 | nach Vereinbarung |

Marge bei vollem Speicher (Filecoin direkt, 3.87 CHF/TB): Starter 76 %, Business 70 %; Nutzerplätze fast
reine Marge. Typische Auslastung 30–50 % → 85–90 %. Mit zusätzlicher Fil-One-Kopie Business nur ~37 %,
deshalb für Business Filecoin als Hauptablage.

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

| Speicherart | Kosten pro GB/Monat | pro TB/Monat | PAYG 3 Rp: Aufschlag · Marge | API 1.5 Rp: Aufschlag · Marge |
|---|---|---|---|---|
| **Filecoin Onchain Cloud** direkt (2 Kopien, PDP) | 0.39 Rp ($0.00455) | 3.87 CHF | **+676 % · 87 %** | **+288 % · 74 %** |
| Fil One (S3) | 0.42 Rp ($0.00499) | 4.24 CHF | +607 % · 86 % | +254 % · 72 % |
| beides (schnelle Kopie + FOC) | 0.81 Rp | 8.11 CHF | +270 % · 73 % | +85 % · 46 % |

Aufschlag = Preis ÷ Kosten − 1 (100 % = doppelte Kosten); Marge = Gewinn ÷ Preis (kann nie über
100 % liegen). **Pay-as-you-go liegt in jeder Variante deutlich über 100 % Aufschlag.**

**FOC im Detail** (docs.filecoin.cloud, 09/2026): $2.50 / TiB / Monat **pro Kopie**, plus 0.12 $ pro
Datensatz und Monat, einmalig 0.025 $ je neuem Datensatz, 0.008 $ + 0.003 $ pro Piece je
Hinzufügen, 0.007 $ je Löschauftrag. Bezahlt in USDFC über Filecoin Pay, 30 Tage Kosten als Reserve.
Deshalb: alle Kunden teilen sich **2 Datensätze** (0.24 $/Monat fix statt pro Konto) und wir bündeln
viele verschlüsselte 32-MiB-Pieces zu **Paketen bis 512 MiB** – ohne Bündelung würden 1 GB
Kundendaten einmalig ≈ 0.66 $ Gebühren kosten (30 Pieces × 0.011 $ × 2 Kopien), mit Bündelung ≈ 0.04 $
(2 Pakete, einmalig ≈ 1.3 Monate PAYG-Umsatz dieses GB) – bei 0.39 Rp Speicherkosten pro GB und Monat ein großer Unterschied. Download ohne CDN: keine Gebühr.

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
| PAYG | 30 CHF / TB | 4.24 CHF / TB | 7-facher Aufschlag, 86 % Marge – macht Pro attraktiv | | |

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

## 7. Speicher-API (später, für Entwickler)

Voreinstellung im Preisbuch (änderbar): **1.5 Rp / 1.5 ct / 1.6 ¢ pro GB und Monat** (= 15 CHF/TB),
Download inklusive bis zur gespeicherten Menge, darüber 1 Rp/GB, Mindestbetrag 5 pro Monat.
Mit FOC direkt +288 % Aufschlag. Einordnung: AWS S3 ≈ $23/TB, Backblaze B2 $6/TB, Wasabi $6.99/TB –
wir liegen im Premium-Bereich, weil jedes Objekt Ende-zu-Ende verschlüsselt und auf Filecoin
nachweisbar gespeichert ist. Für die API muss FOC die Hauptablage sein (schnelle Kopie nach X
Stunden entfernen), sonst sinkt der Aufschlag auf ~85 %.

## 8. Offene Punkte

1. **MWST:** Endkundenpreise in der Schweiz inkl. 8.1 % MWST angeben → 13.90 CHF brutto = 12.86 netto.
   Die Kalkulation oben rechnet mit Bruttopreisen; die Margen sinken dadurch um ~1 Prozentpunkt.
   EU-Kunden: OSS-Verfahren (MWST des Kundenlandes).
2. **Jahresabos** (−17 %) und EUR-Preise für die EU.
3. **Stripe-Anbindung** (Abos, Zusatzspeicher, PAYG-Metering) – bis dahin schaltet der Admin frei;
   lokal werden Buchungen ohne Zahlung aktiviert (`BILLING_DEV_PURCHASES`).
4. **Fil-One-Reserved-Capacity** (1/3/5 Jahre) ab ~50 TB belegtem Speicher anfragen.

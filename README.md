# FocVault — deine Privacy Cloud auf Filecoin

Zero-Knowledge-Cloud für Endkunden: Dateien, Passwörter, Notizen und 2FA-Codes werden im
Browser verschlüsselt und auf **Filecoin Onchain Cloud (FOC)** gespeichert – in mehreren
Kopien bei unabhängigen Anbietern, laufend per **Proof of Data Possession** geprüft.
Anmelden wie gewohnt (E-Mail + Passphrase, Google, Apple oder Wallet über Reown), bezahlen in
CHF, EUR oder USD. Kunden brauchen keine Wallet und kein Krypto.

```
Browser (Web/PWA)        Passphrase → Argon2id → Master-Key (nur im RAM)
  └ Verschlüsselung      AES-256-GCM, 32-MiB-Pieces, Datei-Schlüssel je Datei
Backend (Next.js API)    Konten, Quota, Preise, Secure Send, Admin – sieht nur Ciphertext
Speicher                 schnelle Kopie (Fil One S3 bzw. lokal)
                         + Filecoin Onchain Cloud: gebündelte Pakete, 2 Kopien, PDP-geprüft,
                           bezahlt mit USDFC aus der Betreiber-Wallet über einen Session Key
```

## Schnellstart (lokal)

```bash
npm install --legacy-peer-deps
cp .env.local.example .env.local      # optional – ohne Werte läuft alles lokal
npm run dev                           # http://localhost:3000/de bzw. /en
```

Ohne Umgebungsvariablen: PGlite-Datenbank und Datei-Storage unter `.data/`, jedes Konto ist
Admin (nur in Dev). Seiten: `/de/registrieren`, `/de/anmelden`, `/de/app`, `/de/admin`
(englisch: `/en/register`, `/en/login`, …).

## Filecoin Onchain Cloud einrichten (Admin → „Filecoin (FOC)“)

1. **Netz wählen** – zuerst *Calibration* (kostenlos: tFIL und tUSDFC aus den Faucets, Links
   im Admin), später *Mainnet*.
2. **MetaMask verbinden** und als zahlende Wallet übernehmen. Sie braucht USDFC und ein wenig
   FIL für die Transaktionsgebühren.
3. **Einzahlen & freigeben** – eine Transaktion: USDFC in Filecoin Pay einzahlen und dem
   Speicherdienst ein Monatslimit geben (aus dem Speicherbudget in TiB berechnet).
4. **Server-Schlüssel erzeugen und in MetaMask autorisieren** – der Server darf damit
   befristet Datensätze anlegen, Pakete hinzufügen und entfernen. An das Guthaben kommt er
   nicht; sein privater Teil liegt verschlüsselt in der Datenbank.
5. **Einschalten.** Der Server bündelt neue Dateien zu Paketen (Standard 128–512 MiB oder
   spätestens nach 6 h) und lädt sie mit 2 Kopien hoch. Im Dashboard erscheint bei gesicherten
   Dateien „Filecoin ✓“.

Die Ampel im Admin warnt, wenn das Guthaben weniger als 21 Tage reicht, und stoppt neue
Uploads unter 5 Tagen – FOC hält 30 Tage Kosten als Reserve; gerät das Konto ins Minus,
dürfen Anbieter Daten löschen. Hintergrund-Abgleich: `instrumentation.ts` (Dauerprozess) bzw.
`GET /api/v1/cron/maintenance` mit `Authorization: Bearer $CRON_SECRET` (Vercel Cron).

## Preise

Siehe `PRICING.md`: Free 5 GB + Pay-as-you-go, Pro 1 TB, Family 2 TB, Zusatzspeicher,
Monats-/Jahresabos in CHF/EUR/USD, geplante Speicher-API. Alles im Admin-Preisbuch änderbar,
inklusive Marge je Speicherart (Fil One, FOC, beides).

## Backup-Programm & S3-Gateway

`npm run build:cli` → `bin/focvault.mjs`: verschlüsseltes, inkrementelles Backup von Ordnern und ein
lokales S3-Gateway für rclone, Cyberduck, AWS CLI oder NAS-Backups. Anleitung: `BACKUP.md`.

## Secure Send

Link mit Ablauf, Download-Limit (serverseitig, global) und optionalem Passwort. Der Link
verweist auf die gespeicherte Datei (keine Kopie); Name und Datei-Schlüssel sind mit dem
Link-Schlüssel verschlüsselt, der nur im URL-Fragment (`/s/<id>#…`) steht und nie an den
Server geht. Links sind jederzeit widerrufbar.

## Entwicklung & Tests

```bash
npx tsc --noEmit          # Typen
npx vitest run            # Unit-/Service-Tests (inkl. FOC-Abgleich mit Anbieter-Attrappe)
npx playwright test       # E2E gegen den Dev-Server (einmalig: npx playwright install chromium)
```

- npm immer mit `--legacy-peer-deps` (`.npmrc`).
- Nach Schema-Änderungen den Dev-Server neu starten (Migrationen laufen beim Start).
- CI: `.github/workflows/ci.yml` – `tsc --noEmit` und `vitest`.

## Projektstruktur

```
app/                 Seiten (/[de|en]/… per middleware.ts), API unter app/api/v1
components/          Landing, Dashboard, account/* (Auth, Pakete, Secure Send), admin/*
features/            Client-Logik: Konto, Verschlüsselung, Transfers, i18n, FOC-Wallet
lib/                 Krypto, Preise, Texte (lib/i18n/messages), Typen
server/              Services: accounts, auth, billing, objects, shares, vault, foc, storage, db
```

## Sicherheit & Recht

- Master-Key nur im RAM; Server speichert ausschließlich Ciphertext.
- Nie private Schlüssel oder Seed-Phrasen eingeben oder committen; `.env*` ist ignoriert.
- Als Hosting-Dienst in der EU/CH gelten DSA/DSGVO/nDSG-Pflichten (Impressum, Meldewege).
  Vor dem Launch anwaltlich prüfen lassen.

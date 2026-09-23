# FocVault — Dev-Log (lokal)

Arbeitsprotokoll für die lokale Entwicklung. Wird vor jedem Push aktualisiert,
damit der Partner (`davidkotov`) die Änderungen nachvollziehen kann.

## Workflow

1. **Lokal coden** — Änderungen am Code in `/Users/arbeitsplatz/Downloads/FocVault`
2. **Dokumentieren** — Eintrag unten im „Änderungen"-Abschnitt ergänzen
   (Datei, Was, Warum)
3. **Push-Freigabe** — auf explizites „Go" wird gepusht:
   `git add -A && git commit && git push origin main`

## Umgebung (lokal, macOS)

| Tool | Version | Pfad / Hinweis |
|---|---|---|
| Node.js | v24.21.0 (LTS) | `~/.local/node/bin` (via `PATH` in `~/.zshrc`) |
| npm | 11.19.0 | mit Node mitgeliefert |
| Git | 2.39.3 | System-Git, Branch `main` |
| Credential-Helper | `osxkeychain` | Token wird beim ersten Push im Keychain gespeichert |

**Start:** `npm run dev` → http://localhost:3000

## Projektstand (SOLL/WAS)

- **Stack:** Next.js 14 (App Router) + TypeScript `strict` + React 18
- **Web3:** wagmi 2.12 / viem 2.21, `@filoz/synapse-sdk` (Filecoin Onchain Cloud)
- **Crypto (clientseitig):** AES-256-GCM, HKDF-SHA256 aus Wallet-Signatur,
  non-extractable `CryptoKey`s — siehe `lib/crypto.ts`, `lib/vault.ts`
- **Docs:** `README.md` (Architektur/Roadmap), `SECURITY-AUDIT.md` (2026-09-21,
  Verdict „clean", Funde C1…), `PROPOSAL-FOC.md`
- **Struktur:**
  - `app/` — Routes: `/` (Landing + My Cloud), `/s/[cid]` (Secure-Send-Empfang)
  - `components/` — UI (Landing, FileList, UploadZone, ShareDialog, VaultUnlock, …)
  - `lib/` — `crypto`, `vault`, `share`, `synapse`, `chains`, `abis`
  - `contracts/SubscriptionGate.sol` — Abo-Gate (USDFC Payment-Rails)
  - `public/` — Mockups, Icons, PWA-Manifest

## Änderungen

> Neueste Einträge oben. Wird vor jedem Push gepflegt.

### [noch nicht gepusht] Pricing- & Storage-Strategie: Free 5 GB, Pro/Family 2 TB, Pay-as-you-go + Dataset-Reuse

**Beratung & Entscheidung (mit Partner, Basis: echte FOC-Kosten aus SDK + Docs):**
- FOC-Kosten offiziell: $2.50/TiB/Monat pro Kopie (≈ 0,5 Rp/GB/M bei 2 Kopien),
  $0.12/Dataset/Monat flat, $0.025 einmalig, ~$0.50 Reserve; Egress via Beam bis
  $0.014/GiB. Die Infrastruktur ist also ~100× unter Marktpreis — der Abo-Preis
  bezahlt Features, Schweizer Privacy-Versprechen und Support (Referenz:
  Tresorit 1 TB ≈ $12, Proton 500 GB ≈ $10).
- **Festgelegtes Modell:** Free **5 GB** (danach Pay-as-you-go mit echten
  Filecoin-Kosten, 0 % Aufschlag) · Pro **2 TB @ 13.90 CHF/Monat** · Family
  **2 TB @ 19.90 CHF/Monat** (2–6 Mitglieder, je eigener Vault & Key) · Business
  individuell. Free-Usage zahlt später das **Admin-/Backend-Konto**; Abos laufen
  dann über **Stripe** (Backend = Step 3 mit Partner). Übergang heute: Self-Pay.

**Dateien:** `lib/vault.ts`, `lib/synapse.ts` (Dataset-Reuse,
`getVaultContexts`), `components/UploadZone.tsx`, `app/page.tsx`,
`components/Sidebar.tsx`, `components/ProPanel.tsx`, `components/Landing.tsx`,
`components/UpgradeWall.tsx`, `lib/share.ts`, `app/globals.css`, `README.md`

**Was (Code):**
- `TIERS`: FREE 5 GiB · PRO 2 TiB · FAMILY 2 TiB · BUSINESS (Individuell),
  mit `quotaLabel`, `priceChf`, `maxBytes`; `tierFor()` kennt `FAMILY`/`BUSINESS`;
  `formatBytes()` kann jetzt TB.
- **Dataset-Reuse** (`lib/synapse.ts`): `getVaultContexts()` persistiert die
  Dataset-IDs pro Konto & Chain in localStorage und setzt Uploads (Dateien,
  Sync-Index, Shares) über `createContexts({ dataSetIds })` fort — sonst legte
  jede Session wieder 2 neue Datasets an ($0.12/Monat × N). Verfallene Datasets
  → sauberer Fallback auf frische Contexts. `prepareStorage`/Uploads bekommen
  dieselben Contexts (korrekte Zusatz-Lockup-Berechnung).
- Landing: 4 Preispläne in CHF, 5-GB-Trustline/CTA, FAQ („Kryptowährung?",
  „Abo-Preis"), Pricing-Grid 2×2.
- ProPanel: Quota-Anzeige (5 GB / 2 TB), Hinweis „13.90 CHF via Stripe ab
  Release" neben dem on-chain-USDFC-Preis.
- Secrets-Module bleiben Pro/Family-gated und Quota-frei (kein Änderung).

**Getestet:** `tsc --noEmit` grün; Dev-Server HTTP 200. Upload-Flow-Änderung
(Dataset-Reuse) ist strukturell identisch zur getesteten Streaming-Pipeline —
ein Live-Test auf Calibration mit kleiner Datei steht noch aus (Wallet nötig).

### [noch nicht gepusht] Streaming-Encrypt: Uploads & Downloads ram-frei (v0.3-Foundation)

_Ziel laut Roadmap: „Chunk-Verschlüsselung hält alle Chunks im RAM (2 GB File ≈ 2 GB
Browser-Speicher) – Streaming folgt v0.3."_

**Neues Frame-Format (AES-GCM mit Längen-Prefix):**
- 256-MiB-Chunks bleiben, werden aber intern in **16-MiB-Subblöcke** zerlegt
  (`STREAM_BLOCK_SIZE` in `lib/crypto.ts`).
- Jeder Subblock = Frame `[u32le cipherLen][cipher+16B GCM-Tag]`; IV deterministisch
  aus `baseIv[0..7] + 4-Byte-Zähler` (BE) → kein iv-Array im Meta, keine IV-Wiederverwendung.
  Am Piece-Ende NUL-Padding bis `MIN_PIECE_BYTES` (127) – wie bisher.
- Vault-Metadaten rückwärtskompatibel: neues optionales `fmt: 'frame'` an `ChunkMeta`
  (`lib/vault.ts`); **alte Dateien (ohne `fmt`) laufen unverändert über den Legacy-Pfad**.

**Upload (`components/UploadZone.tsx`, `lib/synapse.ts`):**
- `encryptFileChunked()` (sammelte ALLE Cipher im RAM) **ersetzt** durch
  `encryptedPieceStream(file, start, end, fileKey, baseIv, padding, signal)` – liest per
  `file.slice().stream()`, verschlüsselt live in 16-MiB-Frames, RAM ≈ 1 Frame.
- Kostenschätzung (`prepareStorage`) passiert jetzt **vor** dem Speichern über exakt
  berechenbare `streamCipherPlan(clearSize)`-Größen (`frames/cipherSize/paddedSize`).
- `uploadPiecesStreamed()` reicht Streams an `primary.store(data, { onProgress, signal })`
  → **echter Byte-Fortschritt (in %) + Abbrechen-Button** (`AbortController`).
- Abgebrochene Uploads: einbezahltes USDFC bleibt als Guthaben erhalten (kein Commit).

**Download (`app/page.tsx`, `lib/synapse.ts`, `lib/idb.ts` neu):**
- `getPieceDownloadUrl()` löst Piece-URLs über das offizielle SDK-Subpath-Package
  `@filoz/synapse-core/piece` auf (`tryFrom`/`resolvePieceUrl`/`defaultResolvers`);
  `openPieceStream()` öffnet den Fetch-Stream (abbrechbar).
- `decryptPieceFrames()` parst und entschlüsselt Frame für Frame (RAM ≈ 1 Frame).
- **Chrome/Edge:** `showSaveFilePicker()` + `createWritable()` → Direkt auf Platte,
  komplett RAM-frei. **Firefox/Safari:** IndexedDB-Puffer (`lib/idb.ts`) → Blob-Download,
  ohne große RAM-Kumulation.
- Fortschrittsleiste (%-Anzeige) plus **Abbrechen** für Downloads; Alt-Dateien behalten
  den alte `downloadPiece`-Pfad.

**Getestet:** `tsc` grün; Node-Frame-Tests: 100 B … 256 MiB+1, exakte Blockgrenzen,
300-MiB-Slice (2. Chunk), CST-Roundtrips byte-identisch, Padding, AbortError – alle OK.
Dev-Server (HTTP 200) kompiliert ohne Fehler.

> Hinweis: `@filoz/synapse-core/piece` ist ein offizieller Subpath-Export (Browser-kompatibel).

## Änderungen (älter)

**Dateien:** `components/PasswordsPanel.tsx`, `components/TotpPanel.tsx`,
`components/QrScanModal.tsx` (neu), `lib/csv.ts` (neu), `lib/totp.ts`,
`lib/vault.ts` (`folder`-Feld), `app/page.tsx` (`upsertSecrets` Bulk),
`app/globals.css`, `package.json` (+ `jsqr`)

**Passwörter:**
- **Suche** (Titel/Benutzer/Webseite/Ordner) + **Ordner-Chips** mit Zählern;
  neues optionales `folder`-Feld im Eintrag (mit Datalist-Vorschlägen).
- **Einblenden-Button im Formular** (Augen-Icon) – fehlte bisher beim
  Bearbeiten/Anlegen.
- **Generator im Bitwarden-Stil:** Länge (8–64), Zeichensätze
  (A–Z / a–z / 0–9 / Symbole) als Checkboxen, „🔄 Neu würfeln",
  Kopieren-Button. Ergebnis landet direkt im Passwort-Feld + wird sichtbar.
- **Kopieren-Button** an jedem Listen-Eintrag.
- **CSV-Export/Import** (Bitwarden-ähnliche Spalten name/url/username/
  password/folder/notes, Header-Erkennung, `lib/csv.ts` mit RFC-4180-Quoting).

**2FA-Authenticator:**
- Formular **verschlankt**: nur noch otpauth://-Link **oder** Titel + Secret –
  Ziffern/Periode/Algorithmus kommen automatisch aus dem Link (sonst
  Standard 6/30/SHA1). Aussteller-Doppelpflege entfernt.
- **QR-Scan** per Kamera (Live-Erkennung, `jsqr`) **oder Bild-Upload**
  (`QrScanModal.tsx`); gefundener otpauth://-Link füllt das Formular.
- Einträge **kompakter**: großes Live-TOTP-Code-Feld + Fortschrittsbalken,
  nur Titel/Aussteller – kein Secret-Ausschnitt mehr.

**Getestet:** `tsc` sauber; CSV-Roundtrip, otpauth-Parser, generierte
Secrets + RFC-6238-Vektoren bestanden; Seite lädt (HTTP 200).

> Hinweis Dev: QR-Scan braucht `navigator.mediaDevices` → läuft auf
> `localhost`/`https`; ohne Kamera kann man Bilder hochladen.

## Änderungen (älter)

### [noch nicht gepusht] Secret-Module: Passwörter, Notizen, 2FA-Authenticator (Pro)

**Dateien:** `lib/vault.ts`, `lib/totp.ts`, `app/page.tsx`, `components/Sidebar.tsx`,
`components/PasswordsPanel.tsx`, `components/NotesPanel.tsx`,
`components/TotpPanel.tsx`, `components/UpgradeWall.tsx`, `app/globals.css`

**Was:** Die drei ersten Privacy-Module im Dashboard, gespeichert als
`secrets` im v3-Container (verschlüsselt im Vault, Sync/Export/Import inklusive).

- **Passwörter:** Liste, Anlegen/Bearbeiten/Löschen, Anzeigen/Ausblenden,
  Passwort-Generator (24 Zeichen, crypto.getRandomValues).
- **Notizen:** Karten-Layout, Anlegen/Bearbeiten/Löschen, mehrzeiliger Inhalt.
- **2FA-Authenticator:** TOTP-Codes (RFC 6238, WebCrypto HMAC) live im Browser
  mit Countdown-Balken (wird rot in den letzten 15 %). Hinzufügen per
  Base32-Secret (mit Generieren) **oder per otpauth://-Link** (Parser in
  `lib/totp.ts`, Standard-Backup/QR-Export). Ziffern 6/7/8, Periode 30/60.
- **TOTP getestet:** alle offiziellen RFC-6238-Testvektoren bestanden
  (SHA1/6 digits, 5 Zeitpunkte).
- **Pro-Gating:** Module sind in der Sidebar sichtbar; ohne Pro-Abo erscheint
  eine Upgrade-Wall (Button → „Konto & Zahlungen"). Mit `?pro=1` im URL lassen
  sich die Module lokal ohne Abo testen (Dev-Hilfe, nur UI-Gate – echtes
  Gating bleibt die Storage-/Subscription-Ebene).
- **Unlock:** Module benötigen wie Dateien den entsperrten Vault
  (Master-Key aus Wallet-Signatur, RAM-only) – erscheint als Unlock-Prompt.
- Schema: `SecretEntry` (`password | note | totp`); `issuer`, `secretBase32`,
  `digits`, `period`, `algorithm` für TOTP.

## Änderungen (älter)

### [noch nicht gepusht] Datenmodell v3 — Basis für Secret-Module (Passwörter/Notizen/2FA)

**Dateien:** `lib/vault.ts`, `app/page.tsx`

**Was:** Vault speichert jetzt einen **Container** `{ v: 3, files, secrets }`
statt eines reinen Datei-Arrays.

- `SecretEntry` (kind: `password` | `note` | `totp`) mit Feldern für Titel,
  Benutzer, Passwort, URL, Notiz-Text, TOTP (`secretBase32`, `digits`, `period`,
  `algorithm`).
- **Migration:** `parseVaultContainer()` versteht das alte v2-Array-Format
  (Ältere Vaults bleiben lesbar) — Sync, Export/Import decken beide Formate ab
  und mergen in `mergeContainer()`.
- JSON-Sync (`pushSync/pullSync`) und `.vault`-Export/Import laufen jetzt über
  den v3-Container — **kryptographisch unverändert** (AES-256-GCM, Master-Key
  RAM-only), **keine Storage-/Pricing-Logik angerührt** (bleibt für die
  Neuplanung mit Partner unverändert).
- **Quota:** `usedBytes()` zählt weiterhin nur `files` — Secrets verbrauchen
  keinen Cloud-Speicher (liegen im kleinen verschlüsselten Index).

**Getestet:** `tsc --noEmit` ok, Seite lädt (HTTP 200, keine Dev-Fehler).

### [noch nicht gepusht] Step 1 — „Wallet verbinden"-Button im Landing-Header

**Dateien:** `components/Landing.tsx`, `app/globals.css`

**Was:** Dritter Button ergänzt. Header zeigt jetzt `Anmelden · Registrieren ·
Wallet verbinden` (zuvor: `Anmelden · Kostenlos starten`, beide 1:1 Wallet-Connect).

- `navcta` im Haupt-Header: neuer primärer Button **„Wallet verbinden"** mit
  Wallet-Icon (SVG `WalletIcon`), verbindet Browser-Wallet (MetaMask etc.) oder
  fällt auf WalletConnect (QR für Mobil) zurück, verbindet auf Filecoin
  Calibration (kostenlos testen).
- Beide bisherigen Buttons umbenannt/angeordnet (Anmelden, Registrieren) und
  bleiben vorerst als Kurzweg zum selben Connect-Flow (bewusst: Auth-Ausbau
  folgt in späteren Steps).
- Utility-Leiste (ganz oben): „Anmelden", „Registrieren" und ein Akzent-Link
  „Wallet verbinden" ergänzt.
- **Fehler-Toasts:** `useConnect`-Fehler werden jetzt angezeigt (roter Toast
  oben rechts beim Navigations-Suchfeld-Ende statt still zu scheitern).
- CSS: `.wicon` (Icon-Abstand), `.utilwallet`, `.connecterror`,
  `.navconnecterr` (Toast).

**Warum:** Sichtbarer, professioneller Wallet-Einstieg auf der Landingpage.
Danach läuft der bestehende Flow: Connect → Dashboard → „Cloud entsperren"
(Signatur → HKDF → AES-256-Master-Key = verschlüsselte Sitzung, 30-Min-Auto-Lock).

**Getestet:** `tsc --noEmit` ok; Dev-Server rendert Buttons (2× Anmelden,
2× Registrieren, Wallet verbinden inkl. Icons).

### [noch nicht gepusht] Initial lokaler Stand

- Repo aus `FocVault-main.zip` (GitHub-Archive, Commit `1b5e587…`) lokal
  entpackt und Git-Repo initialisiert (`git init -b main`)
- Remote `origin` = `https://github.com/davidkotov/FocVault.git` gesetzt
  (Repo muss auf GitHub existieren bzw. Zugriff muss beim ersten Push klappen)
- `.gitignore` neu angelegt (vorher nicht vorhanden: `node_modules`,
  `.next`, `.env*.local` wären sonst ins Repo gekommen)
- `DEV-LOG.md` (diese Datei) neu angelegt
- Umgebung: Node v24.21.0 + npm 11.19.0 installiert (ohne sudo, `~/.local`)
- `npm install` erfolgreich (Next 14.2.35, wagmi 2.12.11, viem 2.56.8,
  Synapse-SDK 2.0.0) und `npm run dev` verifiziert: läuft auf
  http://localhost:3000, HTTP 200, Title „FocVault"

## Offene Punkte / Known Issues

- **Push-Freigabe ausstehend:** Das private Repo `davidkotov/FocVault` ist
  aktuell über den vorhandenen Token (Account `filelambo`) nicht erreichbar.
  Partner `davidkotov` lädt `filelambo` als Contributor ein; danach legt
  User einen neuen PAT an → erster `git push origin main` wird dann gemacht.
- Quell-Archive enthielt **keine** `.env.local.example`, obwohl `README.md`
  unter „Setup" darauf verweist — README-Setup ist PowerShell-Weg (`npm.cmd`),
  für macOS/Bash anpassen?
- Sicherheits-Punkte aus `SECURITY-AUDIT.md` (u. a. **C1: Master-Key
  nicht wiederherstellbar / nicht portabel**, bricht „cross-device sync")
  sind noch nicht adressiert.
- Kein Test-Setup vorhanden (`npm test` existiert nicht in `package.json`).

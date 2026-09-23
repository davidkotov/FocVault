# FocVault — deine Privacy Cloud

Eine persönliche Privacy-Cloud auf Filecoin Onchain Cloud (FOC): **Identity/Keys als
Root of Trust**, Ende-zu-Ende-Verschlüsselung im Browser, eine komfortable
Cloud-Oberfläche („My Cloud") und darunter eine dezentrale, PDP-verifizierte
Storage-Schicht. Bezahlt wird on-chain per USDFC Payment-Rails – genau so lange
wie gespeichert wird.

## Architektur (4 Schichten)

```
┌─────────────────────────────────────────────────────┐
│  Nutzer: Web / PWA / (später Mobile-App, Desktop)  │
├─────────────────────────────────────────────────────┤
│  Identity & Keys (Root of Trust)                    │
│  Wallet-Signatur → HKDF-SHA256 → AES-256 Master-Key │
├─────────────────────────────────────────────────────┤
│  My Cloud (Oberfläche)                              │
│  Files (Auto-Ordner: Fotos/Dokumente/Videos/Backups)│
│  Secure Send (Share-Links, Key im URL-Fragment)     │
│  Roadmap: Passwords · Passkeys · Notes · Backup     │
├─────────────────────────────────────────────────────┤
│  Client-Side Crypto: AES-256-GCM, Chunking (256 MiB)│
│  Key-Wrapping, Vault-Sync (on-chain, verschlüsselt) │
├─────────────────────────────────────────────────────┤
│  Storage-Schicht: Filecoin Onchain Cloud            │
│  PDP-verifiziert · 2 Kopien · Rails pro Epoch       │
└─────────────────────────────────────────────────────┘
```

**Abgrenzung zu fil.one/S3-Diensten:** fil.one ist S3-Objektstorage für Teams
(Buckets, API-Keys, Terabyte-Pipelines). FocVault ist die Consumer-Privacy-Cloud
darüber: Identity-Layer, E2EE, komfortable Oberfläche, kein Mindestbetrag.
Keine Überlappung – wir sind die App-Schicht, sie die Infrastruktur-Schicht.

**Roadmap (Personal Cloud OS):**

| Modul | Beschreibung | Status |
|---|---|---|
| Files + Secure Send | Speichern, Teilen, Geräte-Sync | ✅ gebaut |
| Passwords / Passkeys | Passwort-Manager als Root-of-Trust-Modul | geplant |
| Secure Notes | verschlüsselte Notizen | geplant |
| Device-Backup | Foto-/Geräte-Backups mit Policy („min. 3 Orte") | geplant |
| Bring your own Storage | Filecoin + NAS + S3 als Ziele, verschlüsselt davor | geplant |
| Mobile-App | Capacitor + Biometrie-Key-Storage | geplant |

## Setup

```powershell
cd focvault
npm.cmd install
Copy-Item .env.local.example .env.local
npm.cmd run dev
```

App: http://localhost:3000

## Testnet-Vorbereitung (Calibration, kostenlos)

1. **Wallet**: MetaMask o.ä. verbinden – beim Verbinden wird Calibration
   (Chain-ID 314159) automatisch vorgeschlagen.
2. **tFIL** (Gas): Faucet https://faucet.calibnet.chainsafe-fil.io/funds.html
3. **tUSDFC** (Storage-Zahlung): Faucet
   https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc
4. Vault entschlüsseln (einmalige Signatur), Datei hochladen, im Wallet die
   Deposit/Approval-Tx bestätigen.

Für Mainnet: im UI oben auf „Zu Mainnet“ wechseln (echte FIL + USDFC nötig;
USDFC Mainnet: `0x80B98d3aa09ffff255c3ba4A241111Ff1262F045`).

## Pro-Tier: SubscriptionGate deployen (optional)

1. https://remix.ethereum.org öffnen, `contracts/SubscriptionGate.sol` laden.
2. Compiler 0.8.24, EVM-Version paris/london.
3. Deploy auf **Filecoin Calibration** mit:
   - `token` = `0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0` (tUSDFC)
   - `treasury_` = eigene Einnahmen-Adresse
   - `pricePerMonth_` = z.B. `5000000000000000000` (5 USDFC, **18 Dezimalen** – USDFC folgt FIL, nicht USDC)
4. Deploy-Adresse in `.env.local`:
   ```
   NEXT_PUBLIC_SUB_GATE_ADDRESS=0x…
   ```
5. Dev-Server neu starten. Unter „Tier“ erscheint „Pro aktivieren (USDFC)“.

## Projektstruktur

```
app/            Next.js App Router (page, providers, globals.css)
lib/
  chains.ts     Filecoin Mainnet/Calibration + USDFC-Adressen (aus FOC-Doku)
  crypto.ts     HKDF-Master-Key, AES-256-GCM, Key-Wrapping, Vault-Export
  synapse.ts    Synapse-SDK-Wrapper (prepare/upload/download)
  vault.ts      localStorage-Index, Tier-Quotas, Formater
  abis.ts       ERC20 + SubscriptionGate ABI
components/     WalletBar, VaultUnlock, UploadZone, FileList, ProPanel
contracts/      SubscriptionGate.sol
```

## Quotas & Pricing (2026-09, mit Partner abgestimmt)

| Tier | Quota | Preis | Freischaltung |
|---|---|---|---|
| Free | 5 GB | 0 CHF | automatisch; danach Pay-as-you-go (Self-Pay, echte Filecoin-Kosten) |
| Pro | 2 TB | 13.90 CHF/Monat (Stripe ab Release) | Gate-Contract heute (USDFC), Stripe später |
| Family | 2 TB geteilt (2–6 Mitglieder) | 19.90 CHF/Monat | Roadmap (Stripe) |
| Business | individuell | individuell | Custom |

**Storage-Strategie / Kosten-Realität (FOC offiziell):**
- Storage: $2.50/TiB/Monat pro Kopie (≈ 0,5 Rp/GB/Monat bei 2 Kopien), plus
  $0.12/Dataset/Monat flat + ~$0.50 USDFC Lifecycle-Reserve + $0.025 einmalig.
- **Dataset-Reuse:** ein persistenter Datensatz pro Konto & Chain
  (`getVaultContexts()` in `lib/synapse.ts`, IDs in localStorage) statt neuer
  Datasets pro Upload/Session → spart die $0.12/Dataset/Monat-Gebühren.
- Übergang: Heute Self-Pay (Kunde finanziert sein Storage-Guthaben selbst, 0 %
  Aufschlag). Die 5-GB-Free-Usage wird später über das **Admin-/Backend-Konto**
  bezahlt; Abos laufen dann über **Stripe** (CZ/Stripe-Integration = Step 3 mit
  Partner). Die App-Marge kommt aus den Abos, nicht aus den Storage-Bytes.
- `prepare()` zeigt weiter vor jedem Upload die echte USDFC-Einzahlung/Monatsrate.

## Sicherheit & Recht

- Master-Key nur im RAM der Session; Vault-Export AES-verschlüsselt.
- Private Keys niemals committen; `.env*` ist ignoriert.
- Als Hosting-Dienst in der EU gelten DSA-Pflichten (Takedown-Prozess,
  Impressum, DSGVO). Zero-Knowledge entbindet nicht von Melde-/Löschpflichten
  für abuse-Reports – vor dem Launch anwaltlich prüfen lassen.

## Secure Send & Auto-Lock (v0.4)

- **Auto-Lock:** Master-Key wird nach 30 Min Inaktivität aus dem RAM entfernt
  (Interaktion = Klick/Tastatur/Scroll/Touch). „Sofort sperren" im Vault-Panel.
- **Secure Send:** Datei teilen ohne Empfänger-Konto:
  - File-Key wird entschlüsselt und mit einem Zufalls-**Link-Key** neu verschlüsselt
  - Share-Datensatz (Metadaten + gewrappter Key, Ablaufdatum 1/7/30 Tage) wird als
    eigener verschlüsselter Piece on-chain gespeichert
  - Link: `/s/<pieceCid>#<linkKey>` – der Key steckt im URL-Fragment (#) und wird
    **nie** an einen Server übertragen
  - Empfänger: beliebige Wallet (nur zum Piece-Abruf, keine Tx, keine Kosten),
    Entschlüsselung lokal im Browser, Ablauf wird clientseitig geprüft
  - Ehrlich: der Cipher-Piece bleibt bis zum Rail-Ablauf on-chain – ohne Link-Key
    ist er nutzlos (Zero-Knowledge)

## Mobile & Zahlungen: 3 kostenlose Registrierungen schalten alles frei

| Feature | Was tun | Eintrag in `.env.local` |
|---|---|---|
| **WalletConnect** (Mobile-Wallets, PWA-Install) | Project-ID holen: https://cloud.walletconnect.com | `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` |
| **Squid Router Widget** (USDC/ETH von jeder Chain → Filecoin) | Integrator-ID: https://docs.squidrouter.com | `NEXT_PUBLIC_SQUID_INTEGRATOR_ID` |
| **On-Ramp** (Kreditkarte → FIL/USDFC) | MoonPay/Transak-API-Key beantragen | folgt in v0.4 |

Ohne Keys läuft die App trotzdem – dann per Browser-Wallet + Faucet/Testnet.

## Mobile-Roadmap

1. **PWA (fertig):** Manifest + Icons liegen in `public/`, App ist installierbar
   (Android: „Zum Startbildschirm hinzufügen", iOS: Teilen → „Zum Home-Bildschirm").
2. **WalletConnect:** Key oben eintragen → Mobile-Wallets verbinden sich per QR/Deep-Link.
3. **Capacitor-Wrapper (v0.5):** App-Store/Play-Store-Builds mit nativen Extras:
   Biometrie-Speicher für den Master-Key (Secure Enclave/Keystore), Share-Sheet
   („In FocVault sichern"), Kamera-Upload. Reine Wrapper werden von Apple §4.2
   abgelehnt – die nativen Extras sind Pflicht.

## Bekannte MVP-Grenzen

- Chunk-Verschlüsselung hält alle Chunks im RAM (2 GB File ≈ 2 GB Browser-Speicher) –
  Streaming-Encrypt folgt in v0.3.
- Löschen entfernt nur den Vault-Eintrag; Pieces bleiben bis zum
  Rail-Ablauf on-chain (Deposit-Kontrolle & Withdraw via Konto-Panel).
- Pro-Tier-Quota wird client-seitig geprüft (Bypass möglich) – server-seitiges
  Gating + Session Keys sind der nächste Schritt.
- USDFC-Anzeige mit 18 Dezimalen (USDFC folgt FIL-Präzision, NICHT USDC mit 6).
- Sync-Auto-Push feuert nach jeder Vault-Änderung (unsichtbar bei Fehlern);
  bewusst einfach gehalten – Versionierung des Index folgt.

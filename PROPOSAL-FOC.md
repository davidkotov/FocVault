# FocVault → Filecoin Onchain Cloud Community

Ziel: Eintrag auf https://docs.filecoin.cloud/resources/community-projects +
Sichtbarkeit im FOC/Filecoin-Ökosystem (FilOzone, FIL-Builders, Filecoin Foundation).

## Voraussetzungen (vor dem PR)

1. **Öffentliches GitHub-Repo** – die Listings verlinken Source; ohne Repo kein Eintrag.
   `focvault` auf GitHub pushen (ohne `.env.local`, siehe .gitignore – ist vorbereitet).
2. **Stabile Demo-URL** – aktuell `http://179.43.188.2:3000` (Calibration Testnet).
   Besser vor dem PR: kostenloses HTTPS-Deployment (Vercel) + eigene Domain.

## A) Eintrag für die Community-Projects-Seite (PR-Inhalt)

Einzufügen in `docs/src/content/docs/resources/community-projects.mdx`
(Repo: https://github.com/FilOzone/synapse-sdk,Ordner `docs/src/content/docs/resources/`)
unter **Additional Community Projects** als neue Unterkategorie **Apps**:

```md
### Apps

#### FocVault

**[FocVault](https://<DEINE-DOMAIN>)** — A consumer privacy cloud built on
Filecoin Onchain Cloud: identity/keys as root of trust, end-to-end encryption,
and a comfortable cloud UI over a decentralized, verifiable storage layer.
Think "MEGA + Bitwarden on FOC", not another S3 pipeline.

- Client-side AES-256-GCM encryption — keys derived via HKDF from a wallet
  signature, never leave the device; the operator only ever sees ciphertext
  and piece CIDs
- Chunked uploads (256 MiB pieces) using Synapse split operations
  (store → presignForCommit → pull → commit) so all chunks share batch
  transactions with minimal wallet prompts
- Transparent payments UX: `prepare()` cost preview before every upload,
  account runway monitoring via `accountSummary()`, one-click `withdraw()`
- Encrypted vault index synced on-chain (piece + CID registry in a
  SubscriptionGate contract) for cross-device recovery without any backend
- Progressive Web App, installable on mobile, WalletConnect-ready

Demo: [Open Demo](https://<DEINE-DOMAIN>) (Filecoin Calibration testnet)
Source: [GitHub](https://github.com/<USER>/focvault)
```

## B) PR-Beschreibung (copy-paste)

```text
Title: docs: add FocVault to community projects (Apps)

FocVault is a consumer-facing zero-knowledge file vault built on Synapse/FOC.
It demonstrates several patterns the docs currently don't show in a real app:

- split-operation uploads with presignForCommit batching (minimal wallet
  prompts for multi-piece files)
- full payments UX: prepare() preview, accountSummary() runway, withdraw()
- client-side encryption pipeline (HKDF from wallet signature → AES-256-GCM)
- on-chain encrypted vault sync via a small registry contract

Live demo on Calibration testnet: https://<DEINE-DOMAIN>
Happy to adjust the entry to match the page's format.
```

## C) Kurz-Pitch (Discord/X, FilOzone + Filecoin-Kanäle)

```text
We built FocVault — a zero-knowledge consumer file vault on Filecoin
Onchain Cloud (Synapse SDK).

🔒 AES-256-GCM in-browser, keys never leave the device
🧩 chunked uploads via split ops + presign batching
⚡ pay-per-epoch UX: cost preview, runway, 1-click withdraw
🔄 encrypted vault sync on-chain, no backend

Live on Calibration testnet: https://<DEINE-DOMAIN>
Would love feedback + a community-projects listing:
https://github.com/FilOzone/synapse-sdk/pull/<NR>
```

## D) Danach: Grants

- **Filecoin Foundation Grants** (grants.filecoin.io): "Community / Dev Tooling"
  – FocVault passt als Consumer-Showcase für FOC-Adoption.
- Ask: ~$10–25k für 3 Monate (Mobile-App via Capacitor + Biometrie-Key-Storage,
  Fiat-On-Ramp, Mainnet-Launch inkl. Audit des SubscriptionGate).

## Squid-Integrator-ID (aktuell blockiert)

Typeform ist zu – offizieller Weg laut deren Doku: **Squid-Discord, Kanal
#developers**, dort um eine Integrator-ID bitten. Bis dahin:

- Link-out auf https://v2.app.squidrouter.com funktioniert für User ohne ID
- WalletConnect-Project-ID priorisieren (schaltet Mobile frei)
- In-App-Swap-Widget erst nach ID – alternativ Sushi-Widget prüfen

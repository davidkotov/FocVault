# FocVault – Zielarchitektur & Umsetzungsauftrag

> **Zweck:** Verbindliche Architektur für den Ausbau von FocVault vom Wallet-MVP zur
> B2C-Privacy-Cloud mit **Fil One als Storage-Lieferant**. Dieses Dokument ist der
> Auftrag für die Implementierung (Zielmodell: Opus 5.5 als ausführender Agent) und
> die Referenz für Reviews durch `davidkotov` / `filelambo`.
>
> **Stand:** 2026-09-27 · Code-Basis `main` = `3ece43c` (Sprint A gemergt, PR #3) ·
> ergänzt `ROADMAP.md` (Was/Wann) um das **Wie**. Bei Widerspruch gilt: Code-Fakten in
> §2 sind verifiziert; Zielentscheidungen in §3–§14 gelten, bis §16 anders entschieden wird.
>
> **Sprache:** Deutsch, Code-Bezeichner Englisch. Pfade sind Repo-relativ.

---

## 0. Zusammenfassung (für Eilige)

| Thema | Heute (MVP) | Ziel |
|---|---|---|
| Storage-Einkauf | Nutzer zahlt selbst via Wallet/USDFC an Filecoin Onchain Cloud (Synapse SDK), pro Epoche, 2 Datasets/Konto | **FocVault kauft Storage bei Fil One** (S3-kompatibel, Filecoin-gesichert, $4.99/TB/Monat, EU-Region), Nutzer zahlt CHF via Stripe |
| Identität | Wallet-Signatur ⇒ Master-Key (Salt nur in `localStorage`, **nicht wiederherstellbar**, Audit C1) | Account (Passkey / E-Mail) + **zufälliger Master-Key**, gewrappt durch Passphrase-KEK, Passkey-PRF und **Recovery-Kit**; Wallet bleibt optionale Login-Methode |
| Zero-Knowledge | ✅ AES-256-GCM clientseitig, Frames 16 MiB | ✅ **unverändert** – Backend und Fil One sehen nur Ciphertext + Metadaten-Minimum |
| Backend | keines (alles im Browser, `localStorage` im Klartext) | **Backend-Service** (Auth, Presigned URLs, Quota, Shares, Billing, Family, Audit) in der EU |
| Secure Send | Key im URL-Fragment, Ablauf/Einmal-Link nur clientseitig | Key bleibt im Fragment; **Ablauf, Einmal-Link, Download-Limit, Widerruf global** durch Backend; Empfänger braucht **keine Wallet** |
| Quota/Abo | clientseitig, `?pro=1`-Bypass, SubscriptionGate on-chain (defekt, Audit H1) | serverseitig, Stripe-Entitlements, Ciphertext-Bytes zählen |
| Filecoin-Nachweis | PDP über Synapse, für Nutzer unsichtbar | Fil One-Verifikation (CID, tägliche Prüfung) sichtbar im UI + exportierbares Zertifikat |

**Nicht verhandelbar (Invarianten, §3.3):** Kein Klartext-Dateiinhalt, kein Dateischlüssel,
kein Master-Key und kein Share-Passwort verlässt je das Endgerät. Backend und Fil One sind
„honest-but-curious“-Gegner im Threat-Model.

---

## 1. Produkt & Positionierung

- **Was:** Persönliche Privacy-Cloud („MEGA + Bitwarden“) mit Files, Secure Send, Passwörtern,
  Notizen, 2FA – Ende-zu-Ende-verschlüsselt, komfortables UI (bestehendes Design bleibt).
- **Für wen:** B2C, DACH-first (UI Deutsch, CHF), später Family und kleine Teams.
- **Storage-Lieferant:** **Fil One** (fil.one) – S3-kompatibler Object Storage auf Filecoin.
  Storage Provider müssen fortlaufend kryptografische Nachweise liefern; Fil One prüft Objekte
  ~alle 24 h gegen ihre CID. **Wir sind die App-/Identitäts-/Krypto-Schicht, Fil One die
  Infrastruktur-Schicht.** (README §„Abgrenzung“ ist damit die Lieferanten-Beziehung, kein Wettbewerb.)
- **Warum Fil One statt Direkt-FOC (Synapse):**
  - B2C-Nutzer wollen weder Wallet, USDFC, Gas noch „Runway in Epochen“. Stripe/CHF ist Pflicht.
  - Kalkulierbare Kosten: $4.99/TB/Monat, **keine Egress-Gebühren** (Downloads/CDN-Fälle kosten
    uns nichts extra), Minimum $4.99/Monat pro Konto – für **uns** ein Konto, nicht pro Nutzer.
  - EU-Region (Frankreich) ⇒ DSGVO/Datenresidenz sauber argumentierbar.
  - S3-API ⇒ Standard-Tooling, Multipart, Presigned URLs; **Ciphertext ist portabel** (Exit-Strategie §5.7).
- **Was bleibt vom Web3-Kern:** Filecoin-Verifizierbarkeit als Vertrauensanker (Proof-Zertifikat, §13),
  Wallet-Login als eine von mehreren Identitäten, Ciphertext-Format unverändert.

---

## 2. Ist-Zustand (verifiziert, `main` @ `3ece43c`)

### 2.1 Struktur

```
app/                 Next.js 14 App Router, alles 'use client' außer layout.tsx
  page.tsx           Landing (Wallet-Modus entfernt, 09/2026)
  s/[id]/page.tsx    Secure-Send-Empfängerseite v3 (Konto-Modus, Link-ID + Fragment s.<key> | p.<salt>.<iv>.<cipher>)
  providers.tsx      wagmi (Calibration 314159 + Mainnet 314, injected + optional WalletConnect)
components/          Landing, Sidebar, Topbar, FileList, account/* (Auth, Pakete, Secure Send), admin/* (inkl. FOC),
                     UpgradeWall, PasswordsPanel, NotesPanel, TotpPanel, QrScanModal
lib/
  crypto.ts          HKDF-Master-Key, AES-256-GCM, File-Key-Wrap, Frame-Format, Share-Fragmente, PBKDF2
  vault.ts           VaultContainer v3 {files, secrets}, TIERS, folderFor, localStorage-Index
  synapse.ts         Synapse-SDK-Wrapper (withCDN, 2 Kopien, Dataset-Reuse v3, Streams)
  share.ts           createShareUrl / openShare / downloadSharedFile
  totp.ts, csv.ts, chains.ts, idb.ts, abis.ts
contracts/SubscriptionGate.sol   USDFC-Abo + syncIndex-Registry (Calibration)
.github/workflows/ci.yml         tsc --noEmit + vitest (11 Tests), bewusst kein next build
```

### 2.2 Krypto heute (bleibt größtenteils)

- **Master-Key:** `deriveMasterKey(signature, salt)` = HKDF-SHA-256(IKM = UTF-8(Signatur),
  salt = 16 Zufallsbytes aus `localStorage focvault:salt:<addr>`, info `focvault-master-v1`)
  → AES-GCM-256, non-extractable. **Problem C1:** Salt existiert nur in einem Browser.
- **File-Key:** 32 Zufallsbytes pro Datei, `wrapFileKey` (AES-GCM unter Master-Key) → `{wrapped, iv}`.
- **Frame-Format (`fmt: 'frame'`):** Datei → 256-MiB-Pieces → 16-MiB-Blöcke; pro Block
  `[u32le cipherLen][AES-GCM(cipher||tag)]`, IV = `baseIv[0..7] || u32be(counter)`, Ende mit NUL
  auf ≥ 127 Bytes gepolstert. `streamCipherPlan`, `encryptedPieceStream`, `decryptPieceFrames`.
- **Vault-Container:** `[12-Byte IV][AES-GCM(JSON)]` unter Master-Key (`encryptVaultJsonBytes`).
- **Secure Send:** Link-Key 32 Bytes; `ShareRecord` (enthält **rohen File-Key**) als Container
  unter Link-Key; Fragment-Formate v2 mit PBKDF2-SHA-256 (310 000) Key-Wrap.

### 2.3 Speicher- und Zustandsorte (alle Client-lokal)

| Ort | Inhalt | Bewertung |
|---|---|---|
| `focvault:salt:<addr>` | HKDF-Salt (hex) | **C1** – Verlust = Datenverlust |
| `focvault:vault:<addr>` | `VaultContainer` v3 **im Klartext** (Dateinamen, CIDs, gewrappte Keys, **Passwörter/TOTP-Secrets**) | **H4** – muss verschlüsselt ruhen |
| `focvault:datasets:<chain>:<addr>` | `{v:3, ids:[a,b]}` Synapse-Datasets | entfällt mit Fil One |
| `focvault:syncCid:<addr>` | PieceCID des letzten Index-Push | entfällt |
| `focvault:share:uses:<cid>` | Einmal-/Limit-Zähler (best effort) | wird durch Backend ersetzt |
| IndexedDB `focvault-download` | entschlüsselte Download-Parts (Firefox/Safari) | bleibt |

### 2.4 Befunde, die die Zielarchitektur beheben muss

| ID | Befund | Quelle | Konsequenz in Zielarchitektur |
|---|---|---|---|
| **D1** | `downloadSharedFile` (`lib/share.ts:122-143`) entschlüsselt jeden Chunk mit **einem** `crypto.subtle.decrypt` und ignoriert `fmt:'frame'`/`padLen`. `UploadZone` erzeugt seit dem Streaming-Umbau **nur** Frame-Chunks ⇒ Secure Send scheitert für alle neu hochgeladenen Dateien an der GCM-Auth. | Kartierung 27.09. | **Hotfix vor allem anderen** (§15 Phase 0): Frame-Pfad wie `handleDownload` in `app/page.tsx:296-405` nutzen (`openPieceStream` + `decryptPieceFrames`), Legacy-Pfad nur bei fehlendem `fmt`. Test mit Frame-Fixture. |
| **C1** | Master-Key nicht wiederherstellbar; Cross-Device unmöglich | SECURITY-AUDIT | §4: zufälliger Master-Key + mehrere KEKs + Recovery-Kit; Wallet-KEK mit **deterministischem** Salt |
| **H1** | `SubscriptionGate.MAX_CID_LENGTH = 64` verwirft echte PieceCIDs (64–67 Z.) | Audit | Gate wird für Abo/Sync **nicht mehr benötigt** (Stripe, Backend-Index). Vertrag optional als „Pay with Crypto“ später neu deployen |
| **H2/H3** | Sync-Fehler verschluckt; Transaktionen ohne Kostenvorschau | Audit | Entfällt mit Backend-Index; jede Fehlermeldung wird sichtbar (Fehler-Taxonomie §8.6) |
| **H4** | Klartext-Index in `localStorage` | Audit | §14.2: Index ruht nur verschlüsselt (IndexedDB), Secrets nie im Klartext at rest |
| **H5** | 22 Dependency-CVEs (next 14.2.x, wagmi-Pin) | Audit | Phase 0: Upgrade-Slot, Renovate/Dependabot |
| **H6** | Keine CSP/Security-Header | Audit | §12.3 Header-Set in `next.config.mjs` |
| **M4** | AES-GCM ohne AAD, Chunks nicht positionsgebunden | Audit | §4.6 AAD-Schema für Frame-Format v2 (rückwärtskompatibel) |
| **M8** | Unbekannte Chain fällt still auf Calibration zurück | Audit | Wallet-Login nur noch Identität, kein Storage-Pfad |
| **M11** | Share-Key bleibt in `window.location.hash` | Audit | Empfängerseite ersetzt Hash nach dem Lesen (`history.replaceState`) |
| **M13/L6** | Quota clientseitig, Klartext-Bytes, `?pro=1` | Audit | §11: Quota serverseitig auf Ciphertext-Bytes, Dev-Bypass nur hinter `NODE_ENV !== 'production'` |
| **A1** | `app/page.tsx` ist ein ~700-Zeilen-Monolith mit Krypto, Sync, Download, UI | Kartierung | §14.1 Feature-Module + Storage-Adapter |
| **A2** | `lib/synapse.ts` greift in SDK-Interna (`_readClient`), `AnySynapse = any` | Kartierung | Wird zum Legacy-Adapter hinter Feature-Flag isoliert |

---

## 3. Zielarchitektur – Überblick

### 3.1 Systemkontext

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Endgerät (Browser / PWA, später Capacitor)                                   │
│  ┌──────────────┐  ┌────────────────┐  ┌─────────────────┐  ┌──────────────┐  │
│  │ UI (Next.js) │  │ Crypto-Kern    │  │ Vault-Store     │  │ Storage-     │  │
│  │ bestehendes  │  │ lib/crypto.ts  │  │ IndexedDB, nur  │  │ Adapter      │  │
│  │ Design       │  │ (unverändert)  │  │ verschlüsselt   │  │ (S3-Presign) │  │
│  └──────┬───────┘  └───────┬────────┘  └────────┬────────┘  └──────┬───────┘  │
│         │  Klartext & Schlüssel bleiben hier  │                    │           │
└─────────┼──────────────────────────────────────┼────────────────────┼──────────┘
          │ HTTPS/JSON (nur Metadaten, Ciphertext-Blobs für Index/Share)        │ HTTPS PUT/GET
          ▼                                                                       ▼ (Presigned, SigV4)
┌───────────────────────────────────────────────┐        ┌───────────────────────────────────────┐
│  FocVault Backend (EU)                         │        │  Fil One S3 (eu-west-1, Frankreich)   │
│  Auth · Vault-Index · Objects · Shares ·       │ SigV4  │  Bucket focvault-prod-eu               │
│  Entitlements/Quota · Billing (Stripe) ·       │ ─────▶ │  Objekte = Ciphertext-Pieces           │
│  Family · Usage-Ledger · Audit · Abuse/DSA     │        │  Filecoin-Proofs, CID-Verifikation     │
│  Postgres (EU) · Cron (Trash/Expiry)           │        └───────────────────────────────────────┘
└───────────────┬───────────────────────────────┘
                │ Webhooks
                ▼
        ┌───────────────┐
        │  Stripe       │  Abos Pro/Family, Pay-as-you-go (metered), CHF
        └───────────────┘
```

### 3.2 Komponenten und Verantwortungen

| Komponente | Verantwortung | Sieht |
|---|---|---|
| **Client** | Schlüsselableitung, Ver-/Entschlüsselung, Vault-Index-Pflege, Upload/Download direkt zu/von Fil One über Presigned URLs, UI | Alles (Klartext) – nur hier |
| **Backend** | Identität/Sessions, Autorisierung, Presigned URLs ausstellen, Quota/Entitlements, Share-Policy (Ablauf, Uses, Widerruf), Vault-Index-Blob-Ablage (verschlüsselt), Billing, Family-Verwaltung, Audit, Abuse | Ciphertext-Blobs, Objekt-IDs/Größen, Account-Daten, Zahlungsdaten (Stripe-IDs) – **nie** Dateinamen im Klartext (§7: Dateinamen liegen nur im verschlüsselten Index) |
| **Fil One** | Persistenz der Ciphertext-Objekte, Multipart, Filecoin-Proofs, CID-Verifikation | Ciphertext, Objekt-Key (opak), Größe |
| **Stripe** | Zahlung, Abo-Status, Rechnungen | Kunden-E-Mail, Zahlungsmittel |

### 3.3 Zero-Knowledge-Invarianten (verbindlich)

1. Dateiinhalt, Dateinamen, Secrets (Passwörter/Notizen/TOTP) verlassen das Gerät **nur** als
   AES-256-GCM-Ciphertext. Der Backend-Index kennt Objekt-IDs, Ciphertext-Größen, Zeitstempel –
   **keine Dateinamen, keine MIME-Typen**. (Suche/Ordner laufen clientseitig über den entschlüsselten Index.)
2. Master-Key, File-Keys, Link-Keys, Space-Keys existieren im Klartext nur im RAM des Clients
   (non-extractable `CryptoKey`, Auto-Lock 30 min bleibt).
3. Passwörter (Account-Passphrase, Share-Passwort) werden **nie** an das Backend gesendet; das Backend
   erhält nur Verifier (Argon2id-Hash eines clientseitig abgeleiteten Verifizierers, §4.4/§10.3).
4. Secure-Send-Link-Key steht ausschließlich im URL-Fragment (`#`), das der Browser nicht sendet.
5. Jeder Ciphertext ist an seinen Kontext gebunden (AAD, §4.6), damit Backend/Fil One Objekte nicht
   unbemerkt vertauschen können.
6. Alles, was gegen 1–5 verstößt, ist ein **Blocker**, kein Trade-off.

---

## 4. Identität & Schlüsselhierarchie (Ziel)

### 4.1 Prinzip

Der Master-Key ist **zufällig** (256 Bit, einmal pro Account) und wird durch mehrere unabhängige
**Key-Encryption-Keys (KEK)** gewrappt. Verlust eines KEK ist kein Datenverlust, solange ein
anderer existiert. Das behebt C1 strukturell und macht Cross-Device trivial: Der gewrappte
Master-Key liegt (verschlüsselt) beim Backend, wird auf jedem Gerät geladen und lokal entwrappt.

```
                    ┌──────────── Master-Key (MK, 256 Bit, random) ────────────┐
                    │  wrappt: File-Keys, Vault-Index-Key, Space-Keys (Family)  │
                    └───────────────────────────────────────────────────────────┘
        ▲ unwrap                ▲ unwrap                 ▲ unwrap                ▲ unwrap
  KEK_passphrase          KEK_passkey (PRF)         KEK_recovery            KEK_wallet (legacy/opt.)
  Argon2id(passphrase,    WebAuthn PRF-Ext →         24-Wort-Kit (BIP39-      HKDF(personal_sign(msg),
  salt_user)  → 256 Bit   HKDF → 256 Bit             Entropie 256 Bit)        salt = SHA-256("focvault-
                                                                                 wallet-v2"||addr))
```

Backend speichert pro Account: `mk_wrapped_by_passphrase`, `mk_wrapped_by_passkey[]`,
`mk_wrapped_by_recovery`, optional `mk_wrapped_by_wallet` – jeweils `{iv, cipher}` unter AES-GCM
mit dem jeweiligen KEK. Das Backend kann keinen davon öffnen.

### 4.2 Login-Methoden (Account-Identität, getrennt vom Schlüssel)

| Methode | Identität (Backend-Session) | Schlüssel-Unlock (Client) | Status |
|---|---|---|---|
| **Passkey** (empfohlen, wie Fil One selbst) | WebAuthn-Assertion | PRF-Extension → `KEK_passkey`; Fallback: Passphrase | Primär |
| **E-Mail + Passphrase** | Magic-Link/OTP zur E-Mail-Verifikation + Session | Argon2id(passphrase) → `KEK_passphrase` | Primär |
| **Wallet** (bestehende Nutzer) | SIWE-Signatur (EIP-4361) | `KEK_wallet` (deterministischer Salt) | Optional, Legacy |

Passphrase ≠ Login-Passwort: Die Passphrase verlässt das Gerät nie; für die Session-Authentifizierung
wird ein davon **unabhängiger** Verifier verwendet (§4.4).

### 4.3 Ableitungen (verbindlich)

- `KEK_passphrase = Argon2id(passphrase, salt_user, m=64 MiB, t=3, p=1) → 32 Byte` (im Browser via
  WASM, z. B. `hash-wasm`; PBKDF2 nur als Fallback, wenn WASM fehlt, dann ≥ 600 000 Iterationen).
- Aus demselben Argon2id-Output werden per **HKDF mit unterschiedlichem `info`** zwei Schlüssel abgeleitet:
  `KEK_passphrase = HKDF(out, info="focvault/kek/passphrase/v1")`,
  `auth_verifier_secret = HKDF(out, info="focvault/auth/verifier/v1")`.
  Nur der `auth_verifier_secret` geht (einmalig bei Registrierung als Argon2id-Hash serverseitig gespeichert,
  bei Login als Challenge-Response) zum Backend. Der KEK nie.
- `KEK_passkey = HKDF(PRF_output, info="focvault/kek/passkey/v1")`, PRF-Salt = `SHA-256("focvault-prf-v1" || account_id)`.
- `KEK_recovery = HKDF(entropy_256, info="focvault/kek/recovery/v1")`, Anzeige als 24 Wörter (BIP39-Wortliste,
  deutsch/englisch wählbar) + druckbares PDF mit QR. **Pflicht** bei Registrierung, Bestätigung durch Eingabe von 3 Wörtern.
- `KEK_wallet = HKDF(UTF-8(signature), salt = SHA-256("focvault-wallet-v2" || lowercase(addr)), info="focvault/kek/wallet/v2")`.
  Nur EOA-Wallets zulassen (Signatur muss deterministisch sein); Smart-Contract-Wallets → Hinweis, Passphrase nutzen.
- **Migration bestehender Wallet-Nutzer (Calibration, Testdaten):** Beim ersten Login nach Umstellung:
  alten Master-Key (HKDF v1 mit `localStorage`-Salt) ableiten, falls Salt vorhanden → Vault entschlüsseln →
  neuen zufälligen MK erzeugen, alle File-Keys re-wrappen (nur Keys, **nicht** Ciphertext) → MK mit `KEK_wallet` v2
  und Recovery-Kit wrappen. Fehlt der alte Salt, ist der alte Vault verloren (war es vorher auch – ehrlich kommunizieren).

### 4.4 Session/Auth

- Sessions: HttpOnly-Cookie, `SameSite=Lax`, Rotation bei Privilegien-Änderung, 30 Tage gleitend,
  Geräteliste mit Widerruf. Sensible Aktionen (Recovery-Kit neu, Passkey entfernen, Account löschen) verlangen
  frische Re-Authentifizierung (wie bei Fil One).
- 2FA: TOTP/Security-Key optional für Login. **Kein SMS/E-Mail-OTP als zweiter Faktor.**

### 4.5 Familien & geteilte Räume (Space-Keys)

- Jeder Account erhält ein **X25519-Schlüsselpaar**; Public-Key beim Backend, Private-Key durch MK gewrappt.
- Ein **Space** (Family-Raum) hat einen zufälligen `SpaceKey`. Für jedes Mitglied wird `SpaceKey` mit
  ECDH(X25519)+HKDF→AES-GCM für dessen Public-Key gewrappt (Sender = Einladender). Dateien im Space haben
  File-Keys, die mit `SpaceKey` statt MK gewrappt sind.
- Mitglied entfernen ⇒ neuer `SpaceKey`, Re-Wrap aller Space-File-Keys (nur Keys), Backend lehnt neue
  Presigned URLs für den Alt-Mitglied-Account ab (Autorisierung serverseitig, Krypto clientseitig).

### 4.6 AAD-Schema (Frame-Format v2, rückwärtskompatibel)

Neue Uploads setzen `fmt: 'frame2'`. Pro Frame wird AAD gesetzt:
`AAD = "focvault/frame/v2" || object_id(16 Byte) || u32be(piece_index) || u32be(frame_index) || u64be(clear_size)`.
Vault-Index-Container: `AAD = "focvault/index/v1" || account_id || u64be(index_version)`.
`fmt: 'frame'`-Altchunks werden weiterhin ohne AAD entschlüsselt (Testnet-Altdaten). Kein Re-Encrypt nötig.

---

## 5. Storage-Schicht: Fil One S3

### 5.1 Fakten (docs.fil.one, Stand 27.09.2026 – bei Umsetzung erneut prüfen)

| Punkt | Wert | Auswirkung |
|---|---|---|
| Endpoint EU | `https://eu-west-1.s3.filonecontent.com` (nur HTTPS) | Region fest pro Bucket und pro Access-Key |
| Auth | SigV4, **Path-Style Pflicht**, kein Virtual-Hosted | `forcePathStyle: true` im AWS SDK |
| Bucket anlegen (EU) | **nur Dashboard**, Region/Versioning/Object Lock/Retention **bei Erstellung permanent** | Buckets werden manuell provisioniert; Konfiguration in §5.2 vorab festlegen |
| Bucket-Limit | 100 (eu-west-1) | **Ein Bucket pro Umgebung + Prefixe**, kein Bucket pro Nutzer |
| Multipart | Part 5 MB–5 GB, max. 10 000 Parts, Objekt ≤ 5 TB (AWS-Standardwerte, von Fil One nicht garantiert) | 16-MiB-Frames ⇒ ein Part = ein oder mehrere Frames; 256-MiB-Piece = 16 Parts |
| Nicht unterstützt | Bucket-Policies, ACLs, Public Access, Lifecycle, Event-Notifications, Tagging, Logging (403 statt 501) | **Alles** über Presigned URLs; Trash/Expiry/Purge als eigener Cron; keine S3-Events ⇒ Upload-Abschluss explizit an Backend melden |
| Object Lock | Governance/Compliance, 1 Tag–100 Jahre, nur versionierte Buckets | Grundlage für „Immutable/Archive“-Tier (separater Bucket) |
| Verschlüsselung | serverseitig immer an (Fil-One-Schlüssel) | Zusätzlich zu unserer E2E – irrelevant für Vertraulichkeit, kein Ersatz |
| Löschung | logisch sofort; versiegelte Filecoin-Sektoren können begrenzt nachlaufen | Ehrlich dokumentieren; Ciphertext ohne Key wertlos |
| Preis | $4.99/TB/Monat, Minimum $4.99/Monat, keine Egress-/Request-Gebühren (bezahlt), Trial 1 TB/30 Tage mit 2 TB Egress-Cap | Kostenmodell §11.4 |
| Rate-Limits | vom Gateway; `SlowDown`/`503` ⇒ Exponential Backoff | Retry-Policy im Client-Adapter (§5.5) |

### 5.2 Buckets (manuell im Dashboard anlegen, Namen ohne Punkte)

| Bucket | Region | Versioning | Object Lock | Zweck |
|---|---|---|---|---|
| `focvault-prod-eu` | eu-west-1 | aus | aus | Standard-Storage (Files, Index-Blobs, Share-Blobs) |
| `focvault-prod-eu-archive` | eu-west-1 | an | Compliance, Default 0 (pro Objekt gesetzt) | „Immutable“-Tier (Sprint D) |
| `focvault-staging-eu` | eu-west-1 | aus | aus | Staging + CI-Contract-Tests |
| `focvault-dev-eu` | eu-west-1 | aus | aus | Entwicklung |

Access-Keys: pro Umgebung ein Key mit minimalen Rechten (Put/Get/Delete/Multipart auf genau diesen Bucket),
nur im Backend-Secret-Store. **Clients erhalten nie Access-Keys**, nur Presigned URLs.

### 5.3 Objekt-Key-Schema (opak, keine Nutzerdaten)

```
u/<account_id>/o/<object_id>/p/<piece_index>        Ciphertext-Piece (Frame-Format)
u/<account_id>/idx/<index_version>                  Vault-Index-Container (verschlüsselt)
u/<account_id>/mk/<kek_type>/<kek_id>               gewrappter Master-Key (klein; alternativ nur in Postgres)
s/<share_id>/rec                                    Secure-Send-Record (verschlüsselt unter Link-Key)
sp/<space_id>/o/<object_id>/p/<piece_index>         Family-Space-Objekte
```
`account_id`, `object_id`, `share_id`, `space_id` = UUIDv7 (zeitlich sortierbar, nicht erratbar).
Keine Dateinamen, keine MIME-Typen, keine Klartext-Hashes im Key.

### 5.4 Upload-Protokoll (Client ⇄ Backend ⇄ Fil One)

1. Client: `streamCipherPlan(size)` ⇒ Pieces/Frames/`cipherSize`; `POST /objects` mit `{cipher_bytes, pieces:[{index, cipher_bytes, parts}]}`.
2. Backend: Quota-Check (Ciphertext-Bytes, §11.2), `object` als `state=uploading` anlegen, pro Piece `CreateMultipartUpload`,
   Presigned `UploadPart`-URLs (TTL 60 min, Parts je 16 MiB = Frame-Grenzen oder 5 GB-Bündel bei kleinen Dateien) zurückgeben.
3. Client: verschlüsselt streamend (`encryptedPieceStream`), `PUT` jeder Part direkt zu Fil One, sammelt `ETag`s; Fortschritt/Abort/Pause wie heute.
   Retry pro Part bei `5xx`/`SlowDown` (Backoff 1 s → 32 s, max. 6 Versuche); bei Ablauf der URL neue via `POST /objects/:id/parts/refresh`.
4. Client: `POST /objects/:id/complete` mit `{pieces:[{index, etags[]}]}`; Backend ruft `CompleteMultipartUpload`, prüft `HeadObject`-Größe == erwartete `cipher_bytes`,
   setzt `state=stored`, bucht Usage-Ledger. Bei Abweichung: `AbortMultipartUpload`, `state=failed`, Fehler an Client.
5. Client aktualisiert lokalen Index (File-Key gewrappt, `object_id`, `pieces`, `fmt:'frame2'`), pusht Index (§9.3).
6. Aufräumen: Cron bricht `uploading`-Objekte > 24 h ab (`AbortMultipartUpload`) – Fil One hat keine Lifecycle-Regeln.

### 5.5 Download-Protokoll

- `GET /objects/:id/download` ⇒ Presigned `GetObject`-URLs pro Piece (TTL 15 min, optional `Range` für Resume).
- Client streamt und entschlüsselt (`decryptPieceFrames`) direkt auf Platte (`showSaveFilePicker`) oder IndexedDB-Fallback – wie heute.
- Keine Egress-Kosten ⇒ **kein Download-Zähler nötig für Billing**, nur für Missbrauchserkennung (Rate-Limit pro Account/IP).

### 5.6 Storage-Provider-Interface (Client + Backend)

```ts
// server/storage/provider.ts
export interface StorageProvider {
  createMultipart(key: string): Promise<{ uploadId: string }>
  presignPart(key: string, uploadId: string, partNumber: number, ttlSec: number): Promise<string>
  completeMultipart(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void>
  abortMultipart(key: string, uploadId: string): Promise<void>
  presignGet(key: string, ttlSec: number, range?: { start: number; end?: number }): Promise<string>
  head(key: string): Promise<{ size: number; etag: string }>
  delete(keys: string[]): Promise<void>
  putSmall(key: string, body: Uint8Array): Promise<void>   // Index-/Share-Blobs ≤ 5 MB
  getSmall(key: string): Promise<Uint8Array>
}
```
Implementierungen: `FilOneS3Provider` (AWS SDK v3, `forcePathStyle: true`, Region `eu-west-1`), `MemoryProvider`
(Unit-Tests), `LegacySynapseProvider` **nur clientseitig** hinter Flag `NEXT_PUBLIC_STORAGE_MODE=synapse` (§15 Phase 1: eingefroren, nicht ausgebaut).

### 5.7 Exit-Strategie / Lock-in

Ciphertext-Objekte sind provider-neutral (Frame-Format + unser Index). Ein Wechsel zu einem anderen
S3-Anbieter oder zurück zu Direkt-FOC ist ein Server-zu-Server-Kopiervorgang (`GetObject` → `PutObject`)
ohne Client-Beteiligung und ohne Re-Encrypt. Vertraglich: monatliche Kündbarkeit, Egress kostenlos ⇒ Migration kostenneutral.

---

## 6. Backend-Service

### 6.1 Stack-Entscheidung

| Aspekt | Entscheidung | Begründung |
|---|---|---|
| Sprache/Runtime | TypeScript, Node 24 | Gleiche Sprache/Typen wie Client, Krypto-Typen (`Bytes`) teilbar |
| Framework Phase 1 | **Next.js Route Handlers** (`app/api/**`) im bestehenden Repo, Domain-Logik framework-frei in `server/**` | Schnellster Weg; Vercel-Deployment existiert (`foc-vault.vercel.app`), Region auf `fra1` festlegen |
| Framework ab Phase 3 | Herauslösen von `server/**` in eigenständigen Dienst (Hono/Fastify) auf Fly.io/Hetzner Frankfurt | Backup-Agent, S3-Gateway, Cron-Jobs brauchen langlaufende Prozesse |
| Datenbank | **PostgreSQL** (Neon oder Supabase, Region EU), ORM **Drizzle**, Migrationen versioniert | Relationale Integrität für Ledger/Entitlements; EU-Residenz |
| Cache/Rate-Limit | Upstash Redis (EU) oder Postgres-basiert in Phase 1 | Rate-Limits, Share-Attempt-Zähler |
| Jobs/Cron | Vercel Cron (Phase 1) → Worker-Prozess (Phase 3) | Trash-Purge, Upload-Abort, Share-Expiry, Usage-Snapshots |
| Auth-Lib | `@simplewebauthn/server` (Passkeys), eigene Session-Tabelle, `viem` für SIWE | Keine Auth-SaaS ⇒ keine Drittpartei mit Kontodaten |
| Storage-SDK | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` | SigV4/Presign/Multipart Standard |
| Billing | `stripe` Node SDK, Webhooks mit Signaturprüfung, Idempotenz-Tabelle | |
| E-Mail | Resend oder Postmark (EU-Versand), nur Transaktions-Mails | Verifikation, Magic-Link, Dunning, Share-Benachrichtigung optional |
| Observability | Strukturierte Logs (pino) **ohne** PII/Objekt-Keys, Sentry (EU-Region) mit Scrubbing | |
| Secrets | Vercel-Env (Phase 1) → Doppler/1Password-Connect; Fil-One-Keys pro Umgebung | Rotation dokumentiert |

### 6.2 Modulschnitt (`server/`)

```
server/
  auth/        passkeys, magic-link, siwe, sessions, reauth, devices
  accounts/    account, keys (mk_wrapped_*), recovery, deletion (DSGVO Art. 17), export (Art. 20)
  vault/       index-blobs (versioniert, optimistic locking), device-sync
  objects/     create/complete/abort, presign, pieces, trash, purge, usage-buchung
  shares/      create/open/consume/revoke, policy-enforcement, password-verifier, attempt-limits
  spaces/      family spaces, members, invitations, space-key-envelopes
  billing/     stripe customers, subscriptions, metered usage, webhooks, entitlements
  usage/       ledger (append-only), snapshots, quota-berechnung
  abuse/       takedown-intake, hash-listen (nur Ciphertext-IDs), sperren, DSA-transparenz
  storage/     StorageProvider + FilOneS3Provider + MemoryProvider
  audit/       append-only events (wer/was/wann, ohne Inhalte)
  shared/      errors, ids (uuidv7), validation (zod), time
app/api/**     dünne HTTP-Adapter: Validierung → server/* → JSON
```

Regel: `app/api/**` enthält **keine** Geschäftslogik; `server/**` importiert **nichts** aus `app/` oder `components/`.

---

## 7. Datenmodell (PostgreSQL, Skizze)

```sql
-- Identität
accounts(id uuid pk, email citext unique null, email_verified_at, created_at, status enum('active','readonly','suspended','deleted'),
         locale, region default 'eu')
account_keys(id uuid pk, account_id fk, kek_type enum('passphrase','passkey','recovery','wallet'), kek_id text,
             mk_wrapped bytea, mk_iv bytea, kdf_params jsonb, created_at, revoked_at)
auth_passkeys(id uuid pk, account_id fk, credential_id bytea unique, public_key bytea, counter bigint, transports text[],
              prf_supported bool, label, created_at, last_used_at)
auth_password_verifiers(account_id pk fk, verifier_hash bytea, salt bytea, params jsonb, updated_at)
auth_wallets(account_id fk, address bytea unique, chain_id int, created_at)
sessions(id uuid pk, account_id fk, device_id, created_at, last_seen_at, expires_at, strong_auth_at, revoked_at, ua_hash, ip_hash)
x25519_keys(account_id pk fk, public_key bytea, private_key_wrapped bytea, iv bytea)

-- Vault-Index (verschlüsselt, versioniert)
vault_indexes(account_id fk, version bigint, storage_key text, size int, sha256 bytea, created_at, pk(account_id, version))

-- Objekte
objects(id uuid pk, owner_account_id fk null, space_id fk null, state enum('uploading','stored','trashed','purging','failed'),
        cipher_bytes bigint, piece_count int, fmt text, created_at, stored_at, trashed_at, purge_after, lock_until null)
object_pieces(object_id fk, piece_index int, storage_key text, cipher_bytes bigint, upload_id text null, etag text null,
              pk(object_id, piece_index))

-- Secure Send
shares(id uuid pk, owner_account_id fk, object_id fk, record_storage_key text, expires_at, max_uses int null,
       burn_after_use bool, uses int default 0, password_verifier_hash bytea null, revoked_at, created_at)
share_events(id bigserial, share_id fk, kind enum('open','consume','password_fail','revoke'), at, ip_hash)

-- Family
spaces(id uuid pk, owner_account_id fk, name_encrypted bytea, created_at)
space_members(space_id fk, account_id fk, role enum('owner','member'), space_key_wrapped bytea, iv bytea, from_pub bytea, joined_at,
              pk(space_id, account_id))
space_invites(id uuid pk, space_id fk, email citext, token_hash bytea, expires_at, accepted_at)

-- Billing / Nutzung
billing_customers(account_id pk fk, stripe_customer_id text unique)
subscriptions(id uuid pk, account_id fk, stripe_subscription_id unique, plan enum('free','pro','family','business'),
              status, current_period_end, cancel_at, quota_bytes bigint, seats int)
usage_ledger(id bigserial pk, account_id fk, delta_bytes bigint, reason enum('store','purge','adjust'), object_id null, at)
usage_snapshots(account_id fk, day date, stored_bytes bigint, pk(account_id, day))
stripe_events(id text pk, type, received_at, processed_at)   -- Idempotenz

-- Audit / Abuse
audit_events(id bigserial pk, account_id null, actor enum('user','system','admin'), kind, meta jsonb, at)
abuse_reports(id uuid pk, target_kind enum('share','object'), target_id, reporter_contact, reason, state, created_at, decided_at)
```

Hinweise: `cipher_bytes` ist die Quota-Basis. `name_encrypted` bei Spaces ist Ciphertext unter `SpaceKey`.
Keine Spalte enthält Dateinamen, MIME oder Klartext-Hashes von Inhalten.

---

## 8. API-Vertrag (REST, JSON, `/api/v1`)

Alle Endpunkte: Session-Cookie (außer öffentlich markiert), `zod`-Validierung, Fehlerformat §8.6,
Rate-Limits §12.4. IDs als UUIDv7-Strings, Bytes als Base64url.

### 8.1 Auth & Account
```
POST /auth/register            {email}                                  → 202 (Verifikations-Mail)
POST /auth/verify-email        {token}                                  → 200 {account_id}
POST /auth/passkey/options     {}                                       → WebAuthn Creation/Request Options (mit PRF-Ext)
POST /auth/passkey/register    {attestation}                            → 200 {passkey_id, prf_supported}
POST /auth/passkey/login       {assertion}                              → 200 Set-Cookie
POST /auth/password/challenge  {email}                                  → {salt, params, nonce}
POST /auth/password/login      {email, proof}                           → 200 Set-Cookie   (proof = HMAC(verifier_secret, nonce))
POST /auth/wallet/nonce        {address}                                → {message}        (SIWE)
POST /auth/wallet/login        {message, signature}                     → 200 Set-Cookie
POST /auth/logout                                                        → 204
GET  /account                                                            → {id, email, status, plan, quota, used_bytes, keys:[{kek_type, kek_id}], passkeys:[…], wallets:[…]}
PUT  /account/keys             {kek_type, kek_id, mk_wrapped, mk_iv, kdf_params}   → 201  (Reauth erforderlich)
DELETE /account/keys/:id                                                 → 204  (Reauth; letzter Key nicht löschbar)
POST /account/delete           {confirm:true}                           → 202  (30 Tage Frist, dann Purge)
GET  /account/export                                                     → Stream (Index-Blobs + Objekt-Liste; Art. 20)
```

### 8.2 Vault-Index
```
GET  /vault/index                          → {version, url (presigned GET), size, sha256}   404 wenn leer
PUT  /vault/index   {base_version, size, sha256}  → {version, url (presigned PUT)}         409 bei Versionskonflikt
POST /vault/index/:version/commit          → 204   (Backend prüft HeadObject-Größe/SHA)
```
Client-Merge-Regel bei 409: Index laden, `mergeContainer` (heute in `app/page.tsx`), erneut `PUT` mit neuer `base_version`.

### 8.3 Objekte
```
POST /objects                {cipher_bytes, fmt:'frame2', pieces:[{index, cipher_bytes, part_count}], space_id?}
                              → 201 {object_id, pieces:[{index, upload_id, parts:[{part_number, url, expires_at}]}]}   402 quota
POST /objects/:id/parts/refresh {piece_index, part_numbers[]}  → {parts:[…]}
POST /objects/:id/complete   {pieces:[{index, etags:[…]}]}     → 200 {state:'stored', stored_at}
POST /objects/:id/abort                                          → 204
GET  /objects/:id/download   {range?}                            → {pieces:[{index, url, expires_at, cipher_bytes}]}
POST /objects/:id/trash                                          → 200 {purge_after}
POST /objects/:id/restore                                        → 200
DELETE /objects/:id                                              → 202 (sofortiger Purge, Reauth bei >1 GB optional)
GET  /objects?state=stored|trashed&cursor=                       → {items:[{id, cipher_bytes, state, created_at}], next}
```

### 8.4 Secure Send
```
POST /shares                 {object_id, expires_in_ms, max_uses?, burn_after_use?, password_verifier?, record_size}
                              → 201 {share_id, record_upload_url}          (Client lädt verschlüsselten Record hoch)
POST /shares/:id/commit                                          → 204
GET  /s/:id                  (öffentlich)                        → {state:'ok'|'expired'|'revoked'|'exhausted', password_required, record_url?, uses_left?}
POST /s/:id/unlock           (öffentlich) {proof}                → {record_url}      429 nach 5 Fehlversuchen/15 min
POST /s/:id/consume          (öffentlich) {download_token}       → {pieces:[{index, url}], uses_left}   409 exhausted
POST /shares/:id/revoke                                          → 204
GET  /shares                                                     → {items:[{id, object_id, expires_at, uses, max_uses, revoked_at}]}
```
Semantik: `consume` zählt **einmal pro Download-Start** (nicht pro Piece) und ist atomar (`UPDATE … WHERE uses < max_uses RETURNING`).
`burn_after_use` ⇒ `max_uses = 1` + Record-Blob wird nach erstem `consume` + 15 min gelöscht.

### 8.5 Family, Billing
```
POST /spaces {name_encrypted}                    → {space_id}
POST /spaces/:id/invites {email}                 → 202 (Mail mit Token)
POST /spaces/invites/accept {token, my_pub}      → {space_id, inviter_pub}       (Client holt Envelope später)
PUT  /spaces/:id/members/:account/envelope {space_key_wrapped, iv, from_pub}  → 204   (nur Owner)
DELETE /spaces/:id/members/:account              → 204  (Owner; Client rotiert SpaceKey danach)
GET  /billing/portal                              → {url}      (Stripe Customer Portal)
POST /billing/checkout {plan:'pro'|'family'}      → {url}
POST /billing/webhook  (Stripe-Signatur)          → 204
GET  /billing/usage                               → {stored_bytes, quota_bytes, plan, period_end, payg_bytes, payg_estimate_chf}
```

### 8.6 Fehlerformat & Taxonomie
```json
{ "error": { "code": "QUOTA_EXCEEDED", "message": "Speicherplatz reicht nicht (2,3 GB frei).", "details": { "free_bytes": 2469606195 } } }
```
Codes (Auszug): `UNAUTHENTICATED`, `REAUTH_REQUIRED`, `FORBIDDEN`, `NOT_FOUND`, `VERSION_CONFLICT`, `QUOTA_EXCEEDED`,
`PLAN_REQUIRED`, `SHARE_EXPIRED`, `SHARE_REVOKED`, `SHARE_EXHAUSTED`, `SHARE_PASSWORD_INVALID`, `RATE_LIMITED`,
`STORAGE_UNAVAILABLE` (Fil One 5xx nach Retries), `UPLOAD_SIZE_MISMATCH`. Kein Fehler wird still verschluckt (H2).

---

## 9. Kernabläufe

### 9.1 Registrierung & erster Unlock
1. E-Mail → Verifikations-Link → Account `active`.
2. Client erzeugt `MK` (random), `salt_user`, Argon2id(passphrase) → `KEK_passphrase` + `auth_verifier_secret`;
   Recovery-Kit (24 Wörter) → `KEK_recovery`; X25519-Paar.
3. Client sendet: `mk_wrapped_by_passphrase`, `mk_wrapped_by_recovery`, `verifier_hash`-Material, `x25519_pub`, `x25519_priv_wrapped`.
4. Optional Passkey mit PRF ⇒ `mk_wrapped_by_passkey`.
5. Leerer Index (`v3`) verschlüsselt → `PUT /vault/index`.

### 9.2 Unlock auf neuem Gerät
Login (Passkey/E-Mail/Wallet) → `GET /account` liefert gewrappte MKs → Client wählt verfügbaren KEK
(Passkey-PRF ohne Eingabe; sonst Passphrase-Prompt) → MK im RAM → `GET /vault/index` → entschlüsseln → UI.
Auto-Lock 30 min löscht MK aus RAM (bleibt).

### 9.3 Index-Sync (ersetzt On-Chain-Sync)
Jede Mutation (Upload, Delete, Secret) ⇒ lokaler Index verschlüsselt in IndexedDB (H4 behoben) ⇒ debounced (2 s)
`PUT /vault/index` mit `base_version`. 409 ⇒ Merge (lokal gewinnt bei ID-Kollision, Löschungen als Tombstones mit
`deletedAt`, 30 Tage) ⇒ erneut. Fehler werden angezeigt („Sync ausstehend“-Badge), nie verschluckt.

### 9.4 Upload / Download
Siehe §5.4 / §5.5. UI-Verhalten (Drag&Drop, Fortschritt, Abort, Pause) bleibt; Kostenvorschau entfällt (Abo/PAYG statt Epochen)
und wird durch „Belegt X von Y“ + PAYG-Schätzung ersetzt.

### 9.5 Secure Send (v3, Backend-gestützt)
**Erstellen:** Client entwrappt File-Key, erzeugt `linkKey`, baut `ShareRecord` (v2: `object_id`, `pieces`, `fmt`, `fileKey`, `name`, `type`, `size`),
verschlüsselt unter `linkKey` (AAD `"focvault/share/v1"||share_id`), optional Passwort: heutiges `p.`-Fragment **plus**
`password_verifier = HKDF(PBKDF2-Output, info="focvault/share/verifier/v1")` an Backend (Argon2id-gehasht gespeichert).
URL: `https://<host>/s/<share_id>#<fragment>` – **Fragment-Formate v2 bleiben identisch** (bare | `s.` | `p.`).
**Öffnen:** `GET /s/:id` (Policy, ohne Key) → ggf. Passwort → Client leitet `pwdKey` + `verifier` ab → `POST /s/:id/unlock {proof}`
→ `record_url` → Record entschlüsseln → `POST /s/:id/consume` → Piece-URLs → Frame-Entschlüsselung (D1 behoben).
Empfängerseite entfernt Fragment aus der URL nach dem Lesen (M11). **Keine Wallet nötig.**
**Widerruf:** `POST /shares/:id/revoke` ⇒ sofort global wirksam (Backend stellt keine URLs mehr aus).

### 9.6 Papierkorb & Löschen
`trash` ⇒ `state=trashed`, `purge_after = now + 30 d`, Quota bleibt belegt (ehrlich anzeigen); `restore` innerhalb Frist;
Cron purgt (`DeleteObjects` bis 1 000 Keys/Call) und bucht `usage_ledger(-bytes)`. Vault-Versionen (T5) nutzen dieselbe
Mechanik über `objects` mit `superseded_by`.

### 9.7 Abo & Pay-as-you-go
Checkout → Stripe-Webhook `customer.subscription.*` ⇒ `subscriptions` aktualisieren ⇒ Entitlement (`quota_bytes`).
Free: 5 GB. Überschreitung Free ⇒ Upload blockiert (`QUOTA_EXCEEDED`) **oder** PAYG aktivieren (Zahlungsmittel hinterlegt):
täglicher Snapshot `stored_bytes` ⇒ monatlich `usage_records` an Stripe (metered price „GB-Monat“ in CHF).
Zahlungsausfall ⇒ nach 14 Tagen `status=readonly` (Downloads weiter möglich), nach 90 Tagen Löschankündigung, nach 120 Tagen Purge.

### 9.8 Recovery
„Passphrase vergessen“ ⇒ Recovery-Kit eingeben ⇒ `KEK_recovery` ⇒ MK ⇒ neue Passphrase setzen ⇒ neues `mk_wrapped_by_passphrase`
(Reauth via E-Mail-Link, da Session-Verifier neu). Kein Backend-Mitarbeiter kann Daten wiederherstellen – im UI so benennen.

---

## 10. Secure Send – Sicherheitsdetails

1. **Link-Key im Fragment**, Record- und Piece-Zugriff über kurzlebige Presigned URLs (15 min), ausgestellt nur nach Policy-Check.
2. **Passwort:** Offline-Brute-Force gegen das `p.`-Fragment bleibt möglich (PBKDF2 310k) – deshalb zusätzlich Online-Verifier mit
   Attempt-Limit (5/15 min pro Share+IP-Hash) als **zweite Hürde**; Passwort-Entropie-Hinweis im Dialog.
3. **Einmal-/Limit-Links** sind jetzt global atomar (§8.4). Die heutigen `localStorage`-Zähler entfallen.
4. **Widerruf** sofort; abgelaufene/widerrufene Shares: Record-Blob nach 7 Tagen löschen (Tombstone bleibt für „Link ungültig“).
5. **Empfänger-Datenschutz:** Keine Account-Pflicht; IP nur als gesalzener Hash im Attempt-Limiter, 30 Tage.
6. **Abuse:** Meldeformular auf `/s/:id` (DSA Art. 16) ⇒ `abuse_reports` ⇒ Sperre ⇒ Transparenz-Log (§12.6).

---

## 11. Billing, Quota, Kosten

### 11.1 Pläne (fixiert, `lib/vault.ts TIERS` bleibt Quelle für Labels)
| Plan | Quota | Preis | Bemerkung |
|---|---|---|---|
| Free | 5 GB | 0 CHF | von FocVault finanziert |
| Pay-as-you-go | ab 5 GB | echte Kosten + Marge (Vorschlag 0.60 CHF/100 GB-Monat) | Zahlungsmittel nötig |
| Pro | 2 TB | 13.90 CHF/Monat | |
| Family | 2 TB geteilt, 2–6 Mitglieder | 19.90 CHF/Monat | Space-Keys §4.5 |
| Business/Custom | individuell | individuell | Sprint D |

### 11.2 Quota-Berechnung (serverseitig, verbindlich)
`used_bytes = Σ cipher_bytes(objects.state ∈ {stored, trashed})` pro Account (Space-Objekte zählen auf den Space-Owner).
Secrets zählen **nicht** (Index-Blobs sind Schlüsselcontainer, Entscheidung ROADMAP §5). Overhead (Frame-Header, GCM-Tags,
Padding) ist im Ciphertext enthalten ⇒ ehrlich und ohne Client-Manipulation.

### 11.3 Entitlement-Check
`POST /objects` prüft `used_bytes + cipher_bytes ≤ quota_bytes` **oder** PAYG aktiv. Client zeigt dieselbe Zahl (aus `GET /billing/usage`),
rechnet aber nichts mehr autoritativ. `?pro=1` nur bei `NODE_ENV !== 'production'`.

### 11.4 Kostenmodell (Fil One)
- Einkauf: $4.99/TB/Monat ≈ 0.45 Rp/GB/Monat (bei 1 USD ≈ 0.90 CHF; Kurs quartalsweise nachziehen), Minimum $4.99/Monat gesamt.
- Pro-Vollnutzer (2 TB) kostet ≈ 9 CHF/Monat ⇒ Marge 4.90 CHF; realistische Auslastung (< 30 %) ⇒ Marge > 10 CHF.
- Free-Nutzer (5 GB) ≈ 2.3 Rp/Monat ⇒ 10 000 Free-Nutzer ≈ 230 CHF/Monat.
- Egress 0 ⇒ Secure Send/Downloads sind kostenneutral; Stripe-Gebühren (≈ 2.9 % + 0.30) einpreisen.
- Kennzahl im Admin-Dashboard: `stored_TB_total`, `cost_estimate_usd`, `mrr_chf`, Deckungsbeitrag.

---

## 12. Sicherheit & Compliance

### 12.1 Threat-Model (Kurzform)
| Angreifer | Ziel | Gegenmaßnahme |
|---|---|---|
| Fil One / Backend-Betreiber (honest-but-curious) | Inhalte lesen | E2E, Zero-Knowledge-Invarianten, opake Keys, AAD |
| Backend kompromittiert | Objekte vertauschen, Shares umleiten, Quota fälschen | AAD-Bindung, signierte Presign-Policies mit TTL, Audit-Log, Alerts |
| Gestohlenes Gerät (gesperrt) | MK | MK nur im RAM, Auto-Lock, Passkey/Passphrase nötig |
| Gestohlenes Gerät (entsperrt) | Daten | Session-Widerruf über Geräteliste, Reauth für sensible Aktionen |
| Link-Leak (Secure Send) | Datei | Ablauf, Einmal-Link, Widerruf, Passwort + Online-Limiter |
| Phishing | Account | Passkeys (origin-gebunden), keine SMS-2FA, SIWE mit Domain-Bindung |
| Insider mit DB-Zugriff | Metadaten | Keine Dateinamen/MIME in DB, IP nur gehasht, Zugriff protokolliert |

### 12.2 Krypto-Bibliotheken
WebCrypto (AES-GCM, HKDF, ECDH X25519 wo verfügbar – sonst `@noble/curves`), `hash-wasm` (Argon2id), `@simplewebauthn/*`.
Keine eigenen Primitiven. Alle KDF-Parameter in `kdf_params` versioniert ⇒ spätere Härtung ohne Migration.

### 12.3 Web-Härtung (`next.config.mjs`)
CSP (`default-src 'self'`; `connect-src 'self' https://*.s3.filonecontent.com https://api.stripe.com` + Wallet-RPCs nur im Web3-Modus),
`Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy: no-referrer` (Fragment-Schutz), `Permissions-Policy` (Kamera nur für QR-Scan),
`Cross-Origin-Opener-Policy`. Nonces für Inline-Skripte statt `'unsafe-inline'`.

### 12.4 Rate-Limits (pro Account bzw. IP-Hash)
Login 10/15 min · Share-Unlock 5/15 min · `POST /objects` 60/min · Presign-Refresh 600/min · öffentliche `GET /s/:id` 120/min.

### 12.5 Betrieb
Secrets-Rotation (Fil-One-Keys quartalsweise), Backups der Postgres (PITR, EU), Restore-Test monatlich, Dependency-Updates
wöchentlich (Renovate), `npm audit` in CI als Warnung, jährlicher externer Pen-Test vor Mainnet-/Public-Launch.

### 12.6 Recht (EU/CH)
Hosting-Dienst ⇒ DSA-Pflichten: Melde-/Abhilfeverfahren, Kontaktstelle, Transparenzbericht; DSGVO: AVV mit Fil One, Stripe,
E-Mail-Provider; Datenexport (Art. 20), Löschung (Art. 17) automatisiert (§8.1). Impressum/AGB/Datenschutz vor Launch anwaltlich prüfen.
Zero-Knowledge entbindet nicht von Takedown bei gemeldeten Share-Links (Sperrung per `share_id`).

---

## 13. Filecoin-Verifizierbarkeit („Proof“)

- Ziel: Nutzer sehen pro Datei „Auf Filecoin gesichert · zuletzt verifiziert <Datum>“ und können ein **Zertifikat** exportieren
  (Objekt-IDs, Ciphertext-SHA-256, Fil-One-CIDs, Zeitstempel, Anbieter, Region).
- **Offene technische Frage (§16 E5):** Ob Fil One CIDs/Verifikationsstatus pro Objekt über API/Dashboard-Export bereitstellt.
  Bis zur Klärung: Zertifikat mit unseren SHA-256-Hashes + Fil-One-Zusicherung (SLA-Link); UI-Wording darf nicht mehr behaupten als belegbar.
- Eigene Integritätsprüfung unabhängig davon: Cron zieht stichprobenartig `HeadObject` (ETag/Größe) und verifiziert monatlich pro Account
  1 zufälliges Piece per `GetObject` + SHA-256 gegen `object_pieces` (Kosten: 0 Egress).

---

## 14. Client-Architektur (Refactor, Design bleibt)

### 14.1 Modulschnitt
```
app/(marketing)/page.tsx          Landing (bestehend)
app/(app)/layout.tsx              Auth-Guard, Unlock-Gate, Auto-Lock
app/(app)/cloud|send|passwords|notes|2fa|account/page.tsx
app/s/[id]/page.tsx               Empfängerseite v3
app/api/v1/**                     Route Handlers → server/**
features/
  auth/        useSession, passkey/passphrase/wallet flows, recovery-kit UI
  keys/        KeyRing (MK im RAM, KEK-Unwrap, Auto-Lock), X25519
  vault/       VaultStore (Zustand + IndexedDB verschlüsselt), Sync-Engine (debounce, 409-Merge, Tombstones)
  objects/     UploadQueue (Multipart, Retry, Pause), DownloadEngine (Streams/IDB), StorageClient (Presign-Adapter)
  shares/      create/open flows
  secrets/     Passwords/Notes/TOTP (bestehende Panels, nur Datenzugriff über VaultStore)
  billing/     usage/plan hooks, Checkout/Portal
lib/crypto.ts                     unverändert + AAD-Varianten (frame2, index, share)
lib/legacy/synapse.ts             Legacy-Adapter (Flag), nicht weiterentwickelt
```
State: Zustand-Store pro Feature, `@tanstack/react-query` für Server-Daten (bereits vorhanden). `app/page.tsx` wird aufgelöst.

### 14.2 Datenhaltung im Client
- IndexedDB `focvault`: `index` (verschlüsselter Container + Version), `pending_ops` (Offline-Queue), `download_parts` (bestehend).
- `localStorage` nur noch: UI-Präferenzen, `device_id`. **Kein** Klartext-Index, **keine** Secrets, **kein** Salt mehr.
- Service Worker (PWA) cached nur statische Assets, nie API-Antworten mit Nutzerdaten.

### 14.3 Kompatibilität
- Fragment-Formate Secure Send v2 bleiben lesbar (bare | `s.` | `p.`).
- `fmt: 'frame'` (ohne AAD) und Legacy-Chunks bleiben entschlüsselbar; neue Uploads `frame2`.
- Wallet-Login bleibt; Storage über Wallet/Synapse nur noch im Legacy-Modus (Flag) bis Phase 3, danach entfernen.

---

## 15. Umsetzungsplan (Phasen ⇢ Sprints B–D) mit Abnahmekriterien

Jede Phase endet mit: `tsc --noEmit` grün · Vitest grün · Playwright-E2E grün · CI grün · DEV-LOG-Eintrag · PR-Review durch Partner.
Kein `main`-Direkt-Push; Feature-Branches `feat/<phase>-<thema>`.

### Phase 0 – Hotfix & Fundament (1 Woche)
- **D1 fixen:** `downloadSharedFile` nutzt Frame-Pfad; Vitest mit Frame-Fixture (encrypt → share record → decrypt).
- Security-Header/CSP (H6), `?pro=1` nur non-prod, Referrer-Policy, Fragment-Cleanup (M11).
- Dependency-Upgrade-Slot (H5): Next 14 → aktuellstes 14.x/15, wagmi/viem aktualisieren, `npm audit` in CI.
- `next build` in CI aktivieren (Vercel baut bereits erfolgreich ⇒ Annahme „baut nicht headless“ prüfen und ggf. `dynamic = 'force-dynamic'`
  für Wallet-Seiten setzen).
- **Abnahme:** Secure Send end-to-end mit neu hochgeladener Datei funktioniert (Calibration); Lighthouse-Security ohne CSP-Warnung.

### Phase 1 – Backend-Kern + Fil One Storage (Sprint B, 3–4 Wochen)
- Postgres-Schema §7 (Migrationen), `server/**` Module auth/accounts/vault/objects/storage, Route Handlers §8.1–8.3.
- `FilOneS3Provider` + Contract-Tests gegen `focvault-staging-eu` (in CI nur, wenn Secrets gesetzt; sonst `MemoryProvider`).
- Client: Auth-Flows (E-Mail+Passphrase, Passkey mit PRF-Feature-Detection, Wallet-SIWE), KeyRing, Recovery-Kit, Index-Sync, UploadQueue/DownloadEngine über Presign.
- Feature-Flag `NEXT_PUBLIC_STORAGE_MODE = 'filone' | 'synapse'`; Default `filone` auf Staging.
- H4: Index verschlüsselt in IndexedDB; `localStorage`-Klartext entfernt (Migration beim ersten Start).
- **Abnahme:** Neues Konto → Upload 1 GB → zweites Gerät → Unlock mit Passphrase **und** mit Recovery-Kit → Download byte-identisch;
  Quota-Überschreitung liefert `QUOTA_EXCEEDED`; Fil-One-Objekte enthalten keine Klartext-Metadaten (Stichprobe).

### Phase 2 – Secure Send v3, Papierkorb, Billing (Sprint B/C, 3 Wochen)
- Shares §8.4/§10, Empfängerseite ohne Wallet, Attempt-Limiter, Widerruf-UI.
- Trash/Restore/Purge-Cron (§9.6), Versionierung (T5) auf `objects.superseded_by`.
- Stripe: Produkte Pro/Family/PAYG, Checkout, Portal, Webhooks, Entitlements, Dunning-Zustände.
- **Abnahme:** Einmal-Link von zwei Geräten gleichzeitig ⇒ genau ein Erfolg; Widerruf innerhalb 1 s wirksam; Stripe-Testabo schaltet 2 TB frei,
  Kündigung setzt nach Periodenende auf Free zurück; Free-Konto mit 5.5 GB ohne PAYG blockiert Upload.

### Phase 3 – Family, Betrieb, Herauslösen (Sprint C, 3 Wochen)
- Spaces §4.5/§8.5, Einladungen, Member-Entfernung mit Key-Rotation.
- Admin-Dashboard (Kosten/MRR §11.4, Abuse-Queue, Account-Sperren), Audit-Log-Ansicht.
- `server/**` in eigenständigen Dienst (Fly/Hetzner FRA) heben, Worker für Cron; Vercel bleibt Frontend.
- Legacy-Synapse-Modus entfernen (nach Bestätigung, dass keine Nutzer mehr darauf sind).
- **Abnahme:** Family mit 3 Mitgliedern teilt 2 TB; entferntes Mitglied kann keine neuen Presigned URLs mehr erhalten und alte Keys nützen ihm nichts für neue Dateien.

### Phase 4 – Filecoin-Services (Sprint D)
- Proof-Zertifikat §13, Archive-Bucket mit Object Lock („Immutable“-Tarif), Backup-Agent (CLI, nutzt dieselbe API), S3-Gateway mit E2E (T11).
- **Abnahme:** Zertifikat verifizierbar (SHA-256 der Pieces stimmt), Object-Lock-Datei nicht vor Ablauf löschbar (auch nicht durch Admin).

### Teststrategie
- Unit (Vitest): Krypto (Roundtrips, AAD-Fehlbindung schlägt fehl, Fragment-Formate), Quota-Rechnung, Share-Zustandsmaschine, Merge-Regeln.
- Contract (Vitest, optional Secrets): `FilOneS3Provider` gegen Staging-Bucket – Multipart 3 Parts, Presign GET mit Range, Abort, Head-Size-Check.
- E2E (Playwright): Registrierung, Upload/Download, Secure Send (mit/ohne Passwort, Einmal-Link), Recovery, Stripe-Test-Checkout.
- Last: 50 parallele Uploads à 100 MB gegen Staging (Presign-Latenz, Fil-One-`SlowDown`-Verhalten dokumentieren).

---

## 16. Offene Entscheidungen (bitte vor Phase 1 festlegen)

| # | Frage | Empfehlung | Entscheider |
|---|---|---|---|
| E1 | Wallet-Login weiterhin anbieten? | **Entschieden (27.09.):** Login per **Reown AppKit** (Google, Apple, E-Mail, 80+ Wallets) als Identität via SIWE; Tresorschlüssel bleibt Passphrase + Recovery-Kit. E-Mail + Passphrase bleibt als Alternative | ✅ |
| E2 | Passkey-PRF als Unlock (Browser-Support noch lückenhaft) | Ja mit Feature-Detection; Passphrase bleibt Pflicht-KEK | Tech |
| E3 | Backend in Phase 1 als Next Route Handlers auf Vercel `fra1` vs. sofort eigener Dienst | **Route Handlers** (Tempo), Herauslösen in Phase 3 | Tech |
| E4 | Postgres-Anbieter (Neon EU vs. Supabase EU vs. eigener auf Hetzner) | Neon EU (Branching für Staging), Wechsel jederzeit via Drizzle | Tech |
| E5 | Liefert Fil One CID/Verifikationsstatus pro Objekt per API? | Mit Fil One klären (support@/sales@); bis dahin Zertifikat ohne CID | Partner |
| E6 | Fil-One-Vertrag: Reserved Capacity (1/3/5 Jahre) ab welchem Volumen? | Ab 50 TB stored prüfen | Partner |
| E7 | PAYG-Preis (Vorschlag 0.60 CHF/100 GB-Monat) und Free-Limit 5 GB beibehalten? | Ja | Partner |
| E8 | SubscriptionGate-Vertrag behalten („Pay with Crypto“) oder archivieren? | Archivieren (README-Hinweis), Re-Deploy nur bei Nachfrage mit H1/M5/M6-Fixes | Partner |
| E9 | Zweite Region (us-east-1) für Nicht-EU-Kunden? | Nicht vor Phase 4 | Partner |
| E10 | Marketing-Claim „on-chain“: künftig „auf Filecoin gesichert, Nachweise durch Fil One“ | Anpassen (README, Landing) | Beide |
| E11 | Unterstützt Fil One CORS für Browser-Uploads per Presigned PUT? (in der Doku nicht erwähnt) | Mit Fil One klären. Bis dahin Proxy-Modus (Standard); `FILONE_BROWSER_DIRECT=true` erst nach Test | Partner |

---

## 17a. Umsetzungsstand & Präzisierungen (Phase 0 + 1, 27.09.2026)

Umgesetzt auf `feat/phase1-accounts-storage` (Phase 0 separat in PR #5). Wo die Umsetzung von
§5–§8 abweicht, gilt dieser Abschnitt – jeweils mit Grund:

| Thema | Plan (§) | Umgesetzt | Grund |
|---|---|---|---|
| Upload pro Piece | Multipart, Parts 16 MiB (§5.4) | **ein Presigned PUT pro Piece** | Fil One bestätigt Presigned PUT; nennt Multipart-Checksums „unreliable“. Pieces sind klein genug. |
| Piece-Größe Konto-Modus | 256 MiB | **32 MiB** (`ACCOUNT_PIECE_SIZE`) | Objekte kosten bei Fil One nichts extra → wenig RAM, Retry pro Piece, feinerer Fortschritt |
| Browser ↔ Fil One | direkt (§5.4) | **Proxy über `/api/v1/storage` als Standard**, direkt per `FILONE_BROWSER_DIRECT=true` | CORS bei Fil One nicht dokumentiert (E11) |
| Flexible Checksums AWS SDK | – | **abgeschaltet** (`WHEN_REQUIRED`) | Fil One: „Additional-checksum operations are unreliable“ |
| Index-Blobs | Presigned (§8.2) | **über die API** (`PUT/GET /vault/index`, ≤ 8 MB) | klein, spart einen Roundtrip; Storage-Key mit Zufallsanteil gegen Wettläufe |
| Passphrase-Login | HMAC-Challenge (§8.1) | **Auth-Key** (HKDF-getrennt vom KEK) wird gesendet, Server speichert scrypt-Hash | gleiches Schutzziel (Passphrase/KEK verlassen nie das Gerät), einfacher, bewährt |
| ORM | Drizzle (§6.1) | **parametrisiertes SQL** hinter `Db`-Interface; lokal **PGlite**, Prod `pg` | keine Codegenerierung, gleiches SQL in Tests (echtes Postgres im RAM) |
| Frame-Format | `frame2` mit Frame-Index in AAD (§4.6) | AAD = `focvault/frame/v2` ‖ Objekt-ID ‖ Piece-Index | Frame-Position ist bereits über die IV (baseIv + Zähler) gebunden |
| Löschen | Papierkorb 30 Tage (§9.6) | **Papierkorb für Pro/Family** (Frist im Preisbuch, Standard 30 Tage, zählt zur Quota), Free löscht sofort nach Bestätigung | Papierkorb als Abo-Vorteil |
| Secure Send Konto-Dateien | §9.5 | **umgesetzt** (Migration v6, serverseitiges Limit, Widerruf) | – |
| E-Mail-Verifikation | §8.1 | **noch nicht** (`email_verified_at` bleibt leer) | braucht E-Mail-Provider |
| Rate-Limit | Redis (§12.4) | **prozesslokal** | eine Instanz in Phase 1; Redis mit Phase 3 |

**Gefundene und behobene Fehler:** leere Dateien erzeugten 20 Byte zu kurze Pieces
(`encryptedPieceStream` gab keinen Frame aus, `streamCipherPlan` plante einen) – betraf auch den
Wallet-Modus. Test „0 B“ ergänzt.

**Verifikation:** Vitest 52/52 (u. a. Server gegen echtes Postgres im RAM: keine User-Enumeration,
Rate-Limit, keine Quota-Überbuchung, kein Fremdzugriff; Known-Answer-Test der Schlüsselableitung;
`frame2`-Angriffe) · Playwright-E2E (Registrierung → Upload → Sperren → Login → Recovery → Download
byte-identisch → Admin) 3/3 grün.

## 17. Anhang

### 17.1 Environment-Variablen (Ziel)
```
# Frontend
NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_STORAGE_MODE=filone|synapse, NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID (optional)
# Backend
DATABASE_URL, SESSION_SECRET, FILONE_ENDPOINT=https://eu-west-1.s3.filonecontent.com, FILONE_REGION=eu-west-1,
FILONE_ACCESS_KEY_ID, FILONE_SECRET_ACCESS_KEY, FILONE_BUCKET=focvault-prod-eu, FILONE_BUCKET_ARCHIVE,
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO, STRIPE_PRICE_FAMILY, STRIPE_PRICE_PAYG_GB_MONTH,
EMAIL_PROVIDER_API_KEY, EMAIL_FROM, RATE_LIMIT_REDIS_URL (optional), SENTRY_DSN (optional)
```
`.env.local.example` mit allen Schlüsseln (ohne Werte) anlegen (Audit M2).

### 17.2 Glossar
MK Master-Key · KEK Key-Encryption-Key · PRF WebAuthn-Pseudo-Random-Function-Extension · SIWE Sign-In with Ethereum ·
AAD Additional Authenticated Data (AES-GCM) · PAYG Pay-as-you-go · DSA Digital Services Act · CID Content Identifier (Filecoin/IPFS).

### 17.3 Referenzen
- Fil One Docs: `https://docs.fil.one` (S3-Kompatibilität, Limits, Buckets, Account Security) – Fakten in §5.1 am 27.09.2026 geprüft.
- Interne Dokumente: `README.md`, `ROADMAP.md`, `DEV-LOG.md`, `SECURITY-AUDIT.md`, `PROPOSAL-FOC.md`.
- Krypto-Standards: RFC 5869 (HKDF), RFC 9106 (Argon2), NIST SP 800-38D (GCM), WebAuthn L3 (PRF), EIP-4361 (SIWE).

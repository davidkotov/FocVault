# FocVault Roadmap

> Gemeinsames Arbeitsdokument (neben `DEV-LOG.md`). Gibt die **Richtung** vor und ist
> die strukturierte Umwandlung der Produktideen-Liste in umsetzbare Sprints (P0–P4).
> Der Code-Stand folgt immer dem Git-Historium; dieses Dokument verweist auf PRs.
>
> **Legende:** ✅ vorhanden · 🟡 Basis vorhanden (ausbaubar) · ❌ fehlt (neu).
> **Priorität:** P0 = Fundament/Security · P1 = Produkt-Kern · P2 = Backend/Monetarisierung
> · P3 = Filecoin-Services · P4 = Erweiterungen (Konzept).

---

## 1. Ist-Zustand (Stand PR #2, Branch `feat/mvp-current`)

Kern: **Privacy Cloud auf Filecoin (FOC) mit Zero-Knowledge-Architektur** –
Wallet-Signatur → HKDF → Master-Key (RAM-only, 30-min Auto-Lock), clientseitige
AES-GCM-Verschlüsselung, Streaming-Upload/-Download (16-MiB-Frames), 2 persistente
Datasets pro Konto & Chain (Dataset-Reuse, $0.12/Dataset/Monat), PDP-Verifikation,
Secrets (Passwörter / Notizen / 2FA-TOTP), Secure Send (Share-Links, Key im URL-Fragment).

**Bereits umgesetzt (Stand PR #2):**
- Encryption-Streaming + Batch-Upload/-Download inkl. Fortschritt, Abort, Pause
- Dataset-Reuse mit localStorage-Persistenz (`getVaultContexts`, Resume + sauberer Fallback)
- Secure Send: Ablauf 1/7/30 Tage, Container-E2E, Empfänger ohne Konto (nur Wallet nötig)
- Pro-Tier-Gating (client-seitig), Quota (Free 5 GB / Pro+ 2 TB), Upgrade-Wall, 2×2-Pricing
- Secret-Module: Passwörter, Notizen, 2FA (TOTP, QR-Export/-Import, CSV), Krypto-Frames
- Secure Vault-Dokumentation (README, DEV-LOG, SECURITY-AUDIT, PROPOSAL-FOC)

---

## 2. Produktideen → Status-Matrix

Die 45+ Ideen aus der Beratung, abgehakt gegen den realen Code (nicht nur Konzept):

### A. Security & Privacy

| Idee | Status | Befund / Verbesserung |
|---|---|---|
| Private Password Vault | ✅ | Passwörter-Modul + 2FA vorhanden. **Fehlt:** Browser-AutoFill, Passkey als Login |
| Private Notes | ✅ | Notizen-Modul vorhanden. **Fehlt:** Markdown, Links/Verschachtelung |
| 2FA Authenticator | ✅ | TOTP mit QR/Codes. **Fehlt:** Backup des Secrets client-seitig (Recovery) |
| Secure Drop (anonym empfangen) | ❌ | „Empfang ohne Login" fehlt – Flips von Secure Send. **Konzept:** `/#inbox` mit Einmal-Schlüssel |
| Encrypted Email Attachments | 🟡 | Secure Send deckt „große Anhänge per Link" ab. **Fehlt:** E-Mail-Integration/Weiterleitung |
| Private Photo Vault | 🟡 | Generischer Storage reicht. **Fehlt:** Vorschau/Thumbnails, Auto-Sync mobil |
| Identity Document Vault | ❌ | Reisepass/Ausweis verschlüsselt – braucht kategorisierte „Documents"-Ansicht |
| Recovery Vault | 🟡 | Vault-Export existiert. **Fehlt:** geführte Recovery (Seeds, Shard-Splitting) → schließt Audit C1 |
| Temporal Storage (Auto-Löschen) | ❌ | Ablauf nur bei Share-Links, nicht bei eigenen Dateien |
| Zero-Knowledge Storage | ✅ | Kern der App (E2E, RAM-only Key) |
| Privacy Share Links | ✅ | Secure Send **v2** (Sprint A): Passwort-Level, Einmal-Link, Download-Limit (best-effort clientseitig), Expiry 1 h–30 d, Legacy-Links lesbar. **Fehlt:** globale Durchsetzung → Backend T7/T13 |
| Dead-Man's Switch / Data Inheritance | ❌ | Rechts- + Krypto-Konzept nötig (Zeit-Splitting). P4 |
| Evidence / Verified Storage | 🟡 | PDP-Laufzeit vorhanden. **Fehlt:** sichtbarer Proof (Zertifikat, Watchdog) → P3 |

### B. Cloud-Produkte

| Idee | Status | Befund |
|---|---|---|
| Personal Cloud | ✅ | Kern-Produkt (Files, Suche, Sync-Push) |
| Family Cloud | 🟡 | Tier + Pricing vorhanden (19.90 CHF). **Fehlt:** Family-Member-Einladung, geteilter Raum → P1 |
| Team Drive | ❌ | Kein Rollen-/Rechte-Modell; Link-Sharing nur (Secure Send) |
| Developer Cloud / API | ❌ | Kein Backend, keine öffentliche API → P2 |
| Server Backup | ❌ | Kein Agent/CLI-Daemon → P2 |
| Database Backup | ❌ | Fehlt (Backup-Schicht) → P2 |
| Docker / Git / Website Backup | ❌ | Fehlt → P2 (Rclone-artig, Krypto vor Upload) |
| Migration (S3 → Filecoin) | ❌ | Kein Importer/Gateway → P3 |

### C. Filecoin-spezifische Services

| Idee | Status | Befund |
|---|---|---|
| Decentralized Archive | 🟡 | 2 Kopien+PDP. **Fehlt:** wählbare Kopienzahl, Retention/Immutable → P3 |
| Proof-of-Storage Produkt | 🟡 | SDK-PDP aktiv. **Fehlt:** Nutzer-sichtbare Verifikation/Export → P3 |
| Dataset Marketplace | ❌ | Signatur/Lizenz/Payment fehlen → P3 |
| Public Dataset Hosting | ❌ | Kein öffentlicher Katalog/CID-Anker → P3 |
| Permanent Website Storage | 🟡 | Möglich (static upload + CID). **Fehlt:** Domain-/Gateway-Workflow → P3 |
| NFT / Asset Hosting | 🟡 | Generisch; **fehlt:** ERC-721-Metadata, Pin-Anzeige |

### D. Monetarisierung / Business

| Idee | Status | Befund |
|---|---|---|
| Pay-per-GB Storage | ✅ | Quota-Modell steht; **fehlt:** echtes Billing (CHF) → P2 |
| Pay-per-Download CDN | 🟡 | **CDN jetzt aktiv** (T5, mitCDN:true). **Fehlt:** Abrechnung pro Egress → P2 |
| Stripe-Abos (Pro/Family) | ❌ | Vorgemerkt (Backend, Step 3/4) → P2 |
| S3 → Filecoin Gateway | ❌ | Konzept: **Stärke = E2E über S3-API** (Differenzierung zu FilOne) → P3 |
| Backup-as-a-Service | ❌ | Agent + Retention → P2 |
| White-Label / Enterprise | ❌ | Backend + SLA → P2/P4 |

**Vorrang: „Privacy → Protection → Delivery → Business"** – erst der Produktkern für
Kunden, dann Backup/Auth, dann CDN/API, dann Verifikation/Marktplatz.

---

## 3. Die wichtigsten Verbesserungen (geordnet nach Wert/Aufwand)

| # | Verbesserung | Warum | Sprint |
|---|---|---|---|
| T1 | **CDN aktivieren (`withCDN: true`)** | 5–10× schnellere Downloads/Retrieval, Grundlage Private CDN/Pay-per-Download | **A** |
| T2 | **Secure Send v2** | Passwort-Schutz, Einmal-Link, Download-Limit → echtes „Secure Send"-Produkt | **A** |
| T3 | **Tests + CI (Vitest)** | Regression-Fang bei Krypto/CSV/TOTP; Vertrauen vor jedem Push | **A/B** |
| T4 | **Recovery Vault** | Schließt Audit C1 (Master-Key nicht wiederherstellbar) | **B** |
| T5 | **Versionierung + Papierkorb** | Ransomware-Schutz, „Immutable"-Grundlage | **B** |
| T6 | **Family-Funktion** | Eingeloggtes Versprechen des Family-Tiers einlösen | **B/C** |
| T7 | **Backend + Stripe + Admin-Funding** | Free-Usage wirklich vom Admin-Konto zahlen, Abos, Pay-per-GB in CHF | **C** |
| T8 | **Backup-Agent/CLI** | Backup-as-a-Service (erst Server, dann DB/Docker) | **C** |
| T9 | **Proof-Zertifikat / Watchdog** | Datei „nachweisbar gespeichert" – Filecoin-USP | **D** |
| T10 | **Dataset-Marktplatz / Open Data** | Umsatz jenseits von Speicher | **D** |

---

## 4. Roadmap in Sprints

### Sprint A – „Schnelle Downloads + richtiges Secure Send" (UI/Client only, kein Backend)

**Status: ✅ abgeschlossen** — verifiziert: `npx tsc --noEmit` grün · `npx vitest run` 11/11 grün · `/` und `/s/<cid>` HTTP 200

- [x] **T1 – CDN aktiv:** `lib/synapse.ts` → `withCDN: true`, mit Datensatz-Persistenz-
  Bump (`DATASET_STORE_VERSION` = 3), damit alte Nicht-CDN-Datasets sauber gegen frische
  (CDN-fähige) Datasets abgelöst werden (keine inkompatiblen Resumes).
- [x] **T2 – Secure Send v2:** `lib/crypto.ts` + `lib/share.ts` + `components/ShareDialog.tsx`
  + Empfängerseite `app/s/[cid]/page.tsx`:
  - **Passwort-Schutz:** PBKDF2-SHA256 (310k Iterationen) → AES-GCM-Key-Wrap des Link-Keys,
    Fragment `p.<salt>.<iv>.<cipher>`
  - **Einmal-Link** (burn-after-use) und **max. Downloads**: client-seitig via
    `localStorage` (`focvault:share:uses:<cid>`), ehrlich als **best effort** gekennzeichnet –
    globale Durchsetzung folgt mit dem Backend (T7/T13)
  - Expiry: 1 h / 24 h / 7 d / 30 d
  - **Backward-kompatibel:** Legacy-`#<b64url>`-Links bleiben lesbar; `s.<key>` = expliziter
    Key-Fragment ohne Passwort
- [x] **T3 – Tests + CI:** Vitest (`lib/share.test.ts`, `lib/totp.test.ts`, `lib/csv.test.ts`),
  `tsc --noEmit`, `.github/workflows/ci.yml` – bewusst **ohne** `next build`, da die
  Client-Wallet-Pfade (wagmi/`window`) nicht headless bauen.

**Akzeptanz:** ✅ `npx vitest run` grün (11/11) · ✅ `npx tsc --noEmit` grün · ⏳ CDN-Download messbar
schneller (Live-Test auf Calibration, braucht Wallet + Partner) · ⏳ Secure Send mit
Passwort/Einmal-Link end-to-end (Live-Test, braucht Wallet).

### Sprint B – „Sicherheit & Verwaltung" 

- **T4 – Recovery Vault & gemanagte Shards:** CLI/UI, das den Master-Key in 3–5 Recovery-
  Fragmente (Shamir/Shards, z. B. 2-von-3 nötig) splittet, verschlüsselt und als Fallback
  einblendet; schließt **SECURITY-AUDIT C1**.
- **T5 – Versionierung + Papierkorb:** Vault-Container v4 (`versions`, `trash`), Retention
  30 Tage, „Wiederherstellen"; Basis für Immutable/Backup.
- **T6 – Previews/Thumbnails + bessere Upload-UX:** Multi-Datei/Ordner, Queue, Fortschritt;
  Vorschau-Kacheln (kleine sichtbare Vorschaupieces statt Voll-Preview).
- **T3-Fortsetzung:** E2E-Tests rund um den Synchronisationspfad (getVaultContexts) + CI-Build.

### Sprint C – „Backend, Billing, Accounts" (mit davidkotov, Step 3/4)

- **T7 – Backend-Service:** Account/Session-API, **Admin-Konto finanziert Free-Usage**
  (5 GB/Monat/Konto vom Backend-Wallet), Quota-Server-Enforcement (schließt Audit L6/L7),
  Rechnungswesen in CHF, Stripe-Abos Pro (13.90) / Family (19.90) / Custom.
- **T8 – Backup-Agent (CLI):** Node-Daemon: Ordner-Backups → FocVault (E2E); später
  PostgreSQL/MySQL Dumps, Docker-Volumes, Git-Mirrors.

### Sprint D – „Filecoin-Services & Skalierung"

- **T9 – Proof-of-Storage Produkt:** exportierbares Zertifikat (CID, Piece-CID, txHash,
  Zeitstempel, PDP-Status), Watchdog-Alarme, „Immutable/Archive"-Tarif.
- **T10 – Dataset-Marktplatz / Open-Data-Hosting** (Katalog, Lizenz, Pay-per-Dataset).
- **T11 – S3 → Filecoin Gateway (E2E):** S3-kompatibler Endpoint mit clientseitiger
  Verschlüsselung (Differenzierung zu FilOne), Rclone-Migration, Public Data API.

### P4 – Konzept & später

- Dead-Man's Switch / Data Inheritance (Recht + Krypto-Design)
- Private AI/Vault-Freigaben (kontrollierte, vergütete Datenweitergabe)
- Content-Paywall, White-Label, NFT-/Web3-Asset-Hosting

---

## 5. Entscheidungen (Fixiert)

1. **Secrets zählen nicht auf Datei-Quota** – Vault-Key/-Index ist ein Schlüsselcontainer,
   kein Datei-Gegenstück (wie mit Partner besprochen).
2. **Master-Key bleibt RAM-only**; keine serverseitige Speicherung. Recovery via Shards
   (T4), nicht via Backend-Key.
3. **Legacy-Chunks (`fmt:'frame'` mit alten v1-Schlüsseln) bleiben kompatibel** – `unwrapFileKey`
   fällt auf `importFileKey` zurück.
4. **Free 5 GB** (danach Pay-as-you-go, echte FOC-Kosten, 0 % Aufschlag) · **Pro 2 TB
   13.90 CHF** · **Family 2 TB 19.90 CHF** · Business/Custom individuell.
5. **Dataset-Reuse:** persistent (localStorage, Session-übergreifend), damit $0.12/Dataset/
   Monat nicht pro Upload anfällt; Resume + Fallback auf frische Datasets.
6. **Direkt-Push auf `main` blockiert** (Repo-Regel) → Feature-Branch + PR (gut für gemeinsames Review).

---

## 6. Offene Punkte (Tracking)

- [ ] **PR #2** – MVP + Sprint A (T1–T3) – offen, wartet auf Merge/Review durch davidkotov
- [ ] **Upload-Live-Test** Dataset-Reuse auf Calibration (braucht Wallet) – nach Merge
- [ ] **Sprint B/C/D** Termine mit Partner (T4–T10) – Vorschlag: T4/T5 in Sprint B direkt
- [ ] Token nach Abschluss rotieren

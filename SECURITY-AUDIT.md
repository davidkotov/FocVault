# FocVault — Security & Code Audit

**Date:** 2026-09-21
**Scope:** full repository at commit `814740c` (all 2 commits, all 36 tracked files, `package-lock.json`)
**Reviewer:** automated code audit (Claude Code)

---

## 1. Malware verdict: **clean**

No malware, backdoors, exfiltration logic, or obfuscated code was found. Checks performed:

| Check | Result |
|---|---|
| `eval`, `new Function`, dynamic `import()` of remote code | none |
| Network calls in app code (`fetch`, `XMLHttpRequest`, `sendBeacon`, WebSocket) | **none** — all network I/O goes through the Synapse SDK, wagmi/viem and the two declared Glif RPC endpoints |
| `dangerouslySetInnerHTML`, `document.write`, `innerHTML` | none |
| `<script>` tags / event-handler attributes in `public/*.html` | **none** — the mockups are pure static HTML/CSS |
| External hosts referenced in source | only `glif.io` RPC, Blockscout explorers, `docs.filecoin.cloud`, and 3 user-facing link-outs (`app.secured.finance`, `app.usdfc.net`, `v2.app.squidrouter.com`) |
| `package-lock.json` resolved URLs | 628/628 from `registry.npmjs.org`, **all with SRI integrity hashes**, lockfileVersion 3 |
| Packages with install scripts | 4 (`bufferutil`, `keccak`, `secp256k1`, `utf-8-validate`) — all legitimate, well-known native bindings pulled in by the wallet stack |
| Secrets in working tree **and full git history** | none (no private keys, API keys, mnemonics, AWS keys) |
| `public/icon192.png`, `public/icon512.png` | valid PNGs, **0 trailing bytes after `IEND`** — no appended payload |
| `app/globals.css` | no `@import`, no `url()`, no `expression()` |
| TypeScript `strict` typecheck | passes clean |

The two commits (`269c419` "Initial commit", `814740c` "Add files via upload") are consistent with a project uploaded in one go through the GitHub web UI. Nothing was added and later removed.

**The crypto is also not backdoored.** Keys are generated with `crypto.getRandomValues`, imported as **non-extractable** `CryptoKey`s, and never serialised anywhere except wrapped under the user's own master key. There is no hidden second recipient, no key escrow, no "phone home".

> Caveat: this audit covers *source*. It does not prove the deployed demo at `http://179.43.188.2:3000` serves this source. Do not enter a real wallet on that plain-HTTP demo host.

---

## 2. Findings by severity

### CRITICAL

#### C1 — Master key is unrecoverable and non-portable; "cross-device sync" cannot work by construction

`lib/crypto.ts:54-63`, `lib/crypto.ts:75-86`

```ts
export function getOrCreateSalt(address: string): string {
  const key = `focvault:salt:${address.toLowerCase()}`
  let salt = window.localStorage.getItem(key)
  if (!salt) { salt = randomHex(16); window.localStorage.setItem(key, salt) }   // <-- random, local only
  return salt
}
```

The master key is `HKDF(signature_over_message_containing_salt, salt)`. The salt is **16 random bytes that exist only in one browser's `localStorage`** and are never exported, never written on-chain, and never included in the `.vault` export file.

Consequences — all confirmed by reading the code paths:

- **Clearing site data, using a private window, a browser profile reset, or a new device produces a *new* random salt → a different signed message → a different master key → every file in the vault becomes permanently undecryptable.** There is no recovery path. The wallet seed phrase does not help.
- **`exportVault` / `importVault` (`app/page.tsx:264-299`) cannot work across devices.** The export is encrypted under the device-local master key; a second device derives a different one. The code even anticipates this in its error string: `'Import fehlgeschlagen – Datei gehört zu einem anderen Master-Schlüssel?'`
- **`pullSync` (`app/page.tsx:185-209`) has the same problem** — the on-chain index is encrypted under the same device-local key.

This directly contradicts the product claims in `README.md` ("so findest du deinen Vault auf jedem Gerät wieder"), `PROPOSAL-FOC.md` ("cross-device recovery without any backend") and `components/Landing.tsx` (Pro tier: "Vault-Sync über alle Geräte").

**Fix:** make the salt deterministic so the key is reproducible from the wallet alone — e.g. `salt = SHA-256("focvault-salt-v1" || lowercase(address))`, or a fixed application salt with the address in the HKDF `info` parameter. (Per RFC 5869 the salt need not be secret; its purpose is domain separation.) Migrate existing users by keeping the old localStorage salt as a fallback for decryption. Also embed the salt in the `.vault` export header.

**Related pitfall (M14):** even with a fixed salt, this scheme assumes `personal_sign` is *deterministic*. That holds for EOAs signing with RFC 6979, but **not** for smart-contract wallets (Safe, ERC-4337) or some hardware wallets. Those users would get a different key on every unlock. Detect and reject non-EOA wallets, or move to a proper key-storage scheme (passphrase + Argon2id, WebAuthn PRF extension, or a wrapped key stored on-chain).

---

### HIGH

#### H1 — `MAX_CID_LENGTH = 64` rejects real PieceCIDs; on-chain vault sync always reverts

`contracts/SubscriptionGate.sol:14,48-52`

```solidity
uint256 public constant MAX_CID_LENGTH = 64;
function setSyncIndex(string calldata cid) external {
    if (bytes(cid).length == 0 || bytes(cid).length > MAX_CID_LENGTH) revert BadCid();
```

Measured against the pinned `@filoz/synapse-core@0.9.0`, PieceCID v2 strings are **64 to 67 characters** and grow with piece size:

```
    127 B payload -> 64 chars  bafkzcibcaabdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy
    128 B         -> 64 chars
      1 KiB       -> 65 chars  bafkzcibd6adqn7d6skbjnziw7kw6tbvsr6jnisspes4tkscsem3wu6mqe66br6bt
     64 KiB       -> 67 chars  bafkzcibeqd4agdeotysah6uijt3cg73a34s7qpxebxfj5wdz5nxwguwrkccpllinh4
      1 MiB       -> 67 chars
```

An encrypted vault index with even a single file entry is several hundred bytes, so its PieceCID is 65–67 chars. **`setSyncIndex` will revert with `BadCid()` for every realistic vault.** The feature is dead on arrival.

**Fix:** raise `MAX_CID_LENGTH` to 128 (or drop the check and store `bytes`). This requires a redeploy — the constant is immutable in practice.

#### H2 — Every sync error is silently swallowed; the user is told the backup exists when it does not

`app/page.tsx:144-167`

```ts
    await refetchSyncCid()
  } catch {
    void 0            // <-- swallows the H1 revert, RPC errors, rejected txs, upload failures
  }
```

Combined with H1, the user sees "Chain-Sync: … so findest du deinen Vault auf jedem Gerät wieder" in the UI (`components/VaultUnlock.tsx:79-84`) while **no sync has ever succeeded**. A silent failure in a backup path is worse than a loud one: it produces false confidence in a recovery mechanism that is not there.

Secondary: `pushSync` (`app/page.tsx:169-183`) wraps `pushSyncQuiet` in its own `try/catch`, but `pushSyncQuiet` never throws — so the `'Sync fehlgeschlagen'` error branch is **dead code** and the manual "Auf Chain syncen" button always appears to succeed.

**Fix:** let `pushSyncQuiet` propagate errors (or return a result object); surface them; at minimum `console.error` them.

#### H3 — Blockchain transactions are executed without a cost preview or confirmation

`lib/share.ts:54-57` and `app/page.tsx:148-159`

The upload flow does this correctly: `UploadZone` shows a `prepare()` cost breakdown and waits for an explicit "Zahlen & speichern" click (`components/UploadZone.tsx:221-250`). Two other paths do **not**:

```ts
// lib/share.ts — createShareUrl
const prep = await prepareStorage(synapse, [container.byteLength])
if (prep.transaction) await prep.transaction.execute()   // no preview, no confirm
```

```ts
// app/page.tsx — pushSyncQuiet, fired automatically on every upload AND every delete
if (prep.transaction) await prep.transaction.execute()
await writeContractAsync({ ... functionName: 'setSyncIndex' ... })
```

So clicking "Share-Link erstellen" — or merely **deleting a file** — can trigger a USDFC deposit plus a new 2-copy dataset commit plus an on-chain `setSyncIndex` transaction, none of it priced in advance. `handleStored` and `handleDelete` (`app/page.tsx:211-231`) both call `pushSyncQuiet` unconditionally, so storage cost is incurred **per vault mutation**, not per file.

**Fix:** show the same `prepare()` preview + confirm step for shares and syncs. Debounce/coalesce auto-sync (e.g. one push every N seconds, or only on explicit user action).

#### H4 — The vault index is stored in plaintext `localStorage`

`lib/vault.ts:94-97`

```ts
export function saveVault(address: string, entries: VaultEntry[]): void {
  window.localStorage.setItem(vaultKey(address), JSON.stringify(entries))
}
```

Every filename, exact byte size, MIME type, upload timestamp, chunk CID and wrapped key sits in cleartext on disk. For a product marketed as "Niemand außer dir sieht deine Daten — nicht einmal wir", this is a meaningful gap: the *contents* are encrypted, but the **complete metadata inventory of the vault is not**, and it survives the 30-minute auto-lock, browser restarts, and disk forensics. Any malicious browser extension or XSS reads it instantly.

The README's security section says "Master-Key nur im RAM der Session" but never discloses that the index itself is plaintext at rest.

**Fix:** encrypt the index at rest too. Since the master key is not available while locked, either (a) store the index encrypted and accept that the file list is hidden until unlock, or (b) keep only CIDs locally and treat the encrypted on-chain index as authoritative.

#### H5 — 22 known dependency vulnerabilities, 1 critical

`npm audit` against the lockfile:

| Severity | Package | Note |
|---|---|---|
| **critical / high** | `next` 14.2.35 | 15 advisories incl. RCE in the AVIF Image Optimization path, several SSRF and cache-poisoning issues |
| high | `postcss` ≤8.5.22 | path traversal / arbitrary `.map` file read via `sourceMappingURL` |
| high | `@coinbase/wallet-sdk` 4.x | via `@wagmi/connectors` |
| high | `wagmi` 2.12.11 (pinned, no `^`) | fixed in ≥2.14.11 |
| moderate | `@walletconnect/*` 2.16.1 | deprecated by upstream; several advisories |
| moderate | `@metamask/sdk` 0.28.x | **no longer maintained** per upstream deprecation notice |
| moderate/low | `elliptic`, `secp256k1`, `@stablelib/ed25519`, `eciesjs`, `uuid`, `query-string`, `decode-uri-component` | transitive |

Most of the `next` advisories target server-side features this app does not use (no middleware, no Server Actions, no `next/image`, no custom server — everything is `'use client'`), so **practical** exposure is lower than the raw count suggests. But `next start` still exposes `/_next/image`, and staying 2 majors behind on a security-critical app is not defensible.

**Fix:** `npm audit fix`, then plan the `next` and `wagmi` major upgrades. Unpin `wagmi` from the exact `2.12.11`.

#### H6 — No Content-Security-Policy or any security headers

`next.config.mjs` is six lines with only `reactStrictMode`. For an application whose entire security model is "the crypto runs in your browser and the key never leaves", **CSP is the primary control** — it is what stops an injected or compromised script from using the unlocked, in-memory master key to decrypt and exfiltrate the whole vault. There is also no `Strict-Transport-Security`, `X-Frame-Options`/`frame-ancestors` (the app is fully clickjackable), `X-Content-Type-Options`, `Referrer-Policy` or `Permissions-Policy`.

**Fix:** add a `headers()` block. Minimum viable:

```js
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value:
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
          "connect-src 'self' https://*.glif.io https://*.walletconnect.com wss://*.walletconnect.com; " +
          "img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    }]
  },
}
```

(Tighten `script-src` with a nonce once the Next.js inline-script requirements are handled; the Synapse provider endpoints will need to be added to `connect-src`.)

---

### MEDIUM

#### M1 — There is no `.gitignore` at all

Both `README.md` ("Private Keys niemals committen; `.env*` ist ignoriert") and `PROPOSAL-FOC.md` ("ohne `.env.local`, siehe .gitignore – ist vorbereitet") **claim a `.gitignore` exists. It does not.** `git ls-files` shows no such file. The next `git add -A` after a real setup will commit `.env.local` (WalletConnect project ID, gate address), `node_modules/`, `.next/` and `tsconfig.tsbuildinfo`. This is the single cheapest fix in the repo and the documentation is actively misleading about it.

```
node_modules/
.next/
.env*
!.env*.example
tsconfig.tsbuildinfo
*.vault
```

#### M2 — `.env.local.example` is referenced by the setup instructions but does not exist

`README.md` says `Copy-Item .env.local.example .env.local`; that file is not in the repo. Setup fails on step 2 for anyone following the README.

#### M3 — Share links are permanent and unrevocable; expiry is decorative

`lib/share.ts:43-52`, `app/s/[cid]/page.tsx:42-48`

The share record embeds the **raw AES file key** (`fileKey: toB64(rawKey)`) for the entire file, and `expiresAt` is only ever checked by `isShareExpired()` **in the recipient's own browser**. Anyone holding the link can fetch the ciphertext piece directly from the storage provider and decrypt it offline, before or after expiry, forever — and can re-share the key freely. Nothing invalidates the piece; per the README it stays on-chain until the rail lapses.

The README is partly honest about this ("der Cipher-Piece bleibt bis zum Rail-Ablauf on-chain"), but the ShareDialog UI is not: *"Nach Ablauf verweigert die Seite den Download"* (`components/ShareDialog.tsx:78`) reads as an enforced control when it is a client-side courtesy. Rewrite that copy.

Also: sharing a file hands over the **file key itself**, so a single share permanently compromises that file even if the share record is later deleted. Consider re-encrypting the payload under a share-specific key instead.

#### M4 — AES-GCM is used without Additional Authenticated Data; chunks are not bound to their position

`lib/crypto.ts:88-100`, `lib/crypto.ts:132-140`

All chunks of a file are encrypted under the same file key with independent IVs and **no AAD**. Nothing cryptographically binds a chunk to its file, its index, or the total chunk count. `chunks[]`, `iv` and `padLen` live in the unauthenticated index (H4). An attacker who can modify the index (local access, XSS, malicious extension, or a tampered on-chain index if the key were ever compromised) can **reorder chunks, splice chunks from a different file of the same user, or truncate a file, and every GCM tag still verifies**. The user gets silently corrupted or manipulated data.

**Fix:** pass `additionalData` to `encrypt`/`decrypt`, e.g. `AAD = fileId || chunkIndex || totalChunks`, and authenticate the index itself.

#### M5 — `SubscriptionGate.subscribe()` violates checks-effects-interactions

`contracts/SubscriptionGate.sol:33-42` — the external `paymentToken.transferFrom(...)` happens **before** `expiresAt[msg.sender]` is written. With a standard ERC-20 this is harmless, but with any callback-capable token a reentrant `subscribe()` lets a user pay twice and receive one period (a user-side loss), and the pattern is a landmine if the token is ever swapped. Move the state write above the transfer, or add a `nonReentrant` guard. Also use a SafeERC20-style wrapper rather than `bool ok = transferFrom(...)`, which reverts on tokens that return no data.

#### M6 — `SubscriptionGate` admin design has no recovery path

`treasury` is `immutable` and doubles as the only admin (`setPrice`). If that key is lost or compromised there is no way to rotate it, no pause, and no way to change the price. `subscribe()` also does not check `pricePerMonth != 0`, so a zero price silently grants free Pro to everyone. For anything beyond a testnet demo, use a two-step ownable/`AccessControl` pattern with a separate treasury address, and add `Pausable`.

#### M7 — `syncIndex` is a public mapping: enumerable user metadata on a public chain

`contracts/SubscriptionGate.sol:17` + the `SyncUpdated` event. Anyone can walk the events and learn **which addresses use FocVault, how often each user changes their vault, and the CID of each user's index**. The index contents stay encrypted, but the linkability of a wallet address to "uses a private file vault, updated 14 times last week" is exactly the kind of metadata a privacy product should not publish. Consider hashing/salting the key, using a per-user commitment, or moving the pointer off-chain.

#### M8 — Any unsupported chain silently falls back to Calibration

`lib/synapse.ts:21-22`

```ts
const chain = chainId === 314 ? mainnet : calibration
const rpc   = chainId === 314 ? READ_RPC_MAINNET : READ_RPC_CALIBRATION
```

A wallet connected to Ethereum, Polygon or anything else yields a Synapse client configured for **Calibration testnet** while signing through a client on the real chain. `app/page.tsx` and `app/s/[cid]/page.tsx` both gate on `isSupportedChain` first, so this is not currently reachable from the UI — but it is a trap waiting for the next caller. Throw explicitly on an unsupported chain id instead of defaulting.

#### M9 — Data pulled from chain or imported from file is not validated

`app/page.tsx:198` and `app/page.tsx:287` both do `JSON.parse(json) as VaultEntry[]` and check only `Array.isArray`. `loadVault` runs every entry through `normalize()` (which handles the v1→v2 migration and fills a missing `folder`); the sync and import paths **skip it entirely**. A v1 index restored from chain will therefore produce entries with `chunks === undefined`, and `handleDownload`'s `for (const chunk of entry.chunks)` will throw. Route both paths through `normalize()` and validate field types before persisting.

#### M10 — Concurrent auto-syncs race; the older index can win

`pushSyncQuiet` is fired unawaited (`void pushSyncQuiet(next)`) from `handleStored`, `handleDelete` and `importVault`. Two quick operations start two overlapping uploads and two `setSyncIndex` transactions; the one that lands last wins, and transaction ordering is not guaranteed to match call ordering. **The on-chain pointer can end up referencing a stale index**, silently losing entries. The README flags the general shape of this ("Versionierung des Index folgt") — until then, serialise the pushes through a single-flight queue and add a monotonically increasing version number to the index.

#### M11 — The share link key is left in `window.location.hash`

`app/s/[cid]/page.tsx:25-34` reads the fragment but never clears it. The secret therefore persists in the address bar, in browser history, and in session restore — readable by any extension with tab access and visible to anyone who later glances at the history. Call `history.replaceState(null, '', window.location.pathname)` immediately after reading it.

#### M12 — Whole-file buffering: predictable OOM on large files

`encryptFileChunked` accumulates every ciphertext chunk in an array before anything is uploaded, and `handleDownload` / `downloadSharedFile` accumulate every decrypted chunk before building the Blob. A 2 GB file (the advertised Pro per-file limit) needs roughly 2 GB of contiguous browser memory on both paths, on top of the plaintext. The README admits this for upload; it applies equally to download. Streaming encrypt/decrypt via `TransformStream` is the fix.

#### M13 — Client-side quota enforcement

`UploadZone` checks `file.size > quotaRemaining` in the browser, and `quotaRemaining` derives from `localStorage`. Trivially bypassed from devtools. The README already flags this. It is only a business-logic issue (the user pays their own storage costs), but the Pro tier is currently worth nothing.

---

### LOW / polish

- **L1** `public/FocVault-Mockup-Dashboard.html` and `public/FocVault-Mockup-Landingpage.html` are **byte-identical duplicates** of `public/mockups/dashboard.html` and `public/mockups/landing.html`. All four are publicly served. They are clean (no scripts), but they are dead weight and leak design drafts. Delete them or move them out of `public/`.
- **L2** `a.download = entry.name` / `record.name` (`app/page.tsx:253`, `lib/share.ts:107`) uses an unsanitised, sender-controlled filename. Browsers sanitise path separators, so impact is cosmetic — but strip control characters and leading dots anyway.
- **L3** `URL.revokeObjectURL(url)` is called synchronously right after `a.click()` on a detached anchor (`app/page.tsx:249-254`, `lib/share.ts:104-109`). Some browsers abort large downloads this way. Append the anchor to the DOM, click, then revoke in a `setTimeout`.
- **L4** No LICENSE file, although the landing page advertises "🧩 Open Source".
- **L5** No tests, no linter, no CI. For a project whose correctness bugs cost users their files (C1, M10), at minimum add round-trip unit tests for `encrypt → wrap → unwrap → decrypt` and for the v1→v2 `normalize()` migration.
- **L6** `usedBytes` sums *plaintext* sizes, but what you pay for is padded ciphertext across 2 copies. Quota display and cost reality diverge. Deleting an entry also frees quota while the paid piece stays on-chain — users can silently exceed what they are paying for, and vice versa.
- **L7** `ProPanel.subscribe` approves exactly `price` then calls `subscribe(1)`. If the second transaction fails or is rejected, a dangling allowance is left on the gate contract. Reset it, or use `permit`.
- **L8** `encryptShareContainer` does not apply the 127-byte minimum-piece padding that `encryptBytesWithKey` applies. Share records are large enough in practice (SDK `MIN_SIZE` is 65), but the inconsistency will bite when the record shrinks.
- **L9** The module-level `cached` Synapse singleton in `lib/synapse.ts:12` is never cleared on disconnect, retaining a wallet client reference for the page's lifetime.
- **L10** Both RPC endpoints are hardcoded to `glif.io` — a single point of failure, and a single operator who sees every piece request (i.e. your access patterns). Make them configurable and consider a fallback.
- **L11** `buildSignMessage` (`lib/crypto.ts:65-73`) is good practice (explicit "not a transaction"), but the German text has a mojibake artefact — `Verschluesselungsschluessel` — repeated in `components/VaultUnlock.tsx:43`. Cosmetic, but it reads like a phishing message, which matters on a signing prompt.

---

## 3. What the code does well

Worth stating explicitly, because it is a short list of things that are often wrong and here are right:

- **AES-256-GCM via WebCrypto**, no hand-rolled primitives, no third-party crypto library in the hot path.
- **Master and file keys are imported as non-extractable `CryptoKey`s** (`extractable: false`). Even with full XSS, an attacker can *use* the key but cannot dump its bytes.
- **Fresh 96-bit IV from `crypto.getRandomValues` for every encryption** — no nonce reuse.
- **Per-file random 256-bit keys, wrapped under the master key** — correct key hierarchy; a leaked file key exposes one file.
- **HKDF-SHA256 with a distinct `info` label** (`focvault-master-v1`) — correct domain separation, and versioned.
- **Key in RAM only, with a working 30-minute idle auto-lock** and a manual lock button.
- No `dangerouslySetInnerHTML` anywhere; React's default escaping is relied on throughout.
- `tsconfig` has `strict: true` and the project **typechecks clean**.
- The README's "Bekannte MVP-Grenzen" section is unusually candid — several of the findings above are acknowledged there. That is a good sign about the author's intent.

---

## 4. Recommended order of work

1. **C1** — fix the salt derivation. Nothing else matters if users lose their files. Ship a migration before anyone stores anything real.
2. **M1** — add `.gitignore` (5 minutes; prevents a credential leak).
3. **H1 + H2** — fix `MAX_CID_LENGTH`, redeploy the contract, stop swallowing errors.
4. **H6** — add CSP and security headers.
5. **H3** — cost preview + confirmation for shares and syncs; debounce auto-sync.
6. **H5** — `npm audit fix`, then the `next`/`wagmi` upgrades.
7. **H4 + M4** — encrypt the index at rest, add AAD binding.
8. **M3** — correct the share-expiry copy in the UI to match reality.
9. Contract hardening (**M5–M7**) before any mainnet deployment, plus a real external audit — `PROPOSAL-FOC.md` already budgets for one.

## 5. Non-code risks

- The demo at `http://179.43.188.2:3000` is **plain HTTP**. With no TLS, anyone on the path can rewrite the JavaScript and steal the master key at unlock time. This defeats the entire security model. Never connect a funded wallet to it; move to HTTPS before showing it to anyone.
- `README.md` already notes the EU DSA/GDPR takedown obligations for a hosting service and recommends legal review before launch. That assessment is correct and should not be skipped — zero-knowledge does not exempt an operator from abuse-report handling.

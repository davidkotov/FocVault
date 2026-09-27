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

### Business: Admin-Konsole, Richtlinien, Protokoll & PDF-Bericht, Firmen-Notfallzugriff, SSO (Migration v20)

Neuer Seitenleisten-Abschnitt **Business** (Geteilte Tresore, Admin-Konsole; ohne Business Schloss).
**Rollen:** Inhaber, Admin, Mitglied (`family_members.role`); Admin vergibt nur der Inhaber; Mitglieder sehen
die Konsole nicht. **Richtlinien** (`team_policies`): Passkey-Pflicht, Mindestlänge der Passphrase, Auto-Sperre
(Minuten, auf allen Geräten), Secure-Send-Links erlauben / höchstens N Tage (serverseitig in `createShare`
durchgesetzt), Firmen-Notfallzugriff verlangen. Passphrase-Länge meldet das Gerät beim Entsperren/Ändern
(`/account/attest`) – Zero-Knowledge, der Server kann sie nicht selbst prüfen. Mitglieder sehen Hinweise im
Dashboard; die Mitgliederübersicht zeigt je Person Passkeys, Passphrase-Länge, Hinterlegung, zuletzt aktiv
und Richtlinien-Status. **Protokoll:** alle Ereignisse des Teams mit Filtern (Person, Bereich, Zeitraum),
CSV-Export, **Compliance-Bericht als PDF** (eigener kleiner PDF-Erzeuger `lib/pdf.ts`, ohne Abhängigkeit):
Team, Richtlinien, Personen-Status, Speicher und Filecoin-Beweise, Notfallzugriffe, Ereignisse.
**Firmen-Notfallzugriff (Vier-Augen):** Inhaber erzeugt im Browser einen Team-Schlüssel (ECDH), der private
Teil liegt nur je Admin verpackt vor (Admins geben ihn automatisch weiter). Mitglieder hinterlegen ihren
Master-Key mit der Passphrase. Admin stellt Antrag mit Begründung → ein **anderer** Admin gibt frei (DB-Check
`approved_by <> requested_by`) → 24 h Lesezugriff nur für die beiden Beteiligten. Die Person sieht jeden
Zugriff mit Begründung. Neuer Team-Schlüssel → alle hinterlegen neu.
**SSO (Enterprise):** OpenID Connect mit PKCE, Nonce, State; ID-Token-Prüfung (RS256/ES256 über JWKS mit
`node:crypto`), Domains, Client-Secret mit SERVER_SECRET verschlüsselt. „SSO erzwingen“ sperrt die
Passphrase-Anmeldung für die Domains (Inhaber ausgenommen); „automatisch beitreten“ erzeugt beim ersten
SSO-Login eine Team-Einladung. SSO ersetzt nur die Anmeldung, entschlüsselt wird weiter mit Passphrase/Passkey.
Redirect-URI: `<APP_ORIGIN>/api/v1/auth/sso/callback`.

**Tests:** Vitest 119/119 (neu `server/team/*`, `lib/pdf`), Playwright 12/12 (neu `e2e/team-admin.spec.ts`
mit drei Konten: Rollen, Richtlinien, Vier-Augen-Zugriff mit Datei-Download, Protokoll, PDF, SSO-Fehlerfall).

### Passwort-Check

Leiste über der Passwortliste: **schwach** (Entropie-Schätzung mit Abzügen für Wörterbuch-, Wiederholungs-,
Folgen- und Jahreszahl-Muster), **mehrfach verwendet**, **in Datenlecks** (Knopf „Auf Datenlecks prüfen“).
Leak-Abgleich per k-Anonymität: der Browser berechnet SHA-1, nur die ersten 5 Hex-Zeichen gehen an
`/api/v1/pwned/:prefix`; der Server leitet an Have I Been Pwned weiter (mit Padding, 1 h Cache, Rate-Limit),
HIBP sieht so weder Passwort noch Nutzer-IP. Chips filtern die Liste, Einträge bekommen Badges. Gilt auch
in geteilten Tresoren.

**Tests:** Vitest 114/114, Playwright 11/11 (neu `e2e/passwords.spec.ts` inkl. echtem Leak-Abgleich;
`family.spec` unter Parallel-Last gelegentlich zu langsam, einzeln grün).

### Notfallzugang / digitaler Nachlass (Migration v19)

„Konto & Sicherheit → Notfallzugang“. Inhaber (Pro/Family/Business) lädt per Link eine Vertrauensperson ein
(beliebiges Konto, auch Free) und wählt eine Wartezeit (sofort … 30 Tage). Nach dem Annehmen bestätigt der
Inhaber mit seiner Passphrase: der Master-Key wird im Browser per ECDH-ES für den öffentlichen Schlüssel der
Vertrauensperson verpackt (Kontext `emergency:<id>`), der Server speichert nur die Hülle. Die Vertrauensperson
fordert Zugriff an; der Inhaber sieht einen Hinweis im Dashboard und kann ablehnen oder sofort freigeben.
Erst nach Ablauf (oder Freigabe) liefert der Server die Hülle und erlaubt **nur lesend** Tresor-Index und
Datei-Downloads des Inhabers (`/emergency/:id/vault`, `/emergency/:id/objects/:oid/download`). Neuer
Schlüssel der Vertrauensperson → Hülle ungültig, Inhaber bestätigt neu. Entziehen jederzeit, auch
Austreten durch die Vertrauensperson. Alles protokolliert (audit_events).

**Tests:** Vitest 112/112 (neu `server/emergency`), Playwright 10/10 (neu `e2e/emergency.spec.ts`).

### Geteilte Tresore mit Rechten (Business, Migration v18)

Neues Modul „Geteilte Tresore“ (Seitenleiste → Weitere Module; ohne Business Schloss „ab Business Starter“).
Ein Tresor enthält Passwörter, Notizen und 2FA für ausgewählte Teammitglieder. **Kryptografie:** eigener
Tresor-Schlüssel (AES-256-GCM) je Generation, pro Mitglied per ECDH-ES verpackt (wie Teamordner, Kontext
`vault:<id>`); Name und Einträge nur im verschlüsselten Index (eigene AAD). **Rollen:** Ansehen (lesen/kopieren),
Bearbeiten (hinzufügen/ändern), Verwalten (Personen, Rechte, Löschen); serverseitig durchgesetzt, mind. ein
Verwalter. **Entfernen:** Server liefert sofort nichts mehr; der Verwalter-Client legt automatisch eine neue
Generation an und verschlüsselt neu, Schreiben mit altem Schlüssel wird abgelehnt. Wer das Team verlässt,
verliert alle Tresore des Teams. **Protokoll** (Verwalter): erstellt, geändert, hinzugefügt/entfernt,
Rechte geändert, Schlüssel erneuert – mit Personen. „Aus meinem Tresor übernehmen“ kopiert private Einträge.
Passwörter/Notizen/2FA-Module haben dafür einen Nur-Lesen-Modus.

**Tests:** Vitest 110/110 (neu `server/vaults`), Playwright 9/9 (neu `e2e/vaults.spec.ts`: zwei Konten im
Business-Team, Ansehen → Bearbeiten → Entfernen, Protokoll).

### Notizen v2: Formatierung, Vorlagen, Anhänge, Teilen per Secure Send

**Notizen:** Formatierung (# Überschriften, Listen, anklickbare Checklisten `- [ ]`, **fett**, *kursiv*,
`Code`, Links) über eine eigene sichere Darstellung (kein HTML), Werkzeugleiste im Editor. Anheften,
Tags mit Filter-Chips, Volltextsuche (ohne geheime Felder). **Vorlagen:** Ausweis/Pass, Kreditkarte,
Versicherung, WLAN, Softwarelizenz mit strukturierten Feldern; geheime Felder verdeckt (Anzeigen/Kopieren),
Ablauf-Erinnerung ab 60 Tagen vorher (Badge + Hinweis oben). **Anhänge:** eigene verschlüsselte Objekte
(zählen zum Speicher, erscheinen nicht in „Meine Cloud“), beim Löschen der Notiz mitgelöscht.
**Teilen (Migration v17):** Notiz-Links ohne oder mit Anhängen; der Notizinhalt liegt verschlüsselt im
`payload` des Links und wird **erst beim gezählten Abruf** ausgeliefert – ein Einmal-Link ist also wirklich
nur einmal lesbar. `shares.object_id` darf leer sein und reißt Links beim Löschen einer Datei nicht mehr mit
(ON DELETE SET NULL; Dateien stehen in `share_items`). Link-Übersicht zeigt „🗒 Titel“.

### Wiederherstellen nur mit den 24 Wörtern (Migration v16)

Aus den Wörtern wird per eigenem HKDF-Zweig eine Konto-Kennung abgeleitet; der Server speichert nur
HMAC(Server-Secret, Kennung). Neue Konten erhalten sie bei der Registrierung, ältere beim nächsten
erfolgreichen Wiederherstellen. `/wiederherstellen`: E-Mail nur noch optional.

**Tests:** Vitest 107/107, Playwright 8/8 (neu: `e2e/notes.spec.ts`; account.spec stellt ohne E-Mail wieder her).

### Mehrfachauswahl, Drag & Drop, Secure Send für mehrere Dateien, Abschnitt „API-Module“

**Meine Cloud:** Dateien markieren (Kästchen, „Alle auswählen“) → Leiste „n ausgewählt“ mit Teilen,
In Familien-/Teamordner, Löschen, Auswahl aufheben. Dateien (einzeln oder die Auswahl) lassen sich per
Drag & Drop auf **Secure Send**, **Familien-/Teamordner** und **Papierkorb** ziehen; die Ziele
leuchten beim Ziehen auf. Löschen: Abo → Papierkorb, Free → Bestätigung, endgültig.
**Verschieben in den gemeinsamen Ordner:** Datei-Schlüssel wird im Browser mit dem Ordner-Schlüssel neu
verpackt, erst in den gemeinsamen Index, dann serverseitig freigegeben (`POST /objects/:id/space`),
dann aus dem eigenen Tresor entfernt (Fehler → zurückgerollt). Die Familienordner-Logik liegt jetzt in
`features/family/space-client.ts` (Hook und Verschieben nutzen dieselbe Instanz).
**Secure Send mit mehreren Dateien (Migration v15, `share_items`):** ein Link, ein Download-Vorgang
zählt einmal; Empfängerseite zeigt alle Dateien mit Einzel-Download und „Alle herunterladen“.
Gelöschte Dateien fallen aus dem Link, die übrigen bleiben abrufbar. Alte Links (v3) funktionieren weiter.
**Seitenleiste:** neuer Abschnitt „API-Module“ mit „Speicher-API“; ohne Business Schloss mit Hinweis
„Upgrade nötig – ab Business Starter“, Klick führt zu den Business-Paketen.
**Filecoin:** Netzwechsel Test → Mainnet sichert alles im neuen Netz neu.

**Tests:** Vitest 103/103, Playwright 7/7 (neu: zwei Dateien markieren → ein Link → Empfänger lädt beide;
Drag & Drop in den Papierkorb; Inhaber zieht Datei auf den Familienordner → Mitglied lädt sie herunter).

### Business in drei Stufen mit Nutzerplätzen, Schalter Privat/Business

**Preisbuch (`business`):** Business Starter 49 CHF · 49 € · $55 (3 TB, 5 Nutzer), Business 129 CHF · 129 € ·
$139 (10 TB, 10 Nutzer), Enterprise ab 490 CHF (ab 50 TB, 50 Nutzer, Vertrag); weiterer Nutzer 8 CHF · 8 € · $9
pro Monat bzw. 80 CHF pro Jahr. Jahresabo = 10 Monatspreise. Alles im Admin-Preisbuch änderbar, mit Marge.
**Konto (Migration v14):** `business_tier`, `seats`, `custom_quota_gb` (Enterprise). Quota nach Stufe,
Mitglieder teilen sie. Weniger Plätze als Personen im Team lassen sich nicht buchen.
**Team:** Der Family-Mechanismus gilt jetzt für Business-Teams (Einladungslinks, Plätze laut gebuchten
Nutzern, gemeinsamer Speicher, Teamordner Ende-zu-Ende, Entfernen). Mitglieder erhalten Business (inkl.
Speicher-API) und folgen dem Plan des Inhabers.
**Stripe:** Produkte Business Starter/Business und „zusätzlicher Nutzer“ (Menge); Checkout mit beiden
Positionen, Stufen-/Nutzerwechsel direkt am Abo (anteilig), Webhook setzt Stufe und Plätze.
**Oberfläche:** „Pakete & Speicher“ mit Schalter Privat/Business; Business-Karten mit Nutzerauswahl
(inklusive, +1/+3/+5/+20/+50) und Live-Preis, Enterprise mit Kontakt. Zusatzspeicher auch für Business.
Startseite: Business „ab 49 CHF“ mit Nutzerhinweis.

**Tests:** Vitest 101/101 (Stripe: Stufe + Nutzer als Positionen, Wechsel zu Starter entfernt Plätze;
Team: Plätze, Mitglieder-Plan, gemeinsame Quota), Playwright 7/7.

### Speicher-API (S3) für Business, unlöschbare Backups, Aufbewahrungsregeln, 5-TiB-Dateien

**S3-Server (`server/s3/*`, Migration v13):** Protokoll aus dem Backup-Programm nach `server/s3/protocol.ts`
verschoben und auf Streaming umgebaut (kein Zwischenspeichern, auch im lokalen Gateway nur noch dort, wo
auf dem Gerät verschlüsselt wird). Mehrmandantenfähig: Access Key → Konto (`s3_keys`, Secret mit
SERVER_SECRET verschlüsselt). `AccountS3Store` schreibt Bodies direkt in 32-MiB-Teile als normale Objekte
(fmt `s3`) → Quota, Abrechnung, Filecoin-Sicherung und Nachweis gelten automatisch. Multipart bis 10 000
Teile à 5 GiB, Teile laufen direkt in Piece-Bereiche und werden beim Abschluss durchnummeriert.
**Object Lock** (GOVERNANCE mit Bypass, COMPLIANCE nicht aufhebbar, nur verlängerbar), Standardfrist je
Bucket und Frist je Objekt, Schutz vor Löschen und Überschreiben. **Aufbewahrungsregeln (GFS)** je Bucket
und Präfix, in der Wartung angewendet; alte Multipart-Uploads werden nach 7 Tagen abgebrochen.
Lokal startet die API mit dem Dev-Server auf Port 9000; Production als eigener Prozess (`STORAGE-API.md`).
Dashboard „Speicher-API“ (nur Business): Endpoint, Schlüssel (Secret einmalig), Buckets mit Object Lock,
Aufbewahrung, Filecoin-Status, Schnellstart für restic, pgBackRest, WAL-G, rclone, Proxmox/Veeam/Synology.

**Große Dateien:** App-Uploads bis 160 000 Teile (≈ 5 TiB); Upload-URLs kommen in Etappen (erst 64).
Leere Objekte sind erlaubt (0-Byte-Teile) und werden von der Filecoin-Bündelung übersprungen.

**Oberfläche:** Secure Send, Familienordner und Papierkorb als Buttons in „Meine Cloud“, Passkeys unter
„Konto & Sicherheit“. Favicon und App-Icons im FocVault-Design (statt „FV“ in Gelb).

**Tests:** Vitest 99/99 (Speicher-API mit dem offiziellen AWS-SDK: 70-MiB-Objekt über drei Teile, Range über
Teilgrenzen, Quota, Überschreiben/Freigeben, leere Objekte, Multipart 41 MiB, Object Lock COMPLIANCE/
GOVERNANCE, GFS-Regeln, Filecoin-Sicherung von S3-Objekten; 5-TiB-Anmeldung mit URLs in Etappen).
Live gegen localhost: Schlüssel und Bucket im Dashboard angelegt, 50 MB per AWS-SDK hoch/runter identisch.

### Gemeinsamer Familienordner (Ende-zu-Ende) und Englisch für Passwörter/Notizen/2FA

**Familienordner (Migration v12, `server/family/space.ts`, `features/family/*`):** Jedes Konto erzeugt ein
ECDH-P-256-Schlüsselpaar; der private Teil liegt im eigenen verschlüsselten Tresor-Index (auf allen
Geräten gleich), der öffentliche beim Server. Der Ordner-Schlüssel (AES-256, Generationen) wird je
Mitglied mit ECDH-ES + HKDF-SHA-256 + AES-GCM verpackt; Familie, Generation und Empfänger stecken in
HKDF-Info und AAD (Hüllen lassen sich nicht umleiten). Jedes Gerät, das einen Schlüssel besitzt, verteilt
fehlende Hüllen automatisch (auch ältere Generationen für neue Mitglieder). Der Inhaber legt Generation 1
an und nach dem Entfernen eines Mitglieds eine neue; entfernte Mitglieder bekommen serverseitig keine
Dateien mehr, ihre Familienordner-Dateien gehen an den Inhaber (Quota). Index des Ordners: AES-GCM mit
der neuesten Generation, optimistisches Locking, bei Konflikt wird die Änderung neu angewendet.
Datei-Schlüssel gemeinsamer Dateien sind mit dem Ordner-Schlüssel verpackt (`spaceGen`), Objekte tragen
`space_owner` (Lesen/Löschen für alle Mitglieder). Endet das Family-Abo, behält der Inhaber den Ordner.
UI: Menüpunkt „Familienordner“ mit Zugriffsstatus je Mitglied, Hochladen, Vorschau, Download, Löschen für
alle, Teilen eigener Dateien. Der Server sieht weder Ordner-Schlüssel noch Namen oder Inhalte.

**Englisch:** Passwort-Manager, Notizen, 2FA-Authenticator und QR-Scan vollständig zweisprachig
(`lib/i18n/messages/secrets.ts`, 68 Texte je Sprache, inkl. CSV-Import-Meldungen).

**Tests:** Vitest 94/94 (u. a. Hüllen nur für Empfänger/Generation/Familie öffnbar, Index-Header,
Server: Generationen, Rechte, Rotation), Playwright 7/7 (neu im Family-Test: Kind wartet → Inhaber legt
Schlüssel an und lädt hoch → Kind lädt die gemeinsame Datei byte-identisch herunter).

### Passkey-Entsperren (Pro/Family)

Face ID, Touch ID, Windows Hello oder Sicherheitsschlüssel statt Passphrase – über die WebAuthn-PRF-
Erweiterung (hmac-secret). Beim Einrichten bestätigt man mit der Passphrase; der Browser holt den
PRF-Wert, leitet per HKDF-SHA-256 (Kontext `focvault/passkey-kek/v1` + Credential-ID) einen Schlüssel ab
und verpackt damit den Master-Key (`account_keys.kek_type = 'passkey'`, `kek_id` = Credential-ID,
Salt/Name in `kdf_params`). Der Server speichert nur diese Hülle – ohne das Gerät wertlos. Entsperren:
„Mit Passkey entsperren“ im Sperrbildschirm. Die Anmeldung (Session) bleibt unverändert; Passphrase und
Recovery-Kit gelten weiter. Nur mit Abo sichtbar/nutzbar; Free sieht ein Schloss. Bis zu 10 Passkeys,
einzeln entfernbar. Neuer Menüpunkt „Passkeys“.

**Tests:** Vitest 91/91 (Plan-Sperre, doppelt, Entfernen, bei Free ausgeblendet), Playwright: echter
WebAuthn-Ablauf mit virtuellem Authenticator inkl. PRF (einrichten → sperren → mit Passkey entsperren).

### Backup-Programm (CLI) und S3-Gateway

**`cli/`** (gebündelt mit esbuild zu `bin/focvault.mjs`, Node ≥ 20): nutzt dieselben Module wie der Browser
(Schlüsselableitung, Upload `frame2`, Tresor-Index mit Merge). `features/api/client.ts` bekam
`configureApi()` (Server-Adresse, Cookie) und `absoluteUrl()`, `transfer.ts` lädt ohne `XMLHttpRequest`
per `fetch` hoch. Befehle: `login`, `status`, `ls`, `backup <Ordner>` (inkrementell nach Größe/Änderungszeit,
geänderte Dateien → Versionen bei Pro/Family, Index in Etappen), `restore` (atomar, pfadsicher), `s3`, `logout`.
Live geprüft gegen localhost: 40 MB + Unterordner, zweiter Lauf „unverändert“, Änderung → neue Version,
Wiederherstellen byte-identisch.

**S3-Gateway (`cli/s3.ts`, `cli/sigv4.ts`, `cli/s3-store.ts`):** eigener S3-Server auf 127.0.0.1 mit
SigV4-Prüfung (Header und signierte Links), `aws-chunked`-Uploads der AWS-SDKs, ListObjects v1/v2 mit
Präfix/Trennzeichen/Seiten, Range-Downloads, Multipart, Copy, Mehrfach-Löschen. Speicher ist der
Tresor: jedes Objekt wird auf dem Gerät verschlüsselt, Index gebündelt gespeichert (beim Beenden
garantiert). Tests mit dem offiziellen `@aws-sdk/client-s3` als Client; live gegen den echten Tresor
geprüft (3 MB hoch/runter identisch, Liste, Löschen, Datei danach im Tresor). Anleitung: `BACKUP.md`.

**Tests:** Vitest 90/90, Playwright 6/6.

### Nachweis auf Filecoin (Proof-Zertifikat) und Explorer-Links

Klick auf „Filecoin ✓“ an einer Datei öffnet den Nachweis: Netz, gesichert seit, Anzahl verschlüsselter
Teile, jede Kopie mit Anbieter und Datensatz samt Link „Beweise ansehen“ in den öffentlichen PDP-Explorer
(`pdp.filecoin.cloud/{netz}/dataset/{id}`), das Filecoin-Piece (PieceCID) und ein herunterladbares
Zertifikat (JSON) mit SHA-256 jedes Ciphertext-Teils, Byte-Bereich im Paket, Abruf-URL je Anbieter und
Prüfanleitung (Migration v11: `foc_members.sha256`, beim Bündeln berechnet). Der Nachweis verrät keine
Inhalte. Admin-FOC-Tab: Datensätze, PDP- und Filecoin-Pay-Explorer verlinkt.
URL-Schema aus dem Explorer-Router geprüft (`/:network/dataset/:id`, `/:network/piece/:cid`).

**Tests:** Vitest 87/87 (Zertifikat: SHA-256 stimmt mit den echten Bytes, Bereiche, Explorer-Link,
kein Zugriff für fremde Konten), Playwright 6/6.

### Family: gemeinsamer Speicher, eigene Tresore

Migration v10 (`families`, `family_members`, `family_invites`), `server/family/service.ts`.
Der Inhaber eines Family-Abos lädt per Link ein (einmalig, 7 Tage, nur gehasht gespeichert; Plätze laut
Preisbuch inkl. offener Einladungen). Wer den Link öffnet, wird bei Bedarf zur Registrierung geführt und
danach gefragt, ob er beitreten will. Mitglieder bekommen alle Pro-Module (auch Papierkorb/Versionen)
und teilen die Quota inkl. Zusatzspeicher des Inhabers; Uploads prüfen den gesamten Pool. Jedes Mitglied
behält eigenes Konto, eigene Passphrase und eigenen Tresor – der Inhaber sieht nur Namen und Speicher
je Person, nie Inhalte. Beitritt nur ohne eigenes laufendes Abo; Mitglieder können kein eigenes Abo und
keinen Zusatzspeicher buchen. Entfernen/Austreten → Free (Daten bleiben). Endet das Family-Abo
(Kündigung, Stripe, Admin), fallen alle Mitglieder automatisch auf Free.
Noch nicht: gemeinsamer Familienordner (braucht geteilte Schlüssel, §4.5) – kommt als nächster Schritt.

**Tests:** Vitest 87/87 (Einladen, einmaliger Link, Pool-Speicher, Sperre für eigenes Abo, Entfernen,
Abo-Ende, Plätze), Playwright 6/6 (neu: Inhaber lädt ein → neues Konto registriert sich über den Link
→ tritt bei → Pro-Module frei → Link verbraucht → Inhaber entfernt Mitglied).

### Dateiversionen (Pro/Family)

Gleicher Name im selben Ordner erneut hochgeladen → neue Fassung wird aktuell, die bisherige bleibt als
Version erhalten (Migration v9, Objektzustand `version`, Aufbewahrung im Preisbuch: 30 Tage, höchstens
10 je Datei). Versionen zählen zur Quota und werden auf Filecoin mitgesichert. Im Dashboard zeigt die
Datei „n Versionen“; der Dialog listet alle Fassungen mit Herunterladen und Wiederherstellen (tauscht
aktuelle und ältere Fassung). Abgelaufene Versionen löscht die Wartung, der Index gleicht sich ab.
Endgültiges Löschen einer Datei entfernt auch ihre Versionen. Free: beide Dateien bleiben nebeneinander.
Preisbuch: neuer Bereich „Aufbewahrung“ (Papierkorb, Versionen).

**Tests:** Vitest 85/85 (Versionen: Quota, Wiederherstellen, Ablauf), Playwright 5/5 (Pro: neu hochladen →
1 Version → Wiederherstellen → Download byte-identisch mit der alten Fassung).

### Stripe: Abos, Zusatzspeicher, Pay-as-you-go (bereit, sobald die Schlüssel eingetragen sind)

**Architektur (`server/stripe/*`, Migration v8):** eine schmale `StripeGateway`-Schnittstelle (einzige
Stelle mit dem Stripe-SDK 22), Geschäftslogik separat und mit einer Attrappe getestet. Preise kommen
immer aus unserem Preisbuch (`price_data`, `tax_behavior: inclusive`); Stripe kennt nur vier Produkte,
die FocVault beim ersten Kauf selbst anlegt. Ohne `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` bleibt
alles wie bisher (lokal Käufe ohne Zahlung).

- **Abo:** Stripe Checkout (Monat/Jahr, CHF/EUR/USD, Promo-Codes, optional Stripe Tax); Freischaltung
  ausschließlich per signiertem Webhook, jedes Ereignis genau einmal (`stripe_events`), Abo-Stand wird
  bei jedem Ereignis frisch geholt (Reihenfolge egal). Paketwechsel in derselben Währung direkt am Abo
  (anteilig), Kündigung zum Laufzeitende mit „Abo fortsetzen“; nach Ablauf automatisch Free (Daten bleiben).
- **Zusatzspeicher:** weitere Position im selben Abo; im Kundenportal entfernte Positionen enden bei uns.
- **Pay-as-you-go:** Karte einmal per Checkout (Setup) hinterlegen, Tagesstand je Konto (`usage_daily`),
  Monatsabschluss nach Durchschnitt über alle Tage, unter dem Minimum Übertrag (`payg_invoices`),
  sonst Rechnung mit sofortiger Abbuchung. Läuft in der Wartung, idempotent je Konto und Monat.
- **Kundenportal:** „Zahlung & Rechnungen“ (Zahlungsmittel, Rechnungen, Kündigen); Hinweis bei
  fehlgeschlagener Zahlung. Admin zeigt „Stripe: aus/Testmodus/Live“ und die neuen Ereignisse.
- Anleitung für das Stripe-Konto: `STRIPE.md`.

**Pro-Module:** Passwörter, Notizen, 2FA und (kommende) Passkeys zeigen für Free ein Schloss mit
Hinweis „Upgrade nötig – ab Pro“.

**Tests:** Vitest 84/84 (neu: Checkout → Webhook → Pro, doppelte Zustellung, Wechsel, Kündigung,
Zusatzspeicher-Positionen, PAYG mit Übertrag und Abbuchung, Webhook-Signatur mit echtem SDK),
Playwright 5/5.

### Papierkorb (Pro/Family) und Vorschau im Browser

**Papierkorb (Migration v7):** Löschen verschiebt bei Pro/Family in den Papierkorb (`state = trashed`,
`purge_after`), Frist im Preisbuch (`trashDays`, Standard 30). Der Papierkorb zählt zur Quota und zu
den Kosten (Admin-Auswertung, FOC-Sicherung bleibt bestehen), Freigabe-Links werden sofort ungültig.
Wiederherstellen, einzeln endgültig löschen, Papierkorb leeren; nach Ablauf löscht die Wartung
(`server/maintenance.ts`, Hintergrund bzw. `GET /api/v1/cron/maintenance`) endgültig – auch auf Filecoin.
Metadaten liegen weiter verschlüsselt im Tresor-Index (`trash`), der Geräte-Abgleich (3-Wege-Merge)
kennt den Papierkorb. Free: endgültiges Löschen nach Bestätigung; der Papierkorb-Button in „Meine
Cloud“ zeigt ein Schloss mit Hinweis „Upgrade nötig“. Nach dem Löschen: „Rückgängig“ (12 s).
Bestätigungen laufen über einen eigenen Dialog statt `window.confirm`.

**Vorschau:** Klick auf Datei/Kachel öffnet eine Vorschau (Bilder, PDF, Video, Audio, Text), lokal
entschlüsselt als Blob-URL, Blättern mit ←/→, Escape schließt. Obergrenzen je Typ (z. B. Video 400 MB),
darüber Hinweis „bitte herunterladen“. CSP: `frame-src blob:` für PDFs.

**Tests:** Vitest 80/80 (u. a. Papierkorb-Lebenszyklus inkl. Ablauf, Merge über Geräte),
Playwright 5/5 (neu: Textvorschau; Pro: Löschen → Rückgängig → Papierkorb → Wiederherstellen → Download
byte-identisch).

### Filecoin Onchain Cloud als Speicher, Secure Send neu, Wallet-Modus entfernt

**FOC-Anbindung (`server/foc/*`, Migration v5, Admin-Tab „Filecoin (FOC)“):** Der Server sichert
alle fertig hochgeladenen Datei-Pieces und den jeweils neuesten Tresor-Index auf Filecoin Onchain
Cloud. Bezahlt wird mit USDFC aus der Betreiber-Wallet (MetaMask): Einzahlen + Freigabe des
Speicherdienstes in einer Transaktion (Monatslimit aus Speicherbudget), danach autorisiert die
Wallet einen **Session Key** des Servers (Datensatz anlegen, Pieces hinzufügen/entfernen – kein
Zugriff auf Guthaben). Der private Teil liegt AES-GCM-verschlüsselt (Schlüssel aus SERVER_SECRET)
in der DB. Wirtschaftlich: alle Kunden teilen sich 2 Datensätze (0.12 $/Monat je Datensatz) und
viele 32-MiB-Pieces werden zu Paketen bis 512 MiB gebündelt (FOC-Gebühr pro Piece). Gelöschte
Dateien werden markiert, leere Pakete bei den Anbietern entfernt. Optional wird die schnelle Kopie
(Fil One/lokal) nach X Stunden entfernt; gelesen wird dann per HTTP-Range direkt vom Anbieter
(`FocBackedProvider`). Ampel: Warnung unter 21 Tagen Guthaben, Upload-Stopp unter 5 Tagen, Minus
oder abgelaufener Schlüssel = kritisch. Abgleich im Hintergrund (`instrumentation.ts`) oder per
Cron (`/api/v1/cron/foc`, `CRON_SECRET`). Synapse SDK 2.0.2 / synapse-core 0.10.0.
Dashboard: „Filecoin ✓“ an jeder Datei, die vollständig auf Filecoin liegt.

**Secure Send für Konten (Migration v6, `server/shares`, `/s/<id>#…`):** Link verweist auf die
gespeicherte Datei (keine Kopie, keine Quota), Metadaten + Datei-Schlüssel mit dem Link-Schlüssel
verschlüsselt, der nur im Fragment steht. Ablauf, Download-Limit (serverseitig, atomar gezählt),
optionales Passwort (PBKDF2), Widerrufen, Übersicht unter „Secure Send“. Empfängerseite ohne
Konto, zweisprachig.

**Preisbuch:** Speicherart (Fil One / FOC / beides) bestimmt die Kosten; FOC-Preis je Kopie und
Kopienzahl einstellbar; neue **Speicher-API**-Preise (1.5 Rp/GB, Download inklusive bis 1×) mit
Aufschlag je Speicherart. PAYG-Aufschlag: +607 % (Fil One), +676 % (FOC), +270 % (beides).

**Entfernt:** alter Wallet-Modus (Dashboard mit Wallet-Schlüssel, Pro-Gate-Contract, Top-up,
Browser-Synapse, alte Share-Seite). Wallets bleiben als Login (Reown) und für den Admin (FOC).

**Tests:** Vitest 70 → 78 (FOC-Abgleich mit Anbieter-Attrappe inkl. Range-Lesen und Aufräumen,
Ampel, Schlüssel-Verschlüsselung, Secure Send), Playwright: Secure Send mit Passwort und
Einmal-Link durch einen zweiten Browser ohne Konto. Live geprüft: Lesen von Filecoin Pay,
Freigaben und Session-Key-Registry auf Calibration und Mainnet.

### Jahresabos, CHF/EUR/USD, Pay-as-you-go neu, Deutsch/Englisch, Responsive

**Preismodell v2** (`lib/pricing.ts`, Migration v4): feste Preispunkte je Währung, Monats- und
Jahresabos (2 Monate geschenkt), Zusatzspeicher folgt Währung/Intervall des Abos. Pay-as-you-go
jetzt 3 Rp/ct pro GB (86 % Marge), nach Monatsdurchschnitt, Beträge unter dem Minimum werden
übertragen. Konto hat `currency` + `billing_interval`; Planwechsel per Self-Service
(`PUT /billing/plan`, ohne Stripe nur Dev), Währung frei wählbar solange kein Abo läuft.
Auswertung rechnet alle Währungen mit den Kursen des Preisbuchs in CHF um.

**Dashboard „Pakete & Speicher"** (`components/account/PlansView.tsx`): Umschalter Monatlich/Jährlich
und Währung, drei Paket-Karten mit Wechsel-Button, Pay-as-you-go in drei Schritten erklärt plus
Rechner (Schieberegler, Kosten, Hinweis ab wann Pro günstiger ist), Zusatzspeicher buchen/kündigen.

**Deutsch/Englisch:** URLs `/de/…` und `/en/…` mit englischen Pfaden (`/en/login`), Middleware leitet
alte Links weiter (Share-Links `/s/…` unverändert). Texte je Bereich in `lib/i18n/messages/*`
(DE/EN, von `tsc` auf Vollständigkeit geprüft). Sprache/Währung über ein dezentes Menü mit
Globus-Symbol. Übersetzt: Landing, Anmeldung/Registrierung/Recovery, Dashboard, Pakete, Fehlermeldungen.
Admin bleibt vorerst Deutsch (intern). Sprachwechsel im Dashboard behält den entsperrten Tresor.

**Responsive:** Seitenleiste wird auf Tablet/Handy zur Kopfzeile mit Menü, Topbar bricht um, Raster
einspaltig, Tabellen scrollen. Automatische Prüfung (390/820/1440 px): keine Seite scrollt horizontal.
Zoom auf dem Handy wieder erlaubt (Barrierefreiheit).

**Gefunden & behoben:** Sprache blieb nach Client-Navigation hängen (Root-Layout wird nicht neu
gerendert) → Sprache als Client-Zustand. `/de/login` lieferte 404 → englische Pfade in beiden Sprachen.
Landing versprach veraltete Dinge („nur Wallet“, „Recovery-Kit auf der Roadmap“) → korrigiert.

**Tests:** Vitest 70/70, Playwright 5/5 (neu: Sprache per Browser, Sprachmenü, Jahres-/Währungspreise
auf der Landing, alte Share-Links).

### Billing & Admin-Wirtschaftlichkeit (Free 5 GB + PAYG, Pro 1 TB, Family 2 TB, Zusatzspeicher)

**Kernbefund:** Fil One rechnet per Kreditkarte (Stripe) auf den Tagesdurchschnitt ab – für die
Free-Nutzer gibt es **eine** Monatsrechnung, keine Einzahlung pro Nutzer und keine USDFC-Wallet.
Scheitert die Zahlung, sperrt Fil One sofort alle Uploads (im Admin als kritischer Hinweis).

- `lib/pricing.ts`: Preisbuch (Standardwerte), Wirtschaftlichkeit, Szenario-Hochrechnung,
  PAYG-Rechnung – eine Formel für Admin, Rechner und `PRICING.md`.
- Migration v3: `settings` (Preisbuch, Reserve), `account_addons`, PAYG-Felder, `last_login_at`,
  `platform_daily` (Tagesverlauf).
- `server/billing/`: Quota = Paket + Zusatzspeicher bzw. PAYG-Obergrenze **live aus dem Preisbuch**;
  Zusatzspeicher buchen/kündigen (Kündigung nur, wenn die Daten danach passen), PAYG an/aus,
  Admin-Gutschriften, Ist-Wirtschaftlichkeit aus Echtdaten, USDFC-Reserve (nur Lesen, Live-Saldo,
  Laufzeit), Kontensuche mit Seiten (skaliert auf 100 000+). Käufe ohne Stripe nur lokal bzw. mit
  `BILLING_DEV_PURCHASES=1`.
- Admin neu mit Tabs: Übersicht · Wirtschaftlichkeit (Free-Subvention, Budget, Deckung durch
  Pro-Kunden, Inaktive, Deckungsbeitrag je Paket) · Szenario-Rechner · Preisbuch (mit Worst-Case-Marge
  je Preis) · Finanzierung (Fil-One-Rechnung, Krypto-Reserve) · Konten (Paket, PAYG, +100 GB Kulanz).
- Konto: „Speicher & Abrechnung“ mit PAYG (eigene Obergrenze) bzw. Zusatzspeicher und Monatssumme.
- Pro jetzt **1 TB** (vorher 2 TB); Anzeige dezimal (1 GB = 10^9 Byte); Landing-Texte korrigiert
  („PAYG ohne Aufschlag mit USDFC“ stimmte nicht mehr).
- `PRICING.md`: Konkurrenz (Dropbox, MEGA, Proton, Tresorit, pCloud, Google), Deckungsbeiträge,
  Free-Tier-Kosten, Hochrechnung 10k–1M Nutzer, offene Punkte (MWST, Jahresabos, Stripe).

**Tests:** Vitest 67/67 (neu: 6 Preis-/Kalkulationstests, 4 Billing-Tests), E2E grün (Admin-Test
auf Tab „Konten“ mit Suche angepasst).

### Login per Reown (Google, Apple, E-Mail, Wallets) – Entscheidung E1

**Prinzip:** Reown liefert die **Identität**, nicht den Tresorschlüssel. Nach dem Reown-Login wird
eine SIWE-Nachricht (EIP-4361) signiert, unser Server prüft sie und legt die Session an. Neue
Nutzer legen danach Passphrase + Recovery-Kit an; bestehende entsperren mit der Passphrase.
Grund: Signaturen eingebetteter Social-/E-Mail-Wallets sind nicht garantiert deterministisch
(Audit M14) – ein daraus abgeleiteter Schlüssel würde Nutzer aussperren.

- `app/providers.tsx`: Reown AppKit + WagmiAdapter (Filecoin Calibration/Mainnet; E-Mail, Google,
  Apple, GitHub, Discord, X, 80+ Wallets; eingebettete Wallets als EOA). Ohne Project-ID wie bisher.
- Server: Migration v2 (`auth_wallets`, `auth_nonces`, `accounts.email` optional, `accounts.label`),
  `server/auth/wallet.ts` (Einmal-Nonce, Domain-/URI-Bindung, Netz, Alter, EOA- und
  Smart-Account-Signaturprüfung, HMAC-signiertes Registrierungs-Token, Recovery mit Session),
  Routen `/api/v1/auth/wallet/{nonce,verify,register}`, `/api/v1/account/recovery`.
- Admin auch über `ADMIN_ADDRESSES`; SIWE-Domain in Production über `APP_ORIGIN` (nicht `Host`).
- UI: Reown-Button auf `/anmelden` und `/registrieren`, gemeinsamer `RegistrationFlow`,
  Wiederherstellung mit Session (nur Kit + neue Passphrase), Anzeige über `label` statt E-Mail.

**Abhängigkeiten:** wagmi 2.12.11 → **2.19.5** (Pflicht für AppKit, deckt Audit H5 teilweise ab).
Stolperfalle: `@reown/appkit-adapter-wagmi` führt `@wagmi/connectors` optional als `>=5.9.9`
→ npm zog 8.2.0 (gehört zu wagmi v3, verlangt `@wagmi/core@3.6.5`) → Browser-Build brach mit
„`./tempo` not exported“. `--legacy-peer-deps` verschluckte den Konflikt. Fix: `@wagmi/connectors`
fest auf **6.2.0**. Zusätzlich webpack-Alias `@x402` → leer (optionale Zahlungsmodule des
Coinbase-SDK, von uns nicht genutzt). `tsc` erkennt solche Bundle-Fehler nicht – deshalb nach
Paket-Updates immer Seiten im Browser prüfen.

**Tests:** Vitest 57/57 (neu: 5 Wallet-Tests mit echten Signaturen – Registrierung/Login, Replay,
fremde Domain, falsches Netz, alte Nachricht, gefälschte Signatur, manipuliertes Token, Recovery),
Playwright-E2E grün, Reown-Fenster öffnet ohne Konsolenfehler. Echte Google-/Apple-Logins lassen
sich nicht headless testen → manuell prüfen.

### Phase 1 – Konten, Backend, Fil-One-Storage (ARCHITECTURE §15)

**Was man auf localhost sieht:** `/registrieren` (4 Schritte inkl. Recovery-Kit und Wortprüfung),
`/anmelden`, `/wiederherstellen`, `/app` (Dashboard im bestehenden Design: Cloud, Passwörter,
Notizen, 2FA, Konto & Sicherheit), `/admin` (Konten, Speicher, Kosten, MRR, Audit-Log).
Die Landing-Buttons „Anmelden/Registrieren/Kostenlos starten“ führen dorthin (Production erst mit
`NEXT_PUBLIC_ACCOUNTS_ENABLED=1`); „Wallet verbinden“ bleibt der bisherige Wallet-Modus.

**Backend (`server/`, Route-Handler unter `app/api/v1/`)**
- `db/`: `Db`-Interface, lokal PGlite (`.data/pglite`), Production `pg` über `DATABASE_URL`; Migration v1
- `storage/`: `StorageProvider` mit `FilOneS3Provider` (SigV4, Path-Style, Flexible Checksums aus),
  `LocalFsProvider` (Dev, signierte URLs), `MemoryProvider` (Tests); Proxy-Route `/api/v1/storage/*`
- `auth/`: Sessions (HttpOnly-Cookie, Token nur als SHA-256 in der DB), scrypt-Hash des Auth-Keys,
  Rate-Limit, Re-Auth für sensible Aktionen; CSRF über Pflicht-Header `x-fv-client`
- `accounts/`, `vault/`, `objects/`, `admin/`: Registrierung, Pre-Login ohne User-Enumeration,
  Login, Recovery, Passphrase-Wechsel (meldet andere Geräte ab), versionierter Index mit
  optimistischem Locking, Objekte mit Quota-Reservierung (Zeilensperre), Größenprüfung beim Abschluss,
  Usage-Ledger, Audit-Log
- Health: `GET /api/v1/health`

**Client (`features/`, `lib/`)**
- `features/keys/kdf.ts`: Argon2id (64 MiB, t=3) → HKDF → KEK + Auth-Key; zufälliger Master-Key,
  gewrappt für Passphrase **und** Recovery-Kit (24 BIP39-Wörter) → **Audit C1 strukturell behoben**
- `features/vault/`: Index verschlüsselt (AAD = Konto-ID), Sync mit 3-Wege-Merge (`lib/merge.ts`)
- `features/objects/transfer.ts`: Upload in 32-MiB-Pieces (`frame2`, AAD = Objekt + Piece),
  Retry/Backoff, URL-Erneuerung, Fortschritt; Download streamend, große Dateien direkt auf die Platte
- `features/account/AccountProvider.tsx`: Master-Key nur im RAM, Auto-Lock 30 Min.

**Gefunden und behoben:** leere Dateien ergaben 20 Byte zu kurze Pieces (auch im Wallet-Modus).
Hinweistext unter der Dateiliste war im Konto-Modus falsch (dort wird wirklich gelöscht).

**Tests:** Vitest 52/52 (neu: Server gegen echtes Postgres im RAM, Known-Answer-Test der
Schlüsselableitung, `frame2`-Angriffe, 3-Wege-Merge) · Playwright-E2E `npm run test:e2e` 3/3.

**Neu/abweichend dokumentiert:** ARCHITECTURE §17a (ein PUT pro Piece, Proxy-Modus wegen
unklarem CORS → Entscheidung **E11**, 32-MiB-Pieces, SQL statt Drizzle), `.env.local.example`
(Audit M2).

**Noch nicht in Phase 1:** Secure Send für Konto-Dateien, Papierkorb, Stripe, E-Mail-Verifikation,
Passkeys, Family-Spaces – siehe ARCHITECTURE §15 Phase 2/3.

### Phase 0 – Hotfix D1 + Härtung (ARCHITECTURE §15)

**D1 behoben – Secure Send für neue Uploads**
- `lib/share.ts downloadSharedFile` entschlüsselte jeden Chunk mit einem einzigen
  `crypto.subtle.decrypt` und ignorierte `fmt:'frame'` und `padLen`. Seit dem Streaming-Umbau
  erzeugt `UploadZone` nur Frame-Chunks → jeder Share-Download scheiterte an der GCM-Auth.
- Neu `lib/pieces.ts decryptSharedChunks(file, fileKey, source)`: Frame-Chunks über
  `decryptPieceFrames`, Legacy-Chunks über `decryptChunk` (mit Padding). Rein, ohne SDK-Import
  → in Node testbar. `downloadSharedFile` nutzt es; Object-URL wird verzögert freigegeben (Audit L3).
- Neu `lib/crypto.ts framesForChunk(fileSize, chunkIndex, chunkCount)`; ersetzt die in
  `app/page.tsx` hart kodierte `256 * 1024 * 1024`.

**Stream-Pufferung O(n) statt O(n²)**
- `encryptedPieceStream` und `decryptPieceFrames` hängten jedes Netzwerk-Stück per
  `concatBytes` an einen wachsenden Puffer (Vollkopie pro Stück). Neu `ByteQueue` (sammelt ohne
  Kopie, entnimmt genau n Bytes). Formatgleich, nur effizienter.

**Härtung**
- `next.config.mjs`: CSP, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `nosniff`,
  COOP, `Permissions-Policy` (Kamera nur für QR), HSTS in Production (Audit H6).
  `connect-src` bleibt `https:`/`wss:`, solange das Synapse SDK dynamische Provider-Hosts nutzt.
- `?pro=1` schaltet Pro nur noch außerhalb von Production frei (Audit M13).
- `app/s/[cid]`: Share-Schlüssel wird nach dem Lesen per `history.replaceState` aus URL/History
  entfernt (Audit M11); Ref schützt vor dem StrictMode-Doppellauf in Dev.

**Tests:** `lib/pieces.test.ts` – ByteQueue, `framesForChunk`, Frame-Roundtrips (10 B, 1 MiB,
16 MiB + 5 B mit unregelmäßigen Stream-Stücken), Nachweis dass der alte Pfad scheitert,
Legacy-Chunks. Hinweis: große Arrays per `Buffer.compare` vergleichen – Vitests `toEqual`
legt pro Byte einen String-Key an und lief bei 16 MiB in einen 4-GB-OOM.

**Verifikation:** `tsc` grün · Vitest 20/20 · Headless-Chromium (Playwright, neu als devDependency):
`/` und `/s/<cid>` rendern ohne Konsolenfehler oder CSP-Verstöße.

### [PR #4] ARCHITECTURE.md – Zielarchitektur mit Fil One als Storage-Lieferant

**Kontext:** Klärung mit Partner: **Fil One (fil.one) ist unser Storage-Lieferant**, nicht
Wettbewerber. Fil One = S3-kompatibler Object Storage auf Filecoin, $4.99/TB/Monat,
keine Egress-Gebühren, EU-Region (Frankreich). Der MVP kauft Storage dagegen direkt
über Synapse/FOC mit Wallet + USDFC – für B2C nicht tragfähig.

**Neu: `ARCHITECTURE.md`** (Umsetzungsauftrag, 17 Abschnitte)
- Ist-Zustand verifiziert gegen `main` (`3ece43c`) inkl. Befund-Tabelle (Audit C1/H1–H6/M4/M8/M11/M13 + neue A1/A2/**D1**)
- Zielarchitektur: Client (Zero-Knowledge unverändert) · Backend EU (Auth, Presigned URLs,
  Quota, Shares, Billing, Family, Audit) · Fil One S3 · Stripe
- Schlüsselhierarchie neu: zufälliger Master-Key, gewrappt durch Passphrase-KEK (Argon2id),
  Passkey-PRF, **Recovery-Kit** (Pflicht), optional Wallet-KEK mit deterministischem Salt ⇒ C1 strukturell behoben
- Fil-One-Fakten (docs.fil.one, 27.09.): SigV4 + Path-Style, EU-Buckets nur per Dashboard,
  Object Lock 1 Tag–100 Jahre, Multipart 5 MB–5 GB/Part, **keine** Policies/ACLs/Lifecycle/Events ⇒ alles via Presign, Lifecycle selbst bauen
- Datenmodell (Postgres), REST-API `/api/v1`, Kernabläufe, Secure Send v3 (global atomare Einmal-Links, Widerruf, Empfänger ohne Wallet)
- Billing/Quota serverseitig auf Ciphertext-Bytes, Kostenmodell, Threat-Model, CSP, DSA/DSGVO
- Phasen 0–4 mit Abnahmekriterien, Teststrategie, 10 offene Entscheidungen (E1–E10)

**Befund D1 (neu, kritisch für Secure Send):** `lib/share.ts:122-143 downloadSharedFile`
entschlüsselt jeden Chunk mit einem einzelnen `crypto.subtle.decrypt` und ignoriert
`fmt:'frame'`/`padLen`. `UploadZone` erzeugt seit dem Streaming-Umbau nur Frame-Chunks
⇒ Secure Send scheitert für alle neu hochgeladenen Dateien an der GCM-Authentifizierung.
Fix = Frame-Pfad wie `app/page.tsx handleDownload` (`openPieceStream` + `decryptPieceFrames`).
**Separater Hotfix-PR (Phase 0), nicht in diesem Doku-PR.**

**Weitere Änderungen:** `ROADMAP.md` (PR #2/#3 als gemergt, Verweis auf ARCHITECTURE,
Fil-One-Formulierungen), `README.md` (Fil One als Lieferant statt „Abgrenzung“).

**Repo-Stand:** PR #2 gemergt 23.09. (`8c51b6a`), PR #3 gemergt 25.09. (`9dcfd10`),
`main` = `3ece43c` (`.npmrc` mit `legacy-peer-deps=true`). CI auf `main` grün.

### [noch nicht gepusht] Sprint A — CDN, Secure Send v2, Tests + CI

**T1 – CDN-Umschaltung**
- `lib/synapse.ts`: `withCDN: true` für schnelle Piece-Downloads.
- `DATASET_STORE_VERSION` auf `'3'` gehoben, Persistenz auf versioniertes Format
  `{v: 3, ids: [...]}` umgestellt.
- **Bewusste Folge:** Der Versions-Bump invalidiert alte, Nicht-CDN-fähige Datasets.
  Deshalb **kein** Resume alter Datensätze – nach dem Update wird ein frisches,
  CDN-fähiges Dataset angelegt. Im Code dokumentiert.

**T2 – Secure Send v2**
- `lib/crypto.ts`: Fragment-Format als Union `ShareFragment`
  (`bare` | `key` | `password`) plus `encodeShareFragment` / `decodeShareFragment`,
  `deriveSharePasswordKey` (PBKDF2-SHA256, 310k Runden), `wrapLinkKeyWithPassword`
  (erzeugt die IV intern) und `unwrapLinkKeyWithPassword`. `Bytes` ist jetzt exportiert.
- `lib/share.ts`: `ShareOptions {expiryMs, password?, burnAfterUse?, maxUses?}`,
  `EXPIRY_OPTIONS` (1 h / 24 h / 7 d / 30 d) und `createShareUrl(...)` mit Optionen;
  `ShareRecord` um `burnAfterUse?` / `maxUses?` erweitert. Signatur von
  `openShare(walletClient, pieceCid, linkKey)` bleibt unverändert.
- `components/ShareDialog.tsx`: Passwortfeld, Einmal-Link-Checkbox, max.-Downloads-Feld,
  Ablauf-Auswahl; `onCreate(options: ShareOptions)`.
- `app/s/[cid]/page.tsx`: Empfängerseite auf v2 – `decodeShareFragment` verarbeitet
  alle drei Formate, Passwort-Phase mit Prompt → PBKDF2 → Key-Unwrap, danach Wallet +
  `openShare`. Einmal-/Limit-Durchsetzung über `localStorage`
  (`focvault:share:uses:<cid>`) mit **ehrlichem** Hinweis, dass dies pro Gerät und
  best effort gilt (globale Durchsetzung folgt mit T7/T13).
- **Backward-Kompatibilität:** Legacy-Links mit nacktem `#<b64url>` bleiben lesbar
  (`decodeShareFragment` fällt auf `bare` zurück); `s.<key>` ist der explizite
  Key-Fragment ohne Passwort.

**T3 – Tests + CI**
- Vitest (`^5.0.1` + `vite` als Peer) mit `vitest.config.ts` (Node-Env, `lib/**/*.test.ts`).
- `lib/share.test.ts`: Fragment-Roundtrip (bare/key/password), Passwort-Wrap/Unwrap,
  Ablehnung falscher Passwörter, Container-Roundtrip.
- `lib/totp.test.ts`: RFC-6238-Appendix-B-Vektoren (SHA1, 8 Stellen).
- `lib/csv.test.ts`: Roundtrip inkl. Quoting (Komma, Anführungszeichen, Zeilenumbruch).
- `.github/workflows/ci.yml`: `npm ci --legacy-peer-deps` → `tsc --noEmit` → `npm test`.
  **Bewusst ohne `next build`**, da die Client-Wallet-Pfade (wagmi/`window`) nicht
  headless bauen.

**Beim Verifizieren gefunden und behoben**
- `Bytes` war in `lib/crypto.ts` nicht exportiert, wurde aber von `share.ts` und den
  Tests importiert.
- `wrapLinkKeyWithPassword` erzeugt die IV intern – Aufrufer in `share.ts` und den Tests
  übergaben zusätzlich eine eigene IV (3 statt 2 Argumente).
- `lib/totp.ts`: `counter` war `const`, wurde aber mutiert; `base32Decode` war als
  `Uint8Array` (`ArrayBufferLike`) deklariert und damit nicht als WebCrypto-`BufferSource`
  nutzbar.
- **Testvektor-Fehler in `lib/totp.test.ts`:** RFC 6238 Appendix B gibt `Time` in
  **Sekunden** an. Der Test rechnete `at = T * 30 * 1000` und erzeugte damit den Counter
  `T` statt `floor(T / 30)` (z. B. `T=59` → Counter 59 statt 1). Korrekt ist `at = T * 1000`.
  Die Implementierung in `lib/totp.ts` war und ist korrekt – nur der Test war falsch.

**Verifikation**

| Prüfung | Ergebnis |
|---|---|
| `npx tsc --noEmit` | ✅ grün, keine Fehler |
| `npx vitest run` | ✅ 3 Testdateien, 11/11 Tests grün |
| `curl /` (Dev-Server) | ✅ HTTP 200 |
| `curl /s/test` (Empfängerseite) | ✅ HTTP 200 |

Noch offen (braucht Wallet/Partner): Live-Upload-Test mit Dataset-Reuse auf Calibration,
End-to-End-Test eines Passwort-/Einmal-Links, CDN-Download messbar schneller messen.

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

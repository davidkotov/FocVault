# FocVault für KI-Agenten — Plan

> **Zweck:** FocVault so öffnen, dass KI-Agenten (Claude Code, Cursor, ChatGPT, Gemini, Grok,
> Perplexity, OpenClaw …) Geheimnisse **benutzen** können, ohne sie zu **lesen** — plus
> Entwickler-Geheimnisse (SSH, `.env`, PGP) und, als eigener Strang, eine Agenten-Wallet mit
> Ausgabengrenzen und menschlicher Freigabe.
>
> **Status:** Entwurf, Stand 13.10.2026. Noch nichts davon ist umgesetzt (kein MCP-/Agenten-Code
> im Repo). Dieses Dokument ist die Arbeitsgrundlage für die Umsetzung und ersetzt für diesen
> Bereich die Platzhalter-Zeile „Private AI/Vault-Freigaben“ in `ROADMAP.md` (P4).
>
> **Das „Warum“** steht hier, das „Wie“ pro Phase in §6, die Konventionen in §9.
> Zielarchitektur und Schlüsselhierarchie: `ARCHITECTURE.md` §4 / §8 / §12 (müssen mitwachsen).
>
> **Legende:** ✅ vorhanden · 🟡 Basis vorhanden (ausbaubar) · ❌ neu.

---

## 0. Zusammenfassung (für Eilige)

1. **Eine Grundregel** (§1): FocVaults Server hält **nie** einen Schlüssel, mit dem er allein
   Klartext lesen oder Geld bewegen kann. Diese Regel schützt gleichzeitig das
   Zero-Knowledge-Versprechen, den Schaden bei einem Einbruch und die regulatorische Einordnung
   der Wallet.
2. **Daraus folgen zwei Stufen** (§2): lokale Agenten (auf dem Gerät des Kunden) arbeiten echt
   Ende-zu-Ende; Cloud-Agenten (ChatGPT & Co.) bekommen **keinen Klartext**, sondern Metadaten,
   Handles, Absichten und Wirkungen. Cloud-Agent plant, lokaler Läufer führt aus.
3. **Ein Leitprinzip** (§3): *Nutzen statt Auslesen.* Der Agent erhält keinen SSH-Schlüssel,
   sondern eine Signatur; keine `.env`-Werte, sondern einen Prozess, in dem sie gesetzt sind;
   keinen privaten Wallet-Schlüssel, sondern eine Transaktion, die die Richtlinie erlaubt.
4. **Der Agent wird kryptografisch zum Mitglied** (§4.1): eigenes Schlüsselpaar, eigene
   Schlüssel-Hülle je Tresor-Generation — genau das Verfahren, das für Familienordner und
   geteilte Tresore schon läuft. Der Master-Key des Menschen ist nie beteiligt (wichtig, weil er
   RAM-only ist und nach Inaktivität verfällt — ein Agent um 3 Uhr nachts hätte ihn nicht).
5. **Die Wallet ist ein eigener Strang mit Rechts-Gate** (§4.8): FocVault wird die
   **Richtlinien-, Freigabe- und Protokollschicht** über einem Smart Account (Safe/ERC-4337),
   nicht die Verwahrstelle. Der Agent signiert mit einem **Session-Key** mit on-chain
   erzwungenen Grenzen — dasselbe Muster, das für Filecoin Pay bereits produktiv ist
   (`server/foc/chain.ts`).
6. **Zwei Anbindungen, nicht zwanzig** (§4.9): lokales stdio-MCP und entferntes MCP/REST mit
   OAuth. Die Listung in den Katalogen der Anbieter ist danach Vertrieb, nicht Entwicklung.

---

## 1. Die Grundregel

> **FocVaults Server hält nie einen Schlüssel, mit dem er allein den Klartext eines Kunden
> lesen oder dessen Geld bewegen kann.**

Jede Entscheidung in diesem Plan muss diese Regel einhalten. Sie ist nicht Prinzipienreiterei,
sie löst drei Probleme auf einmal:

| Problem | Was die Regel bewirkt |
|---|---|
| Produktversprechen | „Der Server sieht nur Ciphertext“ bleibt wahr — auch mit Agenten. |
| Schaden bei Einbruch | Ein kompromittierter FocVault-Server gibt Angreifern keine Klartexte und kein Geld. |
| Regulierung (Wallet) | Serverseitige Schlüssel, die Geld bewegen können, sehen nach **Verwahrung** aus (MiCA: Verwahrung/Transfer von Krypto-Werten für Dritte; CH: FINMA). Ohne solche Schlüssel bleibt FocVault Schlüsselverwaltungs-Software. |

**Die unbequeme Folge:** Cloud-gehostete Assistenten können keine Zero-Knowledge-Clients sein.
Ihr privater Schlüssel müsste entweder beim Anbieter (OpenAI, Google, xAI …) oder bei uns liegen —
beides bricht die Regel. Deshalb §2.

**Zweite Folge, die im Produkt klar gesagt werden muss:** Ein Geheimnis, das an einen
Cloud-Agenten zurückgegeben wird, liegt danach im Kontextfenster, in den Protokollen und
möglicherweise in der Missbrauchsprüfung eines Dritten. Wer Klartext an ChatGPT schickt, ist der
Passwort-Manager, der Geheimnisse an OpenAI mailt. Das machen wir nicht.

---

## 2. Die zwei Stufen

| | **Stufe 1 — lokale Agenten** | **Stufe 2 — Cloud-Agenten** |
|---|---|---|
| Wer | Claude Code, Cursor, Cline, Windsurf, OpenClaw, FocVault-CLI, CI-Läufer | ChatGPT, Claude.ai, Gemini, Grok, Perplexity, Deepseek |
| Anbindung | stdio-MCP + CLI auf dem Gerät des Kunden | entferntes MCP / REST über OAuth 2.1 |
| Schlüssel | Agenten-Seed im Betriebssystem-Schlüsselbund bzw. Secure Enclave, verlässt das Gerät nie | **keiner** |
| Klartext lesbar | ja, innerhalb des Geltungsbereichs | **nein** |
| Bekommt | echte Geheimnisse, echte Signaturen | Metadaten, Handles, Absichten, Wirkungen, Freigabe-Anträge |
| Server sieht | nur Ciphertext (unverändert) | nur Ciphertext (unverändert) |

**Das Zusammenspiel ist das Produkt:** Der Cloud-Agent orchestriert („starte die App“, „deploye“,
„zahle die Rechnung“), der lokale Läufer besitzt die Schlüssel und führt aus. „Bring your own
runner.“ Für Stufe 2 ohne Läufer bleiben drei ehrliche Wege:

1. **Nur Wirkungen** (empfohlen): Der Cloud-Agent kann Aufträge anstoßen, die ein lokaler Läufer
   oder die CI ausführt. Klartext fließt nie.
2. **Mensch in der Mitte**: Der Agent erzeugt einen Einmal-Link; der Mensch öffnet ihn, der
   Browser entschlüsselt. Für den gelegentlichen Fall „ich brauche den Wert jetzt selbst“.
3. **Ausdrücklicher Rückschritt** („Hosted Secrets“, serverseitig lesbar): bricht die Grundregel.
   **Empfehlung: nicht bauen** — jedenfalls nicht in v1 und nie unbeschriftet. Wenn überhaupt,
   dann als sichtbar getrennte Speicherklasse mit eigener Schlüsselhierarchie, eigener
   Datenschutzaussage und eigenem Preis.

---

## 3. Leitprinzip: Nutzen statt Auslesen

> **Agenten bekommen Handles, Menschen bekommen Werte.**

| Feature | Falsch (Inhalt) | Richtig (Fähigkeit) |
|---|---|---|
| SSH | `id_ed25519` herausgeben | als ssh-agent Challenges signieren |
| `.env` | `STRIPE_SECRET_KEY` zurückgeben | `focvault run -- npm start` mit gesetzter Umgebung |
| PGP | privaten Schlüssel exportieren | `sign` / `decrypt` lokal ausführen |
| Wallet | privaten Schlüssel herausgeben | Transaktions-Absicht signieren, wenn die Richtlinie es erlaubt |
| Datei | ganzen Tresor ausliefern | Datei im freigegebenen Ordner lesen/schreiben |

**Klartext-Offenlegung ist der Ausnahmepfad**, nicht der Normalfall: sie braucht eine menschliche
Freigabe, wird als `reveal` protokolliert und **verbrennt das Geheimnis** — danach steht es auf
der Rotationsliste (§4.7). Das ist keine Schikane, sondern die Wahrheit: Was einmal im Kontext
eines Modells lag, ist nicht mehr geheim.

**Die Bedrohung, gegen die von Zeile eins an entworfen wird, ist Prompt-Injection.** Ein Agent,
der eine Webseite, ein GitHub-Issue oder ein PDF liest, kann angewiesen werden, Geheimnisse
abzuziehen. Das lässt sich nicht durch Sorgfalt lösen. Deshalb stehen „Nutzen statt Auslesen“,
knappe Geltungsbereiche, Default-Deny, Freigaben, Ratenbegrenzung und Kanarien-Geheimnisse in
**Phase 1** und nicht in Phase 4.

---

## 4. Die Bausteine

### 4.1 Agenten-Identität & Geltungsbereiche ❌ (Fundament, alles andere hängt daran)

**Was es ist.** Ein Agent ist ein vollwertiges, nicht-menschliches Mitglied eines Kontos oder
Teams: Name, Besitzer, Art (lokal/Cloud), Status, Ablaufdatum, Richtlinie, öffentliche
Schlüssel, eigenes Protokoll. Er ist keine Sitzung eines Menschen und erbt keine Rechte.

**Warum so.** Der Master-Key liegt nur im RAM und verfällt nach Inaktivität
(`TeamPolicy.autoLockMinutes`). Ein Agent, der nachts arbeitet, kann ihn also gar nicht haben.
Jede Lösung, die den Master-Key an den Agenten weitergibt, wäre außerdem ein Generalschlüssel —
genau das, was wir nicht wollen. Also bekommt der Agent **eigene** Schlüssel und für jeden
freigegebenen Tresor eine **eigene Hülle**. Das Verfahren existiert bereits:
`wrapSpaceKey`/`unwrapSpaceKey` in `features/family/space-crypto.ts` (ECDH-ES P-256 → HKDF →
AES-GCM, Kontext in HKDF-Info *und* AAD gebunden, Generationen für den Entzug).

**Ein Seed, drei Schlüssel.** Der Seed wird **auf dem Gerät des Agenten** erzeugt (Stufe 1) und
verlässt es nie; abgeleitet werden daraus:

| Ableitung | Kurve | Wofür |
|---|---|---|
| `focvault/agent/vault/v1` | P-256 (ECDH) | Tresor-Hüllen — passt ohne Änderung in `wrapSpaceKey` |
| `focvault/agent/chain/v1` | secp256k1 | Session-Key der Wallet (Phase 5) |
| `focvault/agent/ssh/v1` | Ed25519 | optionale eigene SSH-Identität des Agenten |

Der Server speichert nur die öffentlichen Teile. Die Kopplung läuft über einen kurzlebigen
**Kopplungs-Code** (wie eine Geräte-Anmeldung): Konto erzeugt den Code → Läufer tauscht ihn gegen
ein Agenten-Token und meldet seine öffentlichen Schlüssel → der Browser des Menschen verpackt die
Tresor-Schlüssel für den öffentlichen Agenten-Schlüssel. Der Server sieht dabei nie Klartext.

**Entscheidung zum Datenmodell (siehe §8.1).** Empfehlung: Agenten als Zeile in `accounts` mit
neuer Spalte `kind text CHECK (kind IN ('human','agent'))`. Dann funktionieren
`account_pubkeys`, `shared_vault_members`, `shared_vault_keys` und der ECDH-Kontext **ohne
Änderung** — und wir duplizieren keine Krypto-Pfade (dort entstehen Fehler). Preis: jede Abfrage,
die Konten zählt oder listet, braucht `kind = 'human'`. Das ist eine überschaubare, aber reale
Aufräumarbeit (Admin-Statistik, Team-Mitglieder, Billing, Löschkaskaden) und steht als Aufgabe in
Phase 1.

**Richtlinie je Agent** (`agents.policy`, JSON, Default-Deny):

```json
{
  "kinds": ["env", "ssh"],
  "capabilities": ["list", "use", "sign"],
  "revealsPerDay": 0,
  "hours": { "tz": "Europe/Zurich", "from": 7, "to": 22 },
  "ips": ["203.0.113.0/24"],
  "requireApproval": { "reveal": true, "env": ["prod"], "paymentAbove": { "USDC": 100 } },
  "spend": { "dayCap": { "USDC": 250 }, "weekCap": { "USDC": 1000 }, "allowlist": ["0x…"] }
}
```

**Begründungspflicht.** Jeder sensible Aufruf verlangt `reason` + `taskId`. Das Muster gibt es
schon bei den Team-Zugriffsanträgen (`team_recovery_requests.reason`) und es ist der Unterschied
zwischen einem Protokoll, das man liest, und einem, das man ignoriert.

**Grenzen.** Ein Agent bekommt **nie**: Rechnungswesen, Admin, Kontolöschung, Team-Richtlinien,
Notfallzugang, Passkey-Verwaltung, Erzeugen von Secure-Send-Links ohne Freigabe.

---

### 4.2 Freigaben — ein Subsystem, vier Abnehmer ❌

**Was es ist.** Ein Postfach für Entscheidungen, die ein Mensch treffen muss, mit Web-Push auf die
bestehende PWA und E-Mail als Rückfallebene.

**Vier Abnehmer, ein Bauteil:**
1. **Offenlegen** — Agent will Klartext (§3).
2. **Zahlung** — Betrag über der Grenze oder Empfänger nicht auf der Liste (§4.8).
3. **Kopplung** — neuer Agent wird eingerichtet.
4. **Produktionszugriff** — `.env`-Satz `prod` wird angefragt (§4.5).

**Warum zusammen.** Alle vier brauchen dasselbe: Antrag mit Begründung, Benachrichtigung,
Entscheidungs-UI mit lesbarer Zusammenfassung, Ablauf, Protokoll, Nachvollziehbarkeit. Einmal
bauen (Phase 1), dreimal anschließen. Baut man es pro Feature, bekommt man drei halbe Lösungen.

**Für Zahlungen** zeigt die Karte eine **simulierte, lesbare Absicht**: „250 USDC an `0x…` —
Hetzner, bekannter Empfänger, 3. Zahlung, Tagesbudget danach 0/250“. Rohe Calldata ist keine
Freigabe, sondern ein Blankoscheck.

---

### 4.3 Prüfprotokoll & Filecoin-Anker 🟡

**Was es ist.** `audit_events` (vorhanden) wird erweitert um: Agenten-Bezug, laufende Nummer,
**Hash-Kette** (`prev_hash`/`hash`), Agenten-Ansicht im UI, signierter Export.

**Und der Teil, den sonst niemand hat:** Die Wurzel der Hash-Kette wird periodisch **auf Filecoin
verankert** — mit der PDP-/Zertifikats-Maschinerie, die für Dateien schon existiert
(`server/foc/proofs.ts`). Ergebnis: ein manipulationssicheres, von Dritten prüfbares Protokoll
darüber, was eine KI mit Geheimnissen und Geld getan hat.

**Warum das zählt.** Für Business/Compliance ist „wer hat das Leck verursacht“ die erste Frage
nach einem Vorfall. Und es macht die Filecoin-Geschichte tragend statt dekorativ: nicht „wir
speichern auch dezentral“, sondern „unser Prüfpfad ist beweisbar unverändert“.

---

### 4.4 SSH-Schlüssel ❌ — speichern ist die leichtere Hälfte

**Was es ist.** Neue Geheimnis-Art `ssh` in `lib/vault.ts` (persönlich **und** in geteilten
Tresoren/Teamordnern) **plus** ein Agenten-Socket im CLI.

**Warum der Socket der eigentliche Wert ist.** Ein Schlüssel, den der Agent nach `~/.ssh/` kopiert,
ist kaum besser als eine Datei. Deshalb: Der FocVault-Läufer hält den entschlüsselten Schlüssel in
seinem **eigenen** Speicher, exportiert `SSH_AUTH_SOCK`, signiert für `ssh`, `git`, `rsync`,
`ansible` — und protokolliert jede Signatur mit dem angefragten Host. Der Agent bekommt Zugriff,
nie das Material.

**Felder** (in `SecretEntry`): `keyType` (`ed25519`|`rsa`|`ecdsa`), `publicKey`, `fingerprint`,
`privateKeyOpenssh`, `keyPassphrase?`, `hosts?`, `comment?`. Fingerprint und öffentlicher Teil
werden im UI angezeigt, damit man Schlüssel ohne Entsperren wiedererkennt.

**Team:** Entzug läuft über die vorhandenen Generationen (`shared_vault_keys` + `rotate`) — wer aus
dem Tresor entfernt wird, bekommt beim nächsten Schlüsselwechsel nichts mehr.

**Nicht-Ziel (bewusst):** eine SSH-Zertifikatsstelle mit kurzlebigen Zertifikaten. Fachlich die
richtige Antwort für Teams (und die bessere Antwort für Agenten), aber ein eigenes Produkt
(Teleport-/Smallstep-Klasse). Notieren, nicht bauen — Platzhalter in §7.

---

### 4.5 `.env`-Variablen ❌ — der größte kurzfristige Gewinn, aber kein Speicher-Feature

**Was es ist.** Geheimnis-Art `env`: ein benannter Satz Variablen je Projekt und Umgebung
(`dev`/`staging`/`prod`), persönlich oder im Teamordner.

**Warum „kein Speicher-Feature“.** Doppler, Infisical, 1Password Secrets Automation und Vault haben
alle gelernt: Der Tresor ist Commodity, das Produkt ist **Einspeisung, Abgrenzung und Rotation**.
Wenn wir nur „speichern und anzeigen“ bauen, ist es ein Drei-Tage-Feature und mittelmäßig. Zu
budgetieren sind die Einspeisungs-Oberflächen:

- `focvault run -- npm start` — Variablen nur in der Umgebung des Kindprozesses, nie auf Platte
- `focvault env pull/push/diff` — lokale `.env` gegen den Tresor abgleichen, Abweichungen zeigen
- GitHub-Action, Docker-Entrypoint, Vercel-/Fly-Abgleich
- MCP-Werkzeug `env_run`: Der Agent startet Befehle *mit* Umgebung, ohne die Werte zu sehen

**Warum es die stärkste Agenten-Geschichte ist.** Das häufigste Leck heute ist der Mensch, der die
`.env` zum Debuggen in ein Chatfenster kopiert. „Dein Agent startet die App, ohne die Schlüssel zu
sehen“ ist in dreißig Sekunden demonstriert und sofort verstanden.

**Felder:** `project?`, `env?` (`dev`|`staging`|`prod`), `vars: Array<{ key, value, masked? }>`.
`prod` ist in der Standard-Richtlinie freigabepflichtig (§4.2).

---

### 4.6 PGP-Schlüsselpaare ❌ — in v1 nur speichern (begründete Kürzung)

**Empfehlung: speichern, exportieren, Fingerprint anzeigen — und sonst nichts.** Begründung, damit
die Entscheidung später nachvollziehbar bleibt:

- Der Hauptanwendungsfall (signierte Git-Commits) ist weitgehend zu **SSH-Signaturen**
  abgewandert (`git config gpg.format ssh`) — das deckt §4.4 bereits ab.
- Verschlüsselte E-Mail ist eine schrumpfende Nische; wer sie braucht, hat feste Werkzeuge
  (GnuPG, YubiKey) und wechselt nicht.
- *Richtig* gemacht bedeutet `openpgp.js` (~1 MB in ein kryptografisch kritisches Bundle) plus
  Unterschlüssel, Ablauf, Widerrufszertifikate, Keyserver-Abgleich, Web of Trust. *Falsch* gemacht
  („wir legen deinen privaten Schlüssel als Text ab“) ist schlechter als kein Angebot.

**Also v1:** Art `pgp` mit `publicKeyArmored`, `privateKeyArmored`, `keyId`, `fingerprint`,
`uids?`, `expiresAt?`. Kostet ~2 Tage und erfüllt „ich brauche das an einem sicheren Ort“.
**Später, nur auf echte Nachfrage:** `sign`/`decrypt` über den lokalen Läufer. **Nie bzw. sehr
viel später:** Keyring-Verwaltung.

---

### 4.7 Begleitende Features (meine Ergänzungen) ❌

| Feature | Was | Warum |
|---|---|---|
| **Leasing** | Wo das Gegenüber es kann, kurzlebige Zugangsdaten vermitteln statt statische weitergeben (STS-Token, befristete DB-Nutzer, SSH-Zertifikate) | Das einzige Geheimnis, das man einer KI gefahrlos gibt, ist eines, das abläuft |
| **Verbrennen & Rotieren** | Offengelegtes statisches Geheimnis wird als „durch Offenlegung kompromittiert“ markiert, Rotationsaufgabe erscheint, Zeit-bis-Rotation wird gemessen | Macht den Ausnahmepfad ehrlich statt kosmetisch |
| **Kanarien-Geheimnis** | In jedem Agenten-Bereich liegt ein Honigtoken. Wird es irgendwo benutzt, ist genau dieser Bereich abgeflossen | Billig zu bauen, erkennt Lecks, die sonst niemand sieht |
| **Not-Aus** | Ein Knopf: alle Agenten-Token widerrufen, alle berührten Generationen rotieren, Leases entziehen, Session-Keys on-chain sperren | Nach einem Vorfall zählen Sekunden; Rotation ist vorhanden, sie muss nur an einen Panikpfad |
| **Agenten-Arbeitsbereiche** | Tresor-Vorlage: `dev`/`staging` frei nutzbar, `prod` freigabepflichtig | Entspricht der Arbeitsweise echter Teams |
| **Geheimnis-Entdeckung** | Repo nach hartkodierten Geheimnissen durchsuchen und anbieten, sie in den Tresor zu holen | Natürliche erste Aufgabe für einen Agenten und starker Einstiegshaken |
| **Läufer als Vertrauensanker** | Das CLI (`cli/`, bereits S3 + Backup) wächst zum Dienst: MCP, ssh-agent, `run`, Git-Credential-Helper, Signierer | Das Bauteil, das Stufe 2 nützlich macht, ohne die Grundregel zu brechen |

---

### 4.8 Krypto-Wallet ❌ — eigener Strang, Rechts-Gate zuerst

**Die drei Korrekturen an der ursprünglichen Idee** (sie sind der eigentliche Inhalt dieses
Abschnitts):

**(a) „Private Schlüssel in einer Secure Enclave“ — in wessen Enclave?**
Auf dem Mac/iPhone des Kunden: perfekt, das ist Stufe 1. Auf **unseren** Servern (HSM/KMS):
Dann können *wir* Kundengeld bewegen. Das bricht die Grundregel und sieht nach **Verwahrung** aus
(MiCA: Verwahrung und Transfer von Krypto-Werten für Dritte sind erlaubnispflichtig; CH analog
über FINMA). Das ist eine Lizenzfrage, keine Sprintfrage. **Vor Code: Anwalt.**

**(b) „Oder ein Trezor, der zum Signieren aufgerufen wird“ — ein Trezor lässt sich nicht aufrufen.**
Hardware-Wallets verlangen konstruktionsbedingt die physische Bestätigung am Gerät. „Der Agent
zahlt um 3 Uhr nachts“ und „der Trezor signiert“ schließen sich aus. Die Idee ist aber nicht
falsch, nur falsch zugeordnet: **Der Trezor ist das Freigabegerät des Menschen**, nicht die Hand
des Agenten. Er hält den Eigentümer-Schlüssel des Smart Accounts, bestätigt Zahlungen über der
Grenze und kann den Agenten entziehen. Das ist die richtige Rolle für ihn.

**(c) „Schwellenwerte, ab denen ein Mensch freigeben muss“ — nur erzwingbar, wenn jemand Nein sagen kann.**
Hält der Agent einen rohen privaten Schlüssel, ist unser Tageslimit eine **Bitte**. Ein
kompromittierter oder per Prompt-Injection gesteuerter Agent ignoriert unser UI vollständig.
Grenzen sind nur real, wenn sie etwas erzwingt, das der Agent nicht umgehen kann. Daraus folgt
die Architektur:

> Der Agent hält **keinen** Wallet-Schlüssel. Er hält einen **Session-Key** — einen delegierten
> Signierer auf einem **Smart Account** (Safe / ERC-4337 + 7579), dessen Modul **on-chain**
> erzwingt: erlaubte Ziele, erlaubte Token, Ausgabengrenze je Zeitraum, Empfängerliste, Ablauf.
> Alles darüber oder daneben landet im Freigabe-Postfach und wird vom Menschen mit Passkey oder
> Trezor signiert. Entzug ist on-chain und sofort.

**Das ist genau das Muster, das FocVault schon produktiv nutzt:** In `server/foc/chain.ts` erzeugt
der Server einen Session-Key, die Zahler-Wallet autorisiert ihn mit einem Monatslimit — „an das
Guthaben kommt er nicht“. Wir verallgemeinern von „der Server zahlt Speicherrechnungen“ zu „der
Agent zahlt innerhalb einer Richtlinie“. Keine neue Erfindung, ein bekanntes Muster.

**Daraus folgende Festlegungen:**

- **Multi-Sig: Safe nehmen.** Keine eigene Multisig. In v1 **überhaupt keine eigenen Verträge** —
  nur auditierte komponieren. Ein Fehler im eigenen Vertrag ist unwiederbringlicher Verlust, und
  ein glaubwürdiges Audit ist ein fünfstelliger, mehrwöchiger Posten.
- **Wiederkehrende/Stapel-Zahlungen**, vom Menschen vorab bewilligt: EIP-712-signierte Absicht mit
  Bedingungen (Betrag, Empfänger, frühester Termin, Mindestguthaben) + ein Keeper, der ausführt.
  **Im UI ehrlich sagen:** Die Ausführung hängt an *unserer* Verfügbarkeit — fällt der Cron aus,
  wird die Miete nicht gezahlt. Das ist ein Dienstversprechen, keine kryptografische Garantie.
- **Ketten eng halten.** „Krypto senden und empfangen“ über alles ist ein QA- und Support-Abgrund.
  Start: eine oder zwei L2 (Base/Arbitrum) mit **Stablecoins** (USDC), plus Filecoin/USDFC, weil
  dort schon alles steht. Nur Stablecoins in v1 — Agentenzahlungen sind Rechnungen, kein Handel.
- **Empfangen** ist die leichte Hälfte (Adressen, Beobachter, Webhooks) und darf in v1 mit.
- **Simulation vor jeder Freigabe** (`eth_call`/Simulation) mit dekodierter, lesbarer Absicht.

**Warum eigener Strang.** §4.1–4.7 sind „ein Geheimnis-Manager für Agenten“ — Wochen Arbeit in
einer Codebasis, die dafür schon die richtige Form hat. Die Wallet ist „eine programmierbare
Zahlungsplattform mit regulatorischer Exposition, Vertragsrisiko und einem Supportfall, bei dem
Fehler Geld kosten, das man nicht zurückbuchen kann“. Getrennt planen, getrennt ausliefern,
Testnetz zuerst.

**Die Positionierung, die trägt:** „Der Ort, an dem KI-Agenten ihr Geld halten“ ist ein echter,
verteidigbarer Platz — aber verteidigbar ist die **Richtlinien-, Freigabe- und Protokollschicht**,
nicht die Verwahrung. Die Standards für Agentenzahlungen (x402-artige HTTP-402-Flüsse, AP2) waren
Mitte 2026 in Bewegung; **vor dem Entwurf aktuellen Stand prüfen**. Die Kontroll- und
Freigabeschicht für die Schiene zu sein, die gewinnt, ist die bessere Wette, als die Wallet zu sein.

---

### 4.9 Anbindung: MCP **und** REST ❌

**Beides, und sie sind keine Alternativen:**

- **REST** (`/api/v1/agent/**`) ist das Substrat — für CI, Skripte, fremde Laufzeiten, eigene Tools.
- **MCP** ist die Benutzeroberfläche für Assistenten und ein **dünner Client des REST-APIs**. Keine
  Geschäftslogik im MCP-Server, sonst gibt es zwei Wahrheiten.

**Zwei Oberflächen, nicht zwanzig.** Lokales **stdio-MCP** (Claude Code, Cursor, Cline, Windsurf,
OpenClaw …) und **entferntes MCP/REST mit OAuth 2.1** (ChatGPT-Connectors, Claude.ai, Gemini).
Danach ist die Listung in den Katalogen der Anbieter **Vertrieb mit Wartezeiten**, keine
Entwicklung. „Alle möglichen KI-Agenten“ heißt: zwei bauen, in viele eintragen.

**Werkzeuge (Default-Deny, jedes einzeln per Richtlinie freigeschaltet):**

| Werkzeug | Stufe 1 | Stufe 2 | Zweck |
|---|---|---|---|
| `vault_list`, `vault_search`, `secret_metadata` | ✓ | ✓ | Was existiert, ohne Werte |
| `secret_envelope` | ✓ | ✗ | Ciphertext + eigene Hülle (nur lokal entschlüsselbar) |
| `env_run`, `ssh_sign`, `pgp_sign` | ✓ | ✗ (über Läufer) | Nutzen ohne Lesen |
| `secret_reveal_request` | ✓ | ✓ | Erzeugt einen Freigabe-Antrag, nie direkt Klartext |
| `file_list`, `file_read`, `file_write` | ✓ | ✓ | Nur in freigegebenen Ordnern |
| `payment_intent_create`, `approval_status` | ✓ | ✓ | Absicht einreichen, Status abfragen |
| `audit_tail` | ✓ | ✓ | Eigene Spur einsehen |

**„Die Gesamtheit von FocVault“ ist ein schlechtes Ziel.** Rechnungswesen, Admin, Kontolöschung,
Team-Richtlinien und Notfallzugang sind hoher Schaden bei nahezu null Nutzen für einen Agenten.
Die richtige Fassung des Satzes lautet: **alles, was nützlich und sicher ist — nichts, was bloß
möglich ist.**

---

## 5. Die eine echte Krypto-Änderung: Granularität

**Das Problem.** Heute ist der Tresor-Index **ein** verschlüsselter Block je Konto bzw. je
geteiltem Tresor (`vault_indexes`, `shared_vault_index`). Wer den Schlüssel hat, hat **alle**
Einträge darin. Eine Freigabe „der Agent darf genau dieses eine Geheimnis“ ist damit nicht
abbildbar — sie wäre eine Lüge im UI.

**v1 — ohne Krypto-Änderung (sofort auslieferbar, ehrlich):**
Der Geltungsbereich eines Agenten **ist ein ganzer Tresor**. Kunden legen einen „Agenten“-Tresor
an und legen genau hinein, was der Agent braucht. Das UI sagt das so. Kosten: null neue Krypto,
nutzt `shared_vaults` + Generationen unverändert.

**v2 — Schlüssel je Eintrag (Phase 4):**
Jedes Geheimnis bekommt einen eigenen Datenschlüssel (DEK); der Index enthält die verpackten DEKs;
eine Freigabe verpackt **nur** die DEKs im Geltungsbereich. Erst damit ist „genau dieser eine
Eintrag“ wahr.

Betroffen: `features/vaults/crypto.ts` (Indexformat v2), `lib/vault.ts`
(`SecretEntry.dek`-Hülle + `parseSecrets`), `server/vaults/service.ts` (Freigaben je Eintrag),
Migration + **ein sorgfältiger Umschlüssel-Pfad für bestehende Tresore** (alte Generation lesen,
DEKs erzeugen, neu verpacken, Version hochzählen — mit Rückfallebene, falls der Client abbricht).
Das ist die riskanteste Einzelaufgabe im Plan und gehört deshalb nicht in Phase 1.

---

## 6. Phasenplan (Ausführung)

> Schätzungen für eine Person + Claude, grob und als Form zu lesen, nicht als Zusage.
> Jede Phase endet mit grünem `npx tsc --noEmit`, `npx vitest run` und den genannten E2E-Tests.

### Phase 1 — Fundament (3–4 Wochen)

**Datenmodell** (`server/db/migrations.ts`, **Version 28**, append-only):

```sql
ALTER TABLE accounts ADD COLUMN kind text NOT NULL DEFAULT 'human'
  CHECK (kind IN ('human','agent'));

CREATE TABLE agents (
  id uuid PRIMARY KEY,                       -- = accounts.id (Agent ist ein Konto kind='agent')
  owner_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  label text NOT NULL,
  runtime text NOT NULL CHECK (runtime IN ('local','cloud')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked')),
  policy jsonb NOT NULL DEFAULT '{}',
  chain_address text,                        -- Phase 5
  ssh_public_key text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);
CREATE TABLE agent_tokens (
  id uuid PRIMARY KEY, agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE, label text NOT NULL,
  expires_at timestamptz NOT NULL, last_used_at timestamptz, revoked_at timestamptz
);
CREATE TABLE agent_pairings (
  id uuid PRIMARY KEY, agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  code_hash bytea NOT NULL UNIQUE, expires_at timestamptz NOT NULL, used_at timestamptz
);
CREATE TABLE approvals (
  id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('reveal','payment','enroll','env_prod')),
  payload jsonb NOT NULL, reason text NOT NULL, task_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  requested_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  decided_at timestamptz, decided_by uuid REFERENCES accounts(id)
);
CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  endpoint text NOT NULL, p256dh text NOT NULL, auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE audit_events ADD COLUMN agent_id uuid REFERENCES agents(id) ON DELETE SET NULL;
ALTER TABLE audit_events ADD COLUMN seq bigserial;
ALTER TABLE audit_events ADD COLUMN prev_hash bytea;
ALTER TABLE audit_events ADD COLUMN hash bytea;
```

**Code**

| Datei | Inhalt |
|---|---|
| `server/agents/service.ts` | Anlegen, Kopplung, Token, Widerruf, Geltungsbereiche; zod-Schemata wie in `server/vaults/service.ts` |
| `server/agents/policy.ts` | Richtlinien-Prüfung als **reine Funktion** (Fähigkeit, Art, Zeitfenster, IP, Zähler) → vollständig unit-testbar |
| `server/auth/guard.ts` | `requireAgent(req, db)` → `AgentInfo`; Token `fva_…` im `Authorization: Bearer`, Hash über `sha256` aus `server/shared/bytes` (Muster: `s3_keys`) |
| `server/approvals/service.ts` | Antrag, Entscheidung, Ablauf, Web-Push (VAPID-Schlüssel als neue Env-Variablen) |
| `server/deps.ts` | `audit()` um `agentId` und Hash-Kette erweitern (eine Stelle, alle Aufrufer profitieren) |
| `lib/vault.ts` | `SecretKind` um `ssh`, `env`, `pgp` erweitern, neue Felder, `isSecret`/`sanitizeSecret` nachziehen |
| `lib/api-types.ts` | `AgentView`, `AgentPolicy`, `ApprovalView` |
| `features/agents/client.ts` | Browser: Geltungsbereich für den öffentlichen Agenten-Schlüssel verpacken (`wrapSpaceKey`) |
| `app/api/v1/agents/**` | `GET/POST /agents`, `PATCH/DELETE /agents/[id]`, `POST /agents/[id]/tokens`, `POST /agents/[id]/grants`, `POST /agents/pair` |
| `app/api/v1/approvals/**` | `GET`, `POST /[id]/approve`, `POST /[id]/reject` |
| `components/account/AgentsPanel.tsx`, `ApprovalsPanel.tsx` | Verwaltung + Postfach (Vorbild: `components/account/*`) |
| `components/DevSecretsPanel.tsx` | SSH/`.env`/PGP (Vorbild: `PasswordsPanel.tsx`, `TotpPanel.tsx`) |
| `lib/i18n/messages/agents.ts` | **DE + EN**, wie alle Module |

**Aufräumarbeit (nicht vergessen):** alle Abfragen, die Konten zählen/listen, auf
`kind = 'human'` einschränken — `server/admin/*`, `server/team/service.ts`,
`server/family/*`, `server/billing/*`, Admin-Statistik, Löschkaskaden.
Suche: `grep -rn "FROM accounts" server/`.

**Abnahme**
- Unit: Richtlinien-Prüfung (Default-Deny, Zeitfenster, Zähler), `parseSecrets` mit neuen Arten,
  Hash-Kette (Manipulation wird erkannt).
- E2E (`e2e/`): Agent anlegen → koppeln (Attrappe) → Tresor freigeben → Agent listet Metadaten →
  Offenlegung beantragt → Freigabe → Protokolleintrag sichtbar → Not-Aus widerruft alles.
- **Vertragstest:** Keine Antwort auf `/api/v1/agent/**` enthält Klartext-Geheimnisse für
  `runtime = 'cloud'`. Dieser Test ist die technische Form der Grundregel — er darf nie rot werden.

### Phase 2 — Stufe-1-Läufer (2–3 Wochen) · *das Vorzeige-Demo*

| Datei | Inhalt |
|---|---|
| `cli/agent-keys.ts` | Seed erzeugen/halten: macOS `security` (Keychain, Secure Enclave wo möglich), Linux `secret-tool`, Windows Credential Manager; Rückfall: Datei mit Passphrase |
| `cli/mcp.ts` | stdio-MCP-Server, dünner Client des REST-APIs (`@modelcontextprotocol/sdk`, Installation mit `--legacy-peer-deps`) |
| `cli/ssh-agent.ts` | ssh-agent-Protokoll (`REQUEST_IDENTITIES`, `SIGN_REQUEST`), Ed25519 über `node:crypto`, Protokoll je Signatur |
| `cli/run.ts` | `focvault run -- <befehl>`: Variablen nur in der Kindprozess-Umgebung, Maskierung in Logs |
| `cli/env-sync.ts` | `env pull/push/diff` |
| `cli/git-credential.ts` | Git-Credential-Helper |
| `cli/focvault.ts` | Unterbefehle: `agent pair`, `daemon`, `run`, `ssh-agent`, `mcp`, `env`, `git-credential` |

**Abnahme:** `focvault daemon` + Claude Code verbunden; `ssh git@github.com` signiert über
FocVault, ohne dass ein Schlüssel auf Platte liegt; `focvault run -- node -e "…"` sieht die
Variablen, `ps`/Shell-History nicht; jede Signatur steht im Protokoll.

### Phase 3 — Stufe-2-Oberfläche (3–4 Wochen)

- `app/api/v1/agent/**`: `me`, `secrets` (nur Metadaten), `secrets/[id]/envelope` (nur
  `runtime='local'`), `reveal`, `files`, `audit`.
- `app/api/mcp/route.ts` (entferntes MCP über HTTP) +
  `app/.well-known/oauth-authorization-server/route.ts`, `server/agents/oauth.ts`
  (OAuth 2.1, PKCE, kurzlebige Token, Zustimmungsseite mit Geltungsbereich in Klartext).
- Ratenbegrenzung über `server/auth/ratelimit.ts` (vorhanden), Kanarien-Geheimnisse,
  Offenlegungs-Zähler, Web-Push live.

**Abnahme:** ChatGPT-Connector und Claude.ai verbunden; Offenlegung ist nur über Freigabe
möglich; Vertragstest aus Phase 1 weiterhin grün; Lastgrenzen greifen nachweisbar.

### Phase 4 — Granularität & Rotation (3–4 Wochen)

Migration 29 (Indexformat v2, DEK je Eintrag), Umschlüssel-Pfad mit Rückfallebene (§5),
Leasing (`server/leases/*`), Verbrennen & Rotieren, GitHub-Action, Docker-Entrypoint,
Vercel-/Fly-Abgleich.

**Abnahme:** Freigabe für genau einen Eintrag belegt kryptografisch, dass der Agent die übrigen
nicht öffnen kann (Testfall mit erwartetem Entschlüsselungs-Fehlschlag); bestehende Tresore
wandern ohne Datenverlust (Migrationstest mit Abbruch in der Mitte).

### Phase 5 — Wallet (6–10 Wochen + extern, eigener Branch)

**Gate 0: Rechtsprüfung** (MiCA/FINMA, Verwahrungsfrage, AGB, Haftung) — **vor** dem ersten Commit.

Danach: Safe + Session-Key-Modul auf **Testnetz**, Migration 30
(`agent_wallets`, `wallet_policies`, `payment_intents`, `payment_executions`),
Richtlinien-Engine (Vorprüfung) + on-chain Erzwingung, Freigabekarten mit Simulation,
Empfangs-Beobachter, wiederkehrende Absichten + Keeper (vorhandener Cron:
`instrumentation.ts` bzw. `GET /api/v1/cron/maintenance`).

**Abnahme (Testnetz):** Zahlung innerhalb der Grenze läuft automatisch; über der Grenze bleibt sie
liegen bis zur Freigabe; Entzug des Session-Keys wirkt sofort on-chain; Cron-Ausfall ist
dokumentiert und im UI ehrlich beschrieben. **Mainnet erst nach Rechtsprüfung und Audit.**

---

## 7. Nicht-Ziele (bewusst ausgeschlossen)

| Nicht-Ziel | Grund |
|---|---|
| Klartext an Cloud-Agenten | Bricht die Grundregel (§1) |
| Serverseitige Schlüssel, die Geld bewegen können | Verwahrung → Lizenz (§4.8a) |
| Eigene Smart Contracts, eigene Multisig | Audit-Kosten, unwiederbringlicher Verlust bei Fehlern |
| Handel, Swaps, Bridges, NFT | Anderes Produkt, anderes Risiko |
| SSH-Zertifikatsstelle | Fachlich richtig, aber eigenes Produkt (§4.4) |
| Vollständige PGP-Keyring-Verwaltung | Aufwand/Nutzen (§4.6) |
| Agenten-Zugriff auf Rechnungswesen, Admin, Kontolöschung, Team-Richtlinien, Notfallzugang | Hoher Schaden, kein Nutzen (§4.9) |
| Bespoke-Integration je Anbieter | Zwei Oberflächen genügen; der Rest ist Vertrieb (§4.9) |

---

## 8. Offene Entscheidungen

1. **Datenmodell:** Agenten als `accounts`-Zeile mit `kind='agent'` (Empfehlung, erbt die
   erprobten Krypto-Pfade, kostet Aufräumarbeit) **oder** eigene Tabellen (sauber getrennt,
   duplizierte Hüllen-Logik)?
2. **Grundregel:** gilt sie absolut, oder soll es eine ausdrücklich beschriftete, serverseitig
   lesbare Speicherklasse geben? (Empfehlung: nein.)
3. **Wallet:** nicht-verwahrende Richtlinienschicht auf Safe (Empfehlung) oder echte Verwahrung
   (dann zuerst Anwalt, nicht Repo)? Welche Ketten/Token?
4. **PGP:** v1 nur speichern (Empfehlung) oder ganz weglassen?
5. **Tarif:** nur Business (wie geteilte Tresore und Speicher-API) oder ein Agent auch für Pro?
   Einzelentwickler sind die besten Früh-Anwender.
6. **Läufer:** vorhandenes CLI erweitern (Empfehlung, günstig, passt zur Zielgruppe) oder
   Desktop-App (erreicht später Nicht-Entwickler)?

---

## 9. Konventionen für die Umsetzung

- `npm` immer mit `--legacy-peer-deps` (`.npmrc`).
- Migrationen sind **append-only**; nächste freie Version: **28**. Nach Schema-Änderungen den
  Dev-Server neu starten (Migrationen laufen beim Start).
- **Dev-Server auf Port 3100** starten (`PORT=3100 npm run dev`) — Port 3000 belegt ein anderes
  Projekt. Für Tests **ohne** `.env.local` arbeiten (enthält Produktions-Zugangsdaten für Fil One)
  → PGlite + lokaler Storage unter `.data/`.
- Services: zod-Schemata im Service, `route()`/`json()`/`readJson()` aus `server/shared/http`,
  Fehler als `ApiError`, **jede sensible Aktion mit `audit()`**.
- Deutsche Kommentare, Texte in `lib/i18n/messages` **DE und EN**.
- Krypto: keine neuen Primitiven. Hüllen über `wrapSpaceKey`-Muster, Kontext-Strings versioniert
  (`focvault/<zweck>/v1`) und in HKDF-Info **und** AAD binden.
- Prüfen: `npx tsc --noEmit`, `npx vitest run`, `npx playwright test`.
- Feature-Branch + PR (direkter Push auf `main` ist blockiert).

---

## 10. Mitwandernde Dokumente, Preis & Wettbewerb

**Dokumente**
- `ARCHITECTURE.md` §4 (Schlüsselhierarchie bekommt Agenten-Identitäten), §8 (API-Vertrag),
  §12 (Sicherheit & Compliance).
- `SECURITY-AUDIT.md`: neuer Abschnitt Bedrohungsmodell — Prompt-Injection, kompromittierter
  Agent, Exfiltration über Werkzeugaufrufe, Missbrauch von Freigaben.
- `ROADMAP.md`: neuer Strang; die P4-Zeile „Private AI/Vault-Freigaben“ verweist hierher.
- `PRICING.md`: Position „Agenten-Zugang“.
- `README.md`: kurzer Abschnitt mit `focvault daemon` / MCP, sobald Phase 2 steht.

**Preis & Position.** Das Feature-Bündel ist Business-geformt (wie geteilte Tresore und
Speicher-API): Agenten-Plätze, Protokoll-Aufbewahrung, Freigaben. Die Wallet eher nutzungsbasiert.
Gegen 1Password Secrets Automation, Infisical, Doppler und HashiCorp Vault ist unser Vorsprung:
(a) echtes Zero-Knowledge plus Filecoin-Beweisbarkeit des Prüfpfads, (b) Privatkunden **und**
Teamordner in einem Produkt, (c) die **Freigabeschicht** für Agentenhandlungen inklusive
Zahlungen, (d) Gerichtsstand CH/EU. Punkt (c) ist der eigentliche Graben: Geheimnisverwaltung
können viele — „ein Mensch entscheidet, bevor die KI Geld ausgibt, und es ist beweisbar
protokolliert“ bisher niemand.

**Danach, ohne Code (Vertrieb mit Wartezeiten):** Claude-Skill + MCP-Listung,
ChatGPT-Connector/App-Einreichung, Gemini-Erweiterung, Ein-Zeilen-Installation für
Cursor/Cline/Windsurf, und ein `AGENTS.md`/`CLAUDE.md`-Schnipsel, den Kunden in ihr Repo legen —
damit ihr Agent weiß, dass es FocVault gibt **und wie man richtig fragt**: nutzen, nicht lesen.

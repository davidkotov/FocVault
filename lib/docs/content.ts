/**
 * Dokumentation (öffentlich unter /docs). Einfache Blöcke statt Markdown – sicher gerendert,
 * zweisprachig. Reihenfolge = Navigation.
 */
export type DocBlock =
  | { t: 'p'; x: string }
  | { t: 'h'; x: string }
  | { t: 'ul'; x: string[] }
  | { t: 'ol'; x: string[] }
  | { t: 'code'; x: string }
  | { t: 'note'; x: string }
  | { t: 'table'; head: string[]; rows: string[][] }

export interface DocArticle {
  slug: string
  group: string
  title: string
  summary: string
  blocks: DocBlock[]
}

const de: DocArticle[] = [
  {
    slug: 'erste-schritte',
    group: 'Erste Schritte',
    title: 'FocVault im Überblick',
    summary: 'Was FocVault ist, wie die Verschlüsselung funktioniert und wo deine Daten liegen.',
    blocks: [
      { t: 'p', x: 'FocVault ist eine Privacy Cloud für Dateien, Passwörter, Notizen und 2FA-Codes. Alles wird in deinem Browser verschlüsselt, bevor es dein Gerät verlässt. Gespeichert wird bei Fil One in der EU und zusätzlich auf Filecoin mit täglich geprüften Speicherbeweisen.' },
      { t: 'h', x: 'In drei Schritten' },
      { t: 'ol', x: ['Konto erstellen – mit E-Mail oder per Google, Apple bzw. Wallet.', 'Passphrase wählen und Recovery-Kit (24 Wörter) sicher aufbewahren.', 'Dateien hochladen, Passwörter anlegen, per Secure Send teilen.'] },
      { t: 'note', x: 'Wir können deine Daten nicht lesen und deine Passphrase nicht zurücksetzen. Bewahre das Recovery-Kit deshalb offline auf, z. B. ausgedruckt.' },
      { t: 'h', x: 'Pakete' },
      { t: 'ul', x: ['Free: 5 GB, danach Pay-as-you-go pro GB und Monat.', 'Pro und Family: mehr Speicher, Passwörter, Notizen, 2FA, Papierkorb, Versionen, Passkeys, Notfallzugang.', 'Business: Teams, geteilte Tresore, Admin-Konsole, Speicher-API, SSO ab Enterprise.'] }
    ]
  },
  {
    slug: 'konto-anmeldung',
    group: 'Erste Schritte',
    title: 'Konto, Anmeldung und Passkeys',
    summary: 'E-Mail, Google/Apple/Wallet, Passphrase, Passkeys und automatische Sperre.',
    blocks: [
      { t: 'p', x: 'Die Anmeldung weist nach, wer du bist. Die Passphrase entsperrt zusätzlich deinen Tresor auf dem Gerät. Beides ist getrennt: Auch bei Anmeldung per Google, Apple oder Wallet bleibt dein Tresor mit deiner Passphrase verschlüsselt.' },
      { t: 'h', x: 'Passkeys (Pro, Family, Business)' },
      { t: 'p', x: 'Unter „Konto & Sicherheit → Passkeys“ kannst du Face ID, Touch ID, Windows Hello oder einen Sicherheitsschlüssel einrichten. Der Tresor lässt sich dann ohne Passphrase entsperren. Die Passphrase und das Recovery-Kit gelten weiter.' },
      { t: 'h', x: 'Automatische Sperre' },
      { t: 'p', x: 'Nach 30 Minuten ohne Aktivität sperrt sich der Tresor. In Business-Teams legt der Admin die Zeit fest.' }
    ]
  },
  {
    slug: 'wiederherstellen',
    group: 'Erste Schritte',
    title: 'Passphrase vergessen? Wiederherstellen mit dem Recovery-Kit',
    summary: 'Mit den 24 Wörtern eine neue Passphrase setzen – ohne E-Mail.',
    blocks: [
      { t: 'ol', x: ['„Passphrase vergessen?“ auf der Anmeldeseite wählen.', 'Die 24 Wörter eingeben – eine E-Mail ist nicht nötig.', 'Neue Passphrase festlegen. Andere Geräte werden abgemeldet, deine Dateien bleiben erhalten.'] },
      { t: 'note', x: 'Ältere Konten, die noch nie wiederhergestellt wurden, brauchen beim ersten Mal zusätzlich die E-Mail oder die Anmeldung per Google, Apple bzw. Wallet.' }
    ]
  },
  {
    slug: 'sicherheit',
    group: 'Sicherheit',
    title: 'Zero-Knowledge und Verschlüsselung',
    summary: 'AES-256-GCM, Argon2id, Schlüsselhierarchie – und was wir sehen können.',
    blocks: [
      { t: 'table', head: ['Baustein', 'Verfahren'], rows: [['Dateien', 'AES-256-GCM, eigener Schlüssel pro Datei, Teile à 32 MiB'], ['Master-Key', 'zufällig (256 Bit), verpackt mit Passphrase (Argon2id, 64 MiB) und Recovery-Kit'], ['Teilen im Team', 'ECDH P-256 + HKDF + AES-GCM je Person und Generation'], ['Secure Send', 'Schlüssel nur im URL-Fragment (#…), nie auf dem Server']] },
      { t: 'h', x: 'Was der Server sieht' },
      { t: 'ul', x: ['Konto (E-Mail oder Wallet-Adresse), Paket, Speicherverbrauch.', 'Verschlüsselte Datenblöcke und deren Grösse.', 'Keine Dateinamen, keine Inhalte, keine Passwörter, keine Passphrase.'] }
    ]
  },
  {
    slug: 'filecoin',
    group: 'Sicherheit',
    title: 'Filecoin und Speicherbeweise',
    summary: 'Wie Dateien zusätzlich auf Filecoin gesichert und täglich geprüft werden.',
    blocks: [
      { t: 'p', x: 'Verschlüsselte Dateien werden gebündelt und bei zwei unabhängigen Filecoin-Speicheranbietern abgelegt. Diese müssen täglich kryptografisch beweisen (PDP), dass die Daten noch vorhanden sind.' },
      { t: 'p', x: 'In „Meine Cloud“ zeigt das Symbol „Filecoin ✓“ gesicherte Dateien. Der Speichernachweis enthält Links zum öffentlichen PDP-Explorer.' }
    ]
  },
  {
    slug: 'dateien',
    group: 'Funktionen',
    title: 'Dateien, Papierkorb und Versionen',
    summary: 'Hochladen, Vorschau, Mehrfachauswahl, Drag & Drop, Papierkorb und frühere Versionen.',
    blocks: [
      { t: 'ul', x: ['Hochladen per Knopf oder Drag & Drop, beliebig gross (gestreamt).', 'Mehrere Dateien markieren und gemeinsam teilen, verschieben oder löschen.', 'Papierkorb (Pro, Family, Business): gelöschte Dateien 30 Tage wiederherstellbar.', 'Versionen: Lädst du eine Datei mit gleichem Namen hoch, bleibt die frühere Version erhalten.'] },
      { t: 'note', x: 'Papierkorb und Versionen zählen zu deinem Speicher.' }
    ]
  },
  {
    slug: 'secure-send',
    group: 'Funktionen',
    title: 'Secure Send',
    summary: 'Dateien und Notizen per Link teilen – mit Ablauf, Download-Limit und Passwort.',
    blocks: [
      { t: 'p', x: 'Ein Link kann eine oder mehrere Dateien oder eine Notiz enthalten. Der Schlüssel steckt nur im Teil nach „#“ und erreicht unseren Server nie.' },
      { t: 'ul', x: ['Gültigkeit: 1 Stunde bis unbegrenzt.', 'Downloads: einmalig, bis 3, bis 10 oder unbegrenzt – serverseitig gezählt.', 'Optionales Passwort: am besten auf einem anderen Weg übermitteln.', 'Widerrufen jederzeit unter „Secure Send“.'] }
    ]
  },
  {
    slug: 'passwoerter',
    group: 'Funktionen',
    title: 'Passwörter, Notizen und 2FA',
    summary: 'Passwort-Check, Notiz-Vorlagen, Anhänge und 2FA-Codes.',
    blocks: [
      { t: 'ul', x: ['Passwort-Check: schwache, mehrfach verwendete und geleakte Passwörter (anonym über k-Anonymität).', 'Notizen mit Formatierung, Checklisten, Tags, Anhängen und Vorlagen (Ausweis, Kreditkarte, WLAN …).', '2FA: TOTP-Codes direkt im Tresor, Import per QR-Code oder otpauth://-Link.', 'CSV-Import und -Export für Passwörter.'] }
    ]
  },
  {
    slug: 'notfallzugang',
    group: 'Funktionen',
    title: 'Notfallzugang',
    summary: 'Eine Vertrauensperson erhält im Notfall nach einer Wartezeit Lesezugriff.',
    blocks: [
      { t: 'ol', x: ['Unter „Konto & Sicherheit → Notfallzugang“ Wartezeit wählen und Einladungslink senden.', 'Die Person nimmt an (eigenes Konto nötig, auch Free).', 'Du bestätigst mit deiner Passphrase.', 'Fordert die Person Zugriff an, kannst du ablehnen oder sofort freigeben. Ohne Einspruch erhält sie nach der Wartezeit Lesezugriff.'] }
    ]
  },
  {
    slug: 'teams',
    group: 'Teams & Business',
    title: 'Family und Business-Team',
    summary: 'Mitglieder einladen, gemeinsamer Speicher, Familien- bzw. Teamordner.',
    blocks: [
      { t: 'p', x: 'Jede Person hat ein eigenes Konto mit eigener Passphrase. Private Dateien bleiben privat. Für gemeinsame Dateien gibt es den Familien- bzw. Teamordner mit eigenem Schlüssel.' },
      { t: 'ul', x: ['Einladen unter „Konto & Sicherheit“ per Link (7 Tage gültig).', 'Dateien per Drag & Drop in den gemeinsamen Ordner ziehen.', 'Wer das Team verlässt, verliert sofort den Zugriff; neue Dateien werden mit neuem Schlüssel verschlüsselt.'] }
    ]
  },
  {
    slug: 'geteilte-tresore',
    group: 'Teams & Business',
    title: 'Geteilte Tresore',
    summary: 'Passwörter, Notizen und 2FA mit Rechten im Team teilen.',
    blocks: [
      { t: 'table', head: ['Recht', 'Darf'], rows: [['Ansehen', 'lesen und kopieren'], ['Bearbeiten', 'hinzufügen und ändern'], ['Verwalten', 'zusätzlich Personen hinzufügen und entfernen']] },
      { t: 'p', x: 'Nach dem Entfernen einer Person erhält der Tresor automatisch einen neuen Schlüssel. Jede Änderung steht im Protokoll.' }
    ]
  },
  {
    slug: 'admin-konsole',
    group: 'Teams & Business',
    title: 'Admin-Konsole, Richtlinien und Compliance-Bericht',
    summary: 'Rollen, Passkey-Pflicht, Passphrase-Länge, Link-Richtlinien, Protokoll und PDF-Bericht.',
    blocks: [
      { t: 'ul', x: ['Rollen: Inhaber, Admin, Mitglied. Admin-Rechte vergibt der Inhaber.', 'Richtlinien: Passkey-Pflicht, Mindestlänge der Passphrase, automatische Sperre, Secure-Send-Links erlauben oder begrenzen.', 'Protokoll mit Filtern und CSV-Export; Compliance-Bericht als PDF.'] },
      { t: 'h', x: 'Firmen-Notfallzugriff (Vier-Augen-Prinzip)' },
      { t: 'p', x: 'Mitglieder hinterlegen ihren Schlüssel für das Team. Ein Admin beantragt Zugriff mit Begründung, ein zweiter Admin gibt frei. Danach 24 Stunden Lesezugriff; die Person sieht jeden Zugriff.' }
    ]
  },
  {
    slug: 'sso',
    group: 'Teams & Business',
    title: 'SSO (Enterprise)',
    summary: 'Anmeldung über Google Workspace, Microsoft Entra ID oder andere OpenID-Connect-Anbieter.',
    blocks: [
      { t: 'ol', x: ['Beim Identity-Provider eine OIDC-Anwendung anlegen (Web, Authorization Code mit PKCE).', 'Redirect-URI eintragen: https://focvault.app/api/v1/auth/sso/callback', 'In der Admin-Konsole → SSO Issuer-URL, Client-ID, Client-Secret und Domains eintragen.'] },
      { t: 'table', head: ['Anbieter', 'Issuer-URL'], rows: [['Google Workspace', 'https://accounts.google.com'], ['Microsoft Entra ID', 'https://login.microsoftonline.com/<Tenant-ID>/v2.0'], ['Okta', 'https://<firma>.okta.com']] },
      { t: 'note', x: 'SSO ersetzt nur die Anmeldung. Entschlüsselt wird weiterhin auf dem Gerät mit Passphrase oder Passkey.' }
    ]
  },
  {
    slug: 'speicher-api',
    group: 'Entwickler',
    title: 'Speicher-API (S3)',
    summary: 'S3-kompatibler Speicher für Server-, Datenbank- und NAS-Backups.',
    blocks: [
      { t: 'p', x: 'Unter „Speicher-API“ legst du Zugangsschlüssel und Buckets an. Buckets können unlöschbar sein (Object Lock) und Aufbewahrungsregeln haben (täglich, wöchentlich, monatlich, jährlich).' },
      { t: 'code', x: 'aws --endpoint-url https://s3.focvault.app s3 cp backup.tar.zst s3://server-backups/\nrestic -r s3:https://s3.focvault.app/server-backups backup /etc /var/lib' },
      { t: 'ul', x: ['Unterstützt: Buckets, ListObjects v1/v2, Put/Get/Head/Delete, Multipart bis 5 TiB, CopyObject, Object Lock, signierte Links (SigV4).', 'Nicht unterstützt: Objekt-Versionierung, ACLs, Lifecycle-XML (dafür Aufbewahrungsregeln).'] }
    ]
  },
  {
    slug: 'backup-cli',
    group: 'Entwickler',
    title: 'Backup-Programm und lokales S3-Gateway',
    summary: 'Ordner verschlüsselt sichern und wiederherstellen, Werkzeuge wie rclone anbinden.',
    blocks: [
      { t: 'code', x: 'focvault login --server https://focvault.app --email du@example.com\nfocvault backup ~/Dokumente --name Laptop\nfocvault restore ~/Wiederhergestellt --prefix Laptop/\nfocvault s3 --port 9000' },
      { t: 'p', x: 'Verschlüsselt wird auf deinem Gerät, genau wie im Browser. Gespeichert wird nur ein Session-Cookie, nie die Passphrase.' }
    ]
  },
  {
    slug: 'abrechnung',
    group: 'Konto & Abrechnung',
    title: 'Pakete, Zusatzspeicher und Pay-as-you-go',
    summary: 'Wie abgerechnet wird, Zusatzspeicher buchen und individuelle Mengen anfragen.',
    blocks: [
      { t: 'ul', x: ['Pay-as-you-go (Free): über 5 GB hinaus pro GB und Monat, mit einstellbarer Obergrenze.', 'Zusatzspeicher: Pro/Family ab 200 GB, Business 3 TB bis 1000 TB – monatlich kündbar.', 'Grössere oder individuelle Mengen: über „Individuelle Menge → Anfrage senden“.', 'Business: zusätzliche Nutzer pro Monat, jährliche Zahlung mit Rabatt.'] }
    ]
  }
]

const en: DocArticle[] = [
  {
    slug: 'erste-schritte',
    group: 'Getting started',
    title: 'FocVault at a glance',
    summary: 'What FocVault is, how encryption works and where your data lives.',
    blocks: [
      { t: 'p', x: 'FocVault is a privacy cloud for files, passwords, notes and 2FA codes. Everything is encrypted in your browser before it leaves your device. Data is stored with Fil One in the EU and additionally on Filecoin with daily verified storage proofs.' },
      { t: 'h', x: 'Three steps' },
      { t: 'ol', x: ['Create an account – with email or via Google, Apple or a wallet.', 'Choose a passphrase and keep the recovery kit (24 words) safe.', 'Upload files, add passwords, share via Secure Send.'] },
      { t: 'note', x: 'We cannot read your data or reset your passphrase. Keep the recovery kit offline, e.g. printed.' },
      { t: 'h', x: 'Plans' },
      { t: 'ul', x: ['Free: 5 GB, then pay-as-you-go per GB and month.', 'Pro and Family: more storage, passwords, notes, 2FA, trash, versions, passkeys, emergency access.', 'Business: teams, shared vaults, admin console, storage API, SSO from Enterprise.'] }
    ]
  },
  {
    slug: 'konto-anmeldung',
    group: 'Getting started',
    title: 'Account, sign-in and passkeys',
    summary: 'Email, Google/Apple/wallet, passphrase, passkeys and auto-lock.',
    blocks: [
      { t: 'p', x: 'Signing in proves who you are. The passphrase additionally unlocks your vault on the device. Both are separate: even with Google, Apple or wallet sign-in, your vault stays encrypted with your passphrase.' },
      { t: 'h', x: 'Passkeys (Pro, Family, Business)' },
      { t: 'p', x: 'Under “Account & security → Passkeys” you can set up Face ID, Touch ID, Windows Hello or a security key and unlock without your passphrase. The passphrase and recovery kit keep working.' },
      { t: 'h', x: 'Auto-lock' },
      { t: 'p', x: 'The vault locks after 30 minutes of inactivity. In Business teams the admin sets the time.' }
    ]
  },
  {
    slug: 'wiederherstellen',
    group: 'Getting started',
    title: 'Forgot your passphrase? Recover with the recovery kit',
    summary: 'Set a new passphrase with the 24 words – no email needed.',
    blocks: [
      { t: 'ol', x: ['Choose “Forgot passphrase?” on the sign-in page.', 'Enter the 24 words – no email required.', 'Set a new passphrase. Other devices are signed out, your files stay intact.'] },
      { t: 'note', x: 'Older accounts that were never recovered need the email or Google/Apple/wallet sign-in the first time.' }
    ]
  },
  {
    slug: 'sicherheit',
    group: 'Security',
    title: 'Zero knowledge and encryption',
    summary: 'AES-256-GCM, Argon2id, key hierarchy – and what we can see.',
    blocks: [
      { t: 'table', head: ['Component', 'Method'], rows: [['Files', 'AES-256-GCM, one key per file, 32 MiB pieces'], ['Master key', 'random (256 bit), wrapped with passphrase (Argon2id, 64 MiB) and recovery kit'], ['Team sharing', 'ECDH P-256 + HKDF + AES-GCM per person and generation'], ['Secure Send', 'key only in the URL fragment (#…), never on the server']] },
      { t: 'h', x: 'What the server sees' },
      { t: 'ul', x: ['Account (email or wallet address), plan, storage usage.', 'Encrypted data blocks and their size.', 'No file names, no content, no passwords, no passphrase.'] }
    ]
  },
  {
    slug: 'filecoin',
    group: 'Security',
    title: 'Filecoin and storage proofs',
    summary: 'How files are additionally stored on Filecoin and verified daily.',
    blocks: [
      { t: 'p', x: 'Encrypted files are bundled and stored with two independent Filecoin storage providers, who must prove cryptographically every day (PDP) that the data is still there.' },
      { t: 'p', x: 'In “My cloud” the “Filecoin ✓” badge marks secured files. The storage certificate links to the public PDP explorer.' }
    ]
  },
  {
    slug: 'dateien',
    group: 'Features',
    title: 'Files, trash and versions',
    summary: 'Upload, preview, multi-select, drag & drop, trash and previous versions.',
    blocks: [
      { t: 'ul', x: ['Upload via button or drag & drop, any size (streamed).', 'Select several files to share, move or delete them together.', 'Trash (Pro, Family, Business): deleted files can be restored for 30 days.', 'Versions: uploading a file with the same name keeps the previous version.'] },
      { t: 'note', x: 'Trash and versions count towards your storage.' }
    ]
  },
  {
    slug: 'secure-send',
    group: 'Features',
    title: 'Secure Send',
    summary: 'Share files and notes via link – with expiry, download limit and password.',
    blocks: [
      { t: 'p', x: 'A link can contain one or more files or a note. The key lives only after “#” and never reaches our server.' },
      { t: 'ul', x: ['Validity: 1 hour to unlimited.', 'Downloads: once, up to 3, up to 10 or unlimited – counted on the server.', 'Optional password: best sent through a different channel.', 'Revoke any time under “Secure Send”.'] }
    ]
  },
  {
    slug: 'passwoerter',
    group: 'Features',
    title: 'Passwords, notes and 2FA',
    summary: 'Password check, note templates, attachments and 2FA codes.',
    blocks: [
      { t: 'ul', x: ['Password check: weak, reused and breached passwords (anonymous via k-anonymity).', 'Notes with formatting, checklists, tags, attachments and templates (ID, credit card, Wi-Fi …).', '2FA: TOTP codes right in the vault, import via QR code or otpauth:// link.', 'CSV import and export for passwords.'] }
    ]
  },
  {
    slug: 'notfallzugang',
    group: 'Features',
    title: 'Emergency access',
    summary: 'A trusted contact gets read access after a waiting period in an emergency.',
    blocks: [
      { t: 'ol', x: ['Under “Account & security → Emergency access”, choose a waiting period and send the invitation link.', 'The person accepts (own account needed, Free is fine).', 'You confirm with your passphrase.', 'If the person requests access, you can reject or release immediately. Without objection they get read access after the waiting period.'] }
    ]
  },
  {
    slug: 'teams',
    group: 'Teams & Business',
    title: 'Family and Business team',
    summary: 'Invite members, shared storage, family or team folder.',
    blocks: [
      { t: 'p', x: 'Everyone has their own account and passphrase. Private files stay private. Shared files go into the family or team folder, which has its own key.' },
      { t: 'ul', x: ['Invite under “Account & security” via link (valid for 7 days).', 'Drag files into the shared folder.', 'Anyone who leaves loses access immediately; new files are encrypted with a new key.'] }
    ]
  },
  {
    slug: 'geteilte-tresore',
    group: 'Teams & Business',
    title: 'Shared vaults',
    summary: 'Share passwords, notes and 2FA with permissions in your team.',
    blocks: [
      { t: 'table', head: ['Permission', 'Allows'], rows: [['View', 'read and copy'], ['Edit', 'add and change'], ['Manage', 'also add and remove people']] },
      { t: 'p', x: 'After removing someone, the vault automatically gets a new key. Every change is logged.' }
    ]
  },
  {
    slug: 'admin-konsole',
    group: 'Teams & Business',
    title: 'Admin console, policies and compliance report',
    summary: 'Roles, passkeys required, passphrase length, link policies, audit log and PDF report.',
    blocks: [
      { t: 'ul', x: ['Roles: owner, admin, member. The owner grants admin rights.', 'Policies: passkeys required, minimum passphrase length, auto-lock, allow or limit Secure Send links.', 'Audit log with filters and CSV export; compliance report as PDF.'] },
      { t: 'h', x: 'Company emergency access (four-eyes)' },
      { t: 'p', x: 'Members escrow their key for the team. One admin requests access with a reason, a second admin approves. Then 24 hours of read access; the person sees every access.' }
    ]
  },
  {
    slug: 'sso',
    group: 'Teams & Business',
    title: 'SSO (Enterprise)',
    summary: 'Sign in via Google Workspace, Microsoft Entra ID or other OpenID Connect providers.',
    blocks: [
      { t: 'ol', x: ['Create an OIDC application at your identity provider (web, authorization code with PKCE).', 'Add the redirect URI: https://focvault.app/api/v1/auth/sso/callback', 'In the admin console → SSO, enter issuer URL, client ID, client secret and domains.'] },
      { t: 'table', head: ['Provider', 'Issuer URL'], rows: [['Google Workspace', 'https://accounts.google.com'], ['Microsoft Entra ID', 'https://login.microsoftonline.com/<tenant ID>/v2.0'], ['Okta', 'https://<company>.okta.com']] },
      { t: 'note', x: 'SSO only replaces sign-in. Decryption still happens on the device with the passphrase or passkey.' }
    ]
  },
  {
    slug: 'speicher-api',
    group: 'Developers',
    title: 'Storage API (S3)',
    summary: 'S3-compatible storage for server, database and NAS backups.',
    blocks: [
      { t: 'p', x: 'Under “Storage API” you create access keys and buckets. Buckets can be immutable (Object Lock) and have retention rules (daily, weekly, monthly, yearly).' },
      { t: 'code', x: 'aws --endpoint-url https://s3.focvault.app s3 cp backup.tar.zst s3://server-backups/\nrestic -r s3:https://s3.focvault.app/server-backups backup /etc /var/lib' },
      { t: 'ul', x: ['Supported: buckets, ListObjects v1/v2, Put/Get/Head/Delete, multipart up to 5 TiB, CopyObject, Object Lock, presigned URLs (SigV4).', 'Not supported: object versioning, ACLs, lifecycle XML (use retention rules).'] }
    ]
  },
  {
    slug: 'backup-cli',
    group: 'Developers',
    title: 'Backup program and local S3 gateway',
    summary: 'Back up and restore folders encrypted, connect tools like rclone.',
    blocks: [
      { t: 'code', x: 'focvault login --server https://focvault.app --email you@example.com\nfocvault backup ~/Documents --name Laptop\nfocvault restore ~/Restored --prefix Laptop/\nfocvault s3 --port 9000' },
      { t: 'p', x: 'Encryption happens on your device, exactly like in the browser. Only a session cookie is stored, never the passphrase.' }
    ]
  },
  {
    slug: 'abrechnung',
    group: 'Account & billing',
    title: 'Plans, extra storage and pay-as-you-go',
    summary: 'How billing works, adding extra storage and requesting custom amounts.',
    blocks: [
      { t: 'ul', x: ['Pay-as-you-go (Free): beyond 5 GB per GB and month, with an adjustable cap.', 'Extra storage: Pro/Family from 200 GB, Business 3 TB to 1000 TB – cancel monthly.', 'Larger or custom amounts: via “Custom amount → Send request”.', 'Business: additional users per month, yearly payment with discount.'] }
    ]
  }
]

export const docs = { de, en }

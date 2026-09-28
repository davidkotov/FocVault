const de = {
  deleted: 'Dein Konto und alle Daten wurden gelöscht. Danke, dass du FocVault genutzt hast.',
  hero: {
    kicker: 'Privacy Cloud · Ende-zu-Ende-verschlüsselt',
    title: 'Deine Daten. Verschlüsselt, bevor sie dein Gerät verlassen.',
    lead: 'Dateien, Passwörter, Notizen und 2FA in einem Tresor. Verschlüsselt in deinem Browser, gespeichert in der EU und zusätzlich auf Filecoin – mit täglich geprüften Speicherbeweisen.',
    cta: 'Kostenlos starten',
    ctaSecondary: 'So funktioniert die Sicherheit',
    trust: '5 GB kostenlos · Keine Kreditkarte · Jederzeit exportierbar'
  },
  trustbar: ['AES-256-GCM im Browser', 'Zero-Knowledge', 'Speicher in der EU', 'Filecoin-Speicherbeweise', 'revDSG & DSGVO'],
  alps: {
    viz: { enc: { plain: 'Klartext', cipher: 'Chiffrat' }, nodes: ['Fil One · EU', 'Filecoin · Anbieter A', 'Filecoin · Anbieter B'], steps: ['Zufällige Challenge', 'Beweis vom Anbieter', 'On-Chain geprüft'], next: 'Läuft laufend – Beispielablauf' },
    kicker: 'Sicherheit · Privacy by Design',
    title: 'So sicher wie das Matterhorn. Und genauso unverrückbar.',
    lead: 'Deine Dateien werden verschlüsselt, bevor sie dein Gerät verlassen – und mehrfach gesichert: in der EU und auf Filecoin, mit täglich geprüften Speicherbeweisen.',
    facts: [
      { t: 'Verschlüsselt im Browser', d: 'AES-256-GCM, Schlüssel nur bei dir. Wir sehen weder Inhalte noch Dateinamen.' },
      { t: 'Mehrfach gespeichert', d: 'Fil One in der EU plus zwei unabhängige Filecoin-Speicheranbieter.' },
      { t: 'Täglich bewiesen', d: 'Kryptografische Speicherbeweise (PDP), öffentlich nachprüfbar.' }
    ],
    stats: [
      { v: 'AES-256', l: 'im Browser' },
      { v: '3', l: 'Kopien' },
      { v: '24 h', l: 'Beweis-Intervall' }
    ],
    caption: 'Live-Ablauf im Produkt – echte Oberfläche, Beispieldaten',
    steps: ['Im Browser verschlüsselt', 'Hochgeladen · Fil One EU', 'Auf Filecoin gesichert', 'Speicherbeweis erhalten'],
    processing: 'wird verarbeitet',
    secured: 'gesichert · Beweis',
    link: 'Secure-Send-Link erstellt',
    linkMeta: '7 Tage · 1 Download',
    upload: 'Hochladen'
  },
  live: {
    label: 'Live',
    uptime: 'Verfügbarkeit (90 Tage)',
    stored: 'verschlüsselt gespeichert',
    onFilecoin: 'Dateien auf Filecoin gesichert',
    plaintext: 'Klartext-Dateien auf unseren Servern',
    status: 'Zur Statusseite'
  },
  modules: {
    kicker: 'Alles in einem Tresor',
    title: 'Jedes Modul aus dem Dashboard – Ende-zu-Ende-verschlüsselt',
    lead: 'Vom privaten Speicher bis zur Firmen-Compliance. Du startest kostenlos und schaltest Module frei, wenn du sie brauchst.',
    groups: { private: 'Privat', family: 'Family', business: 'Business' },
    compareOpen: 'Alle Funktionen vergleichen',
    cols: { free: { title: 'Free', sub: 'Kostenlos, 5 GB' }, pro: { title: 'Pro & Family', sub: 'Alles aus Free, plus' }, business: { title: 'Business', sub: 'Alles aus Pro, plus' } },
    items: [
      { i: 'cloud', t: 'Meine Cloud', d: 'Dateien hochladen, Vorschau, Drag & Drop, Mehrfachauswahl – beliebig gross.', p: 'Free' },
      { i: 'send', t: 'Secure Send', d: 'Dateien per Link teilen, mit Ablauf und Download-Limit – Notizen teilen ab Pro.', p: 'Free' },
      { i: 'proof', t: 'Filecoin-Speicherbeweise', d: 'Jede Datei doppelt auf Filecoin, täglich kryptografisch geprüft.', p: 'Free' },
      { i: 'history', t: 'Papierkorb & Versionen', d: '30 Tage wiederherstellen, frühere Stände einer Datei behalten.', p: 'Pro' },
      { i: 'key', t: 'Passwörter & Passwort-Check', d: 'Generator, CSV-Import, Warnung bei schwachen und geleakten Passwörtern.', p: 'Free' },
      { i: 'note', t: 'Notizen & Vorlagen', d: 'Checklisten, Tags, Anhänge, Vorlagen für Ausweis, Karte, WLAN, Lizenz.', p: 'Free' },
      { i: 'otp', t: '2FA-Authenticator', d: 'TOTP-Codes direkt im Tresor, Import per QR-Code.', p: 'Pro' },
      { i: 'passkey', t: 'Passkeys', d: 'Entsperren mit Face ID, Touch ID, Windows Hello oder Sicherheitsschlüssel.', p: 'Pro' },
      { i: 'lifebuoy', t: 'Notfallzugang', d: 'Eine Vertrauensperson erhält nach einer Wartezeit Lesezugriff.', p: 'Pro' },
      { i: 'family', t: 'Familienordner', d: 'Bis zu 6 Personen mit eigenem Tresor und gemeinsamem Ordner.', p: 'Family' },
      { i: 'vault', t: 'Geteilte Tresore', d: 'Passwörter, Notizen und 2FA im Team teilen – mit Rechten pro Person.', p: 'Business' },
      { i: 'folder', t: 'Teamordner', d: 'Gemeinsame Dateien mit eigenem Schlüssel; Austritt entzieht den Zugriff sofort.', p: 'Business' },
      { i: 'admin', t: 'Admin-Konsole & Compliance', d: 'Rollen, Richtlinien, Protokoll und Compliance-Bericht als PDF.', p: 'Business' },
      { i: 'users', t: 'Firmen-Notfallzugriff', d: 'Zugriff auf Tresore ausscheidender Personen – nur nach dem Vier-Augen-Prinzip.', p: 'Business' },
      { i: 'database', t: 'Speicher-API (S3)', d: 'Für Server-, Datenbank- und NAS-Backups, unlöschbar mit Object Lock.', p: 'Business' },
      { i: 'terminal', t: 'Backup-Programm', d: 'Ordner verschlüsselt sichern und wiederherstellen, inkrementell.', p: 'Alle' },
      { i: 'sso', t: 'SSO', d: 'Anmeldung über Google Workspace, Microsoft Entra ID oder Okta.', p: 'Enterprise' }
    ]
  },
  security: {
    kicker: 'Architektur',
    title: 'Wir können deine Daten nicht lesen. Das ist Absicht.',
    lead: 'Die Verschlüsselung passiert auf deinem Gerät. Unser Server bekommt nur verschlüsselte Blöcke – ohne Namen, ohne Inhalt, ohne Schlüssel.',
    flow: [
      { t: 'Dein Gerät', d: 'Passphrase → Argon2id → Schlüssel. Datei → AES-256-GCM.' },
      { t: 'FocVault-Server', d: 'Speichert verschlüsselte Blöcke und prüft Berechtigungen.' },
      { t: 'Fil One (EU)', d: 'S3-Speicher in eu-west-1, nur Ciphertext.' },
      { t: 'Filecoin', d: 'Zwei Speicheranbieter, tägliche Speicherbeweise (PDP).' }
    ],
    cta: 'Sicherheit im Detail ansehen'
  },
  why: {
    kicker: 'Warum Schweiz & EU',
    title: 'Datenschutz, der nicht verhandelbar ist',
    items: [
      { i: 'pin', t: 'Datenstandort EU', d: 'Deine verschlüsselten Dateien liegen bei Fil One in der EU (eu-west-1). Zusätzliche Kopien auf Filecoin sind ebenfalls nur Ciphertext.' },
      { i: 'scale', t: 'Schweizer und EU-Recht', d: 'Wir richten uns nach dem Schweizer Datenschutzgesetz (revDSG) und der EU-DSGVO. Einen Vertrag zur Auftragsverarbeitung (AVV) stellen wir bereit.' },
      { i: 'eyeOff', t: 'Keine Weitergabe, keine Werbung', d: 'Keine Tracker in der App, kein Verkauf von Daten, keine Analyse von Inhalten – technisch gar nicht möglich.' }
    ]
  },
  compare: {
    kicker: 'Vergleich',
    title: 'Wie FocVault sich einordnet',
    lead: 'Sachlich, nach öffentlich verfügbaren Produktangaben.',
    cols: ['FocVault', 'Dropbox', 'Google Drive', '1Password'],
    rows: [
      { t: 'Alle Dateien standardmässig Ende-zu-Ende-verschlüsselt', v: ['yes', 'no', 'no', 'part'] },
      { t: 'Anbieter kann Inhalte nicht lesen (Zero-Knowledge)', v: ['yes', 'no', 'no', 'yes'] },
      { t: 'Passwörter & 2FA im selben Konto', v: ['yes', 'no', 'part', 'yes'] },
      { t: 'Terabyte-Speicher für Dateien', v: ['yes', 'yes', 'yes', 'no'] },
      { t: 'Öffentlich prüfbare Speicherbeweise', v: ['yes', 'no', 'no', 'no'] },
      { t: 'S3-API für Server-Backups', v: ['yes', 'no', 'no', 'no'] }
    ],
    legend: { yes: 'ja', no: 'nein', part: 'teilweise' },
    note: 'Stand September 2026, ohne Gewähr. „Teilweise“: 1Password verschlüsselt Dokumente im Tresor mit begrenztem Speicher; Google bietet Passwörter separat im Google-Passwortmanager. Clientseitige Verschlüsselung gibt es bei Google Workspace und Dropbox nur in bestimmten Business-Tarifen.'
  },
  proof: {
    kicker: 'Nachweise statt Versprechen',
    title: 'Prüfe uns selbst',
    items: [
      { i: 'activity', t: 'Statusseite', d: 'Verfügbarkeit aller Dienste der letzten 90 Tage, live gemessen.', l: 'Status ansehen', href: '/status' },
      { i: 'proof', t: 'Filecoin-Speicherbeweise', d: 'Jede Sicherung ist im öffentlichen PDP-Explorer nachvollziehbar.', l: 'Zum PDP-Explorer', href: 'https://pdp.filecoin.cloud/mainnet' },
      { i: 'lock', t: 'Sicherheitsarchitektur', d: 'Verfahren, Schlüsselhierarchie und was der Server sieht – offen dokumentiert.', l: 'Zur Sicherheitsseite', href: '/sicherheit' },
      { i: 'admin', t: 'Sicherheitsaudit', d: 'Eine unabhängige Prüfung ist geplant. Der Bericht wird hier veröffentlicht.', l: 'Sicherheitslücke melden', href: '/.well-known/security.txt' }
    ]
  },
  apps: {
    kicker: 'Auf allen Geräten',
    title: 'Im Browser verfügbar. Apps folgen.',
    lead: 'FocVault läuft heute in jedem modernen Browser. Native Apps für alle Plattformen sind in Arbeit.',
    web: 'Web-App',
    webSub: 'Jetzt verfügbar',
    soon: 'Bald verfügbar',
    platforms: [
      { k: 'apple', t: 'App Store', s: 'iPhone & iPad' },
      { k: 'android', t: 'Google Play', s: 'Android' },
      { k: 'apple', t: 'macOS', s: 'Mac App Store' },
      { k: 'windows', t: 'Windows', s: 'Microsoft Store' },
      { k: 'linux', t: 'Linux', s: 'AppImage · .deb · .rpm' }
    ],
    notify: 'Benachrichtigen, sobald verfügbar'
  },
  faq: {
    kicker: 'FAQ',
    title: 'Häufige Fragen',
    items: [
      { q: 'Kann FocVault meine Dateien oder Passwörter sehen?', a: 'Nein. Alles wird in deinem Browser mit AES-256-GCM verschlüsselt, bevor es hochgeladen wird. Wir speichern nur verschlüsselte Daten und kennen weder deine Passphrase noch deine Schlüssel.' },
      { q: 'Was passiert, wenn ich meine Passphrase vergesse?', a: 'Mit deinem Recovery-Kit (24 Wörter) setzt du eine neue Passphrase – ohne E-Mail. Ohne Passphrase und Recovery-Kit kann niemand deine Daten wiederherstellen, auch wir nicht.' },
      { q: 'Wo genau liegen meine Daten?', a: 'Bei Fil One in der EU (eu-west-1) und zusätzlich bei zwei unabhängigen Filecoin-Speicheranbietern. Überall liegen nur verschlüsselte Daten.' },
      { q: 'Was ist ein Filecoin-Speicherbeweis?', a: 'Die Speicheranbieter müssen täglich kryptografisch nachweisen, dass sie deine (verschlüsselten) Daten noch vollständig haben. Die Beweise sind öffentlich einsehbar.' },
      { q: 'Wie funktioniert Pay-as-you-go?', a: 'Free enthält 5 GB. Darüber hinaus zahlst du pro GB und Monat genau für das, was du speicherst – mit einer Obergrenze, die du selbst festlegst.' },
      { q: 'Kann ich FocVault im Unternehmen einsetzen?', a: 'Ja. Business bietet Teams, geteilte Tresore, Admin-Konsole mit Richtlinien, Compliance-Bericht, Firmen-Notfallzugriff nach dem Vier-Augen-Prinzip, S3-Speicher-API und ab Enterprise SSO. Einen AVV stellen wir bereit.' },
      { q: 'Kann ich meine Daten jederzeit mitnehmen?', a: 'Ja. Dateien lädst du einzeln oder mit dem Backup-Programm herunter, Passwörter exportierst du als CSV.' },
      { q: 'Gibt es Apps für iPhone, Android, Windows, macOS und Linux?', a: 'FocVault läuft heute in jedem modernen Browser, auch mobil. Native Apps für alle Plattformen sind in Arbeit.' }
    ]
  },
  team: {
    kicker: 'Wer hinter FocVault steht',
    title: 'Ein Team, das Privatsphäre ernst nimmt',
    lead: 'Wir bauen FocVault, weil Cloud-Speicher nicht bedeuten darf, die Kontrolle über die eigenen Daten abzugeben.',
    cta: 'Team kennenlernen'
  },
  final: {
    title: 'Bereit für deine eigene Privacy Cloud?',
    lead: '5 GB kostenlos. Keine Kreditkarte. In zwei Minuten startklar.',
    cta: 'Kostenlos starten',
    contact: 'Mit uns sprechen'
  }
}

const en: typeof de = {
  deleted: 'Your account and all data have been deleted. Thank you for using FocVault.',
  hero: {
    kicker: 'Privacy cloud · end-to-end encrypted',
    title: 'Your data. Encrypted before it leaves your device.',
    lead: 'Files, passwords, notes and 2FA in one vault. Encrypted in your browser, stored in the EU and additionally on Filecoin – with storage proofs verified every day.',
    cta: 'Start for free',
    ctaSecondary: 'How security works',
    trust: '5 GB free · No credit card · Export any time'
  },
  trustbar: ['AES-256-GCM in the browser', 'Zero knowledge', 'Storage in the EU', 'Filecoin storage proofs', 'Swiss FADP & GDPR'],
  alps: {
    viz: { enc: { plain: 'Plaintext', cipher: 'Ciphertext' }, nodes: ['Fil One · EU', 'Filecoin · provider A', 'Filecoin · provider B'], steps: ['Random challenge', 'Proof from provider', 'Verified on-chain'], next: 'Runs continuously – example cycle' },
    kicker: 'Security · privacy by design',
    title: 'As solid as the Matterhorn. And just as immovable.',
    lead: 'Your files are encrypted before they leave your device – and stored several times: in the EU and on Filecoin, with storage proofs verified every day.',
    facts: [
      { t: 'Encrypted in the browser', d: 'AES-256-GCM, keys stay with you. We see neither content nor file names.' },
      { t: 'Stored several times', d: 'Fil One in the EU plus two independent Filecoin storage providers.' },
      { t: 'Proven daily', d: 'Cryptographic storage proofs (PDP), publicly verifiable.' }
    ],
    stats: [
      { v: 'AES-256', l: 'in the browser' },
      { v: '3', l: 'copies' },
      { v: '24 h', l: 'proof interval' }
    ],
    caption: 'Live flow in the product – real interface, sample data',
    steps: ['Encrypted in the browser', 'Uploaded · Fil One EU', 'Secured on Filecoin', 'Storage proof received'],
    processing: 'processing',
    secured: 'secured · proof',
    link: 'Secure Send link created',
    linkMeta: '7 days · 1 download',
    upload: 'Upload'
  },
  live: {
    label: 'Live',
    uptime: 'uptime (90 days)',
    stored: 'stored encrypted',
    onFilecoin: 'files secured on Filecoin',
    plaintext: 'plaintext files on our servers',
    status: 'Status page'
  },
  modules: {
    kicker: 'Everything in one vault',
    title: 'Every module from the dashboard – end-to-end encrypted',
    lead: 'From private storage to company compliance. Start for free and unlock modules when you need them.',
    groups: { private: 'Personal', family: 'Family', business: 'Business' },
    compareOpen: 'Compare all features',
    cols: { free: { title: 'Free', sub: 'Free, 5 GB' }, pro: { title: 'Pro & Family', sub: 'Everything in Free, plus' }, business: { title: 'Business', sub: 'Everything in Pro, plus' } },
    items: [
      { i: 'cloud', t: 'My cloud', d: 'Upload, preview, drag & drop, multi-select – any size.', p: 'Free' },
      { i: 'send', t: 'Secure Send', d: 'Share files via link, with expiry and download limit – sharing notes from Pro.', p: 'Free' },
      { i: 'proof', t: 'Filecoin storage proofs', d: 'Every file stored twice on Filecoin, verified cryptographically every day.', p: 'Free' },
      { i: 'history', t: 'Trash & versions', d: 'Restore for 30 days, keep previous versions of a file.', p: 'Pro' },
      { i: 'key', t: 'Passwords & password check', d: 'Generator, CSV import, warnings for weak and breached passwords.', p: 'Free' },
      { i: 'note', t: 'Notes & templates', d: 'Checklists, tags, attachments, templates for ID, card, Wi-Fi, licence.', p: 'Free' },
      { i: 'otp', t: '2FA authenticator', d: 'TOTP codes right in the vault, import via QR code.', p: 'Pro' },
      { i: 'passkey', t: 'Passkeys', d: 'Unlock with Face ID, Touch ID, Windows Hello or a security key.', p: 'Pro' },
      { i: 'lifebuoy', t: 'Emergency access', d: 'A trusted contact gets read access after a waiting period.', p: 'Pro' },
      { i: 'family', t: 'Family folder', d: 'Up to 6 people with their own vault and a shared folder.', p: 'Family' },
      { i: 'vault', t: 'Shared vaults', d: 'Share passwords, notes and 2FA in your team – with per-person permissions.', p: 'Business' },
      { i: 'folder', t: 'Team folder', d: 'Shared files with their own key; leaving revokes access immediately.', p: 'Business' },
      { i: 'admin', t: 'Admin console & compliance', d: 'Roles, policies, audit log and a compliance report as PDF.', p: 'Business' },
      { i: 'users', t: 'Company emergency access', d: 'Access vaults of departing staff – only with four-eyes approval.', p: 'Business' },
      { i: 'database', t: 'Storage API (S3)', d: 'For server, database and NAS backups, immutable with Object Lock.', p: 'Business' },
      { i: 'terminal', t: 'Backup program', d: 'Back up and restore folders encrypted, incrementally.', p: 'All' },
      { i: 'sso', t: 'SSO', d: 'Sign in via Google Workspace, Microsoft Entra ID or Okta.', p: 'Enterprise' }
    ]
  },
  security: {
    kicker: 'Architecture',
    title: 'We cannot read your data. By design.',
    lead: 'Encryption happens on your device. Our server only receives encrypted blocks – no names, no content, no keys.',
    flow: [
      { t: 'Your device', d: 'Passphrase → Argon2id → key. File → AES-256-GCM.' },
      { t: 'FocVault server', d: 'Stores encrypted blocks and checks permissions.' },
      { t: 'Fil One (EU)', d: 'S3 storage in eu-west-1, ciphertext only.' },
      { t: 'Filecoin', d: 'Two storage providers, daily storage proofs (PDP).' }
    ],
    cta: 'See security in detail'
  },
  why: {
    kicker: 'Why Switzerland & the EU',
    title: 'Privacy that is not negotiable',
    items: [
      { i: 'pin', t: 'Data location EU', d: 'Your encrypted files are stored with Fil One in the EU (eu-west-1). Additional copies on Filecoin are ciphertext too.' },
      { i: 'scale', t: 'Swiss and EU law', d: 'We follow the Swiss Federal Act on Data Protection (FADP) and the EU GDPR. A data processing agreement (DPA) is available.' },
      { i: 'eyeOff', t: 'No sharing, no ads', d: 'No trackers in the app, no data sales, no content analysis – technically impossible.' }
    ]
  },
  compare: {
    kicker: 'Comparison',
    title: 'Where FocVault fits',
    lead: 'Factual, based on publicly available product information.',
    cols: ['FocVault', 'Dropbox', 'Google Drive', '1Password'],
    rows: [
      { t: 'All files end-to-end encrypted by default', v: ['yes', 'no', 'no', 'part'] },
      { t: 'Provider cannot read content (zero knowledge)', v: ['yes', 'no', 'no', 'yes'] },
      { t: 'Passwords & 2FA in the same account', v: ['yes', 'no', 'part', 'yes'] },
      { t: 'Terabytes of file storage', v: ['yes', 'yes', 'yes', 'no'] },
      { t: 'Publicly verifiable storage proofs', v: ['yes', 'no', 'no', 'no'] },
      { t: 'S3 API for server backups', v: ['yes', 'no', 'no', 'no'] }
    ],
    legend: { yes: 'yes', no: 'no', part: 'partly' },
    note: 'As of September 2026, without guarantee. “Partly”: 1Password encrypts documents in the vault with limited storage; Google offers passwords separately in Google Password Manager. Client-side encryption at Google Workspace and Dropbox is only available in certain business plans.'
  },
  proof: {
    kicker: 'Evidence, not promises',
    title: 'Check us yourself',
    items: [
      { i: 'activity', t: 'Status page', d: 'Uptime of all services over the last 90 days, measured live.', l: 'View status', href: '/status' },
      { i: 'proof', t: 'Filecoin storage proofs', d: 'Every backup can be traced in the public PDP explorer.', l: 'Open PDP explorer', href: 'https://pdp.filecoin.cloud/mainnet' },
      { i: 'lock', t: 'Security architecture', d: 'Methods, key hierarchy and what the server sees – openly documented.', l: 'Security page', href: '/sicherheit' },
      { i: 'admin', t: 'Security audit', d: 'An independent review is planned. The report will be published here.', l: 'Report a vulnerability', href: '/.well-known/security.txt' }
    ]
  },
  apps: {
    kicker: 'On every device',
    title: 'Available in the browser. Apps are coming.',
    lead: 'FocVault runs today in every modern browser. Native apps for all platforms are in the works.',
    web: 'Web app',
    webSub: 'Available now',
    soon: 'Coming soon',
    platforms: [
      { k: 'apple', t: 'App Store', s: 'iPhone & iPad' },
      { k: 'android', t: 'Google Play', s: 'Android' },
      { k: 'apple', t: 'macOS', s: 'Mac App Store' },
      { k: 'windows', t: 'Windows', s: 'Microsoft Store' },
      { k: 'linux', t: 'Linux', s: 'AppImage · .deb · .rpm' }
    ],
    notify: 'Notify me when available'
  },
  faq: {
    kicker: 'FAQ',
    title: 'Frequently asked questions',
    items: [
      { q: 'Can FocVault see my files or passwords?', a: 'No. Everything is encrypted in your browser with AES-256-GCM before upload. We only store encrypted data and know neither your passphrase nor your keys.' },
      { q: 'What if I forget my passphrase?', a: 'Use your recovery kit (24 words) to set a new passphrase – no email needed. Without passphrase and recovery kit nobody can restore your data, not even us.' },
      { q: 'Where exactly is my data stored?', a: 'With Fil One in the EU (eu-west-1) and additionally with two independent Filecoin storage providers. Everywhere only encrypted data is stored.' },
      { q: 'What is a Filecoin storage proof?', a: 'Storage providers must prove cryptographically every day that they still hold your (encrypted) data completely. The proofs are public.' },
      { q: 'How does pay-as-you-go work?', a: 'Free includes 5 GB. Beyond that you pay per GB and month for exactly what you store – with a cap you set yourself.' },
      { q: 'Can I use FocVault in my company?', a: 'Yes. Business offers teams, shared vaults, an admin console with policies, compliance report, company emergency access with four-eyes approval, an S3 storage API and SSO from Enterprise. A DPA is available.' },
      { q: 'Can I take my data with me at any time?', a: 'Yes. Download files individually or with the backup program, export passwords as CSV.' },
      { q: 'Are there apps for iPhone, Android, Windows, macOS and Linux?', a: 'FocVault runs today in every modern browser, including mobile. Native apps for all platforms are in the works.' }
    ]
  },
  team: {
    kicker: 'Who is behind FocVault',
    title: 'A team that takes privacy seriously',
    lead: 'We build FocVault because cloud storage should not mean giving up control over your own data.',
    cta: 'Meet the team'
  },
  final: {
    title: 'Ready for your own privacy cloud?',
    lead: '5 GB free. No credit card. Ready in two minutes.',
    cta: 'Start for free',
    contact: 'Talk to us'
  }
}

export const landing2Messages = { de, en }

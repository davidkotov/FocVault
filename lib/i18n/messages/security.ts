const de = {
  kicker: 'Sicherheit',
  title: 'Verschlüsselung, die du selbst ausprobieren kannst.',
  lead: 'FocVault ist so gebaut, dass wir deine Daten nicht lesen können – auch nicht, wenn wir wollten oder müssten. Hier siehst du live, wie das funktioniert.',
  try: {
    kicker: 'Live ausprobieren',
    title: 'Tippe etwas – dein Browser verschlüsselt es sofort',
    lead: 'Echte AES-256-GCM-Verschlüsselung mit einem zufälligen Schlüssel, der nur in diesem Browser-Tab existiert. Genau so werden deine Dateien und Passwörter verschlüsselt, bevor sie hochgeladen werden.',
    placeholder: 'z. B. Mein WLAN-Passwort ist …',
    sample: 'Mein Tresor gehört mir.',
    you: 'Was du siehst',
    server: 'Was unser Server sieht',
    key: 'Schlüssel (nur in deinem Browser)',
    iv: 'Zufallswert (IV)',
    newKey: 'Neuen Schlüssel erzeugen',
    bytes: '{n} Byte verschlüsselt · Authentifizierungs-Tag 16 Byte',
    hidden: 'nie übertragen',
    keyShort: 'Schlüssel'
  },
  keys: {
    kicker: 'Schlüsselhierarchie',
    title: 'Vom Passwort bis zur einzelnen Datei',
    lead: 'Aus deiner Passphrase entsteht auf deinem Gerät ein Schlüssel, der deinen Master-Key öffnet. Jede Datei hat einen eigenen Schlüssel. Nichts davon verlässt dein Gerät unverschlüsselt.',
    steps: [
      { t: 'Passphrase', d: 'nur in deinem Kopf' },
      { t: 'Argon2id', d: '64 MiB, 3 Durchläufe – bremst Angreifer aus' },
      { t: 'Schlüssel (KEK)', d: 'öffnet den Master-Key' },
      { t: 'Master-Key', d: '256 Bit, zufällig, verpackt gespeichert' },
      { t: 'Datei-Schlüssel', d: 'einer pro Datei, verpackt mit dem Master-Key' },
      { t: 'Verschlüsselte Datei', d: 'AES-256-GCM, Teile à 32 MiB' }
    ],
    recovery: 'Recovery-Kit: 24 Wörter öffnen den Master-Key zusätzlich – falls du die Passphrase vergisst.'
  },
  pipe: {
    kicker: 'Der Weg einer Datei',
    title: 'Verschlüsselt, mehrfach gespeichert, täglich bewiesen',
    steps: [
      { t: 'Auf deinem Gerät', d: 'in Teile zerlegt und einzeln verschlüsselt' },
      { t: 'Fil One, EU', d: 'S3-Speicher in eu-west-1 – nur Ciphertext' },
      { t: 'Filecoin', d: 'gebündelt bei zwei unabhängigen Speicheranbietern' },
      { t: 'Täglicher Beweis', d: 'Anbieter weisen kryptografisch nach, dass alles noch da ist' }
    ],
    days: 'Beispiel: ein neuer Speicherbeweis pro Tag'
  },
  link: {
    kicker: 'Secure Send',
    title: 'Der Schlüssel steckt im Link – und erreicht uns nie',
    lead: 'Browser senden den Teil nach „#“ nicht an den Server. Deshalb kann nur entschlüsseln, wer den vollständigen Link hat.',
    sent: 'geht an den Server',
    kept: 'bleibt im Browser'
  },
  table: {
    kicker: 'Verfahren',
    title: 'Was wir einsetzen',
    head: ['Bereich', 'Verfahren'],
    rows: [
      ['Dateien, Passwörter, Notizen', 'AES-256-GCM, eigener Schlüssel pro Datei'],
      ['Schlüssel aus der Passphrase', 'Argon2id (64 MiB, t = 3) + HKDF-SHA-256'],
      ['Wiederherstellung', 'BIP-39-Recovery-Kit (24 Wörter, 256 Bit)'],
      ['Teilen im Team und in der Familie', 'ECDH P-256 + HKDF + AES-GCM, je Person und Generation'],
      ['Passkeys', 'WebAuthn mit PRF-Erweiterung'],
      ['Transport', 'TLS 1.2+ mit HSTS'],
      ['Leak-Abgleich', 'k-Anonymität: nur 5 Zeichen eines SHA-1-Hashes']
    ]
  },
  sees: {
    kicker: 'Transparenz',
    title: 'Was wir sehen – und was nicht',
    yesTitle: 'Das sehen wir',
    yes: ['E-Mail-Adresse oder Wallet-Adresse', 'Paket, Speicherverbrauch, Rechnungen', 'Anzahl und Grösse verschlüsselter Blöcke', 'Zeitpunkte von Anmeldungen und Änderungen (Protokoll)'],
    noTitle: 'Das sehen wir nie',
    no: ['Dateinamen und Inhalte', 'Passwörter, Notizen, 2FA-Codes', 'Deine Passphrase und dein Recovery-Kit', 'Schlüssel von Secure-Send-Links']
  },
  report: {
    kicker: 'Verantwortungsvolle Offenlegung',
    title: 'Sicherheitslücke gefunden?',
    lead: 'Wir freuen uns über Hinweise und behandeln jede Meldung vertraulich. Bitte gib uns Zeit zur Behebung, bevor du Details veröffentlichst. Wir gehen nicht rechtlich gegen Personen vor, die in gutem Glauben und ohne Schaden für Dritte testen.',
    email: 'security@focvault.app',
    txt: 'security.txt ansehen',
    scope: 'Im Rahmen: focvault.app, die Web-App, die API und die Speicher-API. Nicht im Rahmen: Social Engineering, Denial of Service, Anbieter Dritter.',
    audit: 'Ein unabhängiges Sicherheitsaudit ist geplant; der Bericht wird hier veröffentlicht.'
  }
}

const en: typeof de = {
  kicker: 'Security',
  title: 'Encryption you can try for yourself.',
  lead: 'FocVault is built so that we cannot read your data – not even if we wanted or were forced to. See live how it works.',
  try: {
    kicker: 'Try it live',
    title: 'Type something – your browser encrypts it instantly',
    lead: 'Real AES-256-GCM encryption with a random key that exists only in this browser tab. This is exactly how your files and passwords are encrypted before upload.',
    placeholder: 'e.g. My Wi-Fi password is …',
    sample: 'My vault belongs to me.',
    you: 'What you see',
    server: 'What our server sees',
    key: 'Key (only in your browser)',
    iv: 'Nonce (IV)',
    newKey: 'Generate new key',
    bytes: '{n} bytes encrypted · 16-byte authentication tag',
    hidden: 'never sent',
    keyShort: 'Key'
  },
  keys: {
    kicker: 'Key hierarchy',
    title: 'From passphrase to a single file',
    lead: 'On your device, your passphrase becomes a key that opens your master key. Every file has its own key. None of it leaves your device unencrypted.',
    steps: [
      { t: 'Passphrase', d: 'only in your head' },
      { t: 'Argon2id', d: '64 MiB, 3 passes – slows attackers down' },
      { t: 'Key (KEK)', d: 'opens the master key' },
      { t: 'Master key', d: '256 bit, random, stored wrapped' },
      { t: 'File key', d: 'one per file, wrapped with the master key' },
      { t: 'Encrypted file', d: 'AES-256-GCM, 32 MiB pieces' }
    ],
    recovery: 'Recovery kit: 24 words also open the master key – in case you forget your passphrase.'
  },
  pipe: {
    kicker: 'The path of a file',
    title: 'Encrypted, stored several times, proven daily',
    steps: [
      { t: 'On your device', d: 'split into pieces and encrypted individually' },
      { t: 'Fil One, EU', d: 'S3 storage in eu-west-1 – ciphertext only' },
      { t: 'Filecoin', d: 'bundled with two independent storage providers' },
      { t: 'Daily proof', d: 'providers prove cryptographically that everything is still there' }
    ],
    days: 'Example: one new storage proof per day'
  },
  link: {
    kicker: 'Secure Send',
    title: 'The key lives in the link – and never reaches us',
    lead: 'Browsers do not send the part after “#” to the server. Only someone with the full link can decrypt.',
    sent: 'sent to the server',
    kept: 'stays in the browser'
  },
  table: {
    kicker: 'Methods',
    title: 'What we use',
    head: ['Area', 'Method'],
    rows: [
      ['Files, passwords, notes', 'AES-256-GCM, one key per file'],
      ['Key from passphrase', 'Argon2id (64 MiB, t = 3) + HKDF-SHA-256'],
      ['Recovery', 'BIP-39 recovery kit (24 words, 256 bit)'],
      ['Sharing in teams and families', 'ECDH P-256 + HKDF + AES-GCM per person and generation'],
      ['Passkeys', 'WebAuthn with PRF extension'],
      ['Transport', 'TLS 1.2+ with HSTS'],
      ['Breach check', 'k-anonymity: only 5 characters of a SHA-1 hash']
    ]
  },
  sees: {
    kicker: 'Transparency',
    title: 'What we see – and what we don’t',
    yesTitle: 'What we see',
    yes: ['Email or wallet address', 'Plan, storage usage, invoices', 'Number and size of encrypted blocks', 'Times of sign-ins and changes (audit log)'],
    noTitle: 'What we never see',
    no: ['File names and content', 'Passwords, notes, 2FA codes', 'Your passphrase and recovery kit', 'Keys of Secure Send links']
  },
  report: {
    kicker: 'Responsible disclosure',
    title: 'Found a vulnerability?',
    lead: 'We welcome reports and treat every one confidentially. Please give us time to fix before publishing details. We will not take legal action against people testing in good faith without harming others.',
    email: 'security@focvault.app',
    txt: 'View security.txt',
    scope: 'In scope: focvault.app, the web app, the API and the storage API. Out of scope: social engineering, denial of service, third-party providers.',
    audit: 'An independent security audit is planned; the report will be published here.'
  }
}

export const securityMessages = { de, en }

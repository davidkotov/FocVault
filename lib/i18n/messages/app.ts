const de = {
  nav: {
    cloud: 'Meine Cloud',
    send: 'Secure Send',
    plans: 'Pakete & Speicher',
    account: 'Konto & Sicherheit',
    more: 'Weitere Module',
    passwords: 'Passwörter',
    notes: 'Notizen',
    totp: '2FA-Authenticator',
    passkeys: 'Passkeys',
    soon: 'Bald',
    storage: 'Speicher',
    upgrade: 'Mehr Speicher',
    active: '{plan} aktiv',
    menu: 'Menü'
  },
  folders: { all: 'Alle', documents: 'Dokumente', photos: 'Fotos', videos: 'Videos', backups: 'Backups & Mehr' },
  search: 'Dateien durchsuchen…',
  menu: {
    synced: 'Synchronisiert',
    syncing: 'Wird synchronisiert…',
    notSynced: 'Nicht synchronisiert: {error}',
    retry: 'Erneut syncen',
    admin: 'Admin',
    lock: 'Sperren',
    lockTitle: 'Schlüssel aus dem Speicher entfernen',
    logout: 'Abmelden'
  },
  files: {
    title: 'Meine Dateien',
    count: '{n} Dateien · {size}',
    empty: 'Noch keine Dateien in deiner Cloud. Oben hochladen – Dateien landen automatisch im passenden Ordner.',
    noMatch: 'Keine Treffer.',
    share: 'Teilen',
    onFilecoin: 'Filecoin ✓',
    onFilecoinTitle: 'Auf Filecoin gesichert: {copies} Kopien bei unabhängigen Anbietern, laufend per Proof of Data Possession geprüft.',
    download: 'Herunterladen',
    remove: 'Entfernen',
    deleteNote: '„Entfernen" löscht die verschlüsselten Daten sofort aus dem Speicher und gibt den Platz frei. Ein Papierkorb folgt.',
    confirmDelete: '„{name}" endgültig löschen?'
  },
  upload: {
    title: 'Dateien speichern',
    free: '{size} frei',
    drop: 'Dateien hierher ziehen',
    orClick: 'oder klicken',
    info: 'Verschlüsselung im Browser · AES-256-GCM · gespeichert auf Filecoin (Fil One, EU)',
    abort: 'Abbrechen',
    failed: 'Upload fehlgeschlagen.'
  },
  download: { cancel: 'Abbrechen', failed: 'Download fehlgeschlagen.' },
  unlock: {
    title: 'Tresor entsperren',
    lead: 'Angemeldet als {name}. Dein Schlüssel wird nur im Arbeitsspeicher gehalten und nach 30 Minuten Inaktivität verworfen.',
    passphrase: 'Passphrase',
    working: 'Schlüssel wird abgeleitet …',
    submit: 'Entsperren',
    forgot: 'Passphrase vergessen?',
    logout: 'Abmelden'
  },
  loadingAccount: 'Lade Konto …',
  syncError: 'Tresor nicht synchronisiert: {error}',
  send: {
    title: 'Secure Send',
    badge: 'Ende-zu-Ende',
    body: 'Teile Dateien per Link – mit Ablaufdatum, Download-Limit und optionalem Passwort. Empfänger brauchen kein Konto; der Schlüssel steckt nur im Link und erreicht nie unseren Server. Links lassen sich jederzeit widerrufen. Zum Teilen in „Meine Cloud“ bei einer Datei auf „Teilen“ klicken.',
    notice: 'Links',
    empty: 'Noch keine Links erstellt.',
    file: 'Datei',
    deleted: 'gelöschte Datei'
  },
  account: {
    title: 'Konto',
    email: 'E-Mail',
    account: 'Konto',
    login: 'Login per Reown',
    plan: 'Paket',
    storage: 'Speicher',
    entries: 'Dateien · Einträge',
    since: 'Mitglied seit',
    managePlan: 'Pakete & Speicher verwalten'
  },
  security: {
    title: 'Sicherheit',
    body: 'Deine Dateien werden im Browser mit AES-256-GCM verschlüsselt. Der Master-Key ist zufällig und nur doppelt gesichert gespeichert: mit deiner Passphrase (Argon2id) und mit deinem Recovery-Kit. FocVault und Fil One sehen ausschließlich verschlüsselte Daten – keine Dateinamen, keine Inhalte.',
    kdf: 'Schlüsselableitung',
    autolock: 'Auto-Sperre',
    autolockValue: 'nach 30 Min. Inaktivität',
    kit: 'Recovery-Kit',
    kitValue: 'bei Registrierung erstellt'
  },
  changePass: {
    title: 'Passphrase ändern',
    current: 'Aktuelle Passphrase',
    newLabel: 'Neue Passphrase',
    working: 'Wird neu verschlüsselt …',
    submit: 'Passphrase ändern',
    done: 'Passphrase geändert. Andere Geräte wurden abgemeldet.',
    reauth: 'Aus Sicherheitsgründen bitte kurz ab- und wieder anmelden, dann erneut versuchen.'
  },
  upgradeWall: {
    body: 'Alle Privacy-Module sind Teil von Pro und Family – dazu mehr Speicher und Zusatzspeicher nach Bedarf.',
    cta: 'Pakete ansehen',
    passwordsDesc: 'Logins, Passwörter und Zugänge – Ende-zu-Ende-verschlüsselt in deinem Tresor.',
    notesDesc: 'Verschlüsselte Notizen für PINs, Recovery-Hinweise, Ideen – niemand sonst liest mit.',
    totpDesc: '2FA-Codes direkt hier: TOTP-Secrets sicher speichern und Codes im Browser erzeugen.'
  }
}

const en: typeof de = {
  nav: {
    cloud: 'My cloud',
    send: 'Secure Send',
    plans: 'Plans & storage',
    account: 'Account & security',
    more: 'More modules',
    passwords: 'Passwords',
    notes: 'Notes',
    totp: '2FA authenticator',
    passkeys: 'Passkeys',
    soon: 'Soon',
    storage: 'Storage',
    upgrade: 'More storage',
    active: '{plan} active',
    menu: 'Menu'
  },
  folders: { all: 'All', documents: 'Documents', photos: 'Photos', videos: 'Videos', backups: 'Backups & more' },
  search: 'Search files…',
  menu: {
    synced: 'Synced',
    syncing: 'Syncing…',
    notSynced: 'Not synced: {error}',
    retry: 'Retry sync',
    admin: 'Admin',
    lock: 'Lock',
    lockTitle: 'Remove the key from memory',
    logout: 'Sign out'
  },
  files: {
    title: 'My files',
    count: '{n} files · {size}',
    empty: 'No files in your cloud yet. Upload above – files are sorted into the right folder automatically.',
    noMatch: 'No results.',
    share: 'Share',
    onFilecoin: 'Filecoin ✓',
    onFilecoinTitle: 'Secured on Filecoin: {copies} copies with independent providers, continuously checked with Proof of Data Possession.',
    download: 'Download',
    remove: 'Delete',
    deleteNote: '“Delete” removes the encrypted data from storage right away and frees the space. A trash bin is coming.',
    confirmDelete: 'Permanently delete “{name}”?'
  },
  upload: {
    title: 'Store files',
    free: '{size} free',
    drop: 'Drag files here',
    orClick: 'or click',
    info: 'Encrypted in your browser · AES-256-GCM · stored on Filecoin (Fil One, EU)',
    abort: 'Cancel',
    failed: 'Upload failed.'
  },
  download: { cancel: 'Cancel', failed: 'Download failed.' },
  unlock: {
    title: 'Unlock your vault',
    lead: 'Signed in as {name}. Your key stays in memory only and is discarded after 30 minutes of inactivity.',
    passphrase: 'Passphrase',
    working: 'Deriving key …',
    submit: 'Unlock',
    forgot: 'Forgot your passphrase?',
    logout: 'Sign out'
  },
  loadingAccount: 'Loading account …',
  syncError: 'Vault not synced: {error}',
  send: {
    title: 'Secure Send',
    badge: 'end-to-end',
    body: 'Share files by link – with an expiry date, a download limit and an optional password. Recipients need no account; the key lives only in the link and never reaches our server. Links can be revoked at any time. To share, click “Share” on a file in “My cloud”.',
    notice: 'Links',
    empty: 'No links created yet.',
    file: 'File',
    deleted: 'deleted file'
  },
  account: {
    title: 'Account',
    email: 'Email',
    account: 'Account',
    login: 'Sign-in via Reown',
    plan: 'Plan',
    storage: 'Storage',
    entries: 'Files · entries',
    since: 'Member since',
    managePlan: 'Manage plans & storage'
  },
  security: {
    title: 'Security',
    body: 'Your files are encrypted in the browser with AES-256-GCM. The master key is random and stored only in two protected forms: with your passphrase (Argon2id) and with your recovery kit. FocVault and Fil One only ever see encrypted data – no file names, no contents.',
    kdf: 'Key derivation',
    autolock: 'Auto-lock',
    autolockValue: 'after 30 min of inactivity',
    kit: 'Recovery kit',
    kitValue: 'created at sign-up'
  },
  changePass: {
    title: 'Change passphrase',
    current: 'Current passphrase',
    newLabel: 'New passphrase',
    working: 'Re-encrypting …',
    submit: 'Change passphrase',
    done: 'Passphrase changed. Other devices have been signed out.',
    reauth: 'For your security, please sign out and back in, then try again.'
  },
  upgradeWall: {
    body: 'All privacy modules are part of Pro and Family – plus more storage and add-ons when you need them.',
    cta: 'View plans',
    passwordsDesc: 'Logins, passwords and credentials – end-to-end encrypted in your vault.',
    notesDesc: 'Encrypted notes for PINs, recovery hints and ideas – nobody else can read along.',
    totpDesc: '2FA codes right here: store TOTP secrets safely and generate codes in your browser.'
  }
}

export const appMessages = { de, en }

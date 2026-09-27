const de = {
  util: { docs: 'Dokumentation', security: 'Sicherheit', support: 'Support' },
  nav: { product: 'Produkt', security: 'Sicherheit', pricing: 'Preise', faq: 'FAQ' },
  login: 'Anmelden',
  register: 'Registrieren',
  hero: {
    pill: 'NEU',
    pillText: 'Login mit Google, Apple oder Wallet',
    title1: 'Deine Privacy Cloud für',
    title2: 'Dateien, Passwörter & mehr',
    lead: 'Ende-zu-Ende-verschlüsselt in deinem Browser, gespeichert auf Filecoin. Niemand außer dir sieht deine Daten – nicht einmal wir.',
    cta: 'Kostenlos starten',
    demo: 'So funktioniert es',
    trust: '{gb} GB kostenlos · danach Pay-as-you-go · Keine Kreditkarte nötig'
  },
  preview: {
    cloud: 'Meine Cloud',
    send: 'Secure Send',
    account: 'Konto',
    passwords: 'Passwörter',
    notes: 'Notizen',
    upload: '+ Hochladen',
    all: 'Alle (12)',
    docs: 'Dokumente',
    photos: 'Fotos',
    today: 'heute',
    yesterday: 'gestern',
    days: '3 Tage',
    week: '1 Woche',
    files: ['Vertrag.pdf', 'Urlaub_04.jpg', 'Backup.zip', 'Notizen.txt']
  },
  trustbar: ['Filecoin mit täglicher Integritätsprüfung', 'Zero-Knowledge', 'Server in der EU', 'Open Source'],
  product: {
    eyebrow: 'Produkt',
    title: 'Eine Cloud. Volle Kontrolle.',
    subtitle: 'Komfortable Oberfläche, verschlüsselte Infrastruktur darunter – du musst nie wissen, was technisch dahinter passiert.',
    features: [
      { title: 'Zero-Knowledge', body: 'AES-256-GCM-Verschlüsselung direkt im Browser. Schlüssel, Dateinamen und Passwörter verlassen dein Gerät nie.' },
      { title: 'Auf Filecoin gespeichert', body: 'Dein verschlüsselter Speicher wird täglich kryptografisch auf Integrität geprüft – EU-Rechenzentren.' },
      { title: 'Secure Send', body: 'Dateien teilen ohne Empfänger-Konto – der Schlüssel steckt im Link und erreicht nie den Server.' },
      { title: 'Alles in einem Tresor', body: 'Dateien, Passwort-Manager, Notizen und 2FA-Codes – gemeinsam verschlüsselt, auf allen Geräten.' }
    ]
  },
  how: {
    eyebrow: "So funktioniert's",
    title: 'In drei Schritten in deiner Cloud',
    subtitle: 'Keine Installation. Anmelden wie gewohnt – verschlüsselt wird trotzdem nur bei dir.',
    steps: [
      { title: 'Anmelden', body: 'Mit E-Mail, Google, Apple oder Wallet – in wenigen Sekunden.' },
      { title: 'Tresor anlegen', body: 'Passphrase wählen und Recovery-Kit sichern. Nur du hast den Schlüssel.' },
      { title: 'Speichern & teilen', body: 'Dateien werden im Browser verschlüsselt, sortiert und sind überall abrufbar.' }
    ]
  },
  compare: {
    eyebrow: 'Vergleich',
    title: 'Wie sich FocVault einordnet',
    subtitle: 'Privatsphäre ist bei uns kein Zusatzpaket, sondern die Grundlage.',
    cols: ['FocVault', 'Klassische Cloud', 'S3-Objektspeicher'],
    rows: [
      ['Zero-Knowledge-Verschlüsselung', '✓ immer', '✗ nein', '✗ nein'],
      ['Passwort-Manager & 2FA inklusive', '✓ ab Pro', 'separat', '✗ nein'],
      ['Anmeldung', 'E-Mail, Google, Apple, Wallet', 'E-Mail + Passwort', 'API-Keys'],
      ['Wiederherstellung ohne Anbieterzugriff', '✓ Recovery-Kit', 'Anbieter kann zugreifen', '—'],
      ['Datenhoheit bei Anbieterwechsel', '✓ Export + eigene Keys', 'oft Lock-in', 'S3-kompatibel']
    ]
  },
  pricing: {
    eyebrow: 'Preise',
    title: 'Privacy hat ihren Preis – und ist ihn wert',
    subtitle: '{gb} GB kostenlos, danach Pay-as-you-go pro GB. Oder ein Abo mit allen Privacy-Modulen und zubuchbarem Speicher.',
    monthly: 'Monatlich',
    yearly: 'Jährlich',
    yearlySave: '2 Monate geschenkt',
    perMonth: '/Monat',
    billedYearly: '{amount} jährlich',
    popular: 'Beliebt',
    freeDesc: 'Inklusive {gb} GB, danach {price} pro GB und Monat – mit selbst gewählter Obergrenze.',
    freeFeatures: ['{gb} GB Speicher inklusive', 'Zero-Knowledge-Verschlüsselung', 'Secure Send', 'Pay-as-you-go nach Bedarf'],
    freeCta: 'Kostenlos starten',
    proDesc: 'Deine komplette private Cloud – inkl. aller Module.',
    proFeatures: ['{tb} TB Speicher, Zusatzspeicher ab {addon}', 'Passwörter, Notizen & 2FA-Authenticator', 'Auf allen Geräten, Recovery-Kit', 'Priorisierter Support'],
    proCta: 'Pro wählen',
    familyDesc: 'Gemeinsamer Speicher für bis zu {seats} Personen – jede mit eigenem Tresor.',
    familyFeatures: ['{tb} TB geteilt, Zusatzspeicher buchbar', 'Bis zu {seats} Mitglieder, je eigener Schlüssel', 'Alle Module für alle', 'Privatsphäre für die ganze Familie'],
    familyCta: 'Family wählen',
    business: 'Business / Custom',
    businessPrice: 'Individuell',
    from: 'ab',
    businessSeats: '{seats} Nutzer inklusive, weitere {price}',
    businessDesc: 'Starter, Business und Enterprise – für Teams, Server-Backups und Compliance.',
    businessFeatures: ['S3-Speicher-API für Server- & Datenbank-Backups', 'Unlöschbare Backups (Object Lock) & Aufbewahrungsregeln', 'Öffentlich prüfbare Speicherbeweise auf Filecoin', 'Datenresidenz CH/EU, SLA & Audit-Logs'],
    businessCta: 'Kontakt',
    vat: 'Preise inkl. MWST.'
  },
  faq: {
    title: 'Häufige Fragen',
    items: [
      {
        q: 'Was bedeutet Zero-Knowledge genau?',
        a: 'Deine Dateien werden vor dem Hochladen in deinem Browser verschlüsselt. Wir speichern nur verschlüsselte Bytes – Schlüssel, Dateinamen und Inhalte sehen wir nie.'
      },
      {
        q: 'Wie funktioniert Pay-as-you-go?',
        a: 'Im Free-Konto sind {gb} GB enthalten. Schaltest du Pay-as-you-go ein, zahlst du für den Speicher darüber {price} pro GB und Monat – berechnet nach dem durchschnittlich belegten Speicher, wie bei einem Stromzähler. Du legst eine Obergrenze fest; kleine Beträge werden in den nächsten Monat übertragen.'
      },
      {
        q: 'Was kostet das Abo, und warum darf Privacy etwas mehr kosten?',
        a: 'Pro kostet {pro} pro Monat (1 TB), Family {family} (2 TB für bis zu 6 Personen). Jährlich schenken wir dir zwei Monate. Du bezahlst nicht nur Speicher, sondern Zero-Knowledge: Niemand – auch wir nicht – kann deine Dateien lesen.'
      },
      {
        q: 'Was passiert, wenn ich meine Passphrase vergesse?',
        a: 'Bei der Registrierung bekommst du ein Recovery-Kit mit 24 Wörtern. Damit setzt du eine neue Passphrase – ohne dass wir je Zugriff auf deine Daten hätten.'
      },
      {
        q: 'Wo liegen meine Daten – und wie weiß ich, dass sie noch da sind?',
        a: 'Verschlüsselt auf Filecoin Onchain Cloud, in zwei Kopien bei unabhängigen Speicheranbietern. Die Anbieter müssen laufend kryptografisch beweisen, dass sie deine Daten noch haben (Proof of Data Possession) – bezahlt wird nur für bewiesene Zeit. In deiner Cloud zeigt ein „Filecoin ✓“, welche Dateien so gesichert sind.'
      },
      {
        q: 'Brauche ich eine Kryptowährung?',
        a: 'Nein. Du meldest dich mit E-Mail, Google, Apple oder – wenn du willst – einer Wallet an und bezahlst in CHF, EUR oder USD.'
      }
    ]
  },
  cta: {
    title: 'Bereit für deine eigene Privacy Cloud?',
    body: '{gb} GB kostenlos. Keine Kreditkarte. In 2 Minuten startklar.',
    start: 'Kostenlos starten',
    talk: 'Mit uns sprechen'
  },
  footer: {
    tag: 'Deine Privacy Cloud auf Filecoin. Identität, Verschlüsselung, Speicher – alles bei dir.',
    product: 'Produkt',
    company: 'Unternehmen',
    legal: 'Rechtliches',
    cloud: 'Meine Cloud',
    privacy: 'Datenschutz',
    terms: 'AGB',
    imprint: 'Impressum',
    copy: '© 2026 FocVault. Gespeichert auf Filecoin.',
    builtOn: 'Gebaut auf Filecoin Onchain Cloud'
  }
}

const en: typeof de = {
  util: { docs: 'Documentation', security: 'Security', support: 'Support' },
  nav: { product: 'Product', security: 'Security', pricing: 'Pricing', faq: 'FAQ' },
  login: 'Sign in',
  register: 'Sign up',
  hero: {
    pill: 'NEW',
    pillText: 'Sign in with Google, Apple or a wallet',
    title1: 'Your privacy cloud for',
    title2: 'files, passwords & more',
    lead: 'End-to-end encrypted in your browser, stored on Filecoin. Nobody but you can see your data – not even us.',
    cta: 'Start for free',
    demo: 'How it works',
    trust: '{gb} GB free · then pay-as-you-go · No credit card needed'
  },
  preview: {
    cloud: 'My cloud',
    send: 'Secure Send',
    account: 'Account',
    passwords: 'Passwords',
    notes: 'Notes',
    upload: '+ Upload',
    all: 'All (12)',
    docs: 'Documents',
    photos: 'Photos',
    today: 'today',
    yesterday: 'yesterday',
    days: '3 days',
    week: '1 week',
    files: ['Contract.pdf', 'Holiday_04.jpg', 'Backup.zip', 'Notes.txt']
  },
  trustbar: ['Filecoin with daily integrity checks', 'Zero-knowledge', 'Servers in the EU', 'Open source'],
  product: {
    eyebrow: 'Product',
    title: 'One cloud. Full control.',
    subtitle: 'A comfortable interface on top of encrypted infrastructure – you never need to know what happens under the hood.',
    features: [
      { title: 'Zero-knowledge', body: 'AES-256-GCM encryption right in your browser. Keys, file names and passwords never leave your device.' },
      { title: 'Stored on Filecoin', body: 'Your encrypted storage is cryptographically checked for integrity every day – in EU data centers.' },
      { title: 'Secure Send', body: 'Share files without a recipient account – the key lives in the link and never reaches the server.' },
      { title: 'Everything in one vault', body: 'Files, password manager, notes and 2FA codes – encrypted together, on all your devices.' }
    ]
  },
  how: {
    eyebrow: 'How it works',
    title: 'Three steps to your cloud',
    subtitle: 'Nothing to install. Sign in the way you are used to – encryption still happens only on your side.',
    steps: [
      { title: 'Sign in', body: 'With email, Google, Apple or a wallet – in seconds.' },
      { title: 'Create your vault', body: 'Choose a passphrase and save your recovery kit. Only you hold the key.' },
      { title: 'Store & share', body: 'Files are encrypted in your browser, sorted and available everywhere.' }
    ]
  },
  compare: {
    eyebrow: 'Comparison',
    title: 'Where FocVault fits',
    subtitle: 'Privacy is not an add-on for us – it is the foundation.',
    cols: ['FocVault', 'Classic cloud', 'S3 object storage'],
    rows: [
      ['Zero-knowledge encryption', '✓ always', '✗ no', '✗ no'],
      ['Password manager & 2FA included', '✓ with Pro', 'separate', '✗ no'],
      ['Sign-in', 'Email, Google, Apple, wallet', 'Email + password', 'API keys'],
      ['Recovery without provider access', '✓ recovery kit', 'provider has access', '—'],
      ['Data ownership when switching', '✓ export + own keys', 'often lock-in', 'S3-compatible']
    ]
  },
  pricing: {
    eyebrow: 'Pricing',
    title: 'Privacy has a price – and it is worth it',
    subtitle: '{gb} GB free, then pay-as-you-go per GB. Or a plan with every privacy module and extra storage when you need it.',
    monthly: 'Monthly',
    yearly: 'Yearly',
    yearlySave: '2 months free',
    perMonth: '/month',
    billedYearly: '{amount} per year',
    popular: 'Popular',
    freeDesc: 'Includes {gb} GB, then {price} per GB per month – with a limit you choose.',
    freeFeatures: ['{gb} GB storage included', 'Zero-knowledge encryption', 'Secure Send', 'Pay-as-you-go when needed'],
    freeCta: 'Start for free',
    proDesc: 'Your complete private cloud – with every module.',
    proFeatures: ['{tb} TB storage, add-ons from {addon}', 'Passwords, notes & 2FA authenticator', 'On all devices, recovery kit', 'Priority support'],
    proCta: 'Choose Pro',
    familyDesc: 'Shared storage for up to {seats} people – each with their own vault.',
    familyFeatures: ['{tb} TB shared, add-ons available', 'Up to {seats} members, each with their own key', 'All modules for everyone', 'Privacy for the whole family'],
    familyCta: 'Choose Family',
    business: 'Business / custom',
    businessPrice: 'Custom',
    from: 'from',
    businessSeats: '{seats} users included, more at {price}',
    businessDesc: 'Starter, Business and Enterprise – for teams, server backups and compliance.',
    businessFeatures: ['S3 storage API for server & database backups', 'Immutable backups (Object Lock) & retention rules', 'Publicly verifiable storage proofs on Filecoin', 'Data residency CH/EU, SLA & audit logs'],
    businessCta: 'Contact us',
    vat: 'Prices include VAT.'
  },
  faq: {
    title: 'Frequently asked questions',
    items: [
      {
        q: 'What exactly does zero-knowledge mean?',
        a: 'Your files are encrypted in your browser before upload. We only store encrypted bytes – we never see keys, file names or contents.'
      },
      {
        q: 'How does pay-as-you-go work?',
        a: 'Your free account includes {gb} GB. Turn on pay-as-you-go and you pay {price} per GB per month for storage beyond that – based on your average usage, like a meter. You set a limit; small amounts roll over to the next month.'
      },
      {
        q: 'What does a plan cost, and why is privacy worth a bit more?',
        a: 'Pro costs {pro} per month (1 TB), Family {family} (2 TB for up to 6 people). Pay yearly and get two months free. You are not just paying for storage but for zero-knowledge: nobody – not even us – can read your files.'
      },
      {
        q: 'What if I forget my passphrase?',
        a: 'When you sign up, you get a recovery kit with 24 words. Use it to set a new passphrase – without us ever having access to your data.'
      },
      {
        q: 'Where is my data – and how do I know it is still there?',
        a: 'Encrypted on Filecoin Onchain Cloud, in two copies with independent storage providers. Providers must continuously prove cryptographically that they still hold your data (Proof of Data Possession) – they are only paid for proven time. In your cloud, a “Filecoin ✓” shows which files are secured this way.'
      },
      {
        q: 'Do I need cryptocurrency?',
        a: 'No. Sign in with email, Google, Apple or – if you like – a wallet, and pay in CHF, EUR or USD.'
      }
    ]
  },
  cta: {
    title: 'Ready for your own privacy cloud?',
    body: '{gb} GB free. No credit card. Ready in 2 minutes.',
    start: 'Start for free',
    talk: 'Talk to us'
  },
  footer: {
    tag: 'Your privacy cloud on Filecoin. Identity, encryption, storage – all yours.',
    product: 'Product',
    company: 'Company',
    legal: 'Legal',
    cloud: 'My cloud',
    privacy: 'Privacy',
    terms: 'Terms',
    imprint: 'Imprint',
    copy: '© 2026 FocVault. Stored on Filecoin.',
    builtOn: 'Built on Filecoin Onchain Cloud'
  }
}

export const landingMessages = { de, en }

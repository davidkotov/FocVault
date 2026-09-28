const de = {
  support: {
    eyebrow: 'Support',
    title: 'Hilfe erhalten',
    lead: 'Häufige Fragen unten durchsehen oder eine Anfrage senden.',
    docs: 'Dokumentation',
    docsSub: 'Anleitungen, Sicherheit, Speicher-API & CLI',
    status: 'Status',
    statusSub: 'Live-Systemstatus & Verfügbarkeit',
    faqTitle: 'Häufige Fragen',
    faq: [
      { q: 'Kann FocVault meine Dateien lesen?', a: 'Nein. Dateien, Namen, Passwörter und Notizen werden in deinem Browser verschlüsselt. Wir speichern nur verschlüsselte Daten und kennen deine Passphrase nicht.' },
      { q: 'Ich habe meine Passphrase vergessen – was nun?', a: 'Mit deinem Recovery-Kit (24 Wörter) setzt du unter „Passphrase vergessen?“ eine neue Passphrase. Ohne Passphrase und Recovery-Kit kann niemand deine Daten wiederherstellen – auch wir nicht.' },
      { q: 'Gibt es versteckte Kosten zusätzlich zum Speicherpreis?', a: 'Nein. Es gibt keine Gebühren für Downloads oder Anfragen. Free kostet nichts bis 5 GB, darüber zahlst du nur den angezeigten Preis pro GB und Monat – mit Obergrenze, die du selbst setzt.' },
      { q: 'Wo liegen meine Daten?', a: 'Bei Fil One in der EU (eu-west-1) und zusätzlich auf Filecoin bei zwei unabhängigen Speicheranbietern, die täglich Speicherbeweise liefern.' },
      { q: 'Wie wechsle ich von einem anderen Anbieter?', a: 'Dateien per Drag & Drop oder mit dem Backup-Programm hochladen; Passwörter per CSV importieren. Für grosse Datenmengen hilft die S3-Speicher-API (z. B. mit rclone).' },
      { q: 'Kann ich mit Kryptowährung bezahlen?', a: 'Nein, bezahlt wird über Stripe – je nach Land per Karte, TWINT, Apple Pay, Google Pay oder SEPA-Lastschrift. Enterprise-Verträge auf Anfrage auch per Rechnung.' },
      { q: 'Wie kündige ich?', a: 'Unter „Pakete & Speicher“ jederzeit zum Ende der Laufzeit. Deine Daten bleiben erhalten; über 5 GB wird auf Pay-as-you-go umgestellt oder du exportierst sie vorher.' }
    ],
    formTitle: 'Anfrage senden',
    firstName: 'Vorname',
    lastName: 'Nachname',
    email: 'E-Mail',
    company: 'Firma',
    message: 'Beschreibung',
    messagePlaceholder: 'Beschreibe dein Anliegen oder deine Frage …',
    category: 'Kategorie',
    categories: {
      product: 'Problem mit dem Produkt',
      billing: 'Abrechnung',
      general: 'Allgemeine Frage',
      feature: 'Funktionswunsch',
      storage: 'Speicher-Anfrage (individuelle Menge)',
      business: 'Business / Enterprise'
    } as Record<string, string>,
    storageTemplate: 'Ich interessiere mich für zusätzlichen Speicher.\nPaket: {plan}\nGewünschte Menge (TB): \nZeitraum / Wachstum: ',
    privacy: 'Wir verwenden deine Angaben nur, um deine Anfrage zu beantworten. Details in der',
    privacyLink: 'Datenschutzerklärung',
    response: 'Wir antworten in der Regel innerhalb von',
    responseTime: '1 Arbeitstag',
    submit: 'Senden',
    sending: 'Wird gesendet …',
    sent: 'Danke! Deine Anfrage ist bei uns eingegangen. Wir melden uns per E-Mail.',
    another: 'Weitere Anfrage senden',
    required: 'Pflichtfeld'
  },
  docs: {
    eyebrow: 'Dokumentation',
    title: 'Dokumentation',
    lead: 'Anleitungen zu Konto, Sicherheit, Teams und Entwickler-Schnittstellen.',
    search: 'Dokumentation durchsuchen …',
    noMatch: 'Kein Artikel gefunden.',
    back: '← Alle Artikel',
    help: 'Nicht gefunden, was du suchst?',
    helpCta: 'Support kontaktieren'
  },
  status: {
    title: 'Systemstatus',
    subscribe: 'Updates abonnieren (RSS)',
    overall: {
      operational: 'Alle Systeme funktionieren',
      degraded: 'Eingeschränkte Leistung',
      outage: 'Störung',
      maintenance: 'Wartung läuft'
    } as Record<string, string>,
    state: {
      operational: 'In Betrieb',
      degraded: 'Eingeschränkt',
      outage: 'Störung',
      maintenance: 'Wartung',
      unknown: 'Keine Daten'
    } as Record<string, string>,
    components: {
      app: 'Web-App & API',
      storage: 'Speicher (Fil One, EU)',
      filecoin: 'Filecoin-Sicherung (PDP)',
      s3: 'Speicher-API (S3)'
    } as Record<string, string>,
    uptime: '{pct} % Verfügbarkeit',
    noData: 'noch keine Messung',
    daysAgo: '90 Tage',
    today: 'Heute',
    tipUp: '{date}: {pct} % verfügbar',
    tipNone: '{date}: keine Messung',
    tipMaint: '{date}: Wartung',
    recent: 'Meldungen',
    noNotices: 'Keine Meldungen.',
    updated: 'Zuletzt geprüft: {time}',
    updates: {
      investigating: 'Wird untersucht',
      identified: 'Ursache gefunden',
      monitoring: 'Wird beobachtet',
      resolved: 'Behoben',
      scheduled: 'Geplant',
      in_progress: 'Läuft',
      completed: 'Abgeschlossen'
    } as Record<string, string>,
    measured: 'Automatische Messung alle 5 Minuten. Latenz: {ms} ms'
  }
}

const en: typeof de = {
  support: {
    eyebrow: 'Support',
    title: 'Get help',
    lead: 'Browse common questions below or submit a request.',
    docs: 'Documentation',
    docsSub: 'Guides, security, storage API & CLI',
    status: 'Status',
    statusSub: 'Live system & uptime status',
    faqTitle: 'Common questions',
    faq: [
      { q: 'Can FocVault read my files?', a: 'No. Files, names, passwords and notes are encrypted in your browser. We only store encrypted data and do not know your passphrase.' },
      { q: 'I forgot my passphrase – what now?', a: 'Use your recovery kit (24 words) under “Forgot passphrase?” to set a new one. Without passphrase and recovery kit nobody can restore your data – not even us.' },
      { q: 'Are there hidden fees on top of the storage price?', a: 'No. There are no fees for downloads or requests. Free costs nothing up to 5 GB; beyond that you only pay the listed price per GB and month – with a cap you set yourself.' },
      { q: 'Where is my data stored?', a: 'With Fil One in the EU (eu-west-1) and additionally on Filecoin with two independent storage providers delivering daily storage proofs.' },
      { q: 'How do I migrate from another provider?', a: 'Upload files via drag & drop or the backup program; import passwords via CSV. For large amounts, use the S3 storage API (e.g. with rclone).' },
      { q: 'Can I pay with cryptocurrency?', a: 'No, payment runs through Stripe – depending on your country by card, TWINT, Apple Pay, Google Pay or SEPA direct debit. Enterprise contracts can be invoiced on request.' },
      { q: 'How do I cancel?', a: 'Under “Plans & storage”, any time to the end of the term. Your data stays; above 5 GB you switch to pay-as-you-go or export it first.' }
    ],
    formTitle: 'Submit a request',
    firstName: 'First name',
    lastName: 'Last name',
    email: 'Email',
    company: 'Company name',
    message: 'Ticket description',
    messagePlaceholder: 'Describe your issue or question …',
    category: 'Category',
    categories: {
      product: 'Product issue',
      billing: 'Billing issue',
      general: 'General inquiry',
      feature: 'Feature request',
      storage: 'Storage request (custom amount)',
      business: 'Business / Enterprise'
    },
    storageTemplate: 'I am interested in extra storage.\nPlan: {plan}\nDesired amount (TB): \nTimeframe / growth: ',
    privacy: 'We only use your details to answer your request. Details in our',
    privacyLink: 'privacy policy',
    response: 'We typically respond within',
    responseTime: '1 business day',
    submit: 'Submit',
    sending: 'Sending …',
    sent: 'Thank you! We received your request and will reply by email.',
    another: 'Submit another request',
    required: 'Required'
  },
  docs: {
    eyebrow: 'Documentation',
    title: 'Documentation',
    lead: 'Guides for account, security, teams and developer interfaces.',
    search: 'Search documentation …',
    noMatch: 'No article found.',
    back: '← All articles',
    help: 'Didn’t find what you need?',
    helpCta: 'Contact support'
  },
  status: {
    title: 'System status',
    subscribe: 'Get updates (RSS)',
    overall: { operational: 'All systems operational', degraded: 'Degraded performance', outage: 'Service disruption', maintenance: 'Maintenance in progress' },
    state: { operational: 'Operational', degraded: 'Degraded', outage: 'Outage', maintenance: 'Maintenance', unknown: 'No data' },
    components: { app: 'Web app & API', storage: 'Storage (Fil One, EU)', filecoin: 'Filecoin backup (PDP)', s3: 'Storage API (S3)' },
    uptime: '{pct}% uptime',
    noData: 'no measurement yet',
    daysAgo: '90 days ago',
    today: 'Today',
    tipUp: '{date}: {pct}% available',
    tipNone: '{date}: no measurement',
    tipMaint: '{date}: maintenance',
    recent: 'Recent notices',
    noNotices: 'No notices.',
    updated: 'Last checked: {time}',
    updates: { investigating: 'Investigating', identified: 'Identified', monitoring: 'Monitoring', resolved: 'Resolved', scheduled: 'Scheduled', in_progress: 'In progress', completed: 'Completed' },
    measured: 'Automatic check every 5 minutes. Latency: {ms} ms'
  }
}

export const siteMessages = { de, en }

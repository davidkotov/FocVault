import { COMPANY as C } from './company'

/**
 * Rechtstexte (Entwürfe) für /impressum, /datenschutz, /agb, /avv – DE/EN.
 * Aufbau: Abschnitte mit Überschrift und Absätzen/Listen. Vor Veröffentlichung juristisch prüfen.
 */
export type LegalBlock = string | string[]
export interface LegalSection {
  h: string
  b: LegalBlock[]
}
export interface LegalDoc {
  title: string
  lead: string
  sections: LegalSection[]
}
export type LegalKey = 'impressum' | 'datenschutz' | 'agb' | 'avv'

const addr = `${C.name}, ${C.street}, ${C.city}, ${C.country}`

const SUBPROCESSORS_DE = [
  `Fil One – S3-Objektspeicher, Region EU (eu-west-1): speichert ausschliesslich verschlüsselte Datenblöcke.`,
  `Filecoin-Speicheranbieter (zwei unabhängige Anbieter): zusätzliche Kopien ausschliesslich verschlüsselter Daten mit täglichen Speicherbeweisen.`,
  `${C.hosting} – Betrieb der Web-Anwendung und API.`,
  `${C.database} – Datenbank für Kontodaten, Einstellungen und Protokolle.`,
  `Stripe Payments Europe Ltd. (Irland) bzw. Stripe, Inc. (USA) – Zahlungsabwicklung (nur bei kostenpflichtigen Paketen).`,
  `Reown / WalletConnect – optionale Anmeldung per Wallet, Google oder Apple (nur wenn du diese Anmeldung wählst).`,
  `Have I Been Pwned – Passwort-Check: erhält über unseren Server nur die ersten 5 Zeichen eines SHA-1-Hashes, keine personenbezogenen Daten.`
]
const SUBPROCESSORS_EN = [
  `Fil One – S3 object storage, region EU (eu-west-1): stores encrypted data blocks only.`,
  `Filecoin storage providers (two independent providers): additional copies of encrypted data only, with daily storage proofs.`,
  `${C.hosting} – operation of the web application and API.`,
  `${C.database} – database for account data, settings and audit logs.`,
  `Stripe Payments Europe Ltd. (Ireland) or Stripe, Inc. (USA) – payment processing (paid plans only).`,
  `Reown / WalletConnect – optional sign-in via wallet, Google or Apple (only if you choose it).`,
  `Have I Been Pwned – password check: receives via our server only the first 5 characters of a SHA-1 hash, no personal data.`
]

const de: Record<LegalKey, LegalDoc> = {
  impressum: {
    title: 'Impressum',
    lead: 'Angaben gemäss Art. 3 Abs. 1 lit. s UWG und § 5 DDG.',
    sections: [
      { h: 'Anbieter', b: [[C.name, C.street, `${C.city}, ${C.country}`]] },
      { h: 'Kontakt', b: [[`E-Mail: ${C.email}`, `Telefon: ${C.phone}`, 'Support: focvault.app/support']] },
      { h: 'Handelsregister', b: [[`UID: ${C.uid}`, `Eingetragen im ${C.register}`, `Vertretungsberechtigt: ${C.representatives}`]] },
      { h: 'Verantwortlich für den Inhalt', b: [C.representatives] },
      {
        h: 'Haftungsausschluss',
        b: [
          'Wir prüfen die Inhalte dieser Website sorgfältig, übernehmen jedoch keine Gewähr für Richtigkeit, Vollständigkeit und Aktualität. Für Inhalte verlinkter Websites sind ausschliesslich deren Betreiber verantwortlich.',
          'Die Inhalte deines Tresors sind Ende-zu-Ende-verschlüsselt; wir haben darauf keinen Zugriff und sind für diese Inhalte nicht verantwortlich.'
        ]
      }
    ]
  },
  datenschutz: {
    title: 'Datenschutzerklärung',
    lead: 'Wie wir mit deinen Daten umgehen – nach dem Schweizer Datenschutzgesetz (revDSG) und der EU-Datenschutz-Grundverordnung (DSGVO).',
    sections: [
      { h: '1. Verantwortlicher', b: [`${addr}. Kontakt für Datenschutz: ${C.privacyEmail}.`] },
      {
        h: '2. Grundsatz: Zero-Knowledge',
        b: [
          'Dateien, Dateinamen, Passwörter, Notizen und 2FA-Daten werden auf deinem Gerät mit AES-256-GCM verschlüsselt, bevor sie an uns übertragen werden. Die Schlüssel verlassen dein Gerät nicht unverschlüsselt. Wir können diese Inhalte daher weder lesen noch auswerten oder herausgeben.'
        ]
      },
      {
        h: '3. Welche Daten wir verarbeiten',
        b: [
          [
            'Kontodaten: E-Mail-Adresse oder Wallet-Adresse, gewähltes Paket, Spracheinstellung, Zeitpunkt der Registrierung.',
            'Sicherheitsdaten: Prüfwerte zur Anmeldung (keine Passphrase), verschlüsselte Schlüssel-Hüllen, Passkey-Kennungen.',
            'Nutzungsdaten: Anzahl und Grösse verschlüsselter Blöcke, Speicherverbrauch, Zeitpunkte von Anmeldungen und Änderungen (Protokoll), IP-Adresse zur Missbrauchsabwehr.',
            'Zahlungsdaten: werden von Stripe verarbeitet; wir erhalten nur Status, Betrag, Zeitraum und eine Kunden-Kennung.',
            'Support-Anfragen: Name, E-Mail, Firma und Inhalt deiner Nachricht.',
            'Team-Funktionen (Business): Rollen, Richtlinien-Status und die vom Gerät gemeldete Länge der Passphrase.'
          ]
        ]
      },
      {
        h: '4. Zwecke und Rechtsgrundlagen',
        b: [
          [
            'Bereitstellung des Dienstes und Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO).',
            'Abrechnung und gesetzliche Aufbewahrung (Art. 6 Abs. 1 lit. c DSGVO, Art. 958f OR).',
            'Sicherheit, Missbrauchsabwehr und Stabilität (Art. 6 Abs. 1 lit. f DSGVO).',
            'Beantwortung von Anfragen (Art. 6 Abs. 1 lit. b bzw. f DSGVO).'
          ],
          'Wir betreiben keine Werbung, verkaufen keine Daten und setzen in der App keine Tracker ein.'
        ]
      },
      {
        h: '5. Cookies und lokale Speicherung',
        b: ['Wir verwenden nur technisch notwendige Cookies: Sitzung (Anmeldung), Sprache und Währung. Ein Einwilligungsbanner ist dafür nicht erforderlich. Verschlüsselte Tresor-Daten können zur Beschleunigung lokal im Browser zwischengespeichert werden.']
      },
      { h: '6. Empfänger und Auftragsverarbeiter', b: ['Wir setzen folgende Dienstleister ein, jeweils mit Vertrag zur Auftragsverarbeitung:', SUBPROCESSORS_DE] },
      {
        h: '7. Übermittlung ins Ausland',
        b: ['Deine verschlüsselten Dateien liegen in der EU. Bei Zahlungen über Stripe können Daten in die USA übermittelt werden; dies erfolgt auf Grundlage der EU-Standardvertragsklauseln bzw. des EU-U.S. Data Privacy Framework und des Swiss-U.S. Data Privacy Framework.']
      },
      {
        h: '8. Speicherdauer',
        b: [
          [
            'Kontodaten und Tresor: bis zur Löschung deines Kontos; danach Löschung innerhalb von 30 Tagen, verschlüsselte Filecoin-Kopien werden zur Löschung markiert.',
            'Rechnungsdaten: 10 Jahre (gesetzliche Aufbewahrungspflicht).',
            'Protokolle: 12 Monate.',
            'Support-Anfragen: 2 Jahre nach Abschluss.',
            'Free-Konten ohne Nutzung: nach Vorwarnung gemäss Paketbedingungen.'
          ]
        ]
      },
      {
        h: '9. Deine Rechte',
        b: [
          'Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch. Schreibe dazu an ' +
            C.privacyEmail +
            '. Du kannst dich zudem beim Eidgenössischen Datenschutz- und Öffentlichkeitsbeauftragten (EDÖB) oder einer Aufsichtsbehörde in der EU beschweren.',
          'Die Inhalte deines Tresors kannst du jederzeit selbst exportieren; wir können sie mangels Schlüssel nicht herausgeben.'
        ]
      },
      { h: '10. Sicherheit', b: ['Ende-zu-Ende-Verschlüsselung, TLS mit HSTS, Zugriffsbeschränkungen, Protokollierung und mehrfache, verschlüsselte Speicherung. Details unter focvault.app/sicherheit.'] },
      { h: '11. Änderungen', b: [`Wir passen diese Erklärung an, wenn sich der Dienst oder die Rechtslage ändert. Stand: ${C.updated}.`] }
    ]
  },
  agb: {
    title: 'Allgemeine Geschäftsbedingungen',
    lead: `Für die Nutzung von FocVault, angeboten von ${C.name}.`,
    sections: [
      { h: '1. Geltungsbereich', b: ['Diese AGB gelten für alle Verträge über die Nutzung von FocVault (Web-App, API, Speicher-API, Backup-Programm). Abweichende Bedingungen gelten nur, wenn wir ihnen schriftlich zustimmen.'] },
      { h: '2. Vertragsschluss', b: ['Der Vertrag entsteht mit der Registrierung (Free) bzw. mit der Buchung eines kostenpflichtigen Pakets. Für Business-Kunden kann ein separater Vertrag mit SLA vereinbart werden.'] },
      {
        h: '3. Leistungen',
        b: [
          'Wir stellen Speicherplatz und Funktionen gemäss dem gewählten Paket bereit (Free, Pro, Family, Business, Enterprise). Der Umfang ergibt sich aus der aktuellen Preisübersicht.',
          'Daten werden in der EU gespeichert und zusätzlich verschlüsselt auf Filecoin gesichert.'
        ]
      },
      {
        h: '4. Zero-Knowledge und Eigenverantwortung',
        b: [
          'Die Verschlüsselung erfolgt auf deinem Gerät. Wir kennen weder deine Passphrase noch dein Recovery-Kit und können beides nicht zurücksetzen. Gehen Passphrase und Recovery-Kit verloren, sind die Daten dauerhaft nicht mehr zugänglich. Du bist für die sichere Aufbewahrung selbst verantwortlich.'
        ]
      },
      { h: '5. Verfügbarkeit', b: ['Wir streben eine Verfügbarkeit von 99.9 % im Jahresmittel an und veröffentlichen sie unter focvault.app/status. Geplante Wartungen kündigen wir dort an. Ein garantiertes Service-Level gilt nur bei gesonderter Vereinbarung.'] },
      {
        h: '6. Preise und Zahlung',
        b: [
          'Es gelten die Preise zum Zeitpunkt der Buchung, inklusive gesetzlicher Mehrwertsteuer. Abos werden im Voraus pro Monat oder Jahr abgerechnet, Pay-as-you-go und zusätzliche Nutzer nachträglich pro Monat. Die Zahlung erfolgt über Stripe.',
          'Bei Zahlungsverzug können wir kostenpflichtige Funktionen nach Vorwarnung einschränken; deine Daten bleiben erhalten.'
        ]
      },
      { h: '7. Laufzeit und Kündigung', b: ['Abos verlängern sich automatisch um die gewählte Laufzeit und können jederzeit auf das Ende der Laufzeit gekündigt werden. Free-Konten kannst du jederzeit löschen.'] },
      { h: '8. Zulässige Nutzung', b: ['Du darfst den Dienst nicht für rechtswidrige Zwecke, zur Verbreitung von Schadsoftware oder zur Verletzung von Rechten Dritter nutzen. Bei begründetem Verdacht können wir Konten sperren; wegen der Verschlüsselung prüfen wir Inhalte nicht.'] },
      { h: '9. Haftung', b: ['Wir haften unbeschränkt für Vorsatz und grobe Fahrlässigkeit. Im Übrigen ist die Haftung – soweit gesetzlich zulässig – auf den in den letzten zwölf Monaten gezahlten Betrag begrenzt. Zwingende Verbraucherschutzvorschriften bleiben unberührt.'] },
      { h: '10. Datenschutz und Auftragsverarbeitung', b: ['Es gilt unsere Datenschutzerklärung. Für Business-Kunden gilt ergänzend der Vertrag zur Auftragsverarbeitung (AVV).'] },
      { h: '11. Änderungen', b: ['Änderungen dieser AGB teilen wir mindestens 30 Tage vorher mit. Widersprichst du nicht, gelten sie als angenommen; bei Widerspruch kannst du auf den Änderungszeitpunkt kündigen.'] },
      { h: '12. Anwendbares Recht und Gerichtsstand', b: [`Es gilt Schweizer Recht unter Ausschluss des UN-Kaufrechts. Gerichtsstand ist ${C.court}. Für Verbraucher gelten zusätzlich die zwingenden Vorschriften ihres Wohnsitzstaates.`] }
    ]
  },
  avv: {
    title: 'Vertrag zur Auftragsverarbeitung (AVV)',
    lead: `Zwischen dem Kunden (Verantwortlicher) und ${C.name} (Auftragsverarbeiter) gemäss Art. 9 revDSG und Art. 28 DSGVO. Gilt für Business-Pakete ab Buchung.`,
    sections: [
      { h: '1. Gegenstand und Dauer', b: ['Der Auftragsverarbeiter stellt dem Verantwortlichen FocVault als Speicher- und Tresor-Dienst bereit. Der AVV gilt für die Dauer des Hauptvertrags.'] },
      {
        h: '2. Art, Zweck und Kategorien',
        b: [
          [
            'Zweck: Speicherung, Bereitstellung und Sicherung von Daten des Verantwortlichen.',
            'Datenarten: vom Verantwortlichen verschlüsselte Inhalte (für den Auftragsverarbeiter nicht lesbar) sowie Konto- und Protokolldaten der Nutzer.',
            'Betroffene: Mitarbeitende und weitere vom Verantwortlichen berechtigte Personen sowie Personen, deren Daten in verschlüsselten Inhalten enthalten sind.'
          ]
        ]
      },
      {
        h: '3. Pflichten des Auftragsverarbeiters',
        b: [
          [
            'Verarbeitung nur auf dokumentierte Weisung des Verantwortlichen.',
            'Vertraulichkeitsverpflichtung aller Personen mit Zugang.',
            'Umsetzung der technischen und organisatorischen Massnahmen nach Ziffer 5.',
            'Unterstützung bei Anfragen Betroffener und bei Datenschutz-Folgenabschätzungen, soweit ohne Zugriff auf verschlüsselte Inhalte möglich.',
            'Meldung von Verletzungen der Datensicherheit unverzüglich, spätestens innerhalb von 48 Stunden nach Kenntnis.',
            'Löschung aller Daten nach Vertragsende innerhalb von 30 Tagen, sofern keine Aufbewahrungspflicht besteht.',
            'Bereitstellung der zum Nachweis erforderlichen Informationen, einschliesslich Protokoll und Compliance-Bericht.'
          ]
        ]
      },
      { h: '4. Unterauftragsverarbeiter', b: ['Der Verantwortliche stimmt dem Einsatz folgender Unterauftragsverarbeiter zu. Änderungen werden mindestens 30 Tage vorher angekündigt; der Verantwortliche kann aus wichtigem Grund widersprechen.', SUBPROCESSORS_DE] },
      {
        h: '5. Technische und organisatorische Massnahmen',
        b: [
          [
            'Ende-zu-Ende-Verschlüsselung (AES-256-GCM) auf den Geräten der Nutzer; Schlüssel ausserhalb des Zugriffs des Auftragsverarbeiters.',
            'Transportverschlüsselung (TLS 1.2+, HSTS).',
            'Zugriffskontrolle nach dem Minimalprinzip, Protokollierung sicherheitsrelevanter Ereignisse.',
            'Mehrfache Speicherung (EU und Filecoin) mit täglichen kryptografischen Speicherbeweisen.',
            'Richtlinien für Teams: Passkey-Pflicht, Mindestlänge der Passphrase, automatische Sperre, Link-Richtlinien.',
            'Firmen-Notfallzugriff nur nach dem Vier-Augen-Prinzip, protokolliert und für Betroffene sichtbar.',
            'Überwachung der Verfügbarkeit, öffentliche Statusseite.'
          ]
        ]
      },
      { h: '6. Kontrollrechte', b: ['Der Verantwortliche kann sich von der Einhaltung überzeugen, vorrangig durch den Compliance-Bericht und Nachweise; Vor-Ort-Prüfungen nach Absprache mit angemessener Vorankündigung.'] },
      { h: '7. Schlussbestimmungen', b: [`Es gilt Schweizer Recht; Gerichtsstand ist ${C.court}. Bei Widersprüchen geht dieser AVV dem Hauptvertrag in Fragen des Datenschutzes vor. Stand: ${C.updated}.`] }
    ]
  }
}

const en: Record<LegalKey, LegalDoc> = {
  impressum: {
    title: 'Imprint',
    lead: 'Information pursuant to Swiss and German law.',
    sections: [
      { h: 'Provider', b: [[C.name, C.street, `${C.city}, ${C.country}`]] },
      { h: 'Contact', b: [[`Email: ${C.email}`, `Phone: ${C.phone}`, 'Support: focvault.app/support']] },
      { h: 'Commercial register', b: [[`UID: ${C.uid}`, `Registered in the ${C.register}`, `Authorised representatives: ${C.representatives}`]] },
      { h: 'Responsible for content', b: [C.representatives] },
      {
        h: 'Disclaimer',
        b: [
          'We check the content of this website carefully but cannot guarantee accuracy, completeness or timeliness. The operators of linked websites are solely responsible for their content.',
          'The contents of your vault are end-to-end encrypted; we have no access to them and are not responsible for them.'
        ]
      }
    ]
  },
  datenschutz: {
    title: 'Privacy policy',
    lead: 'How we handle your data – under the Swiss Federal Act on Data Protection (FADP) and the EU General Data Protection Regulation (GDPR).',
    sections: [
      { h: '1. Controller', b: [`${addr}. Privacy contact: ${C.privacyEmail}.`] },
      { h: '2. Principle: zero knowledge', b: ['Files, file names, passwords, notes and 2FA data are encrypted on your device with AES-256-GCM before they are sent to us. Keys never leave your device unencrypted. We therefore cannot read, analyse or disclose this content.'] },
      {
        h: '3. Data we process',
        b: [
          [
            'Account data: email or wallet address, chosen plan, language, time of registration.',
            'Security data: sign-in verifiers (no passphrase), encrypted key envelopes, passkey identifiers.',
            'Usage data: number and size of encrypted blocks, storage usage, times of sign-ins and changes (audit log), IP address for abuse prevention.',
            'Payment data: processed by Stripe; we only receive status, amount, period and a customer ID.',
            'Support requests: name, email, company and the content of your message.',
            'Team features (Business): roles, policy status and the passphrase length reported by the device.'
          ]
        ]
      },
      {
        h: '4. Purposes and legal bases',
        b: [
          ['Providing the service and performing the contract (Art. 6(1)(b) GDPR).', 'Billing and statutory retention (Art. 6(1)(c) GDPR, Art. 958f Swiss CO).', 'Security, abuse prevention and stability (Art. 6(1)(f) GDPR).', 'Answering requests (Art. 6(1)(b) or (f) GDPR).'],
          'We do not advertise, sell data or use trackers in the app.'
        ]
      },
      { h: '5. Cookies and local storage', b: ['We only use technically necessary cookies: session (sign-in), language and currency. No consent banner is required for these. Encrypted vault data may be cached locally in the browser for speed.'] },
      { h: '6. Recipients and processors', b: ['We use the following providers, each under a data processing agreement:', SUBPROCESSORS_EN] },
      { h: '7. Transfers abroad', b: ['Your encrypted files are stored in the EU. Payments via Stripe may involve transfers to the USA, based on the EU standard contractual clauses and the EU-U.S. and Swiss-U.S. Data Privacy Framework.'] },
      {
        h: '8. Retention',
        b: [
          [
            'Account data and vault: until you delete your account; then deletion within 30 days, encrypted Filecoin copies are marked for removal.',
            'Invoice data: 10 years (statutory retention).',
            'Audit logs: 12 months.',
            'Support requests: 2 years after closing.',
            'Inactive Free accounts: after prior warning according to plan terms.'
          ]
        ]
      },
      {
        h: '9. Your rights',
        b: [
          `You have the right to access, rectification, erasure, restriction, data portability and objection. Write to ${C.privacyEmail}. You may also complain to the Swiss Federal Data Protection and Information Commissioner (FDPIC) or an EU supervisory authority.`,
          'You can export the contents of your vault yourself at any time; we cannot disclose them because we do not have the keys.'
        ]
      },
      { h: '10. Security', b: ['End-to-end encryption, TLS with HSTS, access restrictions, audit logging and multiple encrypted copies. Details at focvault.app/security.'] },
      { h: '11. Changes', b: [`We update this policy when the service or the law changes. Last updated: ${C.updated}.`] }
    ]
  },
  agb: {
    title: 'Terms of service',
    lead: `For the use of FocVault, provided by ${C.name}.`,
    sections: [
      { h: '1. Scope', b: ['These terms apply to all contracts for the use of FocVault (web app, API, storage API, backup program). Deviating terms apply only if we agree in writing.'] },
      { h: '2. Conclusion of contract', b: ['The contract is concluded upon registration (Free) or when booking a paid plan. Business customers may agree a separate contract with an SLA.'] },
      { h: '3. Services', b: ['We provide storage and features according to the chosen plan (Free, Pro, Family, Business, Enterprise) as described in the current pricing.', 'Data is stored in the EU and additionally secured on Filecoin in encrypted form.'] },
      { h: '4. Zero knowledge and your responsibility', b: ['Encryption happens on your device. We know neither your passphrase nor your recovery kit and cannot reset them. If both are lost, the data is permanently inaccessible. You are responsible for keeping them safe.'] },
      { h: '5. Availability', b: ['We aim for 99.9% annual availability and publish it at focvault.app/status, where planned maintenance is announced. A guaranteed service level applies only if agreed separately.'] },
      { h: '6. Prices and payment', b: ['Prices at the time of booking apply, including statutory VAT. Subscriptions are billed in advance monthly or yearly; pay-as-you-go and additional users monthly in arrears. Payment is handled by Stripe.', 'If payment is overdue we may restrict paid features after notice; your data is kept.'] },
      { h: '7. Term and cancellation', b: ['Subscriptions renew automatically for the chosen term and can be cancelled any time to the end of the term. Free accounts can be deleted at any time.'] },
      { h: '8. Acceptable use', b: ['You may not use the service for unlawful purposes, to distribute malware or to infringe the rights of others. We may suspend accounts on reasonable suspicion; due to encryption we do not inspect content.'] },
      { h: '9. Liability', b: ['We are liable without limitation for intent and gross negligence. Otherwise liability is limited, to the extent permitted by law, to the amount paid in the last twelve months. Mandatory consumer protection law remains unaffected.'] },
      { h: '10. Data protection and processing', b: ['Our privacy policy applies. For Business customers the data processing agreement (DPA) applies in addition.'] },
      { h: '11. Changes', b: ['We announce changes at least 30 days in advance. If you do not object they are deemed accepted; if you object you may cancel as of the effective date.'] },
      { h: '12. Governing law and jurisdiction', b: [`Swiss law applies, excluding the UN Convention on Contracts for the International Sale of Goods. Place of jurisdiction is ${C.court}. Consumers additionally benefit from mandatory provisions of their country of residence.`] }
    ]
  },
  avv: {
    title: 'Data processing agreement (DPA)',
    lead: `Between the customer (controller) and ${C.name} (processor) under Art. 9 FADP and Art. 28 GDPR. Applies to Business plans from booking.`,
    sections: [
      { h: '1. Subject and duration', b: ['The processor provides FocVault to the controller as a storage and vault service. This DPA applies for the term of the main contract.'] },
      {
        h: '2. Nature, purpose and categories',
        b: [
          [
            'Purpose: storing, providing and backing up the controller’s data.',
            'Data: content encrypted by the controller (not readable by the processor) and account and log data of users.',
            'Data subjects: employees and other persons authorised by the controller, and persons whose data is contained in encrypted content.'
          ]
        ]
      },
      {
        h: '3. Obligations of the processor',
        b: [
          [
            'Processing only on documented instructions of the controller.',
            'Confidentiality obligations for everyone with access.',
            'Implementation of the technical and organisational measures in section 5.',
            'Assistance with data subject requests and impact assessments, as far as possible without access to encrypted content.',
            'Notification of security breaches without undue delay, at the latest within 48 hours of becoming aware.',
            'Deletion of all data within 30 days after the end of the contract unless retention is required by law.',
            'Provision of information needed to demonstrate compliance, including audit log and compliance report.'
          ]
        ]
      },
      { h: '4. Sub-processors', b: ['The controller consents to the following sub-processors. Changes are announced at least 30 days in advance; the controller may object for good cause.', SUBPROCESSORS_EN] },
      {
        h: '5. Technical and organisational measures',
        b: [
          [
            'End-to-end encryption (AES-256-GCM) on users’ devices; keys outside the processor’s reach.',
            'Transport encryption (TLS 1.2+, HSTS).',
            'Least-privilege access control, logging of security-relevant events.',
            'Multiple storage (EU and Filecoin) with daily cryptographic storage proofs.',
            'Team policies: passkeys required, minimum passphrase length, auto-lock, link policies.',
            'Company emergency access only with four-eyes approval, logged and visible to the data subject.',
            'Availability monitoring, public status page.'
          ]
        ]
      },
      { h: '6. Audit rights', b: ['The controller may verify compliance, primarily via the compliance report and evidence; on-site audits by arrangement with reasonable notice.'] },
      { h: '7. Final provisions', b: [`Swiss law applies; place of jurisdiction is ${C.court}. In case of conflict this DPA prevails over the main contract on data protection matters. Last updated: ${C.updated}.`] }
    ]
  }
}

export const legal = { de, en }

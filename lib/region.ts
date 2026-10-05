/**
 * Region: Sprachen und Anzeige-Währungen (reine Daten und Funktionen – Client und Server).
 * - Übersetzt sind nur Deutsch und Englisch; andere Sprachen zeigen englische Texte,
 *   Datum und Zahlen aber im gewählten Format (Intl).
 * - Abgerechnet wird nur in CHF, EUR oder USD (lib/pricing.ts). Alle anderen Währungen sind
 *   reine Anzeige: „≈ umgerechneter Preis, abgerechnet in USD/EUR/CHF“.
 */
import type { Currency } from './pricing'

export interface Language {
  /** BCP-47, z. B. 'de', 'pt-BR', 'zh-CN' */
  code: string
  /** Eigenname der Sprache */
  native: string
  en: string
  de: string
  /** eigene Übersetzung vorhanden (sonst englische Texte) */
  translated: boolean
  /** Schrift von rechts nach links */
  rtl?: boolean
}

const L = (code: string, native: string, en: string, de: string, rtl?: boolean): Language => ({
  code,
  native,
  en,
  de,
  translated: code === 'de' || code === 'en',
  ...(rtl ? { rtl } : {})
})

/** 50 meistgesprochene bzw. im Web meistgenutzte Sprachen. */
export const LANGUAGES: Language[] = [
  L('en', 'English', 'English', 'Englisch'),
  L('de', 'Deutsch', 'German', 'Deutsch'),
  L('zh-CN', '简体中文', 'Chinese (Simplified)', 'Chinesisch (vereinfacht)'),
  L('zh-TW', '繁體中文', 'Chinese (Traditional)', 'Chinesisch (traditionell)'),
  L('es', 'Español', 'Spanish', 'Spanisch'),
  L('hi', 'हिन्दी', 'Hindi', 'Hindi'),
  L('ar', 'العربية', 'Arabic', 'Arabisch', true),
  L('pt-BR', 'Português (Brasil)', 'Portuguese (Brazil)', 'Portugiesisch (Brasilien)'),
  L('pt-PT', 'Português (Portugal)', 'Portuguese (Portugal)', 'Portugiesisch (Portugal)'),
  L('bn', 'বাংলা', 'Bengali', 'Bengalisch'),
  L('ru', 'Русский', 'Russian', 'Russisch'),
  L('ja', '日本語', 'Japanese', 'Japanisch'),
  L('fr', 'Français', 'French', 'Französisch'),
  L('it', 'Italiano', 'Italian', 'Italienisch'),
  L('tr', 'Türkçe', 'Turkish', 'Türkisch'),
  L('ko', '한국어', 'Korean', 'Koreanisch'),
  L('vi', 'Tiếng Việt', 'Vietnamese', 'Vietnamesisch'),
  L('id', 'Bahasa Indonesia', 'Indonesian', 'Indonesisch'),
  L('ur', 'اردو', 'Urdu', 'Urdu', true),
  L('pa', 'ਪੰਜਾਬੀ', 'Punjabi', 'Panjabi'),
  L('mr', 'मराठी', 'Marathi', 'Marathi'),
  L('te', 'తెలుగు', 'Telugu', 'Telugu'),
  L('ta', 'தமிழ்', 'Tamil', 'Tamil'),
  L('fa', 'فارسی', 'Persian', 'Persisch', true),
  L('pl', 'Polski', 'Polish', 'Polnisch'),
  L('uk', 'Українська', 'Ukrainian', 'Ukrainisch'),
  L('nl', 'Nederlands', 'Dutch', 'Niederländisch'),
  L('th', 'ไทย', 'Thai', 'Thailändisch'),
  L('ms', 'Bahasa Melayu', 'Malay', 'Malaiisch'),
  L('fil', 'Filipino', 'Filipino', 'Filipino'),
  L('sw', 'Kiswahili', 'Swahili', 'Swahili'),
  L('gu', 'ગુજરાતી', 'Gujarati', 'Gujarati'),
  L('kn', 'ಕನ್ನಡ', 'Kannada', 'Kannada'),
  L('ml', 'മലയാളം', 'Malayalam', 'Malayalam'),
  L('ro', 'Română', 'Romanian', 'Rumänisch'),
  L('el', 'Ελληνικά', 'Greek', 'Griechisch'),
  L('cs', 'Čeština', 'Czech', 'Tschechisch'),
  L('sv', 'Svenska', 'Swedish', 'Schwedisch'),
  L('hu', 'Magyar', 'Hungarian', 'Ungarisch'),
  L('he', 'עברית', 'Hebrew', 'Hebräisch', true),
  L('da', 'Dansk', 'Danish', 'Dänisch'),
  L('fi', 'Suomi', 'Finnish', 'Finnisch'),
  L('nb', 'Norsk bokmål', 'Norwegian (Bokmål)', 'Norwegisch (Bokmål)'),
  L('sk', 'Slovenčina', 'Slovak', 'Slowakisch'),
  L('bg', 'Български', 'Bulgarian', 'Bulgarisch'),
  L('hr', 'Hrvatski', 'Croatian', 'Kroatisch'),
  L('sr', 'Српски', 'Serbian', 'Serbisch'),
  L('ha', 'Hausa', 'Hausa', 'Hausa'),
  L('am', 'አማርኛ', 'Amharic', 'Amharisch'),
  L('ca', 'Català', 'Catalan', 'Katalanisch')
]

export interface DisplayCurrency {
  /** ISO 4217 */
  code: string
  de: string
  en: string
  /** Nachkommastellen nach ISO 4217 */
  decimals: number
  /** Richtkurs je 1 USD (Stand 2026-10-04, open.er-api.com) – Notfall-Fallback, nicht für Abrechnung */
  approxPerUsd: number
}

const C = (code: string, de: string, en: string, approxPerUsd: number, decimals = 2): DisplayCurrency => ({ code, de, en, decimals, approxPerUsd })

/** 50 wichtigste Währungen (Handelsvolumen, Wirtschaftsraum). */
export const DISPLAY_CURRENCIES: DisplayCurrency[] = [
  C('USD', 'US-Dollar', 'US dollar', 1),
  C('EUR', 'Euro', 'Euro', 0.8888),
  C('CHF', 'Schweizer Franken', 'Swiss franc', 0.8285),
  C('GBP', 'Britisches Pfund', 'British pound', 0.7564),
  C('JPY', 'Japanischer Yen', 'Japanese yen', 157.82, 0),
  C('CNY', 'Chinesischer Yuan', 'Chinese yuan', 6.72),
  C('AUD', 'Australischer Dollar', 'Australian dollar', 1.4397),
  C('CAD', 'Kanadischer Dollar', 'Canadian dollar', 1.4239),
  C('HKD', 'Hongkong-Dollar', 'Hong Kong dollar', 7.8469),
  C('SGD', 'Singapur-Dollar', 'Singapore dollar', 1.2794),
  C('SEK', 'Schwedische Krone', 'Swedish krona', 10.044),
  C('KRW', 'Südkoreanischer Won', 'South Korean won', 1348.6, 0),
  C('NOK', 'Norwegische Krone', 'Norwegian krone', 9.6232),
  C('NZD', 'Neuseeland-Dollar', 'New Zealand dollar', 1.7815),
  C('INR', 'Indische Rupie', 'Indian rupee', 96.35),
  C('MXN', 'Mexikanischer Peso', 'Mexican peso', 18.214),
  C('TWD', 'Neuer Taiwan-Dollar', 'New Taiwan dollar', 31.854),
  C('ZAR', 'Südafrikanischer Rand', 'South African rand', 16.66),
  C('BRL', 'Brasilianischer Real', 'Brazilian real', 5.2205),
  C('DKK', 'Dänische Krone', 'Danish krone', 6.647),
  C('PLN', 'Polnischer Złoty', 'Polish złoty', 3.8902),
  C('THB', 'Thailändischer Baht', 'Thai baht', 33.564),
  C('ILS', 'Israelischer Schekel', 'Israeli shekel', 3.0531),
  C('IDR', 'Indonesische Rupiah', 'Indonesian rupiah', 17888.6),
  C('CZK', 'Tschechische Krone', 'Czech koruna', 21.726),
  C('AED', 'VAE-Dirham', 'UAE dirham', 3.6725),
  C('TRY', 'Türkische Lira', 'Turkish lira', 49.137),
  C('HUF', 'Ungarischer Forint', 'Hungarian forint', 327.48),
  C('CLP', 'Chilenischer Peso', 'Chilean peso', 982.07, 0),
  C('SAR', 'Saudi-Riyal', 'Saudi riyal', 3.75),
  C('PHP', 'Philippinischer Peso', 'Philippine peso', 62.599),
  C('MYR', 'Malaysischer Ringgit', 'Malaysian ringgit', 4.0842),
  C('COP', 'Kolumbianischer Peso', 'Colombian peso', 3311.6),
  C('RUB', 'Russischer Rubel', 'Russian ruble', 83.492),
  C('RON', 'Rumänischer Leu', 'Romanian leu', 4.7432),
  C('PEN', 'Peruanischer Sol', 'Peruvian sol', 3.4433),
  C('ARS', 'Argentinischer Peso', 'Argentine peso', 1523.1),
  C('KWD', 'Kuwait-Dinar', 'Kuwaiti dinar', 0.30874, 3),
  C('BHD', 'Bahrain-Dinar', 'Bahraini dinar', 0.376, 3),
  C('QAR', 'Katar-Riyal', 'Qatari riyal', 3.64),
  C('EGP', 'Ägyptisches Pfund', 'Egyptian pound', 52.23),
  C('NGN', 'Nigerianischer Naira', 'Nigerian naira', 1330.1),
  C('PKR', 'Pakistanische Rupie', 'Pakistani rupee', 276.83),
  C('VND', 'Vietnamesischer Dong', 'Vietnamese dong', 25939.9, 0),
  C('BDT', 'Bangladeschischer Taka', 'Bangladeshi taka', 122.88),
  C('UAH', 'Ukrainische Hrywnja', 'Ukrainian hryvnia', 44.953),
  C('KZT', 'Kasachischer Tenge', 'Kazakhstani tenge', 444.27),
  C('MAD', 'Marokkanischer Dirham', 'Moroccan dirham', 9.8644),
  C('ISK', 'Isländische Krone', 'Icelandic króna', 121.72, 0),
  C('KES', 'Kenia-Schilling', 'Kenyan shilling', 129.54)
]

const BY_CODE = new Map(DISPLAY_CURRENCIES.map(c => [c.code, c]))

export function displayCurrency(code: string): DisplayCurrency | undefined {
  return BY_CODE.get(code.toUpperCase())
}

export function isDisplayCurrency(code: unknown): code is string {
  return typeof code === 'string' && BY_CODE.has(code.toUpperCase())
}

/** Richtkurse aller Anzeige-Währungen je 1 USD (Notfall-Fallback ohne Netz). */
export const STATIC_USD_RATES: Record<string, number> = Object.fromEntries(DISPLAY_CURRENCIES.map(c => [c.code, c.approxPerUsd]))

/**
 * Europäische Währungen (EWR + Grossbritannien) werden in EUR abgerechnet: näher an der
 * Lebenswelt und günstiger beim Kartenumtausch als USD. GBP bewusst EUR, nicht USD.
 */
const EUR_BILLED = new Set(['EUR', 'GBP', 'SEK', 'NOK', 'DKK', 'ISK', 'PLN', 'CZK', 'HUF', 'RON'])

/** Abrechnungswährung für eine Anzeige-Währung: CHF → CHF, Europa → EUR, Rest → USD. */
export function billingCurrencyFor(code: string): Currency {
  const c = code.toUpperCase()
  if (c === 'CHF') return 'CHF'
  return EUR_BILLED.has(c) ? 'EUR' : 'USD'
}

/** Betrag in Landeswährung, z. B. ('ja-JP', JPY) → „￥2,190“; Nachkommastellen nach ISO 4217. */
export function formatMoney(amount: number, code: string, locale: string, digits?: number): string {
  const c = code.toUpperCase()
  const d = digits ?? displayCurrency(c)?.decimals ?? 2
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: c, minimumFractionDigits: d, maximumFractionDigits: d }).format(amount)
  } catch {
    // unbekannte Locale/Währung: schlicht formatieren
    return `${amount.toFixed(d)} ${c}`
  }
}

/** Umrechnung über USD-Basiskurse (Einheiten je 1 USD). Fehlt ein Kurs: NaN. */
export function convert(amount: number, from: string, to: string, rates: Record<string, number>): number {
  const f = from.toUpperCase()
  const t = to.toUpperCase()
  if (f === t) return amount
  const rf = f === 'USD' ? 1 : rates[f]
  const rt = t === 'USD' ? 1 : rates[t]
  return rf > 0 && rt > 0 ? (amount / rf) * rt : NaN
}

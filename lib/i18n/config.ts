/** Sprachen und URL-Schema: /de/…, /en/… – englische Seiten mit englischen Pfaden. */
export type Locale = 'de' | 'en'
export const LOCALES: Locale[] = ['de', 'en']
export const DEFAULT_LOCALE: Locale = 'de'
export const LOCALE_COOKIE = 'fv_locale'
export const CURRENCY_COOKIE = 'fv_currency'
/** Region: gewählte Sprache (auch ohne Übersetzung) und Anzeige-Währung (eine von 50) */
export const REGION_LANG_COOKIE = 'fv_region_lang'
export const DISPLAY_CURRENCY_COOKIE = 'fv_display_currency'

/** Interner (deutscher) Pfad → englischer Pfad. */
const EN_SLUGS: Record<string, string> = {
  anmelden: 'login',
  registrieren: 'register',
  wiederherstellen: 'recover',
  sicherheit: 'security',
  datenschutz: 'privacy',
  agb: 'terms',
  impressum: 'imprint',
  avv: 'dpa'
}
const EN_SLUGS_REVERSE: Record<string, string> = Object.fromEntries(Object.entries(EN_SLUGS).map(([k, v]) => [v, k]))

export function isLocale(v: unknown): v is Locale {
  return v === 'de' || v === 'en'
}

/** Öffentlicher Pfad für eine Sprache, z. B. ('/anmelden', 'en') → '/en/login'. */
export function localizedPath(internal: string, locale: Locale): string {
  const [pathOnly, query = ''] = internal.split('?')
  const parts = pathOnly.split('/')
  if (locale === 'en' && parts[1] && EN_SLUGS[parts[1]]) parts[1] = EN_SLUGS[parts[1]]
  const p = parts.join('/') === '/' ? '' : parts.join('/')
  return `/${locale}${p}${query ? `?${query}` : ''}`
}

/** Öffentlicher Pfad ohne Sprachpräfix → interner Pfad, z. B. '/login' (en) → '/anmelden'. */
export function internalPath(rest: string, _locale: Locale): string {
  // Englische Pfade funktionieren in beiden Sprachen (z. B. /de/login → /anmelden).
  const parts = rest.split('/')
  if (parts[1] && EN_SLUGS_REVERSE[parts[1]]) parts[1] = EN_SLUGS_REVERSE[parts[1]]
  return parts.join('/') || '/'
}

/** Sprache aus Accept-Language (erste unterstützte), sonst Deutsch. */
export function localeFromAcceptLanguage(header: string | null): Locale {
  for (const part of (header ?? '').split(',')) {
    const tag = part.trim().toLowerCase()
    if (tag.startsWith('de')) return 'de'
    if (tag.startsWith('en')) return 'en'
  }
  return DEFAULT_LOCALE
}

/** Währungsvorschlag aus Accept-Language: Schweiz → CHF, USA → USD, sonst EUR. */
export function currencyFromAcceptLanguage(header: string | null): 'CHF' | 'EUR' | 'USD' {
  const h = (header ?? '').toLowerCase()
  if (/-ch\b/.test(h)) return 'CHF'
  if (/en-us\b/.test(h)) return 'USD'
  if (/^de\b/.test(h.trim())) return 'CHF'
  return 'EUR'
}

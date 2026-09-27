import { NextResponse, type NextRequest } from 'next/server'
import {
  CURRENCY_COOKIE,
  LOCALE_COOKIE,
  currencyFromAcceptLanguage,
  internalPath,
  isLocale,
  localeFromAcceptLanguage,
  localizedPath,
  type Locale
} from './lib/i18n/config'

/**
 * Sprachpräfix /de, /en:
 * - /de/… und /en/… werden auf die internen Seiten umgeschrieben (Sprache als Request-Header)
 * - Pfade ohne Präfix werden auf die bevorzugte Sprache umgeleitet (Cookie, sonst Browser)
 * - Share-Links /s/… bleiben ohne Umleitung gültig (Schlüssel im #-Fragment)
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const first = pathname.split('/')[1]
  const accept = req.headers.get('accept-language')
  const currency = req.cookies.get(CURRENCY_COOKIE)?.value ?? currencyFromAcceptLanguage(accept)

  const withLocale = (locale: Locale, url: URL) => {
    const headers = new Headers(req.headers)
    headers.set('x-fv-locale', locale)
    headers.set('x-fv-currency', currency)
    const res = NextResponse.rewrite(url, { request: { headers } })
    res.cookies.set(LOCALE_COOKIE, locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
    if (!req.cookies.get(CURRENCY_COOKIE)) {
      res.cookies.set(CURRENCY_COOKIE, currency, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
    }
    return res
  }

  const cookieLocale = req.cookies.get(LOCALE_COOKIE)?.value
  const preferred: Locale = isLocale(cookieLocale) ? cookieLocale : localeFromAcceptLanguage(accept)

  if (isLocale(first)) {
    const rest = pathname.slice(first.length + 1) || '/'
    const url = req.nextUrl.clone()
    url.pathname = internalPath(rest, first)
    return withLocale(first, url)
  }

  if (first === 's') return withLocale(preferred, req.nextUrl.clone())

  const url = req.nextUrl.clone()
  url.pathname = localizedPath(pathname, preferred).split('?')[0]
  return NextResponse.redirect(url)
}

export const config = {
  // Alles außer API, Next-Interna und Dateien mit Endung (Icons, Manifest, Mockups)
  matcher: ['/((?!api|_next|.*\\..*).*)']
}

'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { CURRENCY_COOKIE, DISPLAY_CURRENCY_COOKIE, LOCALE_COOKIE, REGION_LANG_COOKIE, isLocale, localizedPath, type Locale } from '@/lib/i18n/config'
import { CURRENCIES, money, type Currency } from '@/lib/pricing'
import { billingCurrencyFor, convert, displayCurrency, formatMoney, LANGUAGES } from '@/lib/region'
import { FALLBACK_FX, loadFxRates } from '@/features/fx/useFxRates'

interface I18nValue {
  locale: Locale
  /** interner Pfad → öffentlicher Pfad in der aktuellen Sprache */
  path: (internal: string) => string
  /** gleiche Seite in anderer Sprache */
  switchLocale: (locale: Locale) => void
  currency: Currency
  setCurrency: (c: Currency) => void
  fmtMoney: (amount: number, currency?: Currency, digits?: number) => string
  fmtDate: (iso: string | number | Date) => string
  fmtNumber: (n: number, digits?: number) => string
  /** Region: gewählte Sprache (BCP-47; ohne Übersetzung englische Texte, aber Datum/Zahlen im Landesformat) */
  regionLanguage: string
  setRegionLanguage: (code: string) => void
  /** Region: Anzeige-Währung (eine von 50); abgerechnet wird in `currency` (CHF/EUR/USD) */
  displayCurrency: string
  setDisplayCurrency: (code: string) => void
  /** „≈ ₹1,240“ für einen Betrag in Abrechnungswährung – null, wenn Anzeige = Abrechnung */
  fmtApprox: (amount: number, from: Currency) => string | null
}

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return m ? decodeURIComponent(m[1]) : null
}

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({
  locale: initialLocale,
  initialCurrency,
  children
}: {
  locale: Locale
  initialCurrency: Currency
  children: ReactNode
}) {
  const router = useRouter()
  // Sprache als Client-Zustand: das Root-Layout wird bei Client-Navigation nicht neu gerendert,
  // und ein Neuladen würde den (nur im RAM gehaltenen) Tresorschlüssel verwerfen.
  const [locale, setLocale] = useState<Locale>(initialLocale)
  const [currency, setCurrencyState] = useState<Currency>(initialCurrency)
  const [regionLanguage, setRegionLang] = useState<string>(initialLocale)
  const [displayCur, setDisplayCur] = useState<string>(initialCurrency)
  const [rates, setRates] = useState<Record<string, number>>(FALLBACK_FX.rates)

  // Region-Einstellungen erst nach dem Laden lesen (kein Hydration-Unterschied)
  useEffect(() => {
    const lang = readCookie(REGION_LANG_COOKIE)
    if (lang && LANGUAGES.some(l => l.code === lang)) setRegionLang(lang)
    const cur = readCookie(DISPLAY_CURRENCY_COOKIE)
    if (cur && displayCurrency(cur)) setDisplayCur(cur)
  }, [])

  // Kurse nur laden, wenn eine Nicht-Abrechnungswährung angezeigt wird
  useEffect(() => {
    if ((CURRENCIES as string[]).includes(displayCur)) return
    let alive = true
    void loadFxRates().then(fx => alive && setRates(fx.rates))
    return () => {
      alive = false
    }
  }, [displayCur])

  useEffect(() => {
    setLocale(initialLocale)
  }, [initialLocale])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setCurrency = useCallback((c: Currency) => {
    setCurrencyState(c)
    document.cookie = `${CURRENCY_COOKIE}=${c}; path=/; max-age=31536000; samesite=lax`
    // Abrechnungswährung direkt gewählt (z. B. in „Pakete im Vergleich“): Anzeige folgt
    setDisplayCur(d => {
      const next = (CURRENCIES as string[]).includes(d) || billingCurrencyFor(d) !== c ? c : d
      writeCookie(DISPLAY_CURRENCY_COOKIE, next)
      return next
    })
  }, [])

  const setDisplayCurrency = useCallback((code: string) => {
    if (!displayCurrency(code)) return
    setDisplayCur(code)
    writeCookie(DISPLAY_CURRENCY_COOKIE, code)
    const billing = (CURRENCIES as string[]).includes(code) ? (code as Currency) : billingCurrencyFor(code)
    setCurrencyState(billing)
    document.cookie = `${CURRENCY_COOKIE}=${billing}; path=/; max-age=31536000; samesite=lax`
  }, [])

  const value = useMemo<I18nValue>(() => {
    // Sprache ohne eigene Übersetzung: englische Texte, aber Zahlen und Datum im Landesformat
    const regional = !isLocale(regionLanguage) ? regionLanguage : null
    const numLocale = regional ?? (locale === 'en' ? 'en-US' : 'de-CH')
    const dateLocale = regional ?? (locale === 'en' ? 'en-GB' : 'de-CH')
    const switchTo = (next: Locale) => {
      // aktuellen öffentlichen Pfad in die andere Sprache übertragen
      const current = window.location.pathname.replace(/^\/(de|en)(?=\/|$)/, '') || '/'
      const internal = current
        .replace(/^\/login(?=\/|$)/, '/anmelden')
        .replace(/^\/register(?=\/|$)/, '/registrieren')
        .replace(/^\/recover(?=\/|$)/, '/wiederherstellen')
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
      setLocale(next)
      router.replace(localizedPath(internal, next) + window.location.search + window.location.hash, { scroll: false })
    }
    return {
      locale,
      path: p => localizedPath(p, locale),
      switchLocale: next => {
        setRegionLang(next)
        writeCookie(REGION_LANG_COOKIE, next)
        switchTo(next)
      },
      currency,
      setCurrency,
      fmtMoney: (amount, cur = currency, digits = 2) => money(amount, cur, locale, digits),
      fmtDate: d => new Date(d).toLocaleDateString(dateLocale),
      fmtNumber: (n, digits = 0) => n.toLocaleString(numLocale, { maximumFractionDigits: digits }),
      regionLanguage,
      setRegionLanguage: code => {
        const lang = LANGUAGES.find(l => l.code === code)
        if (!lang) return
        setRegionLang(code)
        writeCookie(REGION_LANG_COOKIE, code)
        // ohne eigene Übersetzung: englische Texte
        const next: Locale = isLocale(code) ? code : 'en'
        if (next !== locale) switchTo(next)
      },
      displayCurrency: displayCur,
      setDisplayCurrency,
      fmtApprox: (amount, from) => {
        if (displayCur === from) return null
        const v = convert(amount, from, displayCur, rates)
        if (!Number.isFinite(v)) return null
        // Richtwert: bei großen Beträgen ohne Nachkommastellen
        const digits = v >= 100 ? 0 : undefined
        return `≈ ${formatMoney(v, displayCur, numLocale, digits)}`
      }
    }
  }, [locale, currency, setCurrency, router, regionLanguage, displayCur, setDisplayCurrency, rates])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n außerhalb von <I18nProvider>')
  return ctx
}

/** Texte eines Bereichs in der aktuellen Sprache – vollständig typisiert. */
export function useMessages<T>(ns: { de: T; en: T }): T {
  return ns[useI18n().locale]
}

/** Platzhalter ersetzen: fmt('Noch {n} Tage', { n: 3 }). */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`))
}

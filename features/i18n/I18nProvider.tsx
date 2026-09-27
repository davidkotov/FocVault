'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { CURRENCY_COOKIE, LOCALE_COOKIE, localizedPath, type Locale } from '@/lib/i18n/config'
import { money, type Currency } from '@/lib/pricing'

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

  useEffect(() => {
    setLocale(initialLocale)
  }, [initialLocale])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setCurrency = useCallback((c: Currency) => {
    setCurrencyState(c)
    document.cookie = `${CURRENCY_COOKIE}=${c}; path=/; max-age=31536000; samesite=lax`
  }, [])

  const value = useMemo<I18nValue>(() => {
    const numLocale = locale === 'en' ? 'en-US' : 'de-CH'
    return {
      locale,
      path: p => localizedPath(p, locale),
      switchLocale: next => {
        // aktuellen öffentlichen Pfad in die andere Sprache übertragen
        const current = window.location.pathname.replace(/^\/(de|en)(?=\/|$)/, '') || '/'
        const internal = current
          .replace(/^\/login(?=\/|$)/, '/anmelden')
          .replace(/^\/register(?=\/|$)/, '/registrieren')
          .replace(/^\/recover(?=\/|$)/, '/wiederherstellen')
        document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
        setLocale(next)
        router.replace(localizedPath(internal, next) + window.location.search + window.location.hash, { scroll: false })
      },
      currency,
      setCurrency,
      fmtMoney: (amount, cur = currency, digits = 2) => money(amount, cur, locale, digits),
      fmtDate: d => new Date(d).toLocaleDateString(locale === 'en' ? 'en-GB' : 'de-CH'),
      fmtNumber: (n, digits = 0) => n.toLocaleString(numLocale, { maximumFractionDigits: digits })
    }
  }, [locale, currency, setCurrency, router])

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

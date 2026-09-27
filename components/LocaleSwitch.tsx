'use client'

import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/features/i18n/I18nProvider'
import { CURRENCIES, type Currency } from '@/lib/pricing'
import type { Locale } from '@/lib/i18n/config'

const LANGUAGES: Array<{ id: Locale; name: string }> = [
  { id: 'de', name: 'Deutsch' },
  { id: 'en', name: 'English' }
]
const CURRENCY_NAMES: Record<Currency, { de: string; en: string }> = {
  CHF: { de: 'Schweizer Franken', en: 'Swiss franc' },
  EUR: { de: 'Euro', en: 'Euro' },
  USD: { de: 'US-Dollar', en: 'US dollar' }
}

function Globe() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className="icon">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
    </svg>
  )
}

/**
 * Sprache (und optional Währung) wählen – dezenter Menü-Button wie auf professionellen Seiten.
 * Schließt bei Klick daneben oder Escape; per Tastatur bedienbar.
 */
export default function LocaleSwitch({ showCurrency = false, onCurrency }: { showCurrency?: boolean; onCurrency?: (c: Currency) => void }) {
  const { locale, switchLocale, currency, setCurrency } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = LANGUAGES.find(l => l.id === locale)!
  return (
    <div className="localeswitch" ref={ref}>
      <button
        type="button"
        className="localebtn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={locale === 'en' ? 'Language and region' : 'Sprache und Region'}
        onClick={() => setOpen(o => !o)}
      >
        <Globe />
        <span className="localename">{current.name}</span>
        {showCurrency && <span className="localecur">· {currency}</span>}
        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" className="icon">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="localemenu" role="menu">
          <div className="localemenu-title">{locale === 'en' ? 'Language' : 'Sprache'}</div>
          {LANGUAGES.map(l => (
            <button
              key={l.id}
              role="menuitemradio"
              aria-checked={l.id === locale}
              className={l.id === locale ? 'active' : ''}
              onClick={() => {
                setOpen(false)
                if (l.id !== locale) switchLocale(l.id)
              }}
            >
              <span>{l.name}</span>
              {l.id === locale && <span aria-hidden="true">✓</span>}
            </button>
          ))}
          {showCurrency && (
            <>
              <div className="localemenu-title">{locale === 'en' ? 'Currency' : 'Währung'}</div>
              {CURRENCIES.map(c => (
                <button
                  key={c}
                  role="menuitemradio"
                  aria-checked={c === currency}
                  className={c === currency ? 'active' : ''}
                  onClick={() => {
                    setCurrency(c)
                    onCurrency?.(c)
                    setOpen(false)
                  }}
                >
                  <span>
                    {c} <span className="dim">– {CURRENCY_NAMES[c][locale]}</span>
                  </span>
                  {c === currency && <span aria-hidden="true">✓</span>}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

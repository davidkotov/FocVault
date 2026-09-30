'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/site/Icons'
import { useMessages } from '@/features/i18n/I18nProvider'
import { commonMessages } from '@/lib/i18n/messages/common'
import { THEME_COOKIE, type Theme } from '@/lib/theme'

/** Umschalter hell/dunkel für die Kopfzeile. Setzt data-theme auf <html> und merkt die Wahl im Cookie. */
export function ThemeToggle() {
  const m = useMessages(commonMessages).theme
  const [theme, setTheme] = useState<Theme>('light')
  useEffect(() => setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'), [])

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
    setTheme(next)
  }
  const label = theme === 'dark' ? m.toLight : m.toDark
  return (
    <button type="button" className="ghostbtn themetoggle" onClick={toggle} title={label} aria-label={label}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
    </button>
  )
}

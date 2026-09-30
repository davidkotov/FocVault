import type { Metadata, Viewport } from 'next'
import { cookies, headers } from 'next/headers'
import './globals.css'
import { Providers } from './providers'
import { TestEnvBadge } from '@/components/TestEnvBadge'
import { isLocale, DEFAULT_LOCALE } from '@/lib/i18n/config'
import type { Currency } from '@/lib/pricing'
import { THEME_COOKIE, isTheme } from '@/lib/theme'

export async function generateMetadata(): Promise<Metadata> {
  const locale = headers().get('x-fv-locale')
  const en = locale === 'en'
  return {
    title: en ? 'FocVault – Private cloud with zero-knowledge encryption' : 'FocVault – Private Cloud mit Zero-Knowledge-Verschlüsselung',
    description: en
      ? 'End-to-end encrypted cloud storage on Filecoin. Files, passwords and 2FA in one vault.'
      : 'Ende-zu-Ende-verschlüsselter Cloud-Speicher auf Filecoin. Dateien, Passwörter und 2FA in einem Tresor.',
    manifest: '/manifest.webmanifest',
    appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'FocVault' },
    icons: {
      icon: [
        { url: '/favicon.svg', type: 'image/svg+xml' },
        { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' }
      ],
      apple: '/apple-touch-icon.png'
    },
    alternates: { languages: { de: '/de', en: '/en' } }
  }
}

// Zoomen bleibt erlaubt (Barrierefreiheit) – kein maximumScale.
export const viewport: Viewport = {
  themeColor: '#101318',
  width: 'device-width',
  initialScale: 1
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const h = headers()
  const raw = h.get('x-fv-locale')
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE
  const cur = h.get('x-fv-currency')
  const currency: Currency = cur === 'EUR' || cur === 'USD' ? cur : 'CHF'
  const rawTheme = cookies().get(THEME_COOKIE)?.value
  const theme = isTheme(rawTheme) ? rawTheme : 'light'
  return (
    <html lang={locale} data-theme={theme}>
      <body>
        <TestEnvBadge locale={locale} />
        <Providers locale={locale} currency={currency}>
          {children}
        </Providers>
      </body>
    </html>
  )
}

'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { WagmiProvider, createConfig, http, type Config } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createAppKit, type AppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import type { AppKitNetwork } from '@reown/appkit/networks'
import { filecoin, filecoinCalibration } from '@/lib/chains'
import { reownEnabled, reownProjectId } from '@/lib/reown'
import { I18nProvider } from '@/features/i18n/I18nProvider'
import TooltipLayer from '@/components/TooltipLayer'
import type { Locale } from '@/lib/i18n/config'
import type { Currency } from '@/lib/pricing'

const networks = [filecoinCalibration, filecoin] as unknown as [AppKitNetwork, ...AppKitNetwork[]]

/** Reown bringt ein eigenes Design mit: Akzentfarbe wie in globals.css, hell und dunkel. */
const APPKIT_ACCENT = { light: '#0090ff', dark: '#2b9bff' } as const

/** Aktuelles Design der App. Auf dem Server (kein `document`) gilt hell wie im Layout. */
function domTheme(): 'light' | 'dark' {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

let appKit: AppKit | undefined

function buildConfig(): Config {
  if (!reownEnabled) {
    // Ohne Reown-Project-ID: nur Browser-Wallets (Wallet-Modus wie bisher).
    return createConfig({
      chains: [filecoinCalibration, filecoin],
      connectors: [injected()],
      transports: { [filecoinCalibration.id]: http(), [filecoin.id]: http() },
      ssr: true
    })
  }
  const adapter = new WagmiAdapter({ networks, projectId: reownProjectId, ssr: true })
  const mode = domTheme()
  appKit = createAppKit({
    adapters: [adapter],
    networks,
    projectId: reownProjectId,
    defaultNetwork: networks[0],
    metadata: {
      name: 'FocVault',
      description: 'Zero-Knowledge Privacy Cloud auf Filecoin',
      url: typeof window !== 'undefined' ? window.location.origin : 'https://foc-vault.vercel.app',
      icons: ['https://foc-vault.vercel.app/icon192.png']
    },
    features: {
      email: true,
      socials: ['google', 'apple', 'github', 'discord', 'x'],
      emailShowWallets: true,
      analytics: false,
      swaps: false,
      onramp: false
    },
    // Eingebettete Wallets als EOA: normale ECDSA-Signaturen, ohne Smart-Account-Deployment.
    defaultAccountTypes: { eip155: 'eoa' },
    themeMode: mode,
    themeVariables: { '--w3m-accent': APPKIT_ACCENT[mode] }
  })
  return adapter.wagmiConfig
}

const config = buildConfig()

/**
 * Das Reown-Modal folgt dem Design der App: `data-theme` auf <html> beobachten (der Umschalter
 * setzt es direkt) und Modus samt Akzentfarbe nachziehen – sonst bliebe das Modal immer hell.
 */
function AppKitThemeSync() {
  useEffect(() => {
    if (!appKit) return
    const sync = () => {
      const mode = domTheme()
      appKit?.setThemeMode(mode)
      appKit?.setThemeVariables({ '--w3m-accent': APPKIT_ACCENT[mode] })
    }
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return null
}

export function Providers({ children, locale, currency }: { children: ReactNode; locale: Locale; currency: Currency }) {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <I18nProvider locale={locale} initialCurrency={currency}>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          {children}
          <AppKitThemeSync />
          <TooltipLayer />
        </QueryClientProvider>
      </WagmiProvider>
    </I18nProvider>
  )
}

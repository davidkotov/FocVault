'use client'

import { useState, type ReactNode } from 'react'
import { WagmiProvider, createConfig, http, type Config } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createAppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import type { AppKitNetwork } from '@reown/appkit/networks'
import { filecoin, filecoinCalibration } from '@/lib/chains'
import { reownEnabled, reownProjectId } from '@/lib/reown'
import { I18nProvider } from '@/features/i18n/I18nProvider'
import type { Locale } from '@/lib/i18n/config'
import type { Currency } from '@/lib/pricing'

const networks = [filecoinCalibration, filecoin] as unknown as [AppKitNetwork, ...AppKitNetwork[]]

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
  createAppKit({
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
    themeMode: 'light',
    themeVariables: { '--w3m-accent': '#0090ff' }
  })
  return adapter.wagmiConfig
}

const config = buildConfig()

export function Providers({ children, locale, currency }: { children: ReactNode; locale: Locale; currency: Currency }) {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <I18nProvider locale={locale} initialCurrency={currency}>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </WagmiProvider>
    </I18nProvider>
  )
}

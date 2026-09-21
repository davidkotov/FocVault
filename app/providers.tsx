'use client'

import { useState, type ReactNode } from 'react'
import { WagmiProvider, createConfig, http } from 'wagmi'
import { injected, walletConnect } from 'wagmi/connectors'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { filecoin, filecoinCalibration } from '@/lib/chains'

function buildConnectors(): any[] {
  const list: any[] = [injected()]
  const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
  if (wcProjectId) {
    list.push(
      walletConnect({
        projectId: wcProjectId,
        showQrModal: true
      })
    )
  }
  return list
}

const config = createConfig({
  chains: [filecoinCalibration, filecoin],
  connectors: buildConnectors(),
  transports: {
    [filecoinCalibration.id]: http(),
    [filecoin.id]: http()
  },
  ssr: true
})

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  )
}

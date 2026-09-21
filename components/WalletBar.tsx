'use client'

import { useAccount, useBalance, useChainId, useConnect, useDisconnect, useSwitchChain } from 'wagmi'
import { filecoin, filecoinCalibration, isSupportedChain } from '@/lib/chains'

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export default function WalletBar() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { connect, connectors, isPending, error } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChain } = useSwitchChain()
  const { data: balance } = useBalance({
    address,
    chainId,
    query: { enabled: !!address && isSupportedChain(chainId) }
  })

  const injected = connectors.find(c => c.id === 'injected')
  const walletConnectC = connectors.find(c => c.id === 'walletConnect')
  const supported = isSupportedChain(chainId)

  if (!isConnected || !address) {
    return (
      <div className="walletbar">
        {injected && (
          <button
            className="primary"
            disabled={isPending}
            onClick={() => connect({ connector: injected, chainId: filecoinCalibration.id })}
          >
            Browser-Wallet
          </button>
        )}
        {walletConnectC && (
          <button
            disabled={isPending}
            onClick={() => connect({ connector: walletConnectC, chainId: filecoinCalibration.id })}
          >
            WalletConnect (Mobil)
          </button>
        )}
        {!injected && !walletConnectC && <span className="dim">Kein Connector verfügbar</span>}
        {error && <span className="dim">{(error as Error).message}</span>}
      </div>
    )
  }

  return (
    <div className="walletbar">
      <span className="addresspill" title={address}>{short(address)}</span>
      <span className={`badge ${supported ? 'ok' : 'err'}`}>
        {supported ? (chainId === filecoin.id ? 'Filecoin' : 'Calibration') : `Falsches Netz (ID ${chainId})`}
      </span>
      {balance && (
        <span className="addresspill">
          {Number(balance.formatted).toFixed(3)} FIL
        </span>
      )}
      {!supported && (
        <>
          <button className="small" onClick={() => switchChain({ chainId: filecoinCalibration.id })}>
            Zu Calibration
          </button>
          <button className="small" onClick={() => switchChain({ chainId: filecoin.id })}>
            Zu Mainnet
          </button>
        </>
      )}
      <button className="small" onClick={() => disconnect()}>Trennen</button>
    </div>
  )
}

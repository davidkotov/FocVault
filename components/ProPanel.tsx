'use client'

import { useState } from 'react'
import { useReadContract, useWriteContract } from 'wagmi'
import { formatUnits } from 'viem'
import { SUB_GATE_ADDRESS, USDFC_DECIMALS } from '@/lib/chains'
import { erc20Abi, subscriptionGateAbi } from '@/lib/abis'
import { TIERS } from '@/lib/vault'

interface Props {
  usdfc: `0x${string}` | undefined
  address: `0x${string}` | undefined
  isPro: boolean
  onSubscribed: () => void
  onError: (msg: string) => void
}

export default function ProPanel({ usdfc, address, isPro, onSubscribed, onError }: Props) {
  const [busy, setBusy] = useState(false)
  const { writeContractAsync } = useWriteContract()

  const enabled = !!SUB_GATE_ADDRESS && !!address

  const { data: price } = useReadContract({
    abi: subscriptionGateAbi,
    address: SUB_GATE_ADDRESS || undefined,
    functionName: 'pricePerMonth',
    query: { enabled }
  })

  const { data: expiry } = useReadContract({
    abi: subscriptionGateAbi,
    address: SUB_GATE_ADDRESS || undefined,
    functionName: 'expiresAt',
    args: address ? [address] : undefined,
    query: { enabled }
  })

  if (!enabled) {
    return (
      <div className="card">
        <h3>Tier</h3>
        <p className="dim">
          Pro-Tier ({TIERS.PRO.quotaLabel} Quota) benötigt den SubscriptionGate-Contract.
          Deploy-Adresse als <code>NEXT_PUBLIC_SUB_GATE_ADDRESS</code> setzen – siehe README.
        </p>
        <p className="dim" style={{ marginTop: 8 }}>
          Ab Release: {TIERS.PRO.priceChf} via Stripe (Family: {TIERS.FAMILY.priceChf}) – heute
          Testnet-USDFC über den Gate-Contract.
        </p>
      </div>
    )
  }

  const subscribe = async () => {
    if (!usdfc || !price) return
    setBusy(true)
    try {
      await writeContractAsync({
        abi: erc20Abi,
        address: usdfc,
        functionName: 'approve',
        args: [SUB_GATE_ADDRESS as `0x${string}`, price]
      })
      await writeContractAsync({
        abi: subscriptionGateAbi,
        address: SUB_GATE_ADDRESS as `0x${string}`,
        functionName: 'subscribe',
        args: [1n]
      })
      onSubscribed()
    } catch (e: any) {
      onError(e?.shortMessage ?? e?.message ?? 'Abo fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  const expiryDate =
    expiry && expiry > 0n ? new Date(Number(expiry) * 1000).toLocaleDateString('de-DE') : null

  return (
    <div className="card">
      <h3>
        Tier
        <span className={`badge ${isPro ? 'pro' : ''}`}>{isPro ? 'Pro' : 'Free'}</span>
      </h3>
      <div className="stat">
        <span className="k">Quota</span>
        <span className="v">{isPro ? TIERS.PRO.quotaLabel : TIERS.FREE.quotaLabel}</span>
      </div>
      {price !== undefined && (
        <div className="stat">
          <span className="k">Pro Preis (on-chain)</span>
          <span className="v">{formatUnits(price, USDFC_DECIMALS)} USDFC / Monat</span>
        </div>
      )}
      <div className="stat">
        <span className="k">Preis ab Release</span>
        <span className="v">{TIERS.PRO.priceChf} via Stripe</span>
      </div>
      {expiryDate && isPro && (
        <div className="stat">
          <span className="k">Pro bis</span>
          <span className="v">{expiryDate}</span>
        </div>
      )}
      <div className="row" style={{ marginTop: 14 }}>
        {!isPro ? (
          <button className="primary" disabled={busy || !usdfc || price === undefined} onClick={subscribe}>
            {busy ? 'Transaktionen laufen…' : 'Pro aktivieren (USDFC)'}
          </button>
        ) : (
          <button disabled={busy} onClick={subscribe}>
            {busy ? 'Verlängern…' : '1 Monat verlängern'}
          </button>
        )}
      </div>
      <p className="dim" style={{ marginTop: 10 }}>
        Zwei Txs: USDFC-Approval + subscribe(1) an den SubscriptionGate-Contract.
      </p>
    </div>
  )
}

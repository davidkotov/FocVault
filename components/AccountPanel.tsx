'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatUnits } from 'viem'
import type { WalletClient } from 'viem'
import { epochsToDays } from '@filoz/synapse-core/utils'
import { USDFC_DECIMALS } from '@/lib/chains'
import { getAccountSummary, getSynapse, withdrawAvailable, type AccountSummaryInfo } from '@/lib/synapse'

interface Props {
  walletClient: WalletClient | undefined
  refreshSignal: number
  onError: (msg: string) => void
}

function fmt(amount: bigint): string {
  return formatUnits(amount, USDFC_DECIMALS)
}

export default function AccountPanel({ walletClient, refreshSignal, onError }: Props) {
  const [summary, setSummary] = useState<AccountSummaryInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)

  const refresh = useCallback(async () => {
    if (!walletClient) return
    setLoading(true)
    try {
      const synapse = await getSynapse(walletClient)
      setSummary(await getAccountSummary(synapse))
    } catch (e: any) {
      onError(e?.shortMessage ?? e?.message ?? 'Konto-Abfrage fehlgeschlagen')
    } finally {
      setLoading(false)
    }
  }, [walletClient, onError])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshSignal])

  const withdraw = async () => {
    if (!walletClient) return
    setWithdrawing(true)
    try {
      const synapse = await getSynapse(walletClient)
      const hash = await withdrawAvailable(synapse)
      if (!hash) {
        onError('Kein abhebbares Guthaben (availableFunds = 0).')
      } else {
        await refresh()
      }
    } catch (e: any) {
      onError(e?.shortMessage ?? e?.message ?? 'Abhebung fehlgeschlagen')
    } finally {
      setWithdrawing(false)
    }
  }

  if (!walletClient) return null

  const MAX_UINT = (1n << 256n) - 1n
  const runwayDays = summary ? epochsToDays(summary.runwayInEpochs) : null
  const grossDays = summary ? epochsToDays(summary.grossCoverageInEpochs) : null
  const noActivity = !!summary && summary.funds === 0n && summary.lockupRatePerMonth === 0n
  const canWithdraw = !!summary && summary.availableFunds > 0n

  const runwayLabel = noActivity
    ? '– kein Storage aktiv'
    : runwayDays === null
      ? '–'
      : runwayDays >= MAX_UINT
        ? '∞'
        : runwayDays > 0n
          ? `${runwayDays} Tage`
          : 'Defizit – aufladen!'

  const grossLabel =
    noActivity || grossDays === null
      ? ''
      : ` (brutto ${grossDays >= MAX_UINT ? '∞' : `${grossDays} T.`})`

  return (
    <div className="card">
      <h3>
        FOC-Konto (USDFC)
        <button className="small" disabled={loading} onClick={() => void refresh()}>
          {loading ? 'Lädt…' : 'Aktualisieren'}
        </button>
      </h3>
      {!summary && <p className="dim">Noch keine Konto-Daten – erst nach dem ersten Deposit.</p>}
      {summary && (
        <>
          <div className="stat">
            <span className="k">Eingezahlt (funds)</span>
            <span className="v">{fmt(summary.funds)} USDFC</span>
          </div>
          <div className="stat">
            <span className="k">Abhebbar (available)</span>
            <span className="v">{fmt(summary.availableFunds)} USDFC</span>
          </div>
          <div className="stat">
            <span className="k">Lockup-Reserve</span>
            <span className="v">{fmt(summary.totalLockup)} USDFC</span>
          </div>
          <div className="stat">
            <span className="k">Laufende Rate</span>
            <span className="v">{fmt(summary.lockupRatePerMonth)} USDFC / Monat</span>
          </div>
          <div className="stat">
            <span className="k">Runway</span>
            <span className="v">
              {runwayLabel}
              {grossLabel}
            </span>
          </div>
        </>
      )}
      {summary && noActivity && (
        <p className="dim" style={{ marginTop: 10 }}>
          Noch nichts eingezahlt – passiert automatisch beim ersten Upload (prepare).
          Ohne aktiven Storage laufen keine Kosten.
        </p>
      )}
      <div className="row" style={{ marginTop: 14 }}>
        <button disabled={withdrawing || !canWithdraw} onClick={() => void withdraw()}>
          {withdrawing ? 'Tx läuft…' : 'Unlocked Guthaben abheben'}
        </button>
      </div>
      <p className="dim" style={{ marginTop: 10 }}>
        Payment-Rails zahlen pro Epoch (30 s) an die Provider. Lockup-Anteile sind aktiv gebunden
        und werden erst nach Rail-Ende frei.
      </p>
    </div>
  )
}

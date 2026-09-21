'use client'

import { useState } from 'react'
import { formatUnits, parseUnits } from 'viem'
import type { WalletClient } from 'viem'
import { USDFC_DECIMALS } from '@/lib/chains'
import { getSynapse } from '@/lib/synapse'

interface Props {
  walletClient: WalletClient | undefined
  usdfcBalance: bigint | undefined
  onError: (msg: string) => void
  onDone: () => void
}

export default function TopUpPanel({ walletClient, usdfcBalance, onError, onDone }: Props) {
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)

  const deposit = async () => {
    if (!walletClient || !amount) return
    let value: bigint
    try {
      value = parseUnits(amount, USDFC_DECIMALS)
    } catch {
      onError('Ungültiger Betrag.')
      return
    }
    if (value <= 0n) {
      onError('Betrag muss größer als 0 sein.')
      return
    }
    if (usdfcBalance !== undefined && value > usdfcBalance) {
      onError('Nicht genug USDFC im Wallet – erst tauschen/minten (siehe unten).')
      return
    }
    setBusy(true)
    try {
      const synapse = await getSynapse(walletClient)
      await synapse.payments.depositWithPermit({ amount: value })
      setAmount('')
      onDone()
    } catch (e: any) {
      onError(e?.shortMessage ?? e?.message ?? 'Einzahlung fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  const maxAmount = usdfcBalance !== undefined ? formatUnits(usdfcBalance, USDFC_DECIMALS) : '0'

  return (
    <div className="card">
      <h3>Zahlung / Aufladen</h3>
      <div className="row" style={{ marginTop: 4 }}>
        <input
          style={{
            fontFamily: 'var(--mono)',
            fontWeight: 700,
            fontSize: 14,
            padding: '10px 12px',
            borderRadius: 10,
            border: '2px solid var(--border)',
            background: 'var(--card-soft)',
            color: 'var(--text)',
            width: 150
          }}
          placeholder="0.00"
          value={amount}
          inputMode="decimal"
          onChange={e => setAmount(e.target.value.replace(',', '.'))}
        />
        <span className="dim">USDFC</span>
        <button className="small" onClick={() => setAmount(maxAmount)}>Max</button>
        <button className="primary" disabled={busy || !walletClient || !amount} onClick={() => void deposit()}>
          {busy ? 'Tx läuft…' : 'Einzahlen (1 Tx)'}
        </button>
      </div>
      <p className="dim" style={{ marginTop: 10 }}>
        Einzahlung ins FOC-Konto per Permit – eine einzige Transaktion (kein Approve nötig).
        Wallet-USDFC: {usdfcBalance !== undefined ? maxAmount : '–'}
      </p>
      <div className="stat">
        <span className="k">FIL → USDFC</span>
        <span className="v">
          <a
            href="https://app.secured.finance"
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--accent)' }}
          >
            Secured Finance Swap ↗
          </a>
        </span>
      </div>
      <div className="stat">
        <span className="k">FIL beleihen (0% Zins)</span>
        <span className="v">
          <a
            href="https://app.usdfc.net"
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--accent)' }}
          >
            USDFC Trove ↗
          </a>
        </span>
      </div>
      <div className="stat">
        <span className="k">Andere Chain? (USDC, ETH …)</span>
        <span className="v">
          <a
            href="https://v2.app.squidrouter.com"
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--accent)' }}
          >
            Squid Router Bridge ↗
          </a>
        </span>
      </div>
      <div className="stat">
        <span className="k">Cross-Chain / Fiat</span>
        <span className="v" style={{ fontSize: 11 }}>
          In-App-Widget + Kreditkarte folgen in v0.4
        </span>
      </div>
    </div>
  )
}

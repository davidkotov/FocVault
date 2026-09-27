'use client'

import { Synapse } from '@filoz/synapse-sdk'
import { calibration, mainnet, type FilecoinChain } from '@filoz/synapse-core/chains'
import * as SessionKey from '@filoz/synapse-core/session-key'
import { createClient, createPublicClient, custom, http, parseUnits, publicActions, type Hash, type WalletClient } from 'viem'

/**
 * Aktionen mit der Betreiber-Wallet (MetaMask) im Admin-Bereich. Alles wird in der Wallet
 * bestätigt; der Server sieht davon nur die Ergebnisse auf der Chain.
 */
export type Network = 'mainnet' | 'calibration'

export const CHAIN_ID: Record<Network, number> = { mainnet: 314, calibration: 314159 }
const EPOCHS_PER_MONTH = 86400n
/** FWSS-Listenpreise (docs.filecoin.cloud, Stand 09/2026) */
export const FOC_USD_PER_TIB_MONTH_PER_COPY = 2.5
export const FOC_PROVING_USD_PER_DATASET_MONTH = 0.12

function chainOf(network: Network): FilecoinChain {
  return network === 'mainnet' ? mainnet : calibration
}

function clients(wallet: WalletClient, network: Network) {
  const address = wallet.account?.address
  if (!address) throw new Error('Wallet nicht verbunden.')
  if (wallet.chain?.id !== CHAIN_ID[network]) throw new Error('Bitte in der Wallet zuerst das richtige Netz wählen.')
  const chain = chainOf(network)
  const signer = createClient({ chain, transport: custom(wallet), account: address }).extend(publicActions)
  const reader = createPublicClient({ chain, transport: http() })
  return { signer, reader, address }
}

async function confirmed(reader: ReturnType<typeof createPublicClient>, hash: Hash): Promise<Hash> {
  const r = await reader.waitForTransactionReceipt({ hash, timeout: 10 * 60_000 })
  if (r.status !== 'success') throw new Error('Transaktion fehlgeschlagen.')
  return hash
}

function synapseFor(wallet: WalletClient, network: Network) {
  const { signer, reader } = clients(wallet, network)
  return { synapse: new Synapse({ client: signer, readClient: reader, source: 'focvault' }), reader }
}

/** Freigabe-Grenzen aus einem Speicherbudget: so viel darf der Speicherdienst höchstens abbuchen. */
export function allowancesFor(budgetTib: number, copies: number) {
  const monthlyUsd = budgetTib * FOC_USD_PER_TIB_MONTH_PER_COPY * copies + FOC_PROVING_USD_PER_DATASET_MONTH * copies
  const perMonth = parseUnits(monthlyUsd.toFixed(6), 18)
  const rateAllowance = perMonth / EPOCHS_PER_MONTH + 1n
  // 30 Tage Reserve + Lifecycle-Reserve (~0.5 USDFC je Datensatz) + Luft für Gebühren
  const lockupAllowance = rateAllowance * EPOCHS_PER_MONTH + parseUnits(String(copies + 5), 18)
  return { monthlyUsd, rateAllowance, lockupAllowance, maxLockupPeriod: EPOCHS_PER_MONTH }
}

/** Erstes Einrichten: USDFC einzahlen und den Speicherdienst (FWSS) mit Grenzen freigeben – eine Transaktion. */
export async function depositAndApprove(wallet: WalletClient, network: Network, amountUsdfc: number, budgetTib: number, copies: number) {
  const { synapse, reader } = synapseFor(wallet, network)
  const a = allowancesFor(budgetTib, copies)
  const hash = await synapse.payments.depositWithPermitAndApproveOperator({
    amount: parseUnits(String(amountUsdfc), 18),
    rateAllowance: a.rateAllowance,
    lockupAllowance: a.lockupAllowance,
    maxLockupPeriod: a.maxLockupPeriod
  })
  return confirmed(reader, hash)
}

export async function deposit(wallet: WalletClient, network: Network, amountUsdfc: number) {
  const { synapse, reader } = synapseFor(wallet, network)
  return confirmed(reader, await synapse.payments.depositWithPermit({ amount: parseUnits(String(amountUsdfc), 18) }))
}

export async function withdraw(wallet: WalletClient, network: Network, amountUsdfc: number) {
  const { synapse, reader } = synapseFor(wallet, network)
  return confirmed(reader, await synapse.payments.withdraw({ amount: parseUnits(String(amountUsdfc), 18) }))
}

/** Server-Schlüssel befristet für Speicher-Aktionen freigeben (kein Zugriff auf Guthaben). */
export async function authorizeSessionKey(wallet: WalletClient, network: Network, sessionAddress: `0x${string}`, days: number) {
  const { signer, reader } = clients(wallet, network)
  const hash = await SessionKey.login(signer, {
    address: sessionAddress,
    permissions: SessionKey.DefaultFwssPermissions,
    expiresAt: BigInt(Math.floor(Date.now() / 1000) + days * 86400),
    origin: typeof window !== 'undefined' ? window.location.host : 'focvault'
  })
  return confirmed(reader, hash)
}

export async function revokeSessionKey(wallet: WalletClient, network: Network, sessionAddress: `0x${string}`) {
  const { signer, reader } = clients(wallet, network)
  const hash = await SessionKey.revoke(signer, { address: sessionAddress, permissions: SessionKey.DefaultFwssPermissions })
  return confirmed(reader, hash)
}

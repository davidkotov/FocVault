import { Synapse } from '@filoz/synapse-sdk'
import { calibration, mainnet, type FilecoinChain } from '@filoz/synapse-core/chains'
import { getAccountSummary, operatorApprovals } from '@filoz/synapse-core/pay'
import * as SessionKey from '@filoz/synapse-core/session-key'
import { createPublicClient, formatUnits, http, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { erc20Abi } from '../../lib/abis'
import type { Db } from '../db'
import { getFocSettings, getFocState, openSecret, sealSecret, updateFocState, type FocNetwork, type FocSettings } from './config'

export const EPOCHS_PER_DAY = 2880n

export function chainFor(network: FocNetwork): FilecoinChain {
  return network === 'mainnet' ? mainnet : calibration
}

function rpcUrl(network: FocNetwork): string | undefined {
  return (network === 'mainnet' ? process.env.FOC_RPC_MAINNET : process.env.FOC_RPC_CALIBRATION) || undefined
}

export function readClient(network: FocNetwork) {
  return createPublicClient({ chain: chainFor(network), transport: http(rpcUrl(network)) })
}

const usd = (v: bigint) => Number(formatUnits(v, 18))

/** Neuen Session-Key für ein Netz erzeugen (ersetzt einen alten; der alte verliert beim Neu-Autorisieren seinen Nutzen). */
export async function rotateSessionKey(db: Db, network: FocNetwork): Promise<string> {
  const pk = generatePrivateKey()
  const addr = privateKeyToAccount(pk).address
  await updateFocState(db, s => {
    s.sessionKeys[network] = { address: addr, enc: sealSecret(pk), createdAt: new Date().toISOString() }
  })
  return addr
}

export async function sessionKeyAddress(db: Db, network: FocNetwork): Promise<string | null> {
  return (await getFocState(db)).sessionKeys[network]?.address ?? null
}

async function sessionKeyFor(db: Db, s: FocSettings) {
  const entry = (await getFocState(db)).sessionKeys[s.network]
  if (!entry) throw new Error('Kein Server-Schlüssel erzeugt.')
  if (!s.payer) throw new Error('Keine zahlende Wallet hinterlegt.')
  const key = SessionKey.fromSecp256k1({
    privateKey: openSecret(entry.enc) as Hex,
    root: s.payer as Address,
    chain: chainFor(s.network),
    transport: http(rpcUrl(s.network))
  })
  await key.syncExpirations()
  return key
}

const g = globalThis as unknown as { __fvSynapse?: { key: string; synapse: Synapse; until: number } }

/** Synapse-Instanz, die mit dem Session-Key im Namen der Payer-Wallet signiert. */
export async function serverSynapse(db: Db, s: FocSettings): Promise<Synapse> {
  const state = await getFocState(db)
  const cacheKey = `${s.network}:${s.payer}:${state.sessionKeys[s.network]?.address}`
  if (g.__fvSynapse && g.__fvSynapse.key === cacheKey && g.__fvSynapse.until > Date.now()) return g.__fvSynapse.synapse
  const sessionKey = await sessionKeyFor(db, s)
  const synapse = Synapse.create({
    chain: chainFor(s.network),
    transport: http(rpcUrl(s.network)),
    account: s.payer as Address,
    sessionKey,
    withCDN: false,
    pieceBatching: false,
    source: 'focvault'
  })
  g.__fvSynapse = { key: cacheKey, synapse, until: Date.now() + 10 * 60_000 }
  return synapse
}

export interface FocChainStatus {
  network: FocNetwork
  payer: string
  wallet: { usdfc: number; fil: number } | null
  account: {
    funds: number
    available: number
    debt: number
    lockup: number
    perMonth: number
    runwayDays: number | null
    coverageDays: number | null
  } | null
  approval: { approved: boolean; rateAllowancePerMonth: number; lockupAllowance: number; maxLockupDays: number } | null
  sessionKey: { address: string; authorized: boolean; expiresAt: string | null } | null
  error: string | null
}

const INF = (1n << 255n)

function daysOf(epochs: bigint): number | null {
  if (epochs >= INF) return null
  return Number(epochs / EPOCHS_PER_DAY)
}

/** Live-Zustand von der Chain (nur lesen). */
export async function chainStatus(db: Db, s?: FocSettings): Promise<FocChainStatus> {
  const settings = s ?? (await getFocSettings(db))
  const entry = (await getFocState(db)).sessionKeys[settings.network]
  const base: FocChainStatus = {
    network: settings.network,
    payer: settings.payer,
    wallet: null,
    account: null,
    approval: null,
    sessionKey: entry ? { address: entry.address, authorized: false, expiresAt: null } : null,
    error: null
  }
  if (!settings.payer) return base
  const chain = chainFor(settings.network)
  const client = readClient(settings.network)
  const payer = settings.payer as Address
  try {
    const [usdfc, fil, summary, approval] = await Promise.all([
      client.readContract({ address: chain.contracts.usdfc.address, abi: erc20Abi, functionName: 'balanceOf', args: [payer] }),
      client.getBalance({ address: payer }),
      getAccountSummary(client, { address: payer }),
      operatorApprovals(client, { address: payer })
    ])
    base.wallet = { usdfc: usd(usdfc as bigint), fil: usd(fil) }
    base.account = {
      funds: usd(summary.funds),
      available: usd(summary.availableFunds),
      debt: usd(summary.debt),
      lockup: usd(summary.totalLockup),
      perMonth: usd(summary.lockupRatePerMonth),
      runwayDays: daysOf(summary.runwayInEpochs),
      coverageDays: daysOf(summary.grossCoverageInEpochs)
    }
    base.approval = {
      approved: approval.isApproved,
      rateAllowancePerMonth: usd(approval.rateAllowance * 86400n),
      lockupAllowance: usd(approval.lockupAllowance),
      maxLockupDays: Number(approval.maxLockupPeriod / EPOCHS_PER_DAY)
    }
    if (entry) {
      const key = SessionKey.fromSecp256k1({
        privateKey: openSecret(entry.enc) as Hex,
        root: payer,
        chain,
        transport: http(rpcUrl(settings.network))
      })
      await key.syncExpirations()
      const now = BigInt(Math.floor(Date.now() / 1000))
      const expiries = SessionKey.DefaultFwssPermissions.map(p => key.expirations[p] ?? 0n)
      const min = expiries.reduce((a, b) => (b < a ? b : a), expiries[0] ?? 0n)
      base.sessionKey = {
        address: entry.address,
        authorized: min > now,
        expiresAt: min > 0n ? new Date(Number(min) * 1000).toISOString() : null
      }
    }
  } catch (e) {
    base.error = `Chain nicht lesbar: ${(e as Error).message.split('\n')[0].slice(0, 200)}`
  }
  return base
}

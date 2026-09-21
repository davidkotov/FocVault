import { Synapse, calibration, mainnet } from '@filoz/synapse-sdk'
import { createClient, custom, http, publicActions } from 'viem'
import type { WalletClient } from 'viem'

type AnySynapse = any

type Bytes = Uint8Array<ArrayBuffer>

const READ_RPC_MAINNET = 'https://api.node.glif.io/rpc/v1'
const READ_RPC_CALIBRATION = 'https://api.calibration.node.glif.io/rpc/v1'

let cached: { key: string; synapse: AnySynapse } | null = null

export async function getSynapse(walletClient: WalletClient): Promise<AnySynapse> {
  const address = walletClient.account?.address
  const chainId = walletClient.chain?.id
  if (!address) throw new Error('Wallet nicht verbunden')
  const key = `${address}:${chainId}`
  if (cached && cached.key === key) return cached.synapse

  const chain = chainId === 314 ? mainnet : calibration
  const rpc = chainId === 314 ? READ_RPC_MAINNET : READ_RPC_CALIBRATION

  const signingClient = createClient({
    chain,
    transport: custom(walletClient as any),
    account: address
  }).extend(publicActions)

  const readClient = createClient({
    chain,
    transport: http(rpc)
  }).extend(publicActions)

  const synapse = new (Synapse as any)({
    client: signingClient,
    readClient,
    source: 'focvault',
    withCDN: false
  })

  try {
    synapse.payments._readClient = readClient
  } catch {
    void 0
  }

  cached = { key, synapse }
  return synapse
}

export interface PrepareResult {
  costs: {
    depositNeeded: bigint
    rates: { perMonth: bigint }
    ready: boolean
  }
  transaction: { execute: () => Promise<{ hash: string }> } | null
}

export async function prepareStorage(synapse: AnySynapse, byteSizes: number[]): Promise<PrepareResult> {
  return synapse.storage.prepare({ pieceSizes: byteSizes.map(n => BigInt(n)) })
}

export interface BatchUploadResult {
  pieceCids: string[]
  primaryTxHash?: string
  secondaryTxHash?: string
  secondaryComplete: boolean
}

export async function uploadPiecesBatched(
  synapse: AnySynapse,
  chunks: Bytes[],
  onStored?: (done: number, total: number) => void
): Promise<BatchUploadResult> {
  const contexts = await synapse.storage.createContexts({
    copies: 2,
    metadata: { Application: 'focvault', Version: '2' }
  })
  const primary = contexts[0]
  const secondary = contexts[1]

  const stored: Array<{ pieceCid: any; size: number }> = []
  for (let i = 0; i < chunks.length; i++) {
    const r = await primary.store(chunks[i])
    stored.push(r)
    onStored?.(i + 1, chunks.length)
  }
  const pieceCids: string[] = stored.map(s => s.pieceCid.toString())

  let secondaryTxHash: string | undefined
  let secondaryComplete = false
  if (secondary) {
    try {
      const extraData = await secondary.presignForCommit(pieceCids.map(cid => ({ pieceCid: cid })))
      const pullResult = await secondary.pull({
        pieces: pieceCids,
        from: (cid: string) => primary.getPieceUrl(cid),
        extraData
      })
      const okPieces =
        pullResult.status === 'complete'
          ? pieceCids.map(cid => ({ pieceCid: cid }))
          : pullResult.pieces
              .filter((p: any) => p.status === 'complete')
              .map((p: any) => ({ pieceCid: p.pieceCid.toString() }))
      if (okPieces.length > 0) {
        const commit = await secondary.commit({ pieces: okPieces, extraData })
        secondaryTxHash = commit.txHash
        secondaryComplete = okPieces.length === pieceCids.length
      }
    } catch {
      secondaryComplete = false
    }
  }

  const primaryCommit = await primary.commit({
    pieces: pieceCids.map(cid => ({ pieceCid: cid }))
  })

  return {
    pieceCids,
    primaryTxHash: primaryCommit.txHash,
    secondaryTxHash,
    secondaryComplete
  }
}

export async function downloadPiece(synapse: AnySynapse, pieceCid: string): Promise<Bytes> {
  const bytes = await synapse.storage.download({ pieceCid })
  if (bytes instanceof Uint8Array) return new Uint8Array(bytes)
  if (bytes instanceof ArrayBuffer) return new Uint8Array(new Uint8Array(bytes))
  if (bytes instanceof Blob) {
    const buf = await bytes.arrayBuffer()
    return new Uint8Array(new Uint8Array(buf))
  }
  if (Array.isArray(bytes)) return new Uint8Array(bytes)
  throw new Error('Unerwartetes Download-Format')
}

export interface AccountSummaryInfo {
  funds: bigint
  availableFunds: bigint
  debt: bigint
  lockupRatePerMonth: bigint
  totalLockup: bigint
  runwayInEpochs: bigint
  grossCoverageInEpochs: bigint
}

export async function getAccountSummary(synapse: AnySynapse): Promise<AccountSummaryInfo> {
  return synapse.payments.accountSummary()
}

export async function withdrawAvailable(synapse: AnySynapse): Promise<string | null> {
  const info = await synapse.payments.accountInfo()
  const amount = info?.availableFunds ?? 0n
  if (!amount || amount <= 0n) return null
  return synapse.payments.withdraw({ amount })
}

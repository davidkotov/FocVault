import { Synapse, calibration, mainnet } from '@filoz/synapse-sdk'
import { createClient, custom, http, publicActions } from 'viem'
import type { WalletClient } from 'viem'
import { defaultResolvers, resolvePieceUrl, tryFrom } from '@filoz/synapse-core/piece'

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
  try {
    ;(synapse as any)._readClient = readClient
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

export async function prepareStorage(
  synapse: AnySynapse,
  byteSizes: number[],
  contexts?: any[]
): Promise<PrepareResult> {
  return synapse.storage.prepare({
    pieceSizes: byteSizes.map(n => BigInt(n)),
    context: contexts
  })
}

export interface BatchUploadResult {
  pieceCids: string[]
  primaryTxHash?: string
  secondaryTxHash?: string
  secondaryComplete: boolean
}

/** Ein gespeichertes Piece: Rohbytes ODER Stream + erwartete Groesse. */
export interface PieceInput {
  data: any // Uint8Array | ReadableStream<Uint8Array>
  size?: number
}

export interface BatchUploadOptions {
  onStored?: (done: number, total: number) => void
  onPieceProgress?: (pieceIndex: number, bytesUploaded: number) => void
  peerSizes?: number[]
  signal?: AbortSignal
}

/**
 * Storage-Kosten-Optimierung: ein persistenter Datensatz pro Konto & Chain
 * statt eines neuen Datasets pro Upload/Session.
 *
 * FOC berechnet $0.12 / Dataset / Monat (flat) zzgl. Lifecycle-Reserve.
 * Das SDK cached zwar Contexts pro Session (createContexts ohne dataSetIds
 * wiederverwendet `_defaultContexts`), aber jede neue Session legte bisher
 * wieder 2 neue Datasets an. Mit `getVaultContexts()` werden die Dataset-IDs
 * in localStorage gemerkt und beim nächsten Upload über
 * `createContexts({ dataSetIds })` fortgesetzt (Owner/validiert vom SDK).
 * Enden/Verfallen Datasets, fällt der Resume fehl → sauberer Fallback auf
 * frische Contexts (alte Datasets verfallen automatisch, keine Doppel-Last).
 */
const CONTEXT_METADATA = { Application: 'focvault', Version: '2' }

function datasetKey(chainId: number | string, address: string): string {
  return `focvault:datasets:${chainId}:${address.toLowerCase()}`
}

function loadPersistedDatasetIds(chainId: number | string, address: string): string[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(datasetKey(chainId, address))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      parsed.every((x: unknown) => typeof x === 'string' && /^\d+$/.test(x))
    ) {
      return parsed
    }
  } catch {
    // unlesbar → frisch anlegen
  }
  return null
}

function clearPersistedDatasetIds(chainId: number | string, address: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(datasetKey(chainId, address))
}

function persistDatasetIds(
  chainId: number | string,
  address: string,
  ids: Array<bigint | number | string | null | undefined>
): void {
  if (typeof window === 'undefined') return
  const clean = ids.filter((id): id is bigint | number | string => id != null).map(id => id.toString())
  if (clean.length < 2) return
  window.localStorage.setItem(datasetKey(chainId, address), JSON.stringify(clean))
}

/** Contexts für Uploads holen: fortsetzen falls IDs vorhanden, sonst frisch anlegen. */
export async function getVaultContexts(synapse: AnySynapse, address: string): Promise<any[]> {
  const chainId = synapse.client.chain.id
  const persisted = loadPersistedDatasetIds(chainId, address)
  if (persisted) {
    try {
      return await synapse.storage.createContexts({
        copies: 2,
        dataSetIds: persisted,
        metadata: CONTEXT_METADATA
      })
    } catch {
      clearPersistedDatasetIds(chainId, address)
    }
  }
  return synapse.storage.createContexts({ copies: 2, metadata: CONTEXT_METADATA })
}

async function uploadPiecesImpl(
  synapse: AnySynapse,
  pieces: PieceInput[],
  options: BatchUploadOptions = {},
  contexts?: any[]
): Promise<BatchUploadResult> {
  const accountAddress = synapse.client.account.address
  const chainId = synapse.client.chain.id
  const active = contexts ?? (await getVaultContexts(synapse, accountAddress))
  const primary = active[0]
  const secondary = active[1]

  const stored: Array<{ pieceCid: any; size: number }> = []
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]
    const r = await primary.store(p.data, {
      signal: options.signal,
      onProgress: (bytes: number) => options.onPieceProgress?.(i, bytes)
    })
    stored.push(r)
    options.onStored?.(i + 1, pieces.length)
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

  // Dataset-IDs merken → nächste Uploads (auch nach Reload) laufen auf denselben
  // Datasets weiter statt neue anzulegen ($0.12/Monat pro Dataset sparen).
  persistDatasetIds(chainId, accountAddress, [primary.dataSetId, secondary ? secondary.dataSetId : null])

  return {
    pieceCids,
    primaryTxHash: primaryCommit.txHash,
    secondaryTxHash,
    secondaryComplete
  }
}

export async function uploadPiecesBatched(
  synapse: AnySynapse,
  chunks: Bytes[],
  onStored?: (done: number, total: number) => void,
  contexts?: any[]
): Promise<BatchUploadResult> {
  return uploadPiecesImpl(synapse, chunks.map(c => ({ data: c, size: c.byteLength })), { onStored }, contexts)
}

/** Streaming-Upload: verschluesselte Piece-Streams, mit Byte-Fortschritt und Abbrechen. */
export async function uploadPiecesStreamed(
  synapse: AnySynapse,
  pieces: PieceInput[],
  options: BatchUploadOptions = {},
  contexts?: any[]
): Promise<BatchUploadResult> {
  return uploadPiecesImpl(synapse, pieces, options, contexts)
}

export interface PieceDownloadInfo {
  url: string
}

/** Loest die Download-URL eines Pieces auf (Provider/Chain-Lookup via SDK-Resolver). */
export async function getPieceDownloadUrl(
  synapse: AnySynapse,
  pieceCid: string,
  signal?: AbortSignal
): Promise<string> {
  const readClient = (synapse as any)._readClient
  if (!readClient) throw new Error('Kein Read-Client verfügbar')
  const cid = tryFrom(pieceCid)
  if (!cid) throw new Error(`Ungültige PieceCID: ${pieceCid}`)
  const address = synapse.client.account.address
  const url = await resolvePieceUrl({
    client: readClient,
    address,
    pieceCid: cid,
    resolvers: defaultResolvers,
    signal
  })
  return url
}

/** Öffnet einen Piece als Web-Stream (RAM-frei, abbrechbar). */
export async function openPieceStream(
  synapse: AnySynapse,
  pieceCid: string,
  signal?: AbortSignal
): Promise<ReadableStream<Uint8Array>> {
  const url = await getPieceDownloadUrl(synapse, pieceCid, signal)
  const res = await fetch(url, { signal })
  if (!res.ok || !res.body) {
    throw new Error(`Piece-Download fehlgeschlagen (HTTP ${res.status})`)
  }
  return res.body as ReadableStream<Uint8Array>
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

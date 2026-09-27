import type { ChunkMeta } from './vault'
import { CHUNK_SIZE, decryptChunk, decryptPieceFrames, frameAad, framesForChunk, type Bytes } from './crypto'

/** Liefert Ciphertext-Pieces – als Stream (Frame-Formate) oder am Stück (Legacy). */
export interface PieceSource {
  openStream: (pieceCid: string) => Promise<ReadableStream<Uint8Array>>
  download: (pieceCid: string) => Promise<Bytes>
}

export interface EncryptedFileRef {
  /** Klartext-Größe der Datei */
  size: number
  chunks: ChunkMeta[]
  /** Pflicht für `frame2` (AAD-Bindung) */
  objectId?: string
  /** Klartext-Bytes pro Piece; Standard CHUNK_SIZE (Wallet-Modus) */
  pieceSize?: number
}

/**
 * Entschlüsselt alle Chunks einer Datei der Reihe nach in `sink`.
 * - `frame2`: Streaming-Frames mit AAD (Objekt + Piece-Index)
 * - `frame`:  Streaming-Frames ohne AAD (Wallet-Modus)
 * - Legacy:   ein AES-GCM pro Chunk, mit Padding
 */
export async function decryptChunksTo(
  file: EncryptedFileRef,
  fileKey: CryptoKey,
  source: PieceSource,
  sink: (plain: Uint8Array<ArrayBuffer>) => void | Promise<void>
): Promise<void> {
  const pieceSize = file.pieceSize ?? CHUNK_SIZE
  for (let i = 0; i < file.chunks.length; i++) {
    const chunk = file.chunks[i]
    if (chunk.fmt === 'frame' || chunk.fmt === 'frame2') {
      let aad: Bytes | undefined
      if (chunk.fmt === 'frame2') {
        if (!file.objectId) throw new Error('frame2-Chunk ohne Objekt-ID – Datensatz unvollständig')
        aad = frameAad(file.objectId, i)
      }
      const stream = await source.openStream(chunk.pieceCid)
      const frames = framesForChunk(file.size, i, file.chunks.length, pieceSize)
      await decryptPieceFrames(stream, fileKey, chunk.iv, frames, sink, aad)
    } else {
      const bytes = await source.download(chunk.pieceCid)
      await sink(await decryptChunk(bytes, chunk.iv, chunk.padLen, fileKey))
    }
  }
}

/** Wie decryptChunksTo, sammelt aber alle Teile im Speicher (kleine Dateien, Secure Send). */
export async function decryptSharedChunks(
  file: EncryptedFileRef,
  fileKey: CryptoKey,
  source: PieceSource
): Promise<Uint8Array<ArrayBuffer>[]> {
  const parts: Uint8Array<ArrayBuffer>[] = []
  await decryptChunksTo(file, fileKey, source, plain => {
    parts.push(plain)
  })
  return parts
}

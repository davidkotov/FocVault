import type { ChunkMeta } from './vault'
import { decryptChunk, decryptPieceFrames, framesForChunk, type Bytes } from './crypto'

/** Liefert Ciphertext-Pieces – als Stream (Frame-Format) oder am Stück (Legacy). */
export interface PieceSource {
  openStream: (pieceCid: string) => Promise<ReadableStream<Uint8Array>>
  download: (pieceCid: string) => Promise<Bytes>
}

/**
 * Entschlüsselt alle Chunks einer Datei. Frame-Chunks (`fmt: 'frame'`, Streaming-Upload)
 * und Legacy-Chunks (ein AES-GCM pro Chunk, mit Padding) werden getrennt behandelt.
 * `size` ist die Klartext-Größe der Datei.
 */
export async function decryptSharedChunks(
  file: { size: number; chunks: ChunkMeta[] },
  fileKey: CryptoKey,
  source: PieceSource
): Promise<Uint8Array<ArrayBuffer>[]> {
  const parts: Uint8Array<ArrayBuffer>[] = []
  for (let i = 0; i < file.chunks.length; i++) {
    const chunk = file.chunks[i]
    if (chunk.fmt === 'frame') {
      const stream = await source.openStream(chunk.pieceCid)
      const frames = framesForChunk(file.size, i, file.chunks.length)
      await decryptPieceFrames(stream, fileKey, chunk.iv, frames, plain => {
        parts.push(plain)
      })
    } else {
      const bytes = await source.download(chunk.pieceCid)
      parts.push(await decryptChunk(bytes, chunk.iv, chunk.padLen, fileKey))
    }
  }
  return parts
}

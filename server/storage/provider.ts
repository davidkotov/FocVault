/**
 * Storage-Abstraktion (ARCHITECTURE §5.6). Objekte sind immer Ciphertext; Keys sind opak
 * (`u/<account>/o/<object>/p/<index>`, `u/<account>/idx/<version>-<rand>`).
 */
export interface PresignedRequest {
  url: string
  method: 'PUT' | 'GET'
  headers?: Record<string, string>
  expiresAt: number
}

export interface StorageProvider {
  readonly kind: 'local' | 'filone' | 'memory'
  /** true = URLs zeigen direkt auf den Anbieter; false = über /api/v1/storage (Proxy). */
  readonly direct: boolean
  presignPut(key: string, size: number, ttlSec: number): Promise<PresignedRequest>
  presignGet(key: string, ttlSec: number): Promise<PresignedRequest>
  head(key: string): Promise<{ size: number } | null>
  delete(keys: string[]): Promise<void>
  putSmall(key: string, body: Uint8Array): Promise<void>
  getSmall(key: string): Promise<Uint8Array | null>
  /** Proxy-Pfad: Body exakt `size` Bytes schreiben (sonst UPLOAD_SIZE_MISMATCH). */
  writeStream(key: string, body: ReadableStream<Uint8Array>, size: number): Promise<void>
  readStream(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null>
}

/** Nur von uns erzeugte Keys sind gültig – keine Punkte, also kein Path-Traversal. */
export const STORAGE_KEY_RE = /^[a-z]{1,3}\/[0-9a-f-]{36}(\/[a-z]{1,4}\/[0-9a-z-]{1,64})+$/

export function objectPieceKey(accountId: string, objectId: string, index: number): string {
  return `u/${accountId}/o/${objectId}/p/${index}`
}

export function indexKey(accountId: string, version: number, rand: string): string {
  return `u/${accountId}/idx/${version}-${rand}`
}

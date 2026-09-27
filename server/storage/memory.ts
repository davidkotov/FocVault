import { ApiError } from '../shared/errors'
import { STORAGE_KEY_RE, type PresignedRequest, type StorageProvider } from './provider'

/** In-Memory-Provider für Unit-Tests. URLs sind Platzhalter (`memory://…`). */
export class MemoryProvider implements StorageProvider {
  readonly kind = 'memory' as const
  readonly direct = false
  readonly objects = new Map<string, Uint8Array>()

  private check(key: string): void {
    if (!STORAGE_KEY_RE.test(key)) throw new ApiError('BAD_REQUEST', 'Ungültiger Storage-Key.')
  }

  async presignPut(key: string, size: number, ttlSec: number): Promise<PresignedRequest> {
    this.check(key)
    return { url: `memory://put/${key}?len=${size}`, method: 'PUT', expiresAt: Date.now() + ttlSec * 1000 }
  }

  async presignGet(key: string, ttlSec: number): Promise<PresignedRequest> {
    this.check(key)
    return { url: `memory://get/${key}`, method: 'GET', expiresAt: Date.now() + ttlSec * 1000 }
  }

  async head(key: string): Promise<{ size: number } | null> {
    const o = this.objects.get(key)
    return o ? { size: o.byteLength } : null
  }

  async delete(keys: string[]): Promise<void> {
    for (const k of keys) this.objects.delete(k)
  }

  async putSmall(key: string, body: Uint8Array): Promise<void> {
    this.check(key)
    this.objects.set(key, new Uint8Array(body))
  }

  async getSmall(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key) ?? null
  }

  async writeStream(key: string, body: ReadableStream<Uint8Array>, size: number): Promise<void> {
    this.check(key)
    const bytes = new Uint8Array(await new Response(body).arrayBuffer())
    if (bytes.byteLength !== size) {
      throw new ApiError('UPLOAD_SIZE_MISMATCH', 'Upload unvollständig.', { expected: size, actual: bytes.byteLength })
    }
    this.objects.set(key, bytes)
  }

  async readStream(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null> {
    const o = this.objects.get(key)
    if (!o) return null
    return { body: new Blob([o as Uint8Array<ArrayBuffer>]).stream(), size: o.byteLength }
  }
}

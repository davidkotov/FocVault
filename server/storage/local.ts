import { createReadStream, createWriteStream, mkdirSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ApiError } from '../shared/errors'
import { STORAGE_KEY_RE, type PresignedRequest, type StorageProvider } from './provider'
import { signedStorageUrl } from './signing'

/**
 * Lokaler Datei-Provider für die Entwicklung. Verhält sich wie S3 mit Presigned URLs:
 * der Browser lädt über signierte, kurzlebige URLs auf /api/v1/storage hoch und herunter.
 */
export class LocalFsProvider implements StorageProvider {
  readonly kind = 'local' as const
  readonly direct = false
  private readonly root: string

  constructor(root: string) {
    this.root = path.resolve(root)
    mkdirSync(this.root, { recursive: true })
  }

  private file(key: string): string {
    if (!STORAGE_KEY_RE.test(key)) throw new ApiError('BAD_REQUEST', 'Ungültiger Storage-Key.')
    const p = path.resolve(this.root, key)
    if (!p.startsWith(this.root + path.sep)) throw new ApiError('BAD_REQUEST', 'Ungültiger Storage-Key.')
    return p
  }

  async presignPut(key: string, size: number, ttlSec: number): Promise<PresignedRequest> {
    this.file(key)
    const { url, expiresAt } = signedStorageUrl('put', key, ttlSec, size)
    return { url, method: 'PUT', expiresAt }
  }

  async presignGet(key: string, ttlSec: number): Promise<PresignedRequest> {
    this.file(key)
    const { url, expiresAt } = signedStorageUrl('get', key, ttlSec)
    return { url, method: 'GET', expiresAt }
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      const s = await stat(this.file(key))
      return { size: s.size }
    } catch (e: any) {
      if (e?.code === 'ENOENT') return null
      throw e
    }
  }

  async delete(keys: string[]): Promise<void> {
    await Promise.all(keys.map(k => rm(this.file(k), { force: true })))
  }

  async putSmall(key: string, body: Uint8Array): Promise<void> {
    const target = this.file(key)
    await mkdir(path.dirname(target), { recursive: true })
    const tmp = `${target}.${randomBytes(6).toString('hex')}.part`
    await writeFile(tmp, body)
    await rename(tmp, target)
  }

  async getSmall(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.file(key)))
    } catch (e: any) {
      if (e?.code === 'ENOENT') return null
      throw e
    }
  }

  async writeStream(key: string, body: ReadableStream<Uint8Array>, size: number): Promise<void> {
    const target = this.file(key)
    await mkdir(path.dirname(target), { recursive: true })
    const tmp = `${target}.${randomBytes(6).toString('hex')}.part`
    let written = 0
    const limiter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        written += chunk.length
        if (written > size) cb(new ApiError('UPLOAD_SIZE_MISMATCH', 'Mehr Daten als angekündigt.', { expected: size }))
        else cb(null, chunk)
      }
    })
    try {
      await pipeline(Readable.fromWeb(body as any), limiter, createWriteStream(tmp))
      if (written !== size) {
        throw new ApiError('UPLOAD_SIZE_MISMATCH', 'Upload unvollständig.', { expected: size, actual: written })
      }
      await rename(tmp, target)
    } catch (e) {
      await rm(tmp, { force: true })
      throw e
    }
  }

  async readStream(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null> {
    const p = this.file(key)
    try {
      const s = await stat(p)
      return { body: Readable.toWeb(createReadStream(p)) as unknown as ReadableStream<Uint8Array>, size: s.size }
    } catch (e: any) {
      if (e?.code === 'ENOENT') return null
      throw e
    }
  }
}

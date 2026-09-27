import { Readable } from 'node:stream'
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { ApiError } from '../shared/errors'
import { STORAGE_KEY_RE, type PresignedRequest, type StorageProvider } from './provider'
import { signedStorageUrl } from './signing'

export interface FilOneConfig {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** Browser lädt direkt zu Fil One (braucht CORS beim Anbieter – nicht dokumentiert). */
  browserDirect: boolean
}

function isNotFound(e: unknown): boolean {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } }
  return err?.name === 'NotFound' || err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404
}

/**
 * Fil One S3 (docs.fil.one, geprüft 27.09.2026):
 * - SigV4, Path-Style Pflicht, Region pro Bucket fest (eu-west-1 = Frankreich)
 * - Presigned GET/PUT unterstützt; ein Piece (≤ 32 MiB + Overhead) = ein PUT, kein Multipart
 * - „Additional-checksum operations are unreliable" → Flexible Checksums des SDK abgeschaltet
 * - keine Lifecycle-Regeln/Events → Aufräumen übernimmt unser Backend
 */
export class FilOneS3Provider implements StorageProvider {
  readonly kind = 'filone' as const
  readonly direct: boolean
  private readonly s3: S3Client
  private readonly bucket: string

  constructor(cfg: FilOneConfig) {
    this.direct = cfg.browserDirect
    this.bucket = cfg.bucket
    this.s3 = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: true,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      maxAttempts: 6,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED'
    })
  }

  private check(key: string): void {
    if (!STORAGE_KEY_RE.test(key)) throw new ApiError('BAD_REQUEST', 'Ungültiger Storage-Key.')
  }

  async presignPut(key: string, size: number, ttlSec: number): Promise<PresignedRequest> {
    this.check(key)
    if (!this.direct) {
      const { url, expiresAt } = signedStorageUrl('put', key, ttlSec, size)
      return { url, method: 'PUT', expiresAt }
    }
    const url = await getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentLength: size }),
      { expiresIn: ttlSec }
    )
    return { url, method: 'PUT', expiresAt: Date.now() + ttlSec * 1000 }
  }

  async presignGet(key: string, ttlSec: number): Promise<PresignedRequest> {
    this.check(key)
    if (!this.direct) {
      const { url, expiresAt } = signedStorageUrl('get', key, ttlSec)
      return { url, method: 'GET', expiresAt }
    }
    const url = await getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttlSec
    })
    return { url, method: 'GET', expiresAt: Date.now() + ttlSec * 1000 }
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      const r = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      return { size: Number(r.ContentLength ?? 0) }
    } catch (e) {
      if (isNotFound(e)) return null
      throw new ApiError('STORAGE_UNAVAILABLE', 'Fil One nicht erreichbar.')
    }
  }

  async delete(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000)
      await this.s3.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map(Key => ({ Key })), Quiet: true }
        })
      )
    }
  }

  async putSmall(key: string, body: Uint8Array): Promise<void> {
    this.check(key)
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentLength: body.byteLength })
    )
  }

  async getSmall(key: string): Promise<Uint8Array | null> {
    try {
      const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
      return r.Body ? await r.Body.transformToByteArray() : null
    } catch (e) {
      if (isNotFound(e)) return null
      throw new ApiError('STORAGE_UNAVAILABLE', 'Fil One nicht erreichbar.')
    }
  }

  async writeStream(key: string, body: ReadableStream<Uint8Array>, size: number): Promise<void> {
    this.check(key)
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: Readable.fromWeb(body as any),
          ContentLength: size
        })
      )
    } catch {
      throw new ApiError('STORAGE_UNAVAILABLE', 'Upload zu Fil One fehlgeschlagen.')
    }
  }

  async readStream(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null> {
    try {
      const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
      if (!r.Body) return null
      return {
        body: r.Body.transformToWebStream() as ReadableStream<Uint8Array>,
        size: Number(r.ContentLength ?? 0)
      }
    } catch (e) {
      if (isNotFound(e)) return null
      throw new ApiError('STORAGE_UNAVAILABLE', 'Fil One nicht erreichbar.')
    }
  }
}

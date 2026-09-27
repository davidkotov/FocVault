import { openAsBlob } from 'node:fs'
import { PassThrough } from 'node:stream'
import { api } from '@/features/api/client'
import { pieceSource, uploadFile } from '@/features/objects/transfer'
import { loadIndex, saveIndex, type IndexState } from '@/features/vault/sync'
import { unwrapFileKey } from '@/lib/crypto'
import { decryptChunksTo } from '@/lib/pieces'
import type { FileVersion, VaultEntry } from '@/lib/vault'
import { readConfig, writeConfig, type Session } from './core'
import type { S3Object, S3Store } from './s3'

const PREFIX = 'S3'

/**
 * S3-Buckets im FocVault-Tresor: jedes Objekt ist eine normale, Ende-zu-Ende-verschlüsselte Datei
 * („S3/<bucket>/<key>“, im Dashboard unter „Backups & Mehr“). Verschlüsselt wird hier auf dem
 * Gerät; der Server sieht nur Ciphertext. Der Index wird gebündelt gespeichert.
 */
export class VaultS3Store implements S3Store {
  private index!: IndexState
  private dirty = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly s: Session) {}

  async init(): Promise<void> {
    this.index = await loadIndex(this.s.masterKey, this.s.account.id)
  }

  /** Änderungen am Index nacheinander ausführen (kein Wettlauf bei parallelen Uploads). */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn)
    this.chain = p.catch(() => undefined)
    return p
  }

  private scheduleFlush() {
    this.dirty = true
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush().catch(e => console.error('[s3] Tresor-Index nicht gespeichert:', (e as Error).message))
    }, 1500)
  }

  flush(): Promise<void> {
    return this.serial(async () => {
      if (!this.dirty) return
      this.dirty = false
      this.index = await saveIndex(this.s.masterKey, this.s.account.id, this.index, this.index.container)
    })
  }

  private entries(bucket: string): VaultEntry[] {
    const p = `${PREFIX}/${bucket}/`
    return this.index.container.files.filter(f => f.objectId && f.name.startsWith(p))
  }

  private find(bucket: string, key: string): VaultEntry | undefined {
    const name = `${PREFIX}/${bucket}/${key}`
    return this.index.container.files.find(f => f.objectId && f.name === name)
  }

  private meta(bucket: string, e: VaultEntry): S3Object {
    return {
      key: e.name.slice(`${PREFIX}/${bucket}/`.length),
      size: e.size,
      etag: e.etag ?? e.objectId!.replace(/-/g, ''),
      lastModified: new Date(e.storedAt),
      contentType: e.type
    }
  }

  private async bucketNames(): Promise<string[]> {
    const c = await readConfig()
    const fromIndex = this.index.container.files
      .filter(f => f.name.startsWith(`${PREFIX}/`))
      .map(f => f.name.split('/')[1])
      .filter(Boolean)
    return [...new Set([...(c?.s3Buckets ?? []), ...fromIndex])].sort()
  }

  async listBuckets() {
    return (await this.bucketNames()).map(name => ({ name, created: new Date(0) }))
  }

  async createBucket(name: string) {
    const c = await readConfig()
    if (!c) return
    if (!(c.s3Buckets ?? []).includes(name)) await writeConfig({ ...c, s3Buckets: [...(c.s3Buckets ?? []), name] })
  }

  async deleteBucket(name: string) {
    const c = await readConfig()
    if (c) await writeConfig({ ...c, s3Buckets: (c.s3Buckets ?? []).filter(b => b !== name) })
  }

  async list(bucket: string) {
    const names = await this.bucketNames()
    if (!names.includes(bucket)) return null
    return this.entries(bucket).map(e => this.meta(bucket, e))
  }

  async head(bucket: string, key: string) {
    const e = this.find(bucket, key)
    return e ? this.meta(bucket, e) : null
  }

  async read(bucket: string, key: string) {
    const e = this.find(bucket, key)
    if (!e) return null
    const fileKey = await unwrapFileKey({ wrapped: e.wrappedKey, iv: e.wrapIv }, this.s.masterKey)
    const source = await pieceSource(e)
    const out = new PassThrough({ highWaterMark: 4 * 1024 * 1024 })
    void decryptChunksTo(e, fileKey, source, async plain => {
      if (!out.write(plain)) await new Promise<void>(r => out.once('drain', () => r()))
    }).then(
      () => out.end(),
      err => out.destroy(err as Error)
    )
    return { meta: this.meta(bucket, e), body: out as AsyncIterable<Uint8Array> }
  }

  async put(bucket: string, key: string, file: string, meta: { size: number; etag: string; contentType: string }) {
    await this.createBucket(bucket)
    const blob = await openAsBlob(file, { type: meta.contentType })
    const entry = await uploadFile(new File([blob], `${PREFIX}/${bucket}/${key}`, { type: meta.contentType }), this.s.masterKey)
    entry.folder = 'backups'
    entry.etag = meta.etag
    await this.serial(async () => {
      const prev = this.find(bucket, key)
      let versions: FileVersion[] | undefined
      if (prev?.objectId && this.s.account.plan !== 'free') {
        try {
          await api.keepVersion(prev.objectId)
          const { versions: older, ...p } = prev
          versions = [
            { objectId: p.objectId!, size: p.size, type: p.type, wrappedKey: p.wrappedKey, wrapIv: p.wrapIv, chunks: p.chunks, pieceSize: p.pieceSize, storedAt: p.storedAt },
            ...(older ?? [])
          ].slice(0, 10)
        } catch {
          versions = undefined
        }
      } else if (prev?.objectId) {
        await api.deleteObject(prev.objectId).catch(() => undefined)
      }
      const next = versions ? { ...entry, versions } : entry
      const c = this.index.container
      this.index = { ...this.index, container: { ...c, files: [next, ...c.files.filter(f => f.id !== prev?.id && f.id !== next.id)] } }
    })
    this.scheduleFlush()
  }

  async delete(bucket: string, key: string) {
    await this.serial(async () => {
      const e = this.find(bucket, key)
      if (!e) return
      for (const id of [e.objectId, ...(e.versions ?? []).map(v => v.objectId)]) if (id) await api.deleteObject(id).catch(() => undefined)
      const c = this.index.container
      this.index = { ...this.index, container: { ...c, files: c.files.filter(f => f.id !== e.id) } }
    })
    this.scheduleFlush()
  }
}

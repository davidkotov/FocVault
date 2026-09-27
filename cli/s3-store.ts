import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream, openAsBlob } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { api } from '@/features/api/client'
import { pieceSource, uploadFile } from '@/features/objects/transfer'
import { loadIndex, saveIndex, type IndexState } from '@/features/vault/sync'
import { unwrapFileKey } from '@/lib/crypto'
import { decryptChunksTo } from '@/lib/pieces'
import type { FileVersion, VaultEntry } from '@/lib/vault'
import { readConfig, writeConfig, type Session } from './core'
import { S3Error, type Retention, type S3Object, type S3Store } from '../server/s3/protocol'

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

  private readonly uploads = new Map<string, { bucket: string; key: string; dir: string; contentType: string; parts: Map<number, { file: string; md5: string; size: number }> }>()

  constructor(private readonly s: Session) {}

  /** Strom in eine Temp-Datei (für die Verschlüsselung auf dem Gerät), MD5 als ETag. */
  private async spool(body: AsyncIterable<Buffer>, dir: string): Promise<{ file: string; md5: string; size: number }> {
    const file = path.join(dir, randomBytes(8).toString('hex'))
    const md5 = createHash('md5')
    const ws = createWriteStream(file)
    let size = 0
    for await (const c of body) {
      md5.update(c)
      size += c.length
      if (!ws.write(c)) await new Promise<void>(r => ws.once('drain', () => r()))
    }
    await new Promise<void>((r, j) => ws.end((e?: Error | null) => (e ? j(e) : r())))
    return { file, md5: md5.digest('hex'), size }
  }

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

  async bucketInfo(name: string) {
    return (await this.bucketNames()).includes(name) ? { objectLock: false, defaultRetention: null } : null
  }

  async createBucket(name: string, _opts?: { objectLock: boolean }) {
    const c = await readConfig()
    if (!c) return
    if (!(c.s3Buckets ?? []).includes(name)) await writeConfig({ ...c, s3Buckets: [...(c.s3Buckets ?? []), name] })
  }

  async deleteBucket(name: string) {
    const c = await readConfig()
    if (c) await writeConfig({ ...c, s3Buckets: (c.s3Buckets ?? []).filter(b => b !== name) })
  }

  async list(bucket: string, prefix: string, after: string, limit: number) {
    return this.entries(bucket)
      .map(e => this.meta(bucket, e))
      .filter(o => o.key.startsWith(prefix) && o.key > after)
      .sort((a, b) => (a.key < b.key ? -1 : 1))
      .slice(0, limit)
  }

  async head(bucket: string, key: string) {
    const e = this.find(bucket, key)
    return e ? this.meta(bucket, e) : null
  }

  async read(bucket: string, key: string, range?: { start: number; end: number }) {
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
    if (!range) return { meta: this.meta(bucket, e), body: out as AsyncIterable<Uint8Array> }
    const { start, end } = range
    const sliced = (async function* () {
      let pos = 0
      for await (const c of out as AsyncIterable<Uint8Array>) {
        const s = Math.max(start - pos, 0)
        const t = Math.min(end + 1 - pos, c.length)
        if (t > s) yield c.subarray(s, t)
        pos += c.length
        if (pos > end) {
          out.destroy()
          return
        }
      }
    })()
    return { meta: this.meta(bucket, e), body: sliced }
  }

  async put(bucket: string, key: string, body: AsyncIterable<Buffer>, meta: { size: number; contentType: string; retention: Retention | null }) {
    const dir = await mkdtemp(path.join(tmpdir(), 'focvault-s3-'))
    try {
      const f = await this.spool(body, dir)
      await this.putFile(bucket, key, f.file, { etag: f.md5, contentType: meta.contentType })
      return { etag: f.md5 }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  async mpCreate(bucket: string, key: string, meta: { contentType: string }) {
    const id = randomBytes(16).toString('base64url')
    this.uploads.set(id, { bucket, key, dir: await mkdtemp(path.join(tmpdir(), 'focvault-mp-')), contentType: meta.contentType, parts: new Map() })
    return id
  }

  async mpPart(uploadId: string, bucket: string, key: string, part: number, body: AsyncIterable<Buffer>) {
    const u = this.uploads.get(uploadId)
    if (!u || u.bucket !== bucket || u.key !== key) throw new S3Error(404, 'NoSuchUpload', 'Upload unbekannt.')
    const f = await this.spool(body, u.dir)
    const prev = u.parts.get(part)
    if (prev) await rm(prev.file, { force: true })
    u.parts.set(part, f)
    return { etag: f.md5 }
  }

  async mpComplete(uploadId: string, bucket: string, key: string, parts: Array<{ part: number }>) {
    const u = this.uploads.get(uploadId)
    if (!u || u.bucket !== bucket || u.key !== key) throw new S3Error(404, 'NoSuchUpload', 'Upload unbekannt.')
    if (parts.some(p => !u.parts.has(p.part))) throw new S3Error(400, 'InvalidPart', 'Teil fehlt.')
    try {
      const file = path.join(u.dir, 'complete')
      const ws = createWriteStream(file)
      for (const p of parts) for await (const c of createReadStream(u.parts.get(p.part)!.file)) if (!ws.write(c)) await new Promise<void>(r => ws.once('drain', () => r()))
      await new Promise<void>((r, j) => ws.end((e?: Error | null) => (e ? j(e) : r())))
      const md5s = Buffer.concat(parts.map(p => Buffer.from(u.parts.get(p.part)!.md5, 'hex')))
      const etag = `${createHash('md5').update(md5s).digest('hex')}-${parts.length}`
      await this.putFile(bucket, key, file, { etag, contentType: u.contentType })
      return { etag }
    } finally {
      this.uploads.delete(uploadId)
      await rm(u.dir, { recursive: true, force: true })
    }
  }

  async mpAbort(uploadId: string) {
    const u = this.uploads.get(uploadId)
    this.uploads.delete(uploadId)
    if (u) await rm(u.dir, { recursive: true, force: true })
  }

  private async putFile(bucket: string, key: string, file: string, meta: { etag: string; contentType: string }) {
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

  async delete(bucket: string, key: string, _opts?: { bypassGovernance: boolean }) {
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

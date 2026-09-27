import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SigV4Error, verifySigV4 } from './sigv4'

/**
 * Lokales S3-Gateway: spricht das S3-Protokoll (Pfad-Stil, SigV4) mit Programmen auf diesem Gerät
 * und speichert über einen `S3Store` – im Betrieb der FocVault-Tresor, der jede Datei vor dem
 * Hochladen lokal verschlüsselt. Unterstützt: Buckets, List (v1/v2, Präfix/Trennzeichen,
 * Seiten), Put/Get (Range)/Head/Delete, Multi-Delete, Copy, Multipart-Upload.
 */
export interface S3Object {
  key: string
  size: number
  etag: string
  lastModified: Date
  contentType?: string
}

export interface S3Store {
  listBuckets(): Promise<Array<{ name: string; created: Date }>>
  createBucket(name: string): Promise<void>
  deleteBucket(name: string): Promise<void>
  list(bucket: string): Promise<S3Object[] | null>
  head(bucket: string, key: string): Promise<S3Object | null>
  read(bucket: string, key: string): Promise<{ meta: S3Object; body: AsyncIterable<Uint8Array> } | null>
  /** Datei liegt unverschlüsselt in einer Temp-Datei; der Store verschlüsselt und lädt hoch */
  put(bucket: string, key: string, file: string, meta: { size: number; etag: string; contentType: string }): Promise<void>
  delete(bucket: string, key: string): Promise<void>
}

export interface GatewayOptions {
  store: S3Store
  accessKey: string
  secretKey: string
  host?: string
  port?: number
  region?: string
}

const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/
const xmlEsc = (s: string) => s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!)
const XMLNS = 'http://s3.amazonaws.com/doc/2006-03-01/'

class S3Error extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

function sendXml(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}) {
  const buf = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`)
  res.writeHead(status, { 'Content-Type': 'application/xml', 'Content-Length': String(buf.length), ...headers })
  res.end(buf)
}

function sendError(res: ServerResponse, e: S3Error, resource: string) {
  if (res.headersSent) return res.destroy()
  sendXml(
    res,
    e.status,
    `<Error><Code>${e.code}</Code><Message>${xmlEsc(e.message)}</Message><Resource>${xmlEsc(resource)}</Resource><RequestId>${randomBytes(8).toString('hex')}</RequestId></Error>`
  )
}

/** Entpackt `aws-chunked` (Streaming-Uploads der AWS-SDKs), Chunk-Signaturen/Trailer werden übersprungen. */
async function* decodeAwsChunked(src: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
  let buf: Buffer = Buffer.alloc(0)
  let need = -1 // Bytes im aktuellen Chunk
  for await (const part of src) {
    buf = buf.length ? Buffer.concat([buf, part]) : part
    for (;;) {
      if (need < 0) {
        const nl = buf.indexOf('\r\n')
        if (nl < 0) break
        const size = parseInt(buf.subarray(0, nl).toString('latin1').split(';')[0], 16)
        if (!Number.isFinite(size)) throw new S3Error(400, 'IncompleteBody', 'Ungültige aws-chunked-Daten.')
        buf = buf.subarray(nl + 2)
        if (size === 0) return // Trailer folgen – für uns ohne Belang
        need = size
      }
      if (buf.length < need + 2) break
      yield buf.subarray(0, need)
      buf = buf.subarray(need + 2)
      need = -1
    }
  }
}

async function* requestBody(req: IncomingMessage): AsyncGenerator<Buffer> {
  for await (const c of req) yield c as Buffer
}

/** Body in eine Temp-Datei schreiben, dabei MD5 (ETag) und SHA-256 (Signatur) berechnen. */
async function spool(req: IncomingMessage, dir: string, payloadHash: string): Promise<{ file: string; size: number; md5: string }> {
  const file = path.join(dir, randomBytes(8).toString('hex'))
  const md5 = createHash('md5')
  const sha = createHash('sha256')
  const chunked = payloadHash.startsWith('STREAMING-') || /aws-chunked/.test(String(req.headers['content-encoding'] ?? ''))
  const ws = createWriteStream(file)
  let size = 0
  for await (const c of chunked ? decodeAwsChunked(requestBody(req)) : requestBody(req)) {
    md5.update(c)
    if (!chunked) sha.update(c)
    size += c.length
    if (!ws.write(c)) await new Promise<void>(r => ws.once('drain', () => r()))
  }
  await new Promise<void>((r, j) => ws.end((e?: Error | null) => (e ? j(e) : r())))
  if (!chunked && /^[0-9a-f]{64}$/.test(payloadHash) && sha.digest('hex') !== payloadHash) {
    await rm(file, { force: true })
    throw new S3Error(400, 'XAmzContentSHA256Mismatch', 'Inhalt passt nicht zur Signatur.')
  }
  const declared = req.headers['x-amz-decoded-content-length']
  if (declared && Number(declared) !== size) {
    await rm(file, { force: true })
    throw new S3Error(400, 'IncompleteBody', 'Inhalt unvollständig.')
  }
  return { file, size, md5: md5.digest('hex') }
}

async function readSmall(req: IncomingMessage, payloadHash: string, max = 1 << 20): Promise<string> {
  const parts: Buffer[] = []
  let n = 0
  const chunked = payloadHash.startsWith('STREAMING-')
  for await (const c of chunked ? decodeAwsChunked(requestBody(req)) : requestBody(req)) {
    n += c.length
    if (n > max) throw new S3Error(400, 'MaxMessageLengthExceeded', 'Anfrage zu groß.')
    parts.push(c)
  }
  return Buffer.concat(parts).toString('utf8')
}

async function* sliceStream(body: AsyncIterable<Uint8Array>, start: number, end: number): AsyncGenerator<Uint8Array> {
  let pos = 0
  for await (const c of body) {
    const s = Math.max(start - pos, 0)
    const e = Math.min(end + 1 - pos, c.length)
    if (e > s) yield c.subarray(s, e)
    pos += c.length
    if (pos > end) return
  }
}

interface Multipart {
  bucket: string
  key: string
  dir: string
  contentType: string
  parts: Map<number, { file: string; size: number; md5: string }>
}

export function startS3Gateway(opts: GatewayOptions): Promise<{ server: Server; url: string; close: () => Promise<void> }> {
  const { store } = opts
  const host = opts.host ?? '127.0.0.1'
  const uploads = new Map<string, Multipart>()
  let tmpRoot = ''

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/'
    const method = req.method ?? 'GET'
    const { payloadHash } = verifySigV4({ method, url, headers: req.headers }, ak => (ak === opts.accessKey ? opts.secretKey : null))
    const u = new URL(url, 'http://gateway')
    const q = u.searchParams
    // Pfad-Stil: /bucket/key…; alternativ Host-Stil bucket.localhost
    const hostBucket = /^([a-z0-9.-]+)\.(localhost|127\.0\.0\.1)(:\d+)?$/.exec(String(req.headers.host ?? ''))?.[1]
    const segs = u.pathname.split('/').slice(1)
    const bucket = hostBucket ?? decodeURIComponent(segs.shift() ?? '')
    const key = decodeURIComponent((hostBucket ? u.pathname.slice(1) : segs.join('/')) ?? '')

    if (!bucket) {
      if (method !== 'GET') throw new S3Error(405, 'MethodNotAllowed', 'Nicht unterstützt.')
      const buckets = await store.listBuckets()
      return sendXml(
        res,
        200,
        `<ListAllMyBucketsResult xmlns="${XMLNS}"><Owner><ID>focvault</ID><DisplayName>FocVault</DisplayName></Owner><Buckets>${buckets
          .map(b => `<Bucket><Name>${xmlEsc(b.name)}</Name><CreationDate>${b.created.toISOString()}</CreationDate></Bucket>`)
          .join('')}</Buckets></ListAllMyBucketsResult>`
      )
    }
    if (!BUCKET_RE.test(bucket)) throw new S3Error(400, 'InvalidBucketName', 'Ungültiger Bucket-Name.')

    // ---------- Bucket-Ebene ----------
    if (!key) {
      if (method === 'PUT') {
        await store.createBucket(bucket)
        res.writeHead(200, { Location: `/${bucket}` }).end()
        return
      }
      if (method === 'DELETE') {
        const objs = await store.list(bucket)
        if (objs === null) throw new S3Error(404, 'NoSuchBucket', 'Bucket existiert nicht.')
        if (objs.length) throw new S3Error(409, 'BucketNotEmpty', 'Bucket ist nicht leer.')
        await store.deleteBucket(bucket)
        res.writeHead(204).end()
        return
      }
      if (method === 'POST' && q.has('delete')) {
        const body = await readSmall(req, payloadHash)
        const keys = [...body.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map(m =>
          m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
        )
        const quiet = /<Quiet>true<\/Quiet>/i.test(body)
        for (const k of keys) await store.delete(bucket, k)
        return sendXml(
          res,
          200,
          `<DeleteResult xmlns="${XMLNS}">${quiet ? '' : keys.map(k => `<Deleted><Key>${xmlEsc(k)}</Key></Deleted>`).join('')}</DeleteResult>`
        )
      }
      const objs = await store.list(bucket)
      if (objs === null) throw new S3Error(404, 'NoSuchBucket', 'Bucket existiert nicht.')
      if (method === 'HEAD') {
        res.writeHead(200, { 'x-amz-bucket-region': opts.region ?? 'us-east-1' }).end()
        return
      }
      if (method !== 'GET') throw new S3Error(405, 'MethodNotAllowed', 'Nicht unterstützt.')
      if (q.has('location')) return sendXml(res, 200, `<LocationConstraint xmlns="${XMLNS}"></LocationConstraint>`)
      if (q.has('versioning')) return sendXml(res, 200, `<VersioningConfiguration xmlns="${XMLNS}"/>`)
      if (q.has('uploads')) return sendXml(res, 200, `<ListMultipartUploadsResult xmlns="${XMLNS}"><Bucket>${xmlEsc(bucket)}</Bucket></ListMultipartUploadsResult>`)

      const v2 = q.get('list-type') === '2'
      const prefix = q.get('prefix') ?? ''
      const delimiter = q.get('delimiter') ?? ''
      const max = Math.min(Math.max(Number(q.get('max-keys') ?? 1000) || 1000, 1), 1000)
      const after = v2 ? (q.get('continuation-token') ? Buffer.from(q.get('continuation-token')!, 'base64url').toString() : (q.get('start-after') ?? '')) : (q.get('marker') ?? '')
      const sorted = objs.filter(o => o.key.startsWith(prefix)).sort((a, b) => (a.key < b.key ? -1 : 1))
      const contents: S3Object[] = []
      const prefixes = new Set<string>()
      let truncated = false
      let last = ''
      for (const o of sorted) {
        if (o.key <= after) continue
        let entry: string | null = null
        if (delimiter) {
          const i = o.key.indexOf(delimiter, prefix.length)
          if (i >= 0) entry = o.key.slice(0, i + delimiter.length)
        }
        if (entry && prefixes.has(entry)) continue
        if (contents.length + prefixes.size >= max) {
          truncated = true
          break
        }
        if (entry) {
          prefixes.add(entry)
          last = entry
        } else {
          contents.push(o)
          last = o.key
        }
      }
      // Weiter nach einem Präfix: alles darunter überspringen
      const nextKey = truncated ? (last.endsWith(delimiter) && delimiter ? last + '\uffff' : last) : ''
      const items = contents
        .map(
          o =>
            `<Contents><Key>${xmlEsc(o.key)}</Key><LastModified>${o.lastModified.toISOString()}</LastModified><ETag>&quot;${o.etag}&quot;</ETag><Size>${o.size}</Size><StorageClass>STANDARD</StorageClass></Contents>`
        )
        .join('')
      const common = [...prefixes].map(p => `<CommonPrefixes><Prefix>${xmlEsc(p)}</Prefix></CommonPrefixes>`).join('')
      const head = `<Name>${xmlEsc(bucket)}</Name><Prefix>${xmlEsc(prefix)}</Prefix>${delimiter ? `<Delimiter>${xmlEsc(delimiter)}</Delimiter>` : ''}<MaxKeys>${max}</MaxKeys><IsTruncated>${truncated}</IsTruncated>`
      const tail = v2
        ? `<KeyCount>${contents.length + prefixes.size}</KeyCount>${q.get('continuation-token') ? `<ContinuationToken>${xmlEsc(q.get('continuation-token')!)}</ContinuationToken>` : ''}${truncated ? `<NextContinuationToken>${Buffer.from(nextKey).toString('base64url')}</NextContinuationToken>` : ''}`
        : `<Marker>${xmlEsc(after)}</Marker>${truncated ? `<NextMarker>${xmlEsc(nextKey)}</NextMarker>` : ''}`
      return sendXml(res, 200, `<ListBucketResult xmlns="${XMLNS}">${head}${tail}${items}${common}</ListBucketResult>`)
    }

    // ---------- Objekt-Ebene ----------
    if ((await store.list(bucket)) === null && !(method === 'PUT' && !q.has('uploadId'))) {
      throw new S3Error(404, 'NoSuchBucket', 'Bucket existiert nicht.')
    }

    if (method === 'POST' && q.has('uploads')) {
      const id = randomBytes(16).toString('base64url')
      uploads.set(id, {
        bucket,
        key,
        dir: await mkdtemp(path.join(tmpRoot, 'mp-')),
        contentType: String(req.headers['content-type'] ?? 'application/octet-stream'),
        parts: new Map()
      })
      return sendXml(
        res,
        200,
        `<InitiateMultipartUploadResult xmlns="${XMLNS}"><Bucket>${xmlEsc(bucket)}</Bucket><Key>${xmlEsc(key)}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`
      )
    }

    const uploadId = q.get('uploadId')
    if (uploadId) {
      const mp = uploads.get(uploadId)
      if (!mp || mp.bucket !== bucket || mp.key !== key) throw new S3Error(404, 'NoSuchUpload', 'Upload unbekannt.')
      if (method === 'PUT') {
        const n = Number(q.get('partNumber'))
        if (!Number.isInteger(n) || n < 1 || n > 10000) throw new S3Error(400, 'InvalidArgument', 'Ungültige Teilnummer.')
        const part = await spool(req, mp.dir, payloadHash)
        const prev = mp.parts.get(n)
        if (prev) await rm(prev.file, { force: true })
        mp.parts.set(n, part)
        res.writeHead(200, { ETag: `"${part.md5}"` }).end()
        return
      }
      if (method === 'DELETE') {
        uploads.delete(uploadId)
        await rm(mp.dir, { recursive: true, force: true })
        res.writeHead(204).end()
        return
      }
      if (method === 'POST') {
        const body = await readSmall(req, payloadHash)
        const order = [...body.matchAll(/<PartNumber>(\d+)<\/PartNumber>/g)].map(m => Number(m[1]))
        if (!order.length || order.some(n => !mp.parts.has(n))) throw new S3Error(400, 'InvalidPart', 'Teil fehlt.')
        const file = path.join(mp.dir, 'complete')
        const ws = createWriteStream(file)
        let size = 0
        const md5s: Buffer[] = []
        for (const n of order) {
          const p = mp.parts.get(n)!
          md5s.push(Buffer.from(p.md5, 'hex'))
          size += p.size
          for await (const c of createReadStream(p.file)) if (!ws.write(c)) await new Promise<void>(r => ws.once('drain', () => r()))
        }
        await new Promise<void>((r, j) => ws.end((e?: Error | null) => (e ? j(e) : r())))
        const etag = `${createHash('md5').update(Buffer.concat(md5s)).digest('hex')}-${order.length}`
        try {
          await store.put(bucket, key, file, { size, etag, contentType: mp.contentType })
        } finally {
          uploads.delete(uploadId)
          await rm(mp.dir, { recursive: true, force: true })
        }
        return sendXml(
          res,
          200,
          `<CompleteMultipartUploadResult xmlns="${XMLNS}"><Bucket>${xmlEsc(bucket)}</Bucket><Key>${xmlEsc(key)}</Key><ETag>&quot;${etag}&quot;</ETag></CompleteMultipartUploadResult>`
        )
      }
      throw new S3Error(405, 'MethodNotAllowed', 'Nicht unterstützt.')
    }

    if (method === 'PUT') {
      const copySource = req.headers['x-amz-copy-source']
      if (copySource) {
        const src = decodeURIComponent(String(copySource)).replace(/^\//, '')
        const [sb, ...sk] = src.split('?')[0].split('/')
        const from = await store.read(sb, sk.join('/'))
        if (!from) throw new S3Error(404, 'NoSuchKey', 'Quelle nicht gefunden.')
        const dir = await mkdtemp(path.join(tmpRoot, 'cp-'))
        try {
          const file = path.join(dir, 'copy')
          const ws = createWriteStream(file)
          for await (const c of from.body) if (!ws.write(c)) await new Promise<void>(r => ws.once('drain', () => r()))
          await new Promise<void>((r, j) => ws.end((e?: Error | null) => (e ? j(e) : r())))
          await store.put(bucket, key, file, { size: from.meta.size, etag: from.meta.etag, contentType: from.meta.contentType ?? 'application/octet-stream' })
        } finally {
          await rm(dir, { recursive: true, force: true })
        }
        return sendXml(
          res,
          200,
          `<CopyObjectResult xmlns="${XMLNS}"><LastModified>${new Date().toISOString()}</LastModified><ETag>&quot;${from.meta.etag}&quot;</ETag></CopyObjectResult>`
        )
      }
      const dir = await mkdtemp(path.join(tmpRoot, 'put-'))
      try {
        const part = await spool(req, dir, payloadHash)
        const md5Header = req.headers['content-md5']
        if (md5Header && Buffer.from(String(md5Header), 'base64').toString('hex') !== part.md5) {
          throw new S3Error(400, 'BadDigest', 'Content-MD5 passt nicht.')
        }
        await store.put(bucket, key, part.file, {
          size: part.size,
          etag: part.md5,
          contentType: String(req.headers['content-type'] ?? 'application/octet-stream')
        })
        res.writeHead(200, { ETag: `"${part.md5}"` }).end()
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
      return
    }

    if (method === 'DELETE') {
      await store.delete(bucket, key)
      res.writeHead(204).end()
      return
    }

    if (method === 'HEAD' || method === 'GET') {
      const meta = await store.head(bucket, key)
      if (!meta) throw new S3Error(404, 'NoSuchKey', 'Objekt nicht gefunden.')
      const base = {
        'Content-Type': meta.contentType ?? 'application/octet-stream',
        ETag: `"${meta.etag}"`,
        'Last-Modified': meta.lastModified.toUTCString(),
        'Accept-Ranges': 'bytes'
      }
      const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''))
      let start = 0
      let end = meta.size - 1
      if (range) {
        if (range[1] === '') start = Math.max(0, meta.size - Number(range[2]))
        else {
          start = Number(range[1])
          end = range[2] === '' ? meta.size - 1 : Math.min(Number(range[2]), meta.size - 1)
        }
        if (start > end || start >= meta.size) {
          res.writeHead(416, { 'Content-Range': `bytes */${meta.size}` }).end()
          return
        }
      }
      const len = meta.size ? end - start + 1 : 0
      const headers = { ...base, 'Content-Length': String(len), ...(range ? { 'Content-Range': `bytes ${start}-${end}/${meta.size}` } : {}) }
      if (method === 'HEAD') {
        res.writeHead(200, { ...base, 'Content-Length': String(meta.size) }).end()
        return
      }
      const obj = await store.read(bucket, key)
      if (!obj) throw new S3Error(404, 'NoSuchKey', 'Objekt nicht gefunden.')
      res.writeHead(range ? 206 : 200, headers)
      for await (const c of range ? sliceStream(obj.body, start, end) : obj.body) {
        if (!res.write(c)) await new Promise<void>(r => res.once('drain', () => r()))
      }
      res.end()
      return
    }
    throw new S3Error(405, 'MethodNotAllowed', 'Nicht unterstützt.')
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(e => {
      const err =
        e instanceof S3Error
          ? e
          : e instanceof SigV4Error
            ? new S3Error(e.code === 'InvalidAccessKeyId' || e.code === 'SignatureDoesNotMatch' || e.code === 'AccessDenied' ? 403 : 400, e.code, e.message)
            : new S3Error(500, 'InternalError', (e as Error).message)
      if (err.status >= 500) console.error('[s3]', (e as Error).message)
      req.resume()
      sendError(res, err, req.url ?? '/')
    })
  })

  return mkdtemp(path.join(tmpdir(), 'focvault-s3-')).then(
    dir =>
      new Promise((resolve, reject) => {
        tmpRoot = dir
        server.once('error', reject)
        server.listen(opts.port ?? 9000, host, () => {
          const addr = server.address()
          const port = typeof addr === 'object' && addr ? addr.port : opts.port
          resolve({
            server,
            url: `http://${host}:${port}`,
            close: async () => {
              await new Promise<void>(r => server.close(() => r()))
              await rm(tmpRoot, { recursive: true, force: true })
            }
          })
        })
      })
  )
}

/** Speicher im Arbeitsspeicher – für Tests des Protokolls. */
export class MemoryS3Store implements S3Store {
  private readonly buckets = new Map<string, { created: Date; objects: Map<string, { meta: S3Object; data: Buffer }> }>()

  async listBuckets() {
    return [...this.buckets].map(([name, b]) => ({ name, created: b.created }))
  }
  async createBucket(name: string) {
    if (!this.buckets.has(name)) this.buckets.set(name, { created: new Date(), objects: new Map() })
  }
  async deleteBucket(name: string) {
    this.buckets.delete(name)
  }
  async list(bucket: string) {
    const b = this.buckets.get(bucket)
    return b ? [...b.objects.values()].map(o => o.meta) : null
  }
  async head(bucket: string, key: string) {
    return this.buckets.get(bucket)?.objects.get(key)?.meta ?? null
  }
  async read(bucket: string, key: string) {
    const o = this.buckets.get(bucket)?.objects.get(key)
    if (!o) return null
    const data = o.data
    return {
      meta: o.meta,
      body: (async function* () {
        for (let i = 0; i < data.length; i += 65536) yield data.subarray(i, i + 65536)
      })()
    }
  }
  async put(bucket: string, key: string, file: string, meta: { size: number; etag: string; contentType: string }) {
    await this.createBucket(bucket)
    const { readFile } = await import('node:fs/promises')
    const data = await readFile(file)
    if ((await stat(file)).size !== meta.size) throw new Error('Größe passt nicht')
    this.buckets.get(bucket)!.objects.set(key, { meta: { key, size: meta.size, etag: meta.etag, lastModified: new Date(), contentType: meta.contentType }, data })
  }
  async delete(bucket: string, key: string) {
    this.buckets.get(bucket)?.objects.delete(key)
  }
}

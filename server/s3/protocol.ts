import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { SigV4Error, accessKeyOf, verifySigV4 } from './sigv4'

/**
 * S3-Protokoll (Pfad-Stil, SigV4) für zwei Einsatzorte:
 * - Speicher-API im Rechenzentrum (Business): viele Konten, je eigene Zugangsschlüssel,
 *   Objekte werden gestreamt (keine Zwischendateien), Object Lock, Aufbewahrungsregeln.
 * - lokales Gateway des Backup-Programms (Ende-zu-Ende, Verschlüsselung auf dem Gerät).
 * Unterstützt: Buckets (inkl. Object Lock), ListObjects v1/v2, Put/Get (Range)/Head/Delete,
 * Mehrfach-Löschen, Copy, Multipart, Object-Lock-Retention, signierte Links, aws-chunked.
 */
export interface S3Object {
  key: string
  size: number
  etag: string
  lastModified: Date
  contentType?: string
  lockMode?: LockMode | null
  retainUntil?: Date | null
}

export type LockMode = 'GOVERNANCE' | 'COMPLIANCE'
export interface Retention {
  mode: LockMode
  until: Date
}

export interface S3Store {
  listBuckets(): Promise<Array<{ name: string; created: Date }>>
  createBucket(name: string, opts: { objectLock: boolean }): Promise<void>
  deleteBucket(name: string): Promise<void>
  bucketInfo(name: string): Promise<{ objectLock: boolean; defaultRetention: { mode: LockMode; days: number } | null } | null>
  setBucketLock?(name: string, rule: { mode: LockMode; days: number } | null): Promise<void>
  /** Objekte mit Präfix (sortiert nach Key), höchstens `limit` nach `after` */
  list(bucket: string, prefix: string, after: string, limit: number): Promise<S3Object[]>
  head(bucket: string, key: string): Promise<S3Object | null>
  read(bucket: string, key: string, range?: { start: number; end: number }): Promise<{ meta: S3Object; body: AsyncIterable<Uint8Array> } | null>
  /** Body wird gestreamt; `size` ist bekannt (Content-Length bzw. dekodierte Länge). Liefert den ETag. */
  put(bucket: string, key: string, body: AsyncIterable<Buffer>, meta: { size: number; contentType: string; retention: Retention | null }): Promise<{ etag: string }>
  delete(bucket: string, key: string, opts: { bypassGovernance: boolean }): Promise<void>
  setRetention?(bucket: string, key: string, r: Retention, opts: { bypassGovernance: boolean }): Promise<void>
  mpCreate(bucket: string, key: string, meta: { contentType: string; retention: Retention | null }): Promise<string>
  mpPart(uploadId: string, bucket: string, key: string, part: number, body: AsyncIterable<Buffer>, size: number): Promise<{ etag: string }>
  mpComplete(uploadId: string, bucket: string, key: string, parts: Array<{ part: number; etag?: string }>): Promise<{ etag: string }>
  mpAbort(uploadId: string, bucket: string, key: string): Promise<void>
}

export class S3Error extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

export interface Tenant {
  secret: string
  store: S3Store
}

export interface GatewayOptions {
  /** Zugangsschlüssel → Secret und Speicher des Kontos (null = unbekannt) */
  resolve: (accessKey: string) => Promise<Tenant | null>
  host?: string
  port?: number
  region?: string
  /** größtes Objekt per einfachem PUT (S3: 5 GiB) */
  maxPutBytes?: number
}

export const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/
const xmlEsc = (s: string) => s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!)
const XMLNS = 'http://s3.amazonaws.com/doc/2006-03-01/'
const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

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

/** Entpackt `aws-chunked` (Streaming-Uploads der AWS-SDKs); Trailer (Prüfsummen) werden übersprungen. */
async function* decodeAwsChunked(src: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
  let buf: Buffer = Buffer.alloc(0)
  let need = -1
  for await (const part of src) {
    buf = buf.length ? Buffer.concat([buf, part]) : part
    for (;;) {
      if (need < 0) {
        const nl = buf.indexOf('\r\n')
        if (nl < 0) break
        const size = parseInt(buf.subarray(0, nl).toString('latin1').split(';')[0], 16)
        if (!Number.isFinite(size)) throw new S3Error(400, 'IncompleteBody', 'Ungültige aws-chunked-Daten.')
        buf = buf.subarray(nl + 2)
        if (size === 0) return
        need = size
      }
      if (buf.length < need + 2) break
      yield buf.subarray(0, need)
      buf = buf.subarray(need + 2)
      need = -1
    }
  }
}

async function* raw(req: IncomingMessage): AsyncGenerator<Buffer> {
  for await (const c of req) yield c as Buffer
}

/**
 * Request-Body als Strom: dekodiert aws-chunked, zählt Bytes und prüft am Ende Länge und
 * (falls signiert) SHA-256. Fehler brechen den Strom ab – der Store verwirft dann das Objekt.
 */
function bodyStream(req: IncomingMessage, payloadHash: string, size: number): AsyncGenerator<Buffer> {
  const chunked = payloadHash.startsWith('STREAMING-') || /aws-chunked/.test(String(req.headers['content-encoding'] ?? ''))
  const verifySha = !chunked && /^[0-9a-f]{64}$/.test(payloadHash)
  const sha = verifySha ? createHash('sha256') : null
  return (async function* () {
    let n = 0
    for await (const c of chunked ? decodeAwsChunked(raw(req)) : raw(req)) {
      n += c.length
      if (n > size) throw new S3Error(400, 'IncompleteBody', 'Mehr Daten als angekündigt.')
      sha?.update(c)
      yield c
    }
    if (n !== size) throw new S3Error(400, 'IncompleteBody', 'Inhalt unvollständig.')
    if (sha && sha.digest('hex') !== payloadHash) throw new S3Error(400, 'XAmzContentSHA256Mismatch', 'Inhalt passt nicht zur Signatur.')
  })()
}

function declaredSize(req: IncomingMessage, payloadHash: string): number {
  const decoded = req.headers['x-amz-decoded-content-length']
  const v = payloadHash.startsWith('STREAMING-') || decoded !== undefined ? decoded : req.headers['content-length']
  const n = Number(v)
  if (v === undefined || !Number.isFinite(n) || n < 0) throw new S3Error(411, 'MissingContentLength', 'Content-Length fehlt.')
  return n
}

async function readSmall(req: IncomingMessage, payloadHash: string, max = 1 << 20): Promise<string> {
  const parts: Buffer[] = []
  let n = 0
  const chunked = payloadHash.startsWith('STREAMING-')
  for await (const c of chunked ? decodeAwsChunked(raw(req)) : raw(req)) {
    n += c.length
    if (n > max) throw new S3Error(400, 'MaxMessageLengthExceeded', 'Anfrage zu groß.')
    parts.push(c)
  }
  return Buffer.concat(parts).toString('utf8')
}

function retentionFrom(headers: IncomingMessage['headers']): Retention | null {
  const mode = String(headers['x-amz-object-lock-mode'] ?? '').toUpperCase()
  const until = headers['x-amz-object-lock-retain-until-date']
  if (!mode && !until) return null
  if ((mode !== 'GOVERNANCE' && mode !== 'COMPLIANCE') || !until) throw new S3Error(400, 'InvalidArgument', 'Object-Lock-Modus und Datum angeben.')
  const d = new Date(String(until))
  if (!Number.isFinite(d.getTime()) || d.getTime() <= Date.now()) throw new S3Error(400, 'InvalidArgument', 'Aufbewahrungsdatum muss in der Zukunft liegen.')
  return { mode, until: d }
}

const bypass = (req: IncomingMessage) => String(req.headers['x-amz-bypass-governance-retention'] ?? '').toLowerCase() === 'true'

function lockHeaders(m: S3Object): Record<string, string> {
  return m.lockMode && m.retainUntil
    ? { 'x-amz-object-lock-mode': m.lockMode, 'x-amz-object-lock-retain-until-date': m.retainUntil.toISOString() }
    : {}
}

export function startS3Server(opts: GatewayOptions): Promise<{ server: Server; url: string; close: () => Promise<void> }> {
  const host = opts.host ?? '127.0.0.1'
  const maxPut = opts.maxPutBytes ?? 5 * 1024 ** 3

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/'
    const method = req.method ?? 'GET'
    const accessKey = accessKeyOf({ method, url, headers: req.headers })
    const tenant = accessKey ? await opts.resolve(accessKey) : null
    const { payloadHash } = verifySigV4({ method, url, headers: req.headers }, ak => (tenant && ak === accessKey ? tenant.secret : null))
    const store = tenant!.store
    const u = new URL(url, 'http://gateway')
    const q = u.searchParams
    const segs = u.pathname.split('/').slice(1)
    const bucket = decodeURIComponent(segs.shift() ?? '')
    const key = decodeURIComponent(segs.join('/'))

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
      if (method === 'PUT' && q.has('object-lock')) {
        const body = await readSmall(req, payloadHash)
        const mode = /<Mode>(GOVERNANCE|COMPLIANCE)<\/Mode>/.exec(body)?.[1] as LockMode | undefined
        const days = Number(/<Days>(\d+)<\/Days>/.exec(body)?.[1] ?? 0) || Number(/<Years>(\d+)<\/Years>/.exec(body)?.[1] ?? 0) * 365
        if (!store.setBucketLock) throw new S3Error(501, 'NotImplemented', 'Nicht unterstützt.')
        await store.setBucketLock(bucket, mode && days ? { mode, days } : null)
        res.writeHead(200).end()
        return
      }
      if (method === 'PUT') {
        await store.createBucket(bucket, { objectLock: String(req.headers['x-amz-bucket-object-lock-enabled'] ?? '').toLowerCase() === 'true' })
        res.writeHead(200, { Location: `/${bucket}` }).end()
        return
      }
      const info = await store.bucketInfo(bucket)
      if (!info) throw new S3Error(404, 'NoSuchBucket', 'Bucket existiert nicht.')
      if (method === 'DELETE') {
        if ((await store.list(bucket, '', '', 1)).length) throw new S3Error(409, 'BucketNotEmpty', 'Bucket ist nicht leer.')
        await store.deleteBucket(bucket)
        res.writeHead(204).end()
        return
      }
      if (method === 'POST' && q.has('delete')) {
        const body = await readSmall(req, payloadHash)
        const keys = [...body.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map(m => unxml(m[1]))
        const quiet = /<Quiet>true<\/Quiet>/i.test(body)
        const ok: string[] = []
        const failed: Array<{ key: string; code: string; message: string }> = []
        for (const k of keys) {
          try {
            await store.delete(bucket, k, { bypassGovernance: bypass(req) })
            ok.push(k)
          } catch (e) {
            if (!(e instanceof S3Error)) throw e
            failed.push({ key: k, code: e.code, message: e.message })
          }
        }
        return sendXml(
          res,
          200,
          `<DeleteResult xmlns="${XMLNS}">${quiet ? '' : ok.map(k => `<Deleted><Key>${xmlEsc(k)}</Key></Deleted>`).join('')}${failed
            .map(f => `<Error><Key>${xmlEsc(f.key)}</Key><Code>${f.code}</Code><Message>${xmlEsc(f.message)}</Message></Error>`)
            .join('')}</DeleteResult>`
        )
      }
      if (method === 'HEAD') {
        res.writeHead(200, { 'x-amz-bucket-region': opts.region ?? 'us-east-1' }).end()
        return
      }
      if (method !== 'GET') throw new S3Error(405, 'MethodNotAllowed', 'Nicht unterstützt.')
      if (q.has('location')) return sendXml(res, 200, `<LocationConstraint xmlns="${XMLNS}"></LocationConstraint>`)
      if (q.has('versioning')) return sendXml(res, 200, `<VersioningConfiguration xmlns="${XMLNS}"/>`)
      if (q.has('object-lock')) {
        if (!info.objectLock) throw new S3Error(404, 'ObjectLockConfigurationNotFoundError', 'Object Lock ist für diesen Bucket nicht aktiv.')
        const rule = info.defaultRetention
          ? `<Rule><DefaultRetention><Mode>${info.defaultRetention.mode}</Mode><Days>${info.defaultRetention.days}</Days></DefaultRetention></Rule>`
          : ''
        return sendXml(res, 200, `<ObjectLockConfiguration xmlns="${XMLNS}"><ObjectLockEnabled>Enabled</ObjectLockEnabled>${rule}</ObjectLockConfiguration>`)
      }
      if (q.has('uploads')) return sendXml(res, 200, `<ListMultipartUploadsResult xmlns="${XMLNS}"><Bucket>${xmlEsc(bucket)}</Bucket></ListMultipartUploadsResult>`)

      const v2 = q.get('list-type') === '2'
      const prefix = q.get('prefix') ?? ''
      const delimiter = q.get('delimiter') ?? ''
      const max = Math.min(Math.max(Number(q.get('max-keys') ?? 1000) || 1000, 1), 1000)
      let after = v2
        ? q.get('continuation-token')
          ? Buffer.from(q.get('continuation-token')!, 'base64url').toString()
          : (q.get('start-after') ?? '')
        : (q.get('marker') ?? '')
      const contents: S3Object[] = []
      const prefixes = new Set<string>()
      let truncated = false
      let last = ''
      // In Seiten aus dem Store lesen, bis die Antwort voll ist
      outer: for (;;) {
        const page = await store.list(bucket, prefix, after, 1000)
        if (!page.length) break
        for (const o of page) {
          after = o.key
          let entry: string | null = null
          if (delimiter) {
            const i = o.key.indexOf(delimiter, prefix.length)
            if (i >= 0) entry = o.key.slice(0, i + delimiter.length)
          }
          if (entry && prefixes.has(entry)) continue
          if (contents.length + prefixes.size >= max) {
            truncated = true
            break outer
          }
          if (entry) {
            prefixes.add(entry)
            last = entry
            // alles unter diesem Präfix überspringen
            after = entry + '\uffff'
          } else {
            contents.push(o)
            last = o.key
          }
        }
        if (page.length < 1000) break
      }
      const nextKey = truncated ? (delimiter && last.endsWith(delimiter) ? last + '\uffff' : last) : ''
      const items = contents
        .map(
          o =>
            `<Contents><Key>${xmlEsc(o.key)}</Key><LastModified>${o.lastModified.toISOString()}</LastModified><ETag>&quot;${o.etag}&quot;</ETag><Size>${o.size}</Size><StorageClass>STANDARD</StorageClass></Contents>`
        )
        .join('')
      const common = [...prefixes].map(p => `<CommonPrefixes><Prefix>${xmlEsc(p)}</Prefix></CommonPrefixes>`).join('')
      const headXml = `<Name>${xmlEsc(bucket)}</Name><Prefix>${xmlEsc(prefix)}</Prefix>${delimiter ? `<Delimiter>${xmlEsc(delimiter)}</Delimiter>` : ''}<MaxKeys>${max}</MaxKeys><IsTruncated>${truncated}</IsTruncated>`
      const tail = v2
        ? `<KeyCount>${contents.length + prefixes.size}</KeyCount>${q.get('continuation-token') ? `<ContinuationToken>${xmlEsc(q.get('continuation-token')!)}</ContinuationToken>` : ''}${truncated ? `<NextContinuationToken>${Buffer.from(nextKey).toString('base64url')}</NextContinuationToken>` : ''}`
        : `<Marker>${xmlEsc(q.get('marker') ?? '')}</Marker>${truncated ? `<NextMarker>${xmlEsc(nextKey)}</NextMarker>` : ''}`
      return sendXml(res, 200, `<ListBucketResult xmlns="${XMLNS}">${headXml}${tail}${items}${common}</ListBucketResult>`)
    }

    // ---------- Objekt-Ebene ----------
    const info = await store.bucketInfo(bucket)
    if (!info) throw new S3Error(404, 'NoSuchBucket', 'Bucket existiert nicht.')
    const contentType = String(req.headers['content-type'] ?? 'application/octet-stream')
    const retention = () => {
      const r = retentionFrom(req.headers)
      if (r && !info.objectLock) throw new S3Error(400, 'InvalidRequest', 'Object Lock ist für diesen Bucket nicht aktiv.')
      if (r) return r
      const d = info.defaultRetention
      return d ? { mode: d.mode, until: new Date(Date.now() + d.days * 86_400_000) } : null
    }

    if (method === 'POST' && q.has('uploads')) {
      const id = await store.mpCreate(bucket, key, { contentType, retention: retention() })
      return sendXml(
        res,
        200,
        `<InitiateMultipartUploadResult xmlns="${XMLNS}"><Bucket>${xmlEsc(bucket)}</Bucket><Key>${xmlEsc(key)}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`
      )
    }

    const uploadId = q.get('uploadId')
    if (uploadId) {
      if (method === 'PUT') {
        const n = Number(q.get('partNumber'))
        if (!Number.isInteger(n) || n < 1 || n > 10000) throw new S3Error(400, 'InvalidArgument', 'Ungültige Teilnummer.')
        const size = declaredSize(req, payloadHash)
        if (size > maxPut) throw new S3Error(400, 'EntityTooLarge', 'Teil größer als 5 GiB.')
        const { etag } = await store.mpPart(uploadId, bucket, key, n, bodyStream(req, payloadHash, size), size)
        res.writeHead(200, { ETag: `"${etag}"` }).end()
        return
      }
      if (method === 'DELETE') {
        await store.mpAbort(uploadId, bucket, key)
        res.writeHead(204).end()
        return
      }
      if (method === 'POST') {
        const body = await readSmall(req, payloadHash)
        const parts = [...body.matchAll(/<Part>([\s\S]*?)<\/Part>/g)].map(m => ({
          part: Number(/<PartNumber>(\d+)<\/PartNumber>/.exec(m[1])?.[1]),
          etag: /<ETag>([\s\S]*?)<\/ETag>/.exec(m[1])?.[1]?.replace(/&quot;|"/g, '')
        }))
        if (!parts.length || parts.some((p, i) => !p.part || (i > 0 && p.part <= parts[i - 1].part))) {
          throw new S3Error(400, 'InvalidPartOrder', 'Teile fehlen oder sind nicht aufsteigend sortiert.')
        }
        const { etag } = await store.mpComplete(uploadId, bucket, key, parts)
        return sendXml(
          res,
          200,
          `<CompleteMultipartUploadResult xmlns="${XMLNS}"><Bucket>${xmlEsc(bucket)}</Bucket><Key>${xmlEsc(key)}</Key><ETag>&quot;${etag}&quot;</ETag></CompleteMultipartUploadResult>`
        )
      }
      throw new S3Error(405, 'MethodNotAllowed', 'Nicht unterstützt.')
    }

    if (q.has('retention')) {
      if (method === 'GET') {
        const m = await store.head(bucket, key)
        if (!m) throw new S3Error(404, 'NoSuchKey', 'Objekt nicht gefunden.')
        if (!m.lockMode || !m.retainUntil) throw new S3Error(404, 'NoSuchObjectLockConfiguration', 'Keine Aufbewahrung gesetzt.')
        return sendXml(res, 200, `<Retention xmlns="${XMLNS}"><Mode>${m.lockMode}</Mode><RetainUntilDate>${m.retainUntil.toISOString()}</RetainUntilDate></Retention>`)
      }
      if (method === 'PUT') {
        if (!info.objectLock || !store.setRetention) throw new S3Error(400, 'InvalidRequest', 'Object Lock ist für diesen Bucket nicht aktiv.')
        const body = await readSmall(req, payloadHash)
        const mode = /<Mode>(GOVERNANCE|COMPLIANCE)<\/Mode>/.exec(body)?.[1] as LockMode | undefined
        const until = new Date(/<RetainUntilDate>([^<]+)<\/RetainUntilDate>/.exec(body)?.[1] ?? '')
        if (!mode || !Number.isFinite(until.getTime())) throw new S3Error(400, 'MalformedXML', 'Retention unvollständig.')
        await store.setRetention(bucket, key, { mode, until }, { bypassGovernance: bypass(req) })
        res.writeHead(200).end()
        return
      }
    }

    if (method === 'PUT') {
      const copySource = req.headers['x-amz-copy-source']
      if (copySource) {
        const src = decodeURIComponent(String(copySource)).replace(/^\//, '')
        const [sb, ...sk] = src.split('?')[0].split('/')
        const from = await store.read(sb, sk.join('/'))
        if (!from) throw new S3Error(404, 'NoSuchKey', 'Quelle nicht gefunden.')
        const it = (async function* () {
          for await (const c of from.body) yield Buffer.from(c)
        })()
        const { etag } = await store.put(bucket, key, it, { size: from.meta.size, contentType: from.meta.contentType ?? contentType, retention: retention() })
        return sendXml(res, 200, `<CopyObjectResult xmlns="${XMLNS}"><LastModified>${new Date().toISOString()}</LastModified><ETag>&quot;${etag}&quot;</ETag></CopyObjectResult>`)
      }
      const size = declaredSize(req, payloadHash)
      if (size > maxPut) throw new S3Error(400, 'EntityTooLarge', 'Größer als 5 GiB – bitte Multipart-Upload verwenden.')
      const md5Header = req.headers['content-md5']
      const { etag } = await store.put(bucket, key, bodyStream(req, payloadHash, size), { size, contentType, retention: retention() })
      if (md5Header && Buffer.from(String(md5Header), 'base64').toString('hex') !== etag) {
        await store.delete(bucket, key, { bypassGovernance: true }).catch(() => undefined)
        throw new S3Error(400, 'BadDigest', 'Content-MD5 passt nicht.')
      }
      res.writeHead(200, { ETag: `"${etag}"` }).end()
      return
    }

    if (method === 'DELETE') {
      await store.delete(bucket, key, { bypassGovernance: bypass(req) })
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
        'Accept-Ranges': 'bytes',
        ...lockHeaders(meta)
      }
      if (method === 'HEAD') {
        res.writeHead(200, { ...base, 'Content-Length': String(meta.size) }).end()
        return
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
      const obj = await store.read(bucket, key, range ? { start, end } : undefined)
      if (!obj) throw new S3Error(404, 'NoSuchKey', 'Objekt nicht gefunden.')
      const len = meta.size ? end - start + 1 : 0
      res.writeHead(range ? 206 : 200, { ...base, 'Content-Length': String(len), ...(range ? { 'Content-Range': `bytes ${start}-${end}/${meta.size}` } : {}) })
      for await (const c of obj.body) if (!res.write(c)) await new Promise<void>(r => res.once('drain', () => r()))
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
            ? new S3Error(['InvalidAccessKeyId', 'SignatureDoesNotMatch', 'AccessDenied'].includes(e.code) ? 403 : 400, e.code, e.message)
            : new S3Error(500, 'InternalError', 'Interner Fehler.')
      if (err.status >= 500) console.error('[s3]', (e as Error).message)
      req.resume()
      sendError(res, err, req.url ?? '/')
    })
  })
  server.requestTimeout = 0 // große Uploads
  server.headersTimeout = 60_000

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port ?? 9000, host, () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : opts.port
      resolve({ server, url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`, close: () => new Promise<void>(r => server.close(() => r())) })
    })
  })
}

// ---------------------------------------------------------------------------------------------
// Speicher im Arbeitsspeicher (Tests)
// ---------------------------------------------------------------------------------------------

async function collect(body: AsyncIterable<Buffer>): Promise<Buffer> {
  const parts: Buffer[] = []
  for await (const c of body) parts.push(c)
  return Buffer.concat(parts)
}

async function* chunks(data: Buffer): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < data.length; i += 65536) yield data.subarray(i, i + 65536)
}

export class MemoryS3Store implements S3Store {
  private readonly buckets = new Map<string, { created: Date; lock: boolean; rule: { mode: LockMode; days: number } | null; objects: Map<string, { meta: S3Object; data: Buffer }> }>()
  private readonly uploads = new Map<string, { bucket: string; key: string; contentType: string; retention: Retention | null; parts: Map<number, Buffer> }>()

  async listBuckets() {
    return [...this.buckets].map(([name, b]) => ({ name, created: b.created }))
  }
  async createBucket(name: string, opts: { objectLock: boolean }) {
    if (!this.buckets.has(name)) this.buckets.set(name, { created: new Date(), lock: opts.objectLock, rule: null, objects: new Map() })
  }
  async deleteBucket(name: string) {
    this.buckets.delete(name)
  }
  async bucketInfo(name: string) {
    const b = this.buckets.get(name)
    return b ? { objectLock: b.lock, defaultRetention: b.rule } : null
  }
  async setBucketLock(name: string, rule: { mode: LockMode; days: number } | null) {
    const b = this.buckets.get(name)
    if (!b?.lock) throw new S3Error(400, 'InvalidBucketState', 'Object Lock nicht aktiv.')
    b.rule = rule
  }
  async list(bucket: string, prefix: string, after: string, limit: number) {
    const b = this.buckets.get(bucket)
    return b ? [...b.objects.values()].map(o => o.meta).filter(o => o.key.startsWith(prefix) && o.key > after).sort((a, c) => (a.key < c.key ? -1 : 1)).slice(0, limit) : []
  }
  async head(bucket: string, key: string) {
    return this.buckets.get(bucket)?.objects.get(key)?.meta ?? null
  }
  async read(bucket: string, key: string, range?: { start: number; end: number }) {
    const o = this.buckets.get(bucket)?.objects.get(key)
    if (!o) return null
    const data = range ? o.data.subarray(range.start, range.end + 1) : o.data
    return { meta: o.meta, body: chunks(data) }
  }
  private guard(bucket: string, key: string, bypassGovernance: boolean) {
    const m = this.buckets.get(bucket)?.objects.get(key)?.meta
    if (m?.retainUntil && m.retainUntil.getTime() > Date.now() && (m.lockMode === 'COMPLIANCE' || !bypassGovernance)) {
      throw new S3Error(403, 'AccessDenied', 'Objekt ist bis zum Ablauf der Aufbewahrungsfrist geschützt.')
    }
  }
  async put(bucket: string, key: string, body: AsyncIterable<Buffer>, meta: { size: number; contentType: string; retention: Retention | null }) {
    this.guard(bucket, key, false)
    const data = await collect(body)
    const etag = createHash('md5').update(data).digest('hex')
    this.buckets.get(bucket)!.objects.set(key, {
      meta: { key, size: data.length, etag, lastModified: new Date(), contentType: meta.contentType, lockMode: meta.retention?.mode ?? null, retainUntil: meta.retention?.until ?? null },
      data
    })
    return { etag }
  }
  async delete(bucket: string, key: string, opts: { bypassGovernance: boolean }) {
    this.guard(bucket, key, opts.bypassGovernance)
    this.buckets.get(bucket)?.objects.delete(key)
  }
  async setRetention(bucket: string, key: string, r: Retention, opts: { bypassGovernance: boolean }) {
    const o = this.buckets.get(bucket)?.objects.get(key)
    if (!o) throw new S3Error(404, 'NoSuchKey', 'Objekt nicht gefunden.')
    const cur = o.meta.retainUntil
    if (cur && r.until < cur) this.guard(bucket, key, opts.bypassGovernance)
    if (o.meta.lockMode === 'COMPLIANCE' && r.mode === 'GOVERNANCE' && cur && cur > new Date()) throw new S3Error(403, 'AccessDenied', 'COMPLIANCE lässt sich nicht abschwächen.')
    o.meta = { ...o.meta, lockMode: r.mode, retainUntil: r.until }
  }
  async mpCreate(bucket: string, key: string, meta: { contentType: string; retention: Retention | null }) {
    const id = randomBytes(12).toString('base64url')
    this.uploads.set(id, { bucket, key, ...meta, parts: new Map() })
    return id
  }
  async mpPart(uploadId: string, _b: string, _k: string, part: number, body: AsyncIterable<Buffer>) {
    const u = this.uploads.get(uploadId)
    if (!u) throw new S3Error(404, 'NoSuchUpload', 'Upload unbekannt.')
    const data = await collect(body)
    u.parts.set(part, data)
    return { etag: createHash('md5').update(data).digest('hex') }
  }
  async mpComplete(uploadId: string, bucket: string, key: string, parts: Array<{ part: number }>) {
    const u = this.uploads.get(uploadId)
    if (!u) throw new S3Error(404, 'NoSuchUpload', 'Upload unbekannt.')
    if (parts.some(p => !u.parts.has(p.part))) throw new S3Error(400, 'InvalidPart', 'Teil fehlt.')
    const all = parts.map(p => u.parts.get(p.part)!)
    const md5s = Buffer.concat(all.map(d => createHash('md5').update(d).digest()))
    const etag = `${createHash('md5').update(md5s).digest('hex')}-${parts.length}`
    const data = Buffer.concat(all)
    this.buckets.get(bucket)!.objects.set(key, {
      meta: { key, size: data.length, etag, lastModified: new Date(), contentType: u.contentType, lockMode: u.retention?.mode ?? null, retainUntil: u.retention?.until ?? null },
      data
    })
    this.uploads.delete(uploadId)
    return { etag }
  }
  async mpAbort(uploadId: string) {
    this.uploads.delete(uploadId)
  }
}

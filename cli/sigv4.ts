import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Prüfung von AWS-Signaturen Version 4 (Header- und Query-Variante) für das lokale S3-Gateway.
 * Kanonisierung nach https://docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html
 * (S3: Pfad wird nicht normalisiert, nur so verwendet, wie der Client ihn gesendet hat).
 */
export interface SigV4Request {
  method: string
  /** roher Pfad inkl. Query, wie auf der Leitung (z. B. `/bucket/a%20b.txt?x-id=PutObject`) */
  url: string
  headers: Record<string, string | string[] | undefined>
}

export interface SigV4Result {
  accessKey: string
  /** vom Client angegebener Payload-Hash (Hex, UNSIGNED-PAYLOAD oder STREAMING-…) */
  payloadHash: string
}

const enc = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')
const hmac = (key: Buffer | string, s: string) => createHmac('sha256', key).update(s).digest()

function header(h: SigV4Request['headers'], name: string): string {
  const v = h[name.toLowerCase()]
  return Array.isArray(v) ? v.join(',') : (v ?? '')
}

function canonicalQuery(rawQuery: string, drop?: string): string {
  if (!rawQuery) return ''
  return rawQuery
    .split('&')
    .filter(Boolean)
    .map(p => {
      const i = p.indexOf('=')
      const k = decodeURIComponent((i < 0 ? p : p.slice(0, i)).replace(/\+/g, '%20'))
      const v = i < 0 ? '' : decodeURIComponent(p.slice(i + 1).replace(/\+/g, '%20'))
      return [enc(k), enc(v)] as const
    })
    .filter(([k]) => k !== drop)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
}

export function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), 'aws4_request')
}

export class SigV4Error extends Error {
  constructor(
    readonly code: 'AccessDenied' | 'SignatureDoesNotMatch' | 'InvalidAccessKeyId' | 'RequestTimeTooSkewed' | 'AuthorizationHeaderMalformed',
    message: string
  ) {
    super(message)
  }
}

/** Prüft die Signatur; wirft SigV4Error. `secretFor` liefert das Secret zum Access Key. */
export function verifySigV4(req: SigV4Request, secretFor: (accessKey: string) => string | null, now = Date.now()): SigV4Result {
  const q = req.url.indexOf('?')
  const rawPath = q < 0 ? req.url : req.url.slice(0, q)
  const rawQuery = q < 0 ? '' : req.url.slice(q + 1)
  const params = new URLSearchParams(rawQuery)
  const auth = header(req.headers, 'authorization')

  let accessKey: string, scope: string, signedHeaders: string[], signature: string, amzDate: string, payloadHash: string, query: string
  if (auth.startsWith('AWS4-HMAC-SHA256 ')) {
    const m = /Credential=([^,\s]+),\s*SignedHeaders=([^,\s]+),\s*Signature=([0-9a-f]{64})/.exec(auth)
    if (!m) throw new SigV4Error('AuthorizationHeaderMalformed', 'Authorization-Header unvollständig.')
    const [ak, ...rest] = m[1].split('/')
    accessKey = ak
    scope = rest.join('/')
    signedHeaders = m[2].split(';')
    signature = m[3]
    amzDate = header(req.headers, 'x-amz-date')
    payloadHash = header(req.headers, 'x-amz-content-sha256') || 'UNSIGNED-PAYLOAD'
    query = canonicalQuery(rawQuery)
  } else if (params.get('X-Amz-Algorithm') === 'AWS4-HMAC-SHA256') {
    const cred = params.get('X-Amz-Credential') ?? ''
    const [ak, ...rest] = cred.split('/')
    accessKey = ak
    scope = rest.join('/')
    signedHeaders = (params.get('X-Amz-SignedHeaders') ?? 'host').split(';')
    signature = params.get('X-Amz-Signature') ?? ''
    amzDate = params.get('X-Amz-Date') ?? ''
    payloadHash = 'UNSIGNED-PAYLOAD'
    query = canonicalQuery(rawQuery, 'X-Amz-Signature')
    const expires = Number(params.get('X-Amz-Expires') ?? 0)
    const t = Date.parse(amzDate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'))
    if (!expires || now > t + expires * 1000) throw new SigV4Error('AccessDenied', 'Signierter Link ist abgelaufen.')
  } else {
    throw new SigV4Error('AccessDenied', 'Anfrage ohne AWS-Signatur (SigV4).')
  }

  const secret = secretFor(accessKey)
  if (!secret) throw new SigV4Error('InvalidAccessKeyId', 'Unbekannter Access Key.')
  const [date, region, service] = scope.split('/')
  if (!date || !region || service !== 's3') throw new SigV4Error('AuthorizationHeaderMalformed', 'Ungültiger Credential-Scope.')
  const t = Date.parse(amzDate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'))
  if (!Number.isFinite(t)) throw new SigV4Error('AuthorizationHeaderMalformed', 'X-Amz-Date fehlt.')
  if (auth && Math.abs(now - t) > 15 * 60_000) throw new SigV4Error('RequestTimeTooSkewed', 'Uhrzeit weicht mehr als 15 Minuten ab.')

  const canonicalHeaders = signedHeaders.map(h => `${h}:${header(req.headers, h).trim().replace(/\s+/g, ' ')}\n`).join('')
  const canonical = [req.method, rawPath || '/', query, canonicalHeaders, signedHeaders.join(';'), payloadHash].join('\n')
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n')
  const expected = createHmac('sha256', signingKey(secret, date, region, service)).update(toSign).digest()
  const given = Buffer.from(signature, 'hex')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new SigV4Error('SignatureDoesNotMatch', 'Signatur passt nicht (Access Key/Secret prüfen).')
  }
  return { accessKey, payloadHash }
}

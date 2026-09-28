import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { request } from 'node:https'
import { isIP } from 'node:net'

/**
 * Ausgehende HTTPS-Anfragen an Adressen, die Nutzer bzw. Admins vorgeben (Website-Icons, SSO-Anbieter).
 * Schutz gegen SSRF: nur HTTPS auf Port 443, nur öffentliche Hostnamen, jede DNS-Auflösung wird beim
 * Verbindungsaufbau geprüft (auch bei Weiterleitungen → kein DNS-Rebinding), Zeit- und Größenlimit.
 */

const HOST_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i

export function validHost(host: string): boolean {
  return HOST_RE.test(host) && !/(^|\.)(localhost|local|internal|lan|home|corp)$/i.test(host)
}

export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number)
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    )
  }
  if (v === 6) {
    const x = ip.toLowerCase()
    if (x === '::' || x === '::1') return true
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x)
    if (mapped) return isPrivateIp(mapped[1])
    return /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith('ff')
  }
  return true
}

/** DNS-Auflösung, die private Adressen verweigert (wird beim Verbindungsaufbau benutzt → kein DNS-Rebinding). */
export function safeLookup(
  hostname: string,
  options: object,
  cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void
) {
  dnsLookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err, '')
    const list = addrs as LookupAddress[]
    if (!list.length || list.some(a => isPrivateIp(a.address))) return cb(Object.assign(new Error('blocked address'), { code: 'EBLOCKED' }), '')
    const all = (options as { all?: boolean }).all
    if (all) return cb(null, list)
    cb(null, list[0].address, list[0].family)
  })
}

/** Nur öffentliche HTTPS-Adressen (Port 443, kein Benutzer/Passwort in der URL). */
export function isSafeUrl(url: URL): boolean {
  return url.protocol === 'https:' && validHost(url.hostname) && (!url.port || url.port === '443') && !url.username && !url.password
}

export interface SafeResponse {
  status: number
  ok: boolean
  headers: Record<string, string | string[] | undefined>
  body: Buffer
  json<T = unknown>(): T
}

export interface SafeFetchInit {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  /** Standard 4 s */
  timeoutMs?: number
  /** Standard 256 KB */
  maxBytes?: number
  /** Nur bei GET; Standard 3 */
  maxRedirects?: number
}

export function safeFetch(input: string | URL, init: SafeFetchInit = {}, hops = 0): Promise<SafeResponse> {
  const method = init.method ?? 'GET'
  const max = init.maxBytes ?? 256 * 1024
  return new Promise((resolve, reject) => {
    let url: URL
    try {
      url = new URL(input)
    } catch {
      return reject(new Error('invalid url'))
    }
    if (!isSafeUrl(url)) return reject(new Error('invalid url'))
    const headers: Record<string, string> = { 'user-agent': 'FocVault/1.0', ...init.headers }
    if (init.body !== undefined) headers['content-length'] = String(Buffer.byteLength(init.body))
    const req = request(url, { method, lookup: safeLookup as never, timeout: init.timeoutMs ?? 4000, headers }, res => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        if (method !== 'GET' || hops >= (init.maxRedirects ?? 3)) return reject(new Error('too many redirects'))
        return safeFetch(new URL(res.headers.location, url), init, hops + 1).then(resolve, reject)
      }
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (c: Buffer) => {
        size += c.length
        if (size > max) {
          req.destroy()
          reject(new Error('too large'))
        } else chunks.push(c)
      })
      res.on('end', () => {
        const body = Buffer.concat(chunks)
        resolve({ status, ok: status >= 200 && status < 300, headers: res.headers, body, json: <T>() => JSON.parse(body.toString('utf8')) as T })
      })
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    if (init.body !== undefined) req.write(init.body)
    req.end()
  })
}

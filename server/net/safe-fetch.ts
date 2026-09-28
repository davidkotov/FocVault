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

function isPrivateIpv4(ip: string): boolean {
  const [a, b, c] = ip.split('.').map(Number)
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) || a >= 224
  )
}

/** IPv6 in 8 Gruppen à 16 Bit (auch mit eingebetteter IPv4-Schreibweise), sonst null. */
function ipv6Groups(ip: string): number[] | null {
  let x = ip.toLowerCase().split('%')[0]
  const v4 = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(x)
  if (v4) {
    if (isIP(v4[2]) !== 4) return null
    const [a, b, c, d] = v4[2].split('.').map(Number)
    x = `${v4[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const halves = x.split('::')
  if (halves.length > 2) return null
  const parse = (h: string) => (h ? h.split(':').map(g => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)) : [])
  const head = parse(halves[0])
  const tail = halves.length === 2 ? parse(halves[1]) : []
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0
  const groups = [...head, ...Array(Math.max(0, fill)).fill(0), ...tail]
  return groups.length === 8 && groups.every(g => Number.isInteger(g) && g >= 0 && g <= 0xffff) && fill >= 0 ? groups : null
}

export function isPrivateIp(ip: string): boolean {
  const bare = ip.split('%')[0]
  const v = isIP(bare)
  if (v === 4) return isPrivateIpv4(bare)
  if (v === 6) {
    const g = ipv6Groups(bare)
    if (!g) return true
    const v4 = `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`
    // IPv4-mapped (::ffff:a.b.c.d), IPv4-translated (::ffff:0:a.b.c.d) und IPv4-compatible (::a.b.c.d, inkl. :: und ::1)
    if (g.slice(0, 5).every(n => n === 0) && g[5] === 0xffff) return isPrivateIpv4(v4)
    if (g.slice(0, 4).every(n => n === 0) && g[4] === 0xffff && g[5] === 0) return isPrivateIpv4(v4)
    if (g.slice(0, 6).every(n => n === 0)) return isPrivateIpv4(v4)
    // Nur globales Unicast (2000::/3) zulassen – blockiert u. a. ULA fc00::/7, Link-/Site-local, Multicast,
    // NAT64 64:ff9b::/96 und 64:ff9b:1::/48, Discard 100::/64
    if ((g[0] & 0xe000) !== 0x2000) return true
    // 6to4 (2002::/16) und Teredo (2001::/32) betten IPv4-Adressen ein, Doku 2001:db8::/32, ORCHID 2001:10::/28
    if (g[0] === 0x2002) return true
    if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8 || (g[1] & 0xfff0) === 0x10 || (g[1] & 0xfff0) === 0x20)) return true
    return false
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
  /** Gesamtfrist inkl. Weiterleitungen und Body; Standard 10 s */
  deadlineMs?: number
  signal?: AbortSignal
}

export function safeFetch(input: string | URL, init: SafeFetchInit = {}, hops = 0): Promise<SafeResponse> {
  const method = init.method ?? 'GET'
  const max = init.maxBytes ?? 256 * 1024
  const signal = init.signal ?? AbortSignal.timeout(init.deadlineMs ?? 10_000)
  const next: SafeFetchInit = { ...init, signal }
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('deadline'))
    let url: URL
    try {
      url = new URL(input)
    } catch {
      return reject(new Error('invalid url'))
    }
    if (!isSafeUrl(url)) return reject(new Error('invalid url'))
    const headers: Record<string, string> = { 'user-agent': 'FocVault/1.0', ...init.headers }
    if (init.body !== undefined) headers['content-length'] = String(Buffer.byteLength(init.body))
    const req = request(url, { method, lookup: safeLookup as never, timeout: init.timeoutMs ?? 4000, headers, signal }, res => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        if (method !== 'GET' || hops >= (init.maxRedirects ?? 3)) return reject(new Error('too many redirects'))
        return safeFetch(new URL(res.headers.location, url), next, hops + 1).then(resolve, reject)
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
      res.on('aborted', () => reject(new Error('aborted')))
      res.on('close', () => {
        if (!res.complete) reject(new Error('aborted'))
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    if (init.body !== undefined) req.write(init.body)
    req.end()
  })
}

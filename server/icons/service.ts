import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { request } from 'node:https'
import { isIP } from 'node:net'

/**
 * Website-Icons für Passwort- und 2FA-Einträge.
 * Der Server holt das Icon einmalig beim Speichern; es wird verschlüsselt im Tresor abgelegt.
 * Schutz gegen SSRF: nur öffentliche Hosts, jede DNS-Auflösung (auch bei Weiterleitungen) wird geprüft.
 */

const HOST_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i
const MAX_HTML = 256 * 1024
const MAX_ICON = 100 * 1024
const TIMEOUT = 4000
const cache = new Map<string, { type: string; body: Buffer } | null>()

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
function safeLookup(hostname: string, options: object, cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) {
  dnsLookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err, '')
    const list = addrs as LookupAddress[]
    if (!list.length || list.some(a => isPrivateIp(a.address))) return cb(Object.assign(new Error('blocked address'), { code: 'EBLOCKED' }), '')
    const all = (options as { all?: boolean }).all
    if (all) return cb(null, list)
    cb(null, list[0].address, list[0].family)
  })
}

function get(url: URL, max: number, hops = 0): Promise<{ type: string; body: Buffer; url: URL }> {
  return new Promise((resolve, reject) => {
    if (url.protocol !== 'https:' || !validHost(url.hostname) || (url.port && url.port !== '443')) return reject(new Error('invalid url'))
    const req = request(
      url,
      { method: 'GET', lookup: safeLookup as never, timeout: TIMEOUT, headers: { 'user-agent': 'FocVault-Icon/1.0', accept: 'text/html,image/*;q=0.9,*/*;q=0.5' } },
      res => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume()
          if (hops >= 3) return reject(new Error('too many redirects'))
          return get(new URL(res.headers.location, url), max, hops + 1).then(resolve, reject)
        }
        if (status !== 200) {
          res.resume()
          return reject(new Error(`status ${status}`))
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
        res.on('end', () => resolve({ type: String(res.headers['content-type'] ?? ''), body: Buffer.concat(chunks), url }))
      }
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end()
  })
}

/** Beste Icon-Adresse aus dem HTML der Startseite (apple-touch-icon > icon mit Grösse > icon). */
export function pickIconHref(html: string): string | null {
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(m => m[0])
  const attr = (tag: string, name: string) => new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  const cands = links
    .map(tag => {
      const rel = (attr(tag, 'rel')?.slice(2).find(Boolean) ?? '').toLowerCase()
      const href = attr(tag, 'href')?.slice(2).find(Boolean)
      if (!href || !/\bicon\b/.test(rel)) return null
      const sizes = attr(tag, 'sizes')?.slice(2).find(Boolean) ?? ''
      const px = Number(/(\d+)x\d+/.exec(sizes)?.[1] ?? 0)
      const score = rel.includes('apple-touch-icon') ? 300 : px >= 32 ? 200 + Math.min(px, 256) / 10 : href.endsWith('.svg') ? 50 : 100
      return { href, score }
    })
    .filter((x): x is { href: string; score: number } => !!x)
    .sort((a, b) => b.score - a.score)
  return cands[0]?.href ?? null
}

export async function fetchIcon(host: string): Promise<{ type: string; body: Buffer } | null> {
  host = host.toLowerCase().replace(/^www\./, '')
  if (!validHost(host)) return null
  if (cache.has(host)) return cache.get(host)!
  let out: { type: string; body: Buffer } | null = null
  const tryIcon = async (u: URL) => {
    const r = await get(u, MAX_ICON)
    const type = r.type.split(';')[0].trim()
    if (!/^image\/(png|x-icon|vnd\.microsoft\.icon|jpeg|gif|webp|svg\+xml)$/.test(type) || r.body.length < 50) throw new Error('not an image')
    return { type, body: r.body }
  }
  for (const h of [host, `www.${host}`]) {
    try {
      const page = await get(new URL(`https://${h}/`), MAX_HTML)
      const href = pickIconHref(page.body.toString('utf8'))
      if (href) out = await tryIcon(new URL(href, page.url)).catch(() => null)
      if (!out) out = await tryIcon(new URL('/favicon.ico', page.url)).catch(() => null)
    } catch {
      out = await tryIcon(new URL(`https://${h}/favicon.ico`)).catch(() => null)
    }
    if (out) break
  }
  if (cache.size > 1000) cache.delete(cache.keys().next().value!)
  cache.set(host, out)
  return out
}

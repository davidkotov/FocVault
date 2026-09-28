'use client'

/**
 * Website-Icons: einmal über den eigenen Server geholt (kein Google-/Drittanbieter-Dienst),
 * auf 64 px verkleinert und als PNG-Data-URL verschlüsselt im Tresor gespeichert.
 */

const KNOWN: Record<string, string> = {
  google: 'google.com', gmail: 'google.com', github: 'github.com', gitlab: 'gitlab.com', microsoft: 'microsoft.com', 'microsoft 365': 'microsoft.com', outlook: 'outlook.com',
  apple: 'apple.com', icloud: 'icloud.com', amazon: 'amazon.com', aws: 'aws.amazon.com', 'aws root': 'aws.amazon.com', dropbox: 'dropbox.com', slack: 'slack.com', cloudflare: 'cloudflare.com',
  hetzner: 'hetzner.com', facebook: 'facebook.com', instagram: 'instagram.com', twitter: 'x.com', x: 'x.com', linkedin: 'linkedin.com', paypal: 'paypal.com', stripe: 'stripe.com',
  discord: 'discord.com', binance: 'binance.com', coinbase: 'coinbase.com', kraken: 'kraken.com', ubs: 'ubs.com', postfinance: 'postfinance.ch', swisscom: 'swisscom.ch', sbb: 'sbb.ch',
  digitec: 'digitec.ch', galaxus: 'galaxus.ch', proton: 'proton.me', notion: 'notion.so', figma: 'figma.com', vercel: 'vercel.com', netflix: 'netflix.com', spotify: 'spotify.com'
}

export function hostFromUrl(url?: string): string {
  if (!url) return ''
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

/** Nur bekannte Dienste (ohne Raten) – für Passwörter ohne Webseite. */
export function knownHost(name?: string): string {
  const n = (name ?? '').trim().toLowerCase()
  return KNOWN[n] ?? KNOWN[n.split(/[\s:(]/)[0]] ?? ''
}

/** Host aus einem Namen raten (2FA-Aussteller): bekannte Dienste, sonst „name.com“ nur bei einfachen Namen. */
export function hostFromName(name?: string): string {
  const n = (name ?? '').trim().toLowerCase()
  if (!n) return ''
  if (KNOWN[n]) return KNOWN[n]
  const first = n.split(/[\s:(]/)[0]
  if (KNOWN[first]) return KNOWN[first]
  if (/^[a-z0-9-]+\.[a-z]{2,}$/.test(n)) return n
  return /^[a-z0-9-]{3,30}$/.test(first) ? `${first}.com` : ''
}

const pending = new Map<string, Promise<string>>()

export function loadSiteIcon(host: string): Promise<string> {
  if (!host) return Promise.resolve('')
  let p = pending.get(host)
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(`/api/v1/icon?host=${encodeURIComponent(host)}`, { credentials: 'same-origin' })
        if (!res.ok) return ''
        const url = URL.createObjectURL(await res.blob())
        try {
          const img = new Image()
          img.decoding = 'async'
          await new Promise<void>((ok, fail) => {
            img.onload = () => ok()
            img.onerror = () => fail(new Error('decode'))
            img.src = url
          })
          const c = document.createElement('canvas')
          c.width = c.height = 64
          const ctx = c.getContext('2d')
          if (!ctx) return ''
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(img, 0, 0, 64, 64)
          return c.toDataURL('image/png')
        } finally {
          URL.revokeObjectURL(url)
        }
      } catch {
        return ''
      }
    })()
    pending.set(host, p)
  }
  return p
}

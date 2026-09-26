const isDev = process.env.NODE_ENV !== 'production'

/**
 * Security-Header (Audit H6, ARCHITECTURE §12.3).
 * - connect-src erlaubt https:/wss:, weil das Synapse SDK Storage-Provider mit dynamischen
 *   Hosts anspricht und WalletConnect über wss: läuft. Mit Fil One (Presigned URLs) wird das
 *   auf feste Hosts eingeschränkt.
 * - script-src braucht 'unsafe-inline' für die Inline-Skripte von Next.js; Nonces folgen mit
 *   Middleware. 'unsafe-eval' nur in Dev (React Refresh).
 * - Referrer-Policy no-referrer: Secure-Send-Seiten sollen nichts nach außen verraten.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' https: wss:${isDev ? ' ws: http://localhost:*' : ''}`,
  "frame-src 'self' https://verify.walletconnect.com https://verify.walletconnect.org",
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ['upgrade-insecure-requests'])
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()' },
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }])
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  }
}

export default nextConfig

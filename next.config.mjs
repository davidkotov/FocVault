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
  // 'wasm-unsafe-eval': Argon2id (hash-wasm) läuft als WebAssembly im Browser.
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  // Reown AppKit lädt eigene Fonts
  "font-src 'self' data: https://fonts.reown.com",
  `connect-src 'self' https: wss:${isDev ? ' ws: http://localhost:*' : ''}`,
  // Reown: Verify-API und der Iframe der eingebetteten E-Mail-/Social-Wallets
  "frame-src 'self' blob: https://verify.walletconnect.com https://verify.walletconnect.org https://secure.walletconnect.com https://secure.walletconnect.org https://secure.reown.com",
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
  experimental: {
    // instrumentation.ts: Hintergrund-Abgleich mit Filecoin Onchain Cloud
    instrumentationHook: true,
    // Zur Laufzeit aus node_modules laden statt bündeln (PGlite lädt WASM per Dateipfad).
    serverComponentsExternalPackages: ['@electric-sql/pglite', 'pg', '@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner']
  },
  // Reown/WalletConnect: optionale Node-Abhängigkeiten nicht bündeln (laut Reown-Doku für Next.js)
  webpack: config => {
    config.externals.push('pino-pretty', 'lokijs', 'encoding')
    // @wagmi/connectors → Base Account → Coinbase CDP-SDK importiert x402-Zahlungsmodule als
    // optionale, nicht installierte Abhängigkeiten. FocVault nutzt weder Base-Account-Zahlungen
    // noch x402 → leeres Modul statt Build-Fehler. React-Native-Storage (MetaMask-SDK) ebenso.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@x402': false,
      '@react-native-async-storage/async-storage': false
    }
    return config
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  }
}

export default nextConfig

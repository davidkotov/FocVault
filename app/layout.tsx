import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: 'FocVault',
  description: 'Zero-Knowledge File-Storage auf Filecoin Onchain Cloud',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'FocVault'
  },
  icons: {
    icon: '/icon192.png',
    apple: '/icon192.png'
  }
}

export const viewport: Viewport = {
  themeColor: '#101318',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}

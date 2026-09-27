import Link from 'next/link'
import type { ReactNode } from 'react'

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="20" fill="#0090ff" />
      <path d="M20 8a12 12 0 1 0 8.49 3.51" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
      <rect x="15" y="17" width="10" height="9" rx="2" fill="#fff" />
      <path d="M17 17v-2a3 3 0 0 1 6 0v2" stroke="#fff" strokeWidth="2.4" fill="none" />
    </svg>
  )
}

export default function AuthShell({ children, wide, foot }: { children: ReactNode; wide?: boolean; foot?: ReactNode }) {
  return (
    <main className="authshell">
      <Link href="/" className="authbrand">
        <BrandMark />
        Foc<span>Vault</span>
      </Link>
      <div className={`authcard ${wide ? 'wide' : ''}`}>{children}</div>
      <p className="authfoot">
        {foot ??
          'Ende-zu-Ende-verschlüsselt: Passphrase und Schlüssel verlassen nie dein Gerät. Gespeichert auf Filecoin über Fil One (EU).'}
      </p>
    </main>
  )
}

export function Working({ label }: { label: string }) {
  return (
    <div className="working" role="status">
      <div className="spinner" />
      {label}
    </div>
  )
}

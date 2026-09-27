import type { ReactNode } from 'react'
import { AccountProvider } from '@/features/account/AccountProvider'

/** Konto-Modus (Fil One): Registrierung, Anmeldung, Recovery, Dashboard, Admin. */
export default function KontoLayout({ children }: { children: ReactNode }) {
  return <AccountProvider>{children}</AccountProvider>
}

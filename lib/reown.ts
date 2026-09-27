/**
 * Reown (ehem. WalletConnect) AppKit: Login mit Google, Apple, E-Mail oder beliebiger Wallet.
 * Die Project-ID ist ein öffentlicher Client-Wert (Reown-Dashboard, erlaubte Domains dort pflegen).
 */
export const reownProjectId =
  process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? ''

export const reownEnabled = reownProjectId.length > 0

export const SIWE_STATEMENT = 'Bei FocVault anmelden. Diese Signatur ist keine Transaktion und kostet nichts.'

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

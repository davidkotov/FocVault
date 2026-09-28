import { getDb, type Db } from './db'
import { getStorage } from './storage'
import type { StorageProvider } from './storage/provider'
import type { SafeFetchInit, SafeResponse } from './net/safe-fetch'

/** Abhängigkeiten der Services – in Routen aus Singletons, in Tests aus In-Memory-Varianten. */
export interface Deps {
  db: Db
  storage: StorageProvider
  /** Netzwerk nach außen (SSO-Anbieter, DNS) – in Tests ersetzbar; Standard: SSRF-geschützter Abruf bzw. node:dns */
  net?: {
    fetch?: (url: string, init?: SafeFetchInit) => Promise<SafeResponse>
    resolveTxt?: (name: string) => Promise<string[][]>
  }
}

export async function deps(): Promise<Deps> {
  return { db: await getDb(), storage: getStorage() }
}

export async function audit(
  db: Db,
  accountId: string | null,
  actor: 'user' | 'system' | 'admin',
  kind: string,
  meta: Record<string, unknown> = {}
): Promise<void> {
  await db.query('INSERT INTO audit_events (account_id, actor, kind, meta) VALUES ($1, $2, $3, $4)', [
    accountId,
    actor,
    kind,
    JSON.stringify(meta)
  ])
}

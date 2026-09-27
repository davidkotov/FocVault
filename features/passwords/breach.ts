'use client'

import { api } from '@/features/api/client'
import { countInRange, sha1Hex } from '@/lib/password-health'
import type { SecretEntry } from '@/lib/vault'

/** Datenleck-Abgleich per k-Anonymität: id → wie oft das Passwort in bekannten Leaks vorkommt. */
export async function checkBreaches(entries: SecretEntry[]): Promise<Map<string, number>> {
  const byPw = new Map<string, string[]>()
  for (const e of entries) if (e.kind === 'password' && e.password) byPw.set(e.password, [...(byPw.get(e.password) ?? []), e.id])
  const ranges = new Map<string, Promise<string>>()
  const out = new Map<string, number>()
  for (const [pw, ids] of byPw) {
    const h = await sha1Hex(pw)
    const prefix = h.slice(0, 5)
    if (!ranges.has(prefix)) ranges.set(prefix, api.pwnedRange(prefix))
    const n = countInRange(await ranges.get(prefix)!, h.slice(5))
    for (const id of ids) out.set(id, n)
  }
  return out
}

'use client'

import { ApiClientError, api } from '@/features/api/client'
import { countInRange, sha1Hex } from '@/lib/password-health'
import type { SecretEntry } from '@/lib/vault'

export interface BreachResult {
  /** id → Anzahl Treffer in bekannten Leaks */
  counts: Map<string, number>
  /** Einträge, die nicht geprüft werden konnten (Netz, Zeitlimit, Rate-Limit) */
  unchecked: number
}

const PARALLEL = 6

/** Datenleck-Abgleich per k-Anonymität; Teilfehler brechen nicht ab. */
export async function checkBreaches(entries: SecretEntry[], onProgress?: (done: number, total: number) => void): Promise<BreachResult> {
  const byPw = new Map<string, string[]>()
  for (const e of entries) if (e.kind === 'password' && e.password) byPw.set(e.password, [...(byPw.get(e.password) ?? []), e.id])
  const hashed = await Promise.all([...byPw].map(async ([pw, ids]) => ({ h: await sha1Hex(pw), ids })))
  const byPrefix = new Map<string, typeof hashed>()
  for (const x of hashed) byPrefix.set(x.h.slice(0, 5), [...(byPrefix.get(x.h.slice(0, 5)) ?? []), x])
  const counts = new Map<string, number>()
  let unchecked = 0
  let done = 0
  let stop = false
  const queue = [...byPrefix]
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const [prefix, list] = item
      if (!stop) {
        try {
          const body = await api.pwnedRange(prefix)
          for (const x of list) {
            const n = countInRange(body, x.h.slice(5))
            for (const id of x.ids) counts.set(id, n)
          }
        } catch (e) {
          if (e instanceof ApiClientError && e.code === 'RATE_LIMITED') stop = true
          unchecked += list.reduce((n, x) => n + x.ids.length, 0)
        }
      } else unchecked += list.reduce((n, x) => n + x.ids.length, 0)
      onProgress?.(++done, byPrefix.size)
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker))
  return { counts, unchecked }
}

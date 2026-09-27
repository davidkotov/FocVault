import type { SecretEntry } from './vault'

/**
 * Passwort-Check im Browser: Stärke (Schätzung der Entropie mit Abzügen für typische Muster),
 * Mehrfachverwendung und – separat – Datenlecks per k-Anonymität (nur 5 Zeichen des SHA-1-Hashes).
 */
export type Strength = 0 | 1 | 2 | 3 | 4

const COMMON = [
  'password', 'passwort', 'qwertz', 'qwerty', 'azerty', '123456', 'letmein', 'welcome', 'willkommen', 'admin',
  'iloveyou', 'monkey', 'dragon', 'sommer', 'summer', 'winter', 'hallo', 'hello', 'schatz', 'master', 'secret', 'geheim'
]

export function estimateBits(pw: string): number {
  if (!pw) return 0
  let pool = 0
  if (/[a-z]/.test(pw)) pool += 26
  if (/[A-Z]/.test(pw)) pool += 26
  if (/[0-9]/.test(pw)) pool += 10
  if (/[^A-Za-z0-9]/.test(pw)) pool += 33
  let bits = pw.length * Math.log2(Math.max(pool, 1))
  const lower = pw.toLowerCase()
  if (COMMON.some(w => lower.includes(w))) bits -= 28
  if (/(.)\1{2,}/.test(pw)) bits -= 10
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef)/i.test(pw)) bits -= 12
  if (/^[A-Za-z]+\d{1,4}[!.?]?$/.test(pw)) bits -= 10
  if (/(19|20)\d{2}/.test(pw)) bits -= 6
  return Math.max(0, Math.round(bits))
}

export function strength(pw: string): Strength {
  const b = estimateBits(pw)
  if (pw.length < 8 || b < 35) return 0
  if (b < 50) return 1
  if (b < 65) return 2
  if (b < 85) return 3
  return 4
}

/** Einträge, deren Passwort auch in anderen Einträgen vorkommt: id → Anzahl gleicher Passwörter. */
export function reusedPasswords(entries: SecretEntry[]): Map<string, number> {
  const byPw = new Map<string, string[]>()
  for (const e of entries) {
    if (e.kind !== 'password' || !e.password) continue
    byPw.set(e.password, [...(byPw.get(e.password) ?? []), e.id])
  }
  const out = new Map<string, number>()
  for (const ids of byPw.values()) if (ids.length > 1) for (const id of ids) out.set(id, ids.length)
  return out
}

export async function sha1Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

/** Antwort der Range-API („SUFFIX:COUNT“ je Zeile) nach dem eigenen Suffix durchsuchen. */
export function countInRange(body: string, suffix: string): number {
  for (const line of body.split('\n')) {
    const [s, n] = line.trim().split(':')
    if (s === suffix) return Number(n) || 0
  }
  return 0
}

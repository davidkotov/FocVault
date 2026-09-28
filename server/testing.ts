import { randomBytes } from 'node:crypto'
import { openMemoryDb, type Db } from './db'
import { MemoryProvider } from './storage/memory'
import type { Deps } from './deps'
import { registerSchema } from './accounts/schemas'
import { register, type RequestMeta } from './accounts/service'
import { findSession, type SessionInfo } from './auth/sessions'

/** Nur für Tests: frische In-Memory-Datenbank + In-Memory-Storage. */
export async function testDeps(): Promise<Deps & { storage: MemoryProvider }> {
  return { db: await openMemoryDb(), storage: new MemoryProvider() }
}

export const META: RequestMeta = { ip: '127.0.0.1', userAgent: 'vitest' }

export function b64(n: number): string {
  return randomBytes(n).toString('base64url')
}

export function kdf() {
  return { alg: 'argon2id' as const, v: 1 as const, salt: b64(16), m: 65_536, t: 3, p: 1 }
}

export function registerInput(email: string) {
  return {
    email,
    authKey: b64(32),
    recoveryAuthKey: b64(32),
    kdf: kdf(),
    envelopes: [
      { kekType: 'passphrase' as const, iv: b64(12), cipher: b64(48) },
      { kekType: 'recovery' as const, iv: b64(12), cipher: b64(48) }
    ]
  }
}

export async function newAccount(deps: Deps, email: string) {
  const input = registerSchema.parse(registerInput(email))
  const result = await register(deps, input, META)
  const session = (await findSession(deps.db, result.token)) as SessionInfo
  return { input, result, session }
}

/**
 * Nur für Tests (Races): Datenbank, die nach jeder Anweisung – auch innerhalb von Transaktionen –
 * `after(sql)` abwartet. So lässt sich ein gleichzeitiger Vorgang genau zwischen zwei Anweisungen einschieben.
 */
export function afterQuery(db: Db, after: (sql: string) => Promise<void>): Db {
  return {
    driver: db.driver,
    async query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]> {
      const rows = await db.query<T>(sql, params)
      await after(sql)
      return rows
    },
    exec: sql => db.exec(sql),
    tx: fn => db.tx(inner => fn(afterQuery(inner, after))),
    close: () => db.close()
  }
}

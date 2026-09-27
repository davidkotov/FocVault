import path from 'node:path'
import { dataDir, isProd } from '../shared/env'
import { migrate } from './migrations'

/**
 * Minimale DB-Schnittstelle über parametrisiertes SQL. Zwei Treiber, gleiches SQL:
 * - lokal/Tests: PGlite (echtes Postgres als WASM, Daten in `.data/pglite` oder im RAM)
 * - Production: node-postgres über DATABASE_URL (z. B. Neon EU)
 * Hinweis: bigint/numeric werden in Queries nach float8 gecastet, damit beide Treiber
 * JS-Zahlen liefern (Größen bis 2^53 sind exakt).
 */
export interface Db {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>
  exec(sql: string): Promise<void>
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>
  close(): Promise<void>
  readonly driver: 'pglite' | 'postgres'
}

function toParam(v: unknown): unknown {
  if (v instanceof Uint8Array && !Buffer.isBuffer(v)) return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
  return v
}

async function openPglite(dir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = dir ? new PGlite(dir) : new PGlite()
  await pg.waitReady
  type Q = { query: (s: string, p?: unknown[]) => Promise<{ rows: any[] }>; exec: (s: string) => Promise<unknown> }
  const wrap = (q: Q, inTx: boolean): Db => ({
    driver: 'pglite',
    async query(sql, params = []) {
      const r = await q.query(sql, params.map(toParam))
      return r.rows
    },
    async exec(sql) {
      await q.exec(sql)
    },
    tx(fn) {
      if (inTx) return fn(wrap(q, true))
      return pg.transaction(t => fn(wrap(t as unknown as Q, true)))
    },
    close: () => pg.close()
  })
  return wrap(pg as unknown as Q, false)
}

async function openPostgres(url: string): Promise<Db> {
  const { Pool } = await import('pg')
  const pool = new Pool({ connectionString: url, max: 5 })
  type C = { query: (s: string, p?: unknown[]) => Promise<{ rows: any[] }> }
  const fromClient = (c: C): Db => ({
    driver: 'postgres',
    query: async (sql, params = []) => (await c.query(sql, params.map(toParam))).rows,
    exec: async sql => {
      await c.query(sql)
    },
    tx: fn => fn(fromClient(c)),
    close: async () => undefined
  })
  return {
    driver: 'postgres',
    query: async (sql, params = []) => (await pool.query(sql, params.map(toParam))).rows,
    exec: async sql => {
      await pool.query(sql)
    },
    tx: async fn => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await fn(fromClient(client))
        await client.query('COMMIT')
        return result
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw e
      } finally {
        client.release()
      }
    },
    close: () => pool.end()
  }
}

const g = globalThis as unknown as { __fvDb?: Promise<Db> }

/** Prozessweiter Singleton (überlebt Hot-Reload in Dev). */
export function getDb(): Promise<Db> {
  if (!g.__fvDb) {
    g.__fvDb = (async () => {
      const url = process.env.DATABASE_URL
      let db: Db
      if (url) {
        db = await openPostgres(url)
      } else {
        if (isProd) throw new Error('DATABASE_URL fehlt (Production).')
        db = await openPglite(path.join(dataDir(), 'pglite'))
      }
      await migrate(db)
      return db
    })().catch(e => {
      g.__fvDb = undefined
      throw e
    })
  }
  return g.__fvDb
}

/** Frische In-Memory-Datenbank mit Schema – für Tests. */
export async function openMemoryDb(): Promise<Db> {
  const db = await openPglite()
  await migrate(db)
  return db
}

export function isUniqueViolation(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: string }).code === '23505'
}

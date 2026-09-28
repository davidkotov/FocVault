import { describe, expect, it } from 'vitest'
import { newAccount, testDeps } from '../testing'
import { deleteAccount } from './delete'
import { completeObject, createObject } from '../objects/service'
import { objectPieceKey } from '../storage/provider'
import { findSession } from '../auth/sessions'
import type { Deps } from '../deps'
import type { SessionInfo } from '../auth/sessions'

async function storedObject(deps: Deps & { storage: { writeStream: Deps['storage']['writeStream'] } }, session: SessionInfo) {
  const created = await createObject(deps, session, { fmt: 'frame2', pieces: [{ index: 0, cipherBytes: 100 }] })
  const key = objectPieceKey(session.accountId, created.objectId, 0)
  await deps.storage.writeStream(key, new Blob([new Uint8Array(100)]).stream(), 100)
  await completeObject(deps, session, created.objectId)
  return { objectId: created.objectId, key }
}

async function s3Object(deps: Deps, session: SessionInfo, objectId: string, lock: { mode: 'GOVERNANCE' | 'COMPLIANCE'; until: Date } | null = null) {
  await deps.db.query(`INSERT INTO s3_buckets (account_id, name) VALUES ($1, 'backup') ON CONFLICT DO NOTHING`, [session.accountId])
  await deps.db.query(
    `INSERT INTO s3_objects (account_id, bucket, key, object_id, size, etag, content_type, lock_mode, retain_until)
     VALUES ($1, 'backup', $2, $3, 100, 'etag', 'application/octet-stream', $4, $5)`,
    [session.accountId, `k-${objectId}`, objectId, lock?.mode ?? null, lock?.until ?? null]
  )
}

describe('Konto löschen', () => {
  it('nur mit richtiger Passphrase, löscht Speicher und Konto; Abo blockiert', async () => {
    const deps = await testDeps()
    const { session, input, result } = await newAccount(deps, 'weg@example.com')
    const { key } = await storedObject(deps, session)

    await expect(deleteAccount(deps, session, { kind: 'passphrase', authKey: input.recoveryAuthKey, confirm: 'DELETE' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })

    await deps.db.query(`UPDATE accounts SET stripe_subscription_id = 'sub_1' WHERE id = $1`, [session.accountId])
    await expect(deleteAccount(deps, session, { kind: 'passphrase', authKey: input.authKey, confirm: 'DELETE' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await deps.db.query(`UPDATE accounts SET stripe_subscription_id = NULL WHERE id = $1`, [session.accountId])

    const r = await deleteAccount(deps, session, { kind: 'recovery', authKey: input.recoveryAuthKey, confirm: 'DELETE' })
    expect(r.deletedObjects).toBe(1)
    expect(await deps.db.query('SELECT id FROM accounts WHERE id = $1', [session.accountId])).toHaveLength(0)
    expect(await findSession(deps.db, result.token)).toBeNull()
    expect(await deps.storage.head(key)).toBeNull()
  })

  it('mit S3-Objekten und offenem Multipart-Upload: klappt, Speicher wird erst nach dem Commit gelöscht', async () => {
    const deps = await testDeps()
    const { session, input } = await newAccount(deps, 's3weg@example.com')
    const a = await storedObject(deps, session)
    const b = await storedObject(deps, session)
    await s3Object(deps, session, a.objectId)
    await s3Object(deps, session, b.objectId, { mode: 'GOVERNANCE', until: new Date(Date.now() + 86_400_000) })
    await deps.db.query(
      `INSERT INTO s3_uploads (upload_id, account_id, bucket, key, object_id, content_type) VALUES ('up1', $1, 'backup', 'mp', $2, 'application/octet-stream')`,
      [session.accountId, b.objectId]
    )
    await deps.db.query(`INSERT INTO s3_parts (upload_id, part_number, size, etag) VALUES ('up1', 1, 100, 'e')`)

    const accountAtDelete: number[] = []
    const origDelete = deps.storage.delete.bind(deps.storage)
    deps.storage.delete = async keys => {
      accountAtDelete.push((await deps.db.query('SELECT id FROM accounts WHERE id = $1', [session.accountId])).length)
      return origDelete(keys)
    }

    const r = await deleteAccount(deps, session, { kind: 'passphrase', authKey: input.authKey, confirm: 'DELETE' })
    expect(r.deletedObjects).toBe(2)
    expect(accountAtDelete.length).toBeGreaterThan(0)
    expect(accountAtDelete.every(n => n === 0)).toBe(true)
    expect(await deps.storage.head(a.key)).toBeNull()
    expect(await deps.storage.head(b.key)).toBeNull()
    expect(await deps.db.query('SELECT 1 FROM s3_objects WHERE account_id = $1', [session.accountId])).toHaveLength(0)
    expect(await deps.db.query(`SELECT 1 FROM s3_uploads WHERE upload_id = 'up1'`)).toHaveLength(0)
  })

  it('COMPLIANCE-Aufbewahrung blockiert ohne Datenverlust; Speicherfehler nach dem Commit wirft nicht', async () => {
    const deps = await testDeps()
    const { session, input } = await newAccount(deps, 'rollback@example.com')
    const a = await storedObject(deps, session)
    await s3Object(deps, session, a.objectId, { mode: 'COMPLIANCE', until: new Date(Date.now() + 86_400_000) })
    // COMPLIANCE-Aufbewahrung blockiert – nichts wird gelöscht
    await expect(deleteAccount(deps, session, { kind: 'passphrase', authKey: input.authKey, confirm: 'DELETE' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await deps.storage.head(a.key)).not.toBeNull()
    expect(await deps.db.query('SELECT id FROM accounts WHERE id = $1', [session.accountId])).toHaveLength(1)

    await deps.db.query(`UPDATE s3_objects SET retain_until = now() - interval '1 day' WHERE account_id = $1`, [session.accountId])
    deps.storage.delete = async () => {
      throw new Error('Speicher weg')
    }
    await expect(deleteAccount(deps, session, { kind: 'passphrase', authKey: input.authKey, confirm: 'DELETE' })).resolves.toMatchObject({ deletedObjects: 1 })
    expect(await deps.db.query('SELECT id FROM accounts WHERE id = $1', [session.accountId])).toHaveLength(0)
    const failed = await deps.db.query<{ meta: { keys: string[] } }>(`SELECT meta FROM audit_events WHERE kind = 'account.storage_cleanup_failed' AND account_id = $1`, [session.accountId])
    expect(failed[0]?.meta.keys).toContain(a.key)
  })

  it('offenes Pay-as-you-go blockiert', async () => {
    const deps = await testDeps()
    const { session, input } = await newAccount(deps, 'payg@example.com')
    const del = () => deleteAccount(deps, session, { kind: 'passphrase', authKey: input.authKey, confirm: 'DELETE' })

    // aktiv
    await deps.db.query(`UPDATE accounts SET payg_enabled = true WHERE id = $1`, [session.accountId])
    await expect(del()).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('Pay-as-you-go ist noch aktiv') })
    await deps.db.query(`UPDATE accounts SET payg_enabled = false WHERE id = $1`, [session.accountId])

    // laufender Monat mit abrechenbarer Nutzung (500 GB), noch kein Monatsabschluss
    const today = new Date().toISOString().slice(0, 10)
    await deps.db.query(`INSERT INTO usage_daily (account_id, day, bytes) VALUES ($1, $2, $3)`, [session.accountId, today, 500e9 * 31])
    await expect(del()).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('Abrechnung aus') })
    await deps.db.query(`DELETE FROM usage_daily WHERE account_id = $1`, [session.accountId])

    // unbezahlte Rechnung
    await deps.db.query(
      `INSERT INTO payg_invoices (account_id, period, billable_gb, amount, currency, status) VALUES ($1, '2026-01', 100, 3, 'CHF', 'failed')`,
      [session.accountId]
    )
    await expect(del()).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('unbezahlte') })
    await deps.db.query(`UPDATE payg_invoices SET status = 'charged' WHERE account_id = $1`, [session.accountId])

    // Übertrag unter Mindestbetrag
    await deps.db.query(
      `INSERT INTO payg_invoices (account_id, period, billable_gb, amount, carried_out, currency, status) VALUES ($1, '2026-02', 1, 0.2, 0.2, 'CHF', 'carried')`,
      [session.accountId]
    )
    await expect(del()).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('Restbetrag') })
    await deps.db.query(`UPDATE payg_invoices SET carried_out = 0 WHERE account_id = $1`, [session.accountId])

    // Nutzung innerhalb der Gratis-Quota ist nicht abrechenbar → erlaubt
    await deps.db.query(`INSERT INTO usage_daily (account_id, day, bytes) VALUES ($1, $2, 1000)`, [session.accountId, today])
    await expect(del()).resolves.toMatchObject({ deletedObjects: 0 })
  })
})

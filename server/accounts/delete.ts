import { z } from 'zod'
import { audit, type Deps } from '../deps'
import type { Db } from '../db'
import type { SessionInfo } from '../auth/sessions'
import { verifySecret, type SecretHashParams } from '../auth/passwords'
import { rateLimit } from '../auth/ratelimit'
import { ApiError } from '../shared/errors'
import { b64uDecode } from '../shared/bytes'
import { getPricing } from '../billing/settings'
import { paygEstimate, type Currency } from '../../lib/pricing'

export const deleteAccountSchema = z.object({
  kind: z.enum(['passphrase', 'recovery']),
  authKey: z.string().min(20).max(200),
  confirm: z.literal('DELETE')
})

const STORAGE_DELETE_BATCH = 500

/**
 * Offene Pay-as-you-go-Beträge: Tagesstände in noch nicht abgerechneten Monaten (inkl. laufendem Monat),
 * unbezahlte Monatsrechnungen (recorded/failed) und ein Übertrag unter dem Mindestbetrag.
 * Beim Löschen würden diese Zeilen per CASCADE verschwinden – deshalb vorher blockieren.
 */
async function assertNoOpenPayg(db: Db, accountId: string, paygEnabled: boolean, currency: Currency): Promise<void> {
  if (paygEnabled) {
    throw new ApiError(
      'BAD_REQUEST',
      'Pay-as-you-go ist noch aktiv. Bitte schalte es unter „Pakete & Speicher“ ab. Nach dem Monatsabschluss (am 1. des Folgemonats) und bezahlter Schlussrechnung kannst du das Konto löschen.'
    )
  }
  const unpaid = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM payg_invoices WHERE account_id = $1 AND status IN ('recorded', 'failed')`,
    [accountId]
  )
  if ((unpaid[0]?.n ?? 0) > 0) {
    throw new ApiError('BAD_REQUEST', 'Es gibt noch eine unbezahlte Pay-as-you-go-Rechnung. Bitte begleiche sie zuerst (z. B. über Guthaben oder deine Zahlungsmethode), danach kannst du das Konto löschen.')
  }
  const last = await db.query<{ carried_out: number }>(
    `SELECT carried_out::float8 AS carried_out FROM payg_invoices WHERE account_id = $1 ORDER BY period DESC LIMIT 1`,
    [accountId]
  )
  if (Number(last[0]?.carried_out ?? 0) > 0) {
    throw new ApiError('BAD_REQUEST', 'Aus Pay-as-you-go ist noch ein kleiner Restbetrag offen (unter dem Mindestbetrag). Bitte wende dich an den Support, um ihn zu begleichen, bevor du das Konto löschst.')
  }
  // Monate mit Tagesständen, für die noch kein Monatsabschluss existiert (typisch: laufender Monat)
  const open = await db.query<{ period: string; total: number; days: number }>(
    `SELECT to_char(u.day, 'YYYY-MM') AS period, SUM(u.bytes)::float8 AS total,
            extract(day FROM (date_trunc('month', min(u.day)) + interval '1 month - 1 day'))::int AS days
       FROM usage_daily u
      WHERE u.account_id = $1
        AND NOT EXISTS (SELECT 1 FROM payg_invoices i WHERE i.account_id = u.account_id AND i.period = to_char(u.day, 'YYYY-MM'))
      GROUP BY to_char(u.day, 'YYYY-MM')`,
    [accountId]
  )
  if (!open.length) return
  const pricing = await getPricing(db)
  const owed = open.some(p => paygEstimate(pricing, Number(p.total) / Math.max(1, Number(p.days)), currency).amount > 0)
  if (owed) {
    throw new ApiError(
      'BAD_REQUEST',
      'Für Pay-as-you-go steht noch eine Abrechnung aus. Die Schlussrechnung wird am 1. des Folgemonats erstellt – sobald sie bezahlt ist, kannst du das Konto löschen.'
    )
  }
}

/**
 * Konto endgültig löschen: prüft Passphrase oder Recovery-Kit, löscht in EINER Transaktion das Konto samt
 * aller verknüpften Daten und erst nach dem Commit die verschlüsselten Datenstücke im Speicher. So bleibt bei
 * einem DB-Fehler alles erhalten; schlägt nur das Löschen im Speicher fehl, wird das protokolliert (Audit),
 * damit die Wartung die verwaisten Keys nachträglich entfernen kann.
 * Bereits auf Filecoin gesicherte Pakete sind verschlüsselt und laufen mit ihrer Speicherdauer aus.
 */
export async function deleteAccount(deps: Deps, session: SessionInfo, input: z.output<typeof deleteAccountSchema>): Promise<{ deletedObjects: number }> {
  rateLimit(`account:delete:${session.accountId}`, 5, 15 * 60_000)
  const secret = (
    await deps.db.query<{ hash: Uint8Array; salt: Uint8Array; params: SecretHashParams }>(
      'SELECT hash, salt, params FROM auth_secrets WHERE account_id = $1 AND kind = $2',
      [session.accountId, input.kind]
    )
  )[0]
  if (!secret || !(await verifySecret(b64uDecode(input.authKey), secret.hash, secret.salt, secret.params))) {
    throw new ApiError('INVALID_CREDENTIALS', input.kind === 'passphrase' ? 'Die Passphrase stimmt nicht.' : 'Die Recovery-Wörter passen nicht zu diesem Konto.')
  }

  const { keys, deletedObjects } = await deps.db.tx(async tx => {
    // Zeilensperre: neue Uploads (createObject sperrt dieselbe Zeile, Inserts in objects brauchen einen
    // Key-Share-Lock) warten, bis die Löschung durch ist, und scheitern dann am fehlenden Konto.
    const acc = (
      await tx.query<{ stripe_subscription_id: string | null; payg_enabled: boolean; currency: Currency }>(
        'SELECT stripe_subscription_id, payg_enabled, currency FROM accounts WHERE id = $1 FOR UPDATE',
        [session.accountId]
      )
    )[0]
    if (!acc) throw new ApiError('NOT_FOUND', 'Konto nicht gefunden.')
    if (acc.stripe_subscription_id) {
      throw new ApiError('BAD_REQUEST', 'Bitte kündige zuerst dein Abo unter „Pakete & Speicher“. Nach dem Ende der Laufzeit kannst du das Konto löschen.')
    }
    const members = await tx.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM family_members WHERE owner_account_id = $1 AND account_id <> $1',
      [session.accountId]
    )
    if ((members[0]?.n ?? 0) > 0) {
      throw new ApiError('BAD_REQUEST', 'Du verwaltest noch eine Family bzw. ein Team mit Mitgliedern. Entferne sie zuerst unter „Familie & Team“.')
    }
    await assertNoOpenPayg(tx, session.accountId, acc.payg_enabled, acc.currency)

    // S3 Object Lock: COMPLIANCE-Aufbewahrung darf niemand vorzeitig aufheben – auch nicht durch Kontolöschung.
    const locked = await tx.query<{ n: number; until: string | null }>(
      `SELECT count(*)::int AS n, max(retain_until) AS until FROM s3_objects
        WHERE account_id = $1 AND lock_mode = 'COMPLIANCE' AND retain_until > now()`,
      [session.accountId]
    )
    if ((locked[0]?.n ?? 0) > 0) {
      const until = locked[0]!.until ? new Date(locked[0]!.until).toISOString().slice(0, 10) : '?'
      throw new ApiError(
        'FORBIDDEN',
        `In der Speicher-API liegen ${locked[0]!.n} Objekte mit COMPLIANCE-Aufbewahrung (bis ${until}). Sie dürfen vorher nicht gelöscht werden – das Konto kann erst danach gelöscht werden.`
      )
    }

    // Alle Storage-Keys innerhalb der Sperre einsammeln (auch bereits gelöschte Objekte: Löschen ist idempotent)
    const pieces = await tx.query<{ storage_key: string }>(
      `SELECT p.storage_key FROM object_pieces p JOIN objects o ON o.id = p.object_id WHERE o.owner_account_id = $1`,
      [session.accountId]
    )
    const indexes = await tx.query<{ storage_key: string }>('SELECT storage_key FROM vault_indexes WHERE account_id = $1', [session.accountId])
    const objects = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM objects WHERE owner_account_id = $1 AND state <> 'deleted'`, [session.accountId])

    // s3_objects/s3_uploads verweisen ohne ON DELETE CASCADE auf objects – vorher selbst entfernen,
    // sonst scheitert DELETE FROM accounts an der Fremdschlüssel-Prüfung (s3_parts hängt per CASCADE an s3_uploads).
    await tx.query('DELETE FROM s3_uploads WHERE account_id = $1 OR object_id IN (SELECT id FROM objects WHERE owner_account_id = $1)', [session.accountId])
    await tx.query('DELETE FROM s3_objects WHERE account_id = $1 OR object_id IN (SELECT id FROM objects WHERE owner_account_id = $1)', [session.accountId])
    await tx.query('DELETE FROM accounts WHERE id = $1', [session.accountId])
    return { keys: [...pieces, ...indexes].map(r => r.storage_key), deletedObjects: objects[0]?.n ?? 0 }
  })

  // Erst nach dem Commit: Datenstücke im Speicher löschen. Fehler hier dürfen nicht mehr werfen – das Konto ist weg.
  for (let i = 0; i < keys.length; i += STORAGE_DELETE_BATCH) {
    const batch = keys.slice(i, i + STORAGE_DELETE_BATCH)
    try {
      await deps.storage.delete(batch)
    } catch (e) {
      console.error('[konto] Speicher nach Kontolöschung nicht vollständig bereinigt:', (e as Error).message)
      await audit(deps.db, session.accountId, 'system', 'account.storage_cleanup_failed', { keys: batch }).catch(() => undefined)
    }
  }
  await audit(deps.db, session.accountId, 'user', 'account.deleted', { objects: deletedObjects, keys: keys.length }).catch(() => undefined)
  return { deletedObjects }
}

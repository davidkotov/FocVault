import { z } from 'zod'
import type { Deps } from '../deps'
import type { SessionInfo } from '../auth/sessions'
import { verifySecret, type SecretHashParams } from '../auth/passwords'
import { rateLimit } from '../auth/ratelimit'
import { ApiError } from '../shared/errors'
import { b64uDecode } from '../shared/bytes'

export const deleteAccountSchema = z.object({
  kind: z.enum(['passphrase', 'recovery']),
  authKey: z.string().min(20).max(200),
  confirm: z.literal('DELETE')
})

/**
 * Konto endgültig löschen: prüft Passphrase oder Recovery-Kit, löscht alle verschlüsselten Datenstücke im
 * Speicher und danach das Konto samt aller verknüpften Daten (Fremdschlüssel mit ON DELETE CASCADE).
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
  const acc = (await deps.db.query<{ stripe_subscription_id: string | null }>('SELECT stripe_subscription_id FROM accounts WHERE id = $1', [session.accountId]))[0]
  if (!acc) throw new ApiError('NOT_FOUND', 'Konto nicht gefunden.')
  if (acc.stripe_subscription_id) {
    throw new ApiError('BAD_REQUEST', 'Bitte kündige zuerst dein Abo unter „Pakete & Speicher“. Nach dem Ende der Laufzeit kannst du das Konto löschen.')
  }
  const members = await deps.db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM family_members WHERE owner_account_id = $1 AND account_id <> $1',
    [session.accountId]
  )
  if ((members[0]?.n ?? 0) > 0) {
    throw new ApiError('BAD_REQUEST', 'Du verwaltest noch eine Family bzw. ein Team mit Mitgliedern. Entferne sie zuerst unter „Familie & Team“.')
  }

  const pieces = await deps.db.query<{ storage_key: string }>(
    `SELECT p.storage_key FROM object_pieces p JOIN objects o ON o.id = p.object_id
      WHERE o.owner_account_id = $1 AND o.state <> 'deleted'`,
    [session.accountId]
  )
  const indexes = await deps.db.query<{ storage_key: string }>('SELECT storage_key FROM vault_indexes WHERE account_id = $1', [session.accountId])
  const objects = await deps.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM objects WHERE owner_account_id = $1 AND state <> 'deleted'`, [session.accountId])
  const keys = [...pieces, ...indexes].map(r => r.storage_key)
  for (let i = 0; i < keys.length; i += 500) await deps.storage.delete(keys.slice(i, i + 500))

  await deps.db.query('DELETE FROM accounts WHERE id = $1', [session.accountId])
  return { deletedObjects: objects[0]?.n ?? 0 }
}

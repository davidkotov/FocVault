import { beforeEach, describe, expect, it } from 'vitest'
import { resetRateLimits } from '../auth/ratelimit'
import { changePlan } from '../billing/service'
import { createInvite, joinFamily } from '../family/service'
import { completeObject, createObject } from '../objects/service'
import { createShare } from '../shares/service'
import { objectPieceKey } from '../storage/provider'
import { newAccount, testDeps } from '../testing'
import { putIndex } from '../vault/service'
import { accountView } from '../accounts/service'
import {
  complianceData,
  createRecoveryRequest,
  decideRecoveryRequest,
  DEFAULT_POLICY,
  escrowMasterKey,
  grantRecoveryKey,
  recoveryVault,
  setMemberRole,
  setRecoveryKey,
  setTeamPolicy,
  teamAdminView,
  teamAudit,
  attestPassphrase
} from './service'

const b64u = (n: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString('base64url')
const jwk = () => ({ kty: 'EC' as const, crv: 'P-256' as const, x: b64u(32), y: b64u(32) })
const wrapped = () => ({ epk: jwk(), iv: b64u(12), ct: b64u(48) })

async function team() {
  const deps = await testDeps()
  const { session: ceo } = await newAccount(deps, 'ceo@firma.ch')
  const { session: cto } = await newAccount(deps, 'cto@firma.ch')
  const { session: dev } = await newAccount(deps, 'dev@firma.ch')
  await changePlan(deps, ceo, { plan: 'business', tier: 'starter', extraSeats: 0, interval: 'month', currency: 'CHF' })
  await joinFamily(deps, cto, (await createInvite(deps, ceo)).token)
  await joinFamily(deps, dev, (await createInvite(deps, ceo)).token)
  return { deps, ceo, cto, dev }
}

describe('Admin-Konsole (Business)', () => {
  beforeEach(() => resetRateLimits())

  it('Rollen: nur Inhaber vergibt Admin; Mitglieder sehen keine Konsole; Richtlinie gilt fürs Team', async () => {
    const { deps, ceo, cto, dev } = await team()
    await expect(teamAdminView(deps, dev)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(setMemberRole(deps, cto, dev.accountId, 'admin')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await setMemberRole(deps, ceo, cto.accountId, 'admin')
    await expect(setMemberRole(deps, cto, dev.accountId, 'admin')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const v = await teamAdminView(deps, cto)
    expect(v.members.map(m => [m.label, m.role])).toEqual([
      ['ceo@firma.ch', 'owner'],
      ['cto@firma.ch', 'admin'],
      ['dev@firma.ch', 'member']
    ])

    await setTeamPolicy(deps, cto, { ...DEFAULT_POLICY, passkeyRequired: true, minPassphraseChars: 20, autoLockMinutes: 10, allowShareLinks: true, maxShareDays: 7 })
    const me = await accountView(deps, dev.accountId)
    expect(me.team).toMatchObject({ role: 'member', ownerLabel: 'ceo@firma.ch', policy: { passkeyRequired: true, minPassphraseChars: 20, autoLockMinutes: 10 } })
    await attestPassphrase(deps, dev, 34)
    const devRow = (await teamAdminView(deps, ceo)).members.find(m => m.id === dev.accountId)!
    expect(devRow.issues).toEqual(['passkey'])

    // Link-Richtlinie wird am Server durchgesetzt
    const c = await createObject(deps, dev, { fmt: 'frame2', pieces: [{ index: 0, cipherBytes: 50 }] })
    await deps.storage.writeStream(objectPieceKey(dev.accountId, c.objectId, 0), new Blob([new Uint8Array(50)]).stream(), 50)
    await completeObject(deps, dev, c.objectId)
    const meta = Buffer.from('x'.repeat(40)).toString('base64')
    await expect(createShare(deps, dev, { objectId: c.objectId, meta, expiresInHours: null, maxDownloads: null })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await createShare(deps, dev, { objectId: c.objectId, meta, expiresInHours: 24 * 7, maxDownloads: null })
    await setTeamPolicy(deps, ceo, { ...DEFAULT_POLICY, allowShareLinks: false })
    await expect(createShare(deps, dev, { objectId: c.objectId, meta, expiresInHours: 1, maxDownloads: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // Protokoll und Bericht
    const events = await teamAudit(deps, ceo, { limit: 500 })
    expect(events.map(e => e.kind)).toEqual(expect.arrayContaining(['team.policy_changed', 'team.role_changed', 'share.created']))
    expect((await teamAudit(deps, ceo, { member: dev.accountId, kind: 'share', limit: 50 })).every(e => e.actorId === dev.accountId && e.kind.startsWith('share'))).toBe(true)
    const rep = await complianceData(deps, ceo, 30)
    expect(rep.members).toHaveLength(3)
    expect(rep.storage.files).toBe(1)
    expect(rep.events.total).toBeGreaterThan(3)
  })

  it('Firmen-Notfallzugriff: Hinterlegung, Antrag, Freigabe nur durch zweiten Admin, 24-h-Zugriff, Mitglied sieht es', async () => {
    const { deps, ceo, cto, dev } = await team()
    await setMemberRole(deps, ceo, cto.accountId, 'admin')
    await expect(setRecoveryKey(deps, cto, { publicKey: jwk(), wrapped: wrapped() })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const { generation } = await setRecoveryKey(deps, ceo, { publicKey: jwk(), wrapped: wrapped() })
    await expect(grantRecoveryKey(deps, ceo, { generation, grants: [{ accountId: dev.accountId, wrapped: wrapped() }] })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await grantRecoveryKey(deps, ceo, { generation, grants: [{ accountId: cto.accountId, wrapped: wrapped() }] })

    await expect(createRecoveryRequest(deps, ceo, { target: dev.accountId, reason: 'Mitarbeiter ausgeschieden, Kundendaten sichern' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await escrowMasterKey(deps, dev, { generation, wrapped: wrapped() })
    await putIndex(deps, dev.accountId, 0, new Uint8Array(64))
    expect((await accountView(deps, dev.accountId)).team?.recovery).toMatchObject({ generation, escrowed: true })

    const { id } = await createRecoveryRequest(deps, ceo, { target: dev.accountId, reason: 'Mitarbeiter ausgeschieden, Kundendaten sichern' })
    await expect(recoveryVault(deps, ceo, id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(decideRecoveryRequest(deps, ceo, id, true)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(decideRecoveryRequest(deps, dev, id, true)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await decideRecoveryRequest(deps, cto, id, true)
    const v = await recoveryVault(deps, ceo, id)
    expect(v).toMatchObject({ targetId: dev.accountId, generation })
    expect(v.body).toBeTruthy()
    expect((await recoveryVault(deps, cto, id)).escrow).toBeTruthy()
    const info = (await accountView(deps, dev.accountId)).team!
    expect(info.accessedBy[0]).toMatchObject({ requestedBy: 'ceo@firma.ch', approvedBy: 'cto@firma.ch', reason: 'Mitarbeiter ausgeschieden, Kundendaten sichern' })
    // nach 24 h vorbei
    await deps.db.query(`UPDATE team_recovery_requests SET approved_at = now() - interval '25 hours' WHERE id = $1`, [id])
    await expect(recoveryVault(deps, ceo, id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // neuer Team-Schlüssel → Hinterlegungen verfallen
    await setRecoveryKey(deps, ceo, { publicKey: jwk(), wrapped: wrapped() })
    expect((await accountView(deps, dev.accountId)).team?.recovery).toMatchObject({ generation: 2, escrowed: false })
    expect((await teamAudit(deps, ceo, { kind: 'team.recovery', limit: 50 })).map(e => e.kind)).toEqual(
      expect.arrayContaining(['team.recovery_requested', 'team.recovery_approved', 'team.recovery_opened', 'team.recovery_key_created'])
    )
  })
})

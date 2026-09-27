import { beforeEach, describe, expect, it } from 'vitest'
import { resetRateLimits } from '../auth/ratelimit'
import { changePlan } from '../billing/service'
import { setPublicKey } from '../family/space'
import { completeObject, createObject } from '../objects/service'
import { objectPieceKey } from '../storage/provider'
import { newAccount, testDeps } from '../testing'
import { putIndex } from '../vault/service'
import {
  acceptEmergencyInvite,
  approveEmergency,
  confirmEmergency,
  createEmergencyInvite,
  emergencyDownload,
  emergencyOverview,
  emergencyVault,
  rejectEmergency,
  removeEmergency,
  requestEmergency
} from './service'

const b64u = (n: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString('base64url')
const jwk = () => ({ kty: 'EC' as const, crv: 'P-256' as const, x: b64u(32), y: b64u(32) })
const wrapped = () => ({ epk: jwk(), iv: b64u(12), ct: b64u(48) })

describe('Notfallzugang', () => {
  beforeEach(() => resetRateLimits())

  it('Einladen → Annehmen → Bestätigen → Anfordern → Wartezeit → Lesen; Ablehnen/Entfernen', async () => {
    const deps = await testDeps()
    const { session: anna } = await newAccount(deps, 'anna@example.com')
    const { session: ben } = await newAccount(deps, 'ben@example.com')
    await expect(createEmergencyInvite(deps, anna, { waitHours: 48 })).rejects.toMatchObject({ code: 'PLAN_REQUIRED' })
    await changePlan(deps, anna, { plan: 'pro', interval: 'month', currency: 'CHF' })
    await putIndex(deps, anna.accountId, 0, new Uint8Array(64))
    const c = await createObject(deps, anna, { fmt: 'frame2', pieces: [{ index: 0, cipherBytes: 80 }] })
    await deps.storage.writeStream(objectPieceKey(anna.accountId, c.objectId, 0), new Blob([new Uint8Array(80)]).stream(), 80)
    await completeObject(deps, anna, c.objectId)

    const inv = await createEmergencyInvite(deps, anna, { waitHours: 48 })
    await expect(acceptEmergencyInvite(deps, anna, inv.token)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await acceptEmergencyInvite(deps, ben, inv.token)
    await expect(acceptEmergencyInvite(deps, ben, inv.token)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    // ohne öffentlichen Schlüssel keine Bestätigung
    await expect(confirmEmergency(deps, anna, inv.id, { wrapped: wrapped() })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await setPublicKey(deps, ben, jwk())
    expect((await emergencyOverview(deps, anna)).asGrantor[0]).toMatchObject({ status: 'accepted', label: 'ben@example.com' })
    await expect(requestEmergency(deps, ben, inv.id)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await confirmEmergency(deps, anna, inv.id, { wrapped: wrapped() })

    // Anforderung: während der Wartezeit kein Zugriff und keine Hülle
    await requestEmergency(deps, ben, inv.id)
    let mine = (await emergencyOverview(deps, ben)).asGrantee[0]
    expect(mine).toMatchObject({ status: 'requested', access: false, wrapped: null, label: 'anna@example.com' })
    await expect(emergencyVault(deps, ben, inv.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // Inhaber lehnt ab → zurück auf bestätigt
    await rejectEmergency(deps, anna, inv.id)
    expect((await emergencyOverview(deps, ben)).asGrantee[0].status).toBe('confirmed')
    // erneut anfordern, Wartezeit „abgelaufen“
    await requestEmergency(deps, ben, inv.id)
    await deps.db.query(`UPDATE emergency_contacts SET requested_at = now() - interval '49 hours' WHERE id = $1`, [inv.id])
    mine = (await emergencyOverview(deps, ben)).asGrantee[0]
    expect(mine.access).toBe(true)
    expect(mine.wrapped).toBeTruthy()
    const v = await emergencyVault(deps, ben, inv.id)
    expect(v.grantorId).toBe(anna.accountId)
    expect(v.body).toBeTruthy()
    expect((await emergencyDownload(deps, ben, inv.id, c.objectId)).pieces).toHaveLength(1)
    // Dritte und fremde Dateien: nichts
    const { session: eve } = await newAccount(deps, 'eve@example.com')
    await expect(emergencyVault(deps, eve, inv.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })

    // Neuer Schlüssel der Vertrauensperson macht die Hülle ungültig
    await setPublicKey(deps, ben, jwk())
    expect((await emergencyOverview(deps, anna)).asGrantor[0].status).toBe('accepted')
    await expect(emergencyVault(deps, ben, inv.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })

    await removeEmergency(deps, anna, inv.id)
    expect((await emergencyOverview(deps, ben)).asGrantee).toHaveLength(0)
  })

  it('frühere Freigabe durch den Inhaber', async () => {
    const deps = await testDeps()
    const { session: anna } = await newAccount(deps, 'anna2@example.com')
    const { session: ben } = await newAccount(deps, 'ben2@example.com')
    await changePlan(deps, anna, { plan: 'family', interval: 'month', currency: 'CHF' })
    const inv = await createEmergencyInvite(deps, anna, { waitHours: 24 * 30 })
    await acceptEmergencyInvite(deps, ben, inv.token)
    await setPublicKey(deps, ben, jwk())
    await confirmEmergency(deps, anna, inv.id, { wrapped: wrapped() })
    await requestEmergency(deps, ben, inv.id)
    expect((await emergencyOverview(deps, ben)).asGrantee[0].access).toBe(false)
    await approveEmergency(deps, anna, inv.id)
    expect((await emergencyOverview(deps, ben)).asGrantee[0].access).toBe(true)
  })
})

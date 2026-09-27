import { beforeEach, describe, expect, it } from 'vitest'
import { resetRateLimits } from '../auth/ratelimit'
import { changePlan } from '../billing/service'
import { completeObject, createObject } from '../objects/service'
import { objectPieceKey } from '../storage/provider'
import { newAccount, testDeps } from '../testing'
import { createInvite, familyView, inviteInfo, joinFamily, removeMember } from './service'

const bytes = (n: number) => new Blob([new Uint8Array(n)]).stream()

describe('Family', () => {
  beforeEach(() => resetRateLimits())

  it('Einladen → Beitreten → gemeinsamer Speicher → Entfernen; Ende des Abos setzt alle auf Free', async () => {
    const deps = await testDeps()
    const { session: owner } = await newAccount(deps, 'eltern@example.com')
    const { session: kid } = await newAccount(deps, 'kind@example.com')
    const { session: other } = await newAccount(deps, 'fremd@example.com')

    await expect(createInvite(deps, owner)).rejects.toMatchObject({ code: 'PLAN_REQUIRED' })
    await changePlan(deps, owner, { plan: 'family', interval: 'month', currency: 'CHF' })

    const inv = await createInvite(deps, owner)
    expect((await inviteInfo(deps, inv.token)).ownerLabel).toBe('eltern@example.com')
    await joinFamily(deps, kid, inv.token)
    await expect(joinFamily(deps, other, inv.token)).rejects.toMatchObject({ code: 'GONE' }) // einmalig

    const v = await familyView(deps, kid)
    expect(v.role).toBe('member')
    expect(v.members.map(m => m.label)).toEqual(['eltern@example.com', 'kind@example.com'])
    expect((await deps.db.query(`SELECT plan FROM accounts WHERE id = $1`, [kid.accountId]))[0].plan).toBe('family')

    // Mitglied lädt hoch → zählt zum Pool des Inhabers
    const c = await createObject(deps, kid, { fmt: 'frame2', pieces: [{ index: 0, cipherBytes: 500 }] })
    await deps.storage.writeStream(objectPieceKey(kid.accountId, c.objectId, 0), bytes(500), 500)
    await completeObject(deps, kid, c.objectId)
    const ownerView = await familyView(deps, owner)
    expect(ownerView.members.find(m => m.label === 'kind@example.com')?.usedBytes).toBe(500)

    // Mitglied kann kein eigenes Abo abschließen, solange es Mitglied ist
    await expect(changePlan(deps, kid, { plan: 'pro', interval: 'month', currency: 'CHF' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    // Entfernen → Free, Daten bleiben
    await removeMember(deps, owner, kid.accountId)
    expect((await deps.db.query(`SELECT plan FROM accounts WHERE id = $1`, [kid.accountId]))[0].plan).toBe('free')

    // erneut einladen, dann endet das Abo des Inhabers → Mitglied fällt auf Free zurück
    await joinFamily(deps, kid, (await createInvite(deps, owner)).token)
    await changePlan(deps, owner, { plan: 'free', interval: 'month', currency: 'CHF' })
    expect((await deps.db.query(`SELECT plan FROM accounts WHERE id = $1`, [kid.accountId]))[0].plan).toBe('free')
    expect((await familyView(deps, kid)).role).toBeNull()
  })

  it('Plätze sind begrenzt (inkl. offener Einladungen)', async () => {
    const deps = await testDeps()
    const { session: owner } = await newAccount(deps, 'gross@example.com')
    await changePlan(deps, owner, { plan: 'family', interval: 'year', currency: 'EUR' })
    for (let i = 0; i < 5; i++) await createInvite(deps, owner)
    await expect(createInvite(deps, owner)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('Business-Team: Plätze laut gebuchten Nutzern, Mitglieder erhalten Business, gemeinsame Quota der Stufe', async () => {
    const deps = await testDeps()
    const { session: owner } = await newAccount(deps, 'ceo@example.com')
    const { session: dev } = await newAccount(deps, 'dev@example.com')
    await changePlan(deps, owner, { plan: 'business', tier: 'starter', extraSeats: 1, interval: 'month', currency: 'EUR' })
    const inv = await createInvite(deps, owner)
    await joinFamily(deps, dev, inv.token)
    const v = await familyView(deps, owner)
    expect(v).toMatchObject({ kind: 'business', seats: 6 })
    expect((await deps.db.query(`SELECT plan FROM accounts WHERE id = $1`, [dev.accountId]))[0].plan).toBe('business')
    for (let i = 0; i < 4; i++) await createInvite(deps, owner) // 6 Plätze: Inhaber + 1 Mitglied + 4 offen
    await expect(createInvite(deps, owner)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    // Auf 5 Plätze reduzieren passt (2 Personen)
    await expect(changePlan(deps, owner, { plan: 'business', tier: 'starter', extraSeats: 0, interval: 'month', currency: 'EUR' })).resolves.toEqual({})
    const { accountView } = await import('../accounts/service')
    expect((await accountView(deps, dev.accountId)).quotaBytes).toBe(3000 * 1e9)
  })
})

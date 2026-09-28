import { beforeEach, describe, expect, it } from 'vitest'
import { resetRateLimits } from '../auth/ratelimit'
import { changePlan } from '../billing/service'
import { createInvite, joinFamily, removeMember } from '../family/service'
import { setPublicKey } from '../family/space'
import { afterQuery, newAccount, testDeps } from '../testing'
import { addVaultMember, createVault, deleteVault, grantVaultKeys, listVaults, putVaultIndex, removeVaultMember, setVaultRole, vaultAudit } from './service'

const b64u = (n: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString('base64url')
const jwk = () => ({ kty: 'EC' as const, crv: 'P-256' as const, x: b64u(32), y: b64u(32) })
const wrapped = () => ({ epk: jwk(), iv: b64u(12), ct: b64u(48) })
/** Index-Format: 0x01 | Generation (uint32) | IV | Ciphertext */
const body = (gen: number) => {
  const b = new Uint8Array(40)
  b[0] = 1
  new DataView(b.buffer).setUint32(1, gen)
  return Buffer.from(b).toString('base64')
}

async function team() {
  const deps = await testDeps()
  const { session: ceo } = await newAccount(deps, 'ceo@firma.ch')
  const { session: dev } = await newAccount(deps, 'dev@firma.ch')
  const { session: ops } = await newAccount(deps, 'ops@firma.ch')
  const { session: stranger } = await newAccount(deps, 'fremd@example.com')
  await changePlan(deps, ceo, { plan: 'business', tier: 'starter', extraSeats: 0, interval: 'month', currency: 'CHF' })
  await joinFamily(deps, dev, (await createInvite(deps, ceo)).token)
  await joinFamily(deps, ops, (await createInvite(deps, ceo)).token)
  for (const s of [ceo, dev, ops]) await setPublicKey(deps, s, jwk())
  return { deps, ceo, dev, ops, stranger }
}

describe('Geteilte Tresore (Business)', () => {
  beforeEach(() => resetRateLimits())

  it('nur Business; Ersteller verwaltet; Rollen Ansehen/Bearbeiten/Verwalten werden durchgesetzt', async () => {
    const { deps, ceo, dev, ops, stranger } = await team()
    const id = crypto.randomUUID()
    await expect(listVaults(deps, stranger)).rejects.toMatchObject({ code: 'PLAN_REQUIRED' })
    await createVault(deps, dev, { id, wrapped: wrapped(), body: body(1) })
    // CEO sieht den Tresor nicht, solange er nicht hinzugefügt wurde
    expect((await listVaults(deps, ceo)).vaults).toHaveLength(0)
    const mine = (await listVaults(deps, dev)).vaults[0]
    expect(mine).toMatchObject({ id, role: 'manage', generation: 1, version: 1 })
    expect((await listVaults(deps, dev)).team.map(t => t.label).sort()).toEqual(['ceo@firma.ch', 'dev@firma.ch', 'ops@firma.ch'])

    await expect(addVaultMember(deps, dev, id, { accountId: stranger.accountId, role: 'view' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await addVaultMember(deps, dev, id, { accountId: ops.accountId, role: 'view' })
    await grantVaultKeys(deps, dev, id, { generation: 1, grants: [{ accountId: ops.accountId, wrapped: wrapped() }] })
    const opsView = (await listVaults(deps, ops)).vaults[0]
    expect(opsView).toMatchObject({ role: 'view' })
    expect(opsView.myKeys).toHaveLength(1)

    // Ansehen: kein Speichern, keine Personen
    await expect(putVaultIndex(deps, ops, id, { baseVersion: 1, body: body(1) })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(addVaultMember(deps, ops, id, { accountId: ceo.accountId, role: 'view' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(vaultAudit(deps, ops, id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // Bearbeiten: speichern mit optimistischem Locking
    await setVaultRole(deps, dev, id, ops.accountId, 'edit')
    expect((await putVaultIndex(deps, ops, id, { baseVersion: 1, body: body(1) })).version).toBe(2)
    await expect(putVaultIndex(deps, dev, id, { baseVersion: 1, body: body(1) })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    // letzter Verwalter bleibt
    await expect(setVaultRole(deps, dev, id, dev.accountId, 'edit')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(removeVaultMember(deps, dev, id, dev.accountId)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    // Fremde Konten sehen nichts
    await expect(deleteVault(deps, ceo, id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('Entfernen: kein Zugriff mehr, neue Generation nötig; alter Schlüssel darf nicht mehr schreiben', async () => {
    const { deps, ceo, dev, ops } = await team()
    const id = crypto.randomUUID()
    await createVault(deps, ceo, { id, wrapped: wrapped(), body: body(1) })
    await addVaultMember(deps, ceo, id, { accountId: dev.accountId, role: 'edit' })
    await addVaultMember(deps, ceo, id, { accountId: ops.accountId, role: 'edit' })
    await grantVaultKeys(deps, ceo, id, { generation: 1, grants: [dev, ops].map(s => ({ accountId: s.accountId, wrapped: wrapped() })) })

    await removeVaultMember(deps, ceo, id, ops.accountId)
    expect((await listVaults(deps, ops)).vaults).toHaveLength(0)
    await expect(putVaultIndex(deps, ops, id, { baseVersion: 1, body: body(1) })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await listVaults(deps, ceo)).vaults[0]).toMatchObject({ rotateNeeded: true })
    // Ehemalige können keine Hüllen mehr bekommen; nur Verwalter legen Generation 2 an
    await expect(grantVaultKeys(deps, ceo, id, { generation: 1, grants: [{ accountId: ops.accountId, wrapped: wrapped() }] })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(grantVaultKeys(deps, dev, id, { generation: 2, rotate: true, grants: [{ accountId: dev.accountId, wrapped: wrapped() }] })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // ohne Rotations-Kennzeichen entsteht keine neue Generation
    await expect(grantVaultKeys(deps, ceo, id, { generation: 2, grants: [{ accountId: ceo.accountId, wrapped: wrapped() }] })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    // während des ausstehenden Schlüsselwechsels wird nicht mit dem alten Schlüssel geschrieben
    await expect(putVaultIndex(deps, dev, id, { baseVersion: 1, body: body(1) })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    await grantVaultKeys(deps, ceo, id, { generation: 2, rotate: true, grants: [ceo, dev].map(s => ({ accountId: s.accountId, wrapped: wrapped() })) })
    // zweiter Verwalter/Tab mit derselben neuen Generation → Konflikt statt verworfenem Schlüssel
    await expect(grantVaultKeys(deps, ceo, id, { generation: 2, rotate: true, grants: [{ accountId: ceo.accountId, wrapped: wrapped() }] })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    expect((await listVaults(deps, ceo)).vaults[0]).toMatchObject({ rotateNeeded: false, generation: 2 })
    // mit dem alten Schlüssel verschlüsselter Index wird abgelehnt
    await expect(putVaultIndex(deps, dev, id, { baseVersion: 1, body: body(1) })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    expect((await putVaultIndex(deps, ceo, id, { baseVersion: 1, body: body(2) })).version).toBe(2)

    // Protokoll für Verwalter
    const kinds = (await vaultAudit(deps, ceo, id)).map(e => e.kind)
    expect(kinds).toEqual(expect.arrayContaining(['vault.created', 'vault.member_added', 'vault.member_removed', 'vault.key_rotated', 'vault.updated']))
    const removed = (await vaultAudit(deps, ceo, id)).find(e => e.kind === 'vault.member_removed')
    expect(removed).toMatchObject({ actor: 'ceo@firma.ch', member: 'ops@firma.ch' })
  })

  it('Schlüsselwechsel ohne Entfernen: Index mit alter Generation wird danach abgelehnt', async () => {
    const { deps, ceo, dev } = await team()
    const id = crypto.randomUUID()
    await createVault(deps, ceo, { id, wrapped: wrapped(), body: body(1) })
    await addVaultMember(deps, ceo, id, { accountId: dev.accountId, role: 'edit' })
    await grantVaultKeys(deps, ceo, id, { generation: 1, grants: [{ accountId: dev.accountId, wrapped: wrapped() }] })
    await grantVaultKeys(deps, ceo, id, { generation: 2, rotate: true, grants: [ceo, dev].map(s => ({ accountId: s.accountId, wrapped: wrapped() })) })
    await expect(putVaultIndex(deps, dev, id, { baseVersion: 1, body: body(1) })).rejects.toMatchObject({ code: 'VERSION_CONFLICT', details: { generation: 2 } })
    expect((await putVaultIndex(deps, dev, id, { baseVersion: 1, body: body(2) })).version).toBe(2)
  })

  it('Race: Schlüsselwechsel zwischen Generationsprüfung und Schreiben lässt keinen alten Index durch', async () => {
    const { deps, ceo, dev } = await team()
    const id = crypto.randomUUID()
    await createVault(deps, ceo, { id, wrapped: wrapped(), body: body(1) })
    await addVaultMember(deps, ceo, id, { accountId: dev.accountId, role: 'edit' })
    await grantVaultKeys(deps, ceo, id, { generation: 1, grants: [{ accountId: dev.accountId, wrapped: wrapped() }] })
    let rotation: Promise<void> | null = null
    let rotated = false
    let rotatedBeforeWrite = false
    // direkt nach der Generationsprüfung von dev versucht der Verwalter den Schlüsselwechsel
    const racy = {
      ...deps,
      db: afterQuery(deps.db, async sql => {
        if (rotation || !sql.includes('max(generation)')) return
        rotation = grantVaultKeys(deps, ceo, id, { generation: 2, rotate: true, grants: [ceo, dev].map(s => ({ accountId: s.accountId, wrapped: wrapped() })) }).then(() => {
          rotated = true
        })
        await Promise.race([rotation, new Promise(r => setTimeout(r, 150))])
        rotatedBeforeWrite = rotated
      })
    }
    const put = await putVaultIndex(racy, dev, id, { baseVersion: 1, body: body(1) }).then(
      () => 'ok',
      (e: { code?: string }) => e.code
    )
    await rotation
    // Entweder landet der Index vor dem Wechsel oder er wird abgelehnt – nie danach mit altem Schlüssel
    if (put === 'ok') expect(rotatedBeforeWrite).toBe(false)
    else expect(put).toBe('VERSION_CONFLICT')
    expect((await listVaults(deps, ceo)).vaults[0]).toMatchObject({ generation: 2 })
  })

  it('wer das Team verlässt, verliert alle Tresore des Teams', async () => {
    const { deps, ceo, dev } = await team()
    const id = crypto.randomUUID()
    await createVault(deps, ceo, { id, wrapped: wrapped(), body: body(1) })
    await addVaultMember(deps, ceo, id, { accountId: dev.accountId, role: 'view' })
    await removeMember(deps, ceo, dev.accountId)
    const st = (await listVaults(deps, ceo)).vaults[0]
    expect(st.members.map(m => m.label)).toEqual(['ceo@firma.ch'])
    expect(st.rotateNeeded).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import {
  decryptSpaceIndex,
  encryptSpaceIndex,
  generateFamilyKeypair,
  importSpaceKey,
  newSpaceKey,
  spaceIndexGeneration,
  unwrapSpaceKey,
  wrapSpaceKey
} from './space-crypto'

const OWNER = '00000000-0000-7000-8000-000000000001'
const KID = '00000000-0000-7000-8000-000000000002'
const OTHER = '00000000-0000-7000-8000-000000000003'

describe('Familienordner – Schlüssel', () => {
  it('Ordner-Schlüssel nur für den Empfänger, die Generation und die Familie öffnbar', async () => {
    const kid = await generateFamilyKeypair()
    const other = await generateFamilyKeypair()
    expect(kid.publicJwk).not.toHaveProperty('d')
    const raw = newSpaceKey()
    const w = await wrapSpaceKey(raw, kid.publicJwk, OWNER, 1, KID)
    expect(await unwrapSpaceKey(w, kid.privateJwk, OWNER, 1, KID)).toEqual(raw)
    await expect(unwrapSpaceKey(w, other.privateJwk, OWNER, 1, KID)).rejects.toThrow() // falscher privater Schlüssel
    await expect(unwrapSpaceKey(w, kid.privateJwk, OWNER, 2, KID)).rejects.toThrow() // andere Generation
    await expect(unwrapSpaceKey(w, kid.privateJwk, OWNER, 1, OTHER)).rejects.toThrow() // umgeleitete Hülle
    expect(w.iv).toMatch(/^[A-Za-z0-9_-]{16}$/)
    expect(w.ct).toMatch(/^[A-Za-z0-9_-]{64}$/)
  })

  it('Index: Generation im Header, nur mit dem richtigen Schlüssel und der richtigen Familie lesbar', async () => {
    const key = await importSpaceKey(newSpaceKey())
    const container = { v: 3 as const, secrets: [], files: [{ id: 'a', name: 'Urlaub.jpg' } as never] }
    const body = await encryptSpaceIndex(container, key, 7, OWNER)
    expect(spaceIndexGeneration(body)).toBe(7)
    expect((await decryptSpaceIndex(body, key, OWNER)).files).toEqual(container.files)
    await expect(decryptSpaceIndex(body, key, OTHER)).rejects.toThrow()
    await expect(decryptSpaceIndex(body, await importSpaceKey(newSpaceKey()), OWNER)).rejects.toThrow()
    expect(new TextDecoder().decode(body)).not.toContain('Urlaub')
  })
})

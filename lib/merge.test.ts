import { describe, expect, it } from 'vitest'
import { merge3, mergeContainers } from './merge'
import type { SecretEntry, VaultEntry } from './vault'

type Item = { id: string; t: number }
const it_ = (id: string, t: number): Item => ({ id, t })
const m = (b: Item[], l: Item[], r: Item[]) =>
  merge3(b, l, r, x => x.t)
    .map(x => `${x.id}@${x.t}`)
    .sort()

describe('3-Wege-Merge (Tresor-Index über mehrere Geräte)', () => {
  it('Hinzufügungen auf beiden Seiten bleiben erhalten', () => {
    expect(m([], [it_('a', 1)], [it_('b', 2)])).toEqual(['a@1', 'b@2'])
  })

  it('lokal gelöscht, remote unverändert → gelöscht', () => {
    expect(m([it_('a', 1)], [], [it_('a', 1)])).toEqual([])
  })

  it('remote gelöscht, lokal unverändert → gelöscht', () => {
    expect(m([it_('a', 1)], [it_('a', 1)], [])).toEqual([])
  })

  it('gelöscht vs. geändert → Änderung gewinnt', () => {
    expect(m([it_('a', 1)], [], [it_('a', 5)])).toEqual(['a@5'])
    expect(m([it_('a', 1)], [it_('a', 7)], [])).toEqual(['a@7'])
  })

  it('beidseitig geändert → neuerer Zeitstempel gewinnt', () => {
    expect(m([it_('a', 1)], [it_('a', 3)], [it_('a', 9)])).toEqual(['a@9'])
    expect(m([it_('a', 1)], [it_('a', 9)], [it_('a', 3)])).toEqual(['a@9'])
  })

  it('mergeContainers führt Dateien und Secrets getrennt zusammen', () => {
    const file = (id: string, storedAt: number) => ({ id, storedAt }) as VaultEntry
    const secret = (id: string, updatedAt: number) => ({ id, updatedAt }) as SecretEntry
    const out = mergeContainers(
      { v: 3, files: [file('f1', 1)], secrets: [secret('s1', 1)] },
      { v: 3, files: [file('f1', 1), file('f2', 2)], secrets: [secret('s1', 4)] },
      { v: 3, files: [file('f3', 3)], secrets: [secret('s1', 1), secret('s2', 2)] }
    )
    expect(out.files.map(f => f.id)).toEqual(['f3', 'f2'])
    expect(out.secrets.map(s => `${s.id}@${s.updatedAt}`)).toEqual(['s1@4', 's2@2'])
  })
})

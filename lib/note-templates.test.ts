import { describe, expect, it } from 'vitest'
import { daysUntilExpiry, expiresAtMonthEnd, noteSearchText, parseTags } from './note-templates'
import type { SecretEntry } from './vault'

const note = (fields: SecretEntry['fields'], extra: Partial<SecretEntry> = {}): SecretEntry => ({
  id: 'n',
  kind: 'note',
  title: 'Pass',
  createdAt: 0,
  updatedAt: 0,
  fields,
  ...extra
})

describe('Notiz-Vorlagen', () => {
  it('Ablauf: Tag und Monat (Kreditkarte = Monatsende)', () => {
    const now = new Date(2026, 0, 1).getTime()
    expect(daysUntilExpiry(note([{ key: 'expires', value: '2026-01-31' }]), now)).toBe(31)
    expect(daysUntilExpiry(note([{ key: 'expires', value: '2026-02' }]), now)).toBe(59)
    expect(daysUntilExpiry(note([{ key: 'expires', value: '2025-12-01' }]), now)).toBeLessThan(0)
    expect(daysUntilExpiry(note([{ key: 'expires', value: '' }]), now)).toBeNull()
    expect(expiresAtMonthEnd(note([{ key: 'expires', value: '2026-10' }]))).toBe(true)
    expect(expiresAtMonthEnd(note([{ key: 'expires', value: '2026-10-05' }]))).toBe(false)
  })
  it('Suche ohne geheime Felder, Tags bereinigt', () => {
    const n = note([{ key: 'holder', value: 'Anna' }, { key: 'number', value: '4111' }], { template: 'card', tags: ['Bank'] })
    const t = noteSearchText(n)
    expect(t).toContain('anna')
    expect(t).toContain('bank')
    expect(t).not.toContain('4111')
    expect(parseTags(' Arbeit, ,Privat,Arbeit ')).toEqual(['Arbeit', 'Privat'])
  })
})

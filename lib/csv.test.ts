import { describe, expect, it } from 'vitest'
import { parseCsv, toCsv } from './csv'

describe('CSV-Roundtrip (deutsche Exporte)', () => {
  it('einfache Zeilen', () => {
    const rows = [
      ['Name', 'Wert'],
      ['Notiz 1', '42'],
      ['Passwort 2', 'geheim']
    ]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
  })

  it('Quoting: Komma, Anführungszeichen, Zeilenumbruch', () => {
    const rows = [
      ['Titel', 'Beschreibung'],
      ['Notiz "wichtig"', 'Zeile 1\nZeile 2'],
      ['A, B & C', 'Semikolon; egal']
    ]
    const csv = toCsv(rows)
    expect(csv).toContain('"') // Felder mit Sonderzeichen werden gequotet
    expect(parseCsv(csv)).toEqual(rows)
  })
})

import { describe, expect, it } from 'vitest'
import { PdfDoc, wrap } from './pdf'

describe('PDF-Erzeuger', () => {
  it('gültige Struktur: Objekt-Offsets in der xref stimmen, Umlaute/Gedankenstrich in WinAnsi, Seitenumbruch', () => {
    const d = new PdfDoc('FocVault – Compliance-Bericht', 'Vertraulich')
    d.heading('Übersicht')
    d.text('Grüße aus Zürich – Straße (Test) \\ Ende € •')
    d.table(['A', 'B'], Array.from({ length: 120 }, (_, i) => [`Zeile ${i}`, 'x'.repeat(40)]), [0.3, 0.7])
    const bytes = d.bytes()
    const s = Array.from(bytes, b => String.fromCharCode(b)).join('')
    expect(s.startsWith('%PDF-1.4')).toBe(true)
    const startxref = Number(/startxref\n(\d+)/.exec(s)![1])
    expect(s.slice(startxref, startxref + 4)).toBe('xref')
    const entries = s.slice(startxref).split('\n').slice(3).filter(l => / n $/.test(l)).map(l => Number(l.slice(0, 10)))
    entries.forEach((off, i) => expect(s.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`))
    expect(/\/Count (\d+)/.exec(s)![1]).not.toBe('1')
    expect(s).toContain('Gr\xFC\xDFe aus Z\xFCrich \x96 Stra\xDFe \\(Test\\) \\\\ Ende \x80 \x95')
  })
  it('Umbruch nach Breite', () => {
    expect(wrap('eins zwei drei vier fünf sechs', 10, 60).length).toBeGreaterThan(1)
  })
})

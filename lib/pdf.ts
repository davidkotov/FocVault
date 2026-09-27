/**
 * Minimaler PDF-Erzeuger (PDF 1.4, Standardschriften Helvetica/Helvetica-Bold, WinAnsi) für
 * Berichte – ohne Abhängigkeiten, läuft im Browser und in Node. Zeilenumbruch nach geschätzter
 * Zeichenbreite, automatischer Seitenumbruch, Kopf- und Fußzeile.
 */
const WIN: Record<string, number> = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99 }

function encode(s: string): string {
  let out = ''
  for (const ch of s.normalize('NFC')) {
    const c = ch.codePointAt(0)!
    const b = WIN[ch] ?? (c < 256 && c !== 0x7f && (c >= 0x20 || c === 9) ? c : '?'.charCodeAt(0))
    const x = String.fromCharCode(b)
    out += x === '(' || x === ')' || x === '\\' ? `\\${x}` : x
  }
  return out
}

/** grobe Breite in pt (Helvetica): schmale/breite Zeichen berücksichtigt */
export function textWidth(s: string, size: number): number {
  let w = 0
  for (const ch of s) w += /[il.,:;'|!]/.test(ch) ? 0.28 : /[mwMW@]/.test(ch) ? 0.85 : /[A-Z0-9]/.test(ch) ? 0.65 : 0.52
  return w * size
}

export function wrap(s: string, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  for (const para of s.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word
      if (textWidth(next, size) <= maxWidth || !line) line = next
      else {
        lines.push(line)
        line = word
      }
    }
    lines.push(line)
  }
  return lines
}

interface Op {
  font: 'R' | 'B'
  size: number
  x: number
  y: number
  text: string
  color?: [number, number, number]
}

export class PdfDoc {
  private pages: Array<{ ops: Op[]; lines: Array<[number, number, number, number]> }> = []
  private y = 0
  readonly width = 595.28
  readonly height = 841.89
  readonly margin = 50

  constructor(private readonly header: string, private readonly footer: string) {
    this.addPage()
  }

  private addPage() {
    this.pages.push({ ops: [], lines: [] })
    this.y = this.height - this.margin - 20
  }

  private ensure(h: number) {
    if (this.y - h < this.margin + 20) this.addPage()
  }

  text(s: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; indent?: number; gap?: number } = {}) {
    const size = opts.size ?? 10
    const x = this.margin + (opts.indent ?? 0)
    for (const line of wrap(s, size, this.width - this.margin - x)) {
      this.ensure(size * 1.4)
      this.y -= size * 1.4
      this.pages[this.pages.length - 1].ops.push({ font: opts.bold ? 'B' : 'R', size, x, y: this.y, text: line, color: opts.color })
    }
    this.y -= opts.gap ?? 0
  }

  heading(s: string) {
    this.ensure(40)
    this.y -= 8
    this.text(s, { size: 13, bold: true, gap: 4 })
    this.rule()
  }

  rule() {
    this.y -= 4
    this.pages[this.pages.length - 1].lines.push([this.margin, this.y, this.width - this.margin, this.y])
    this.y -= 6
  }

  /** Tabelle mit festen Spaltenbreiten (Anteile), Kopfzeile fett. */
  table(head: string[], rows: string[][], widths: number[], size = 8.5) {
    const total = this.width - 2 * this.margin
    const cols = widths.map(w => w * total)
    const drawRow = (cells: string[], bold: boolean) => {
      const wrapped = cells.map((c, i) => wrap(c, size, cols[i] - 6))
      const h = Math.max(...wrapped.map(w => w.length)) * size * 1.35 + 4
      this.ensure(h)
      let x = this.margin
      const top = this.y
      wrapped.forEach((lines, i) => {
        lines.forEach((l, j) =>
          this.pages[this.pages.length - 1].ops.push({ font: bold ? 'B' : 'R', size, x: x + 2, y: top - (j + 1) * size * 1.35, text: l })
        )
        x += cols[i]
      })
      this.y = top - h
      this.pages[this.pages.length - 1].lines.push([this.margin, this.y + 1, this.width - this.margin, this.y + 1])
    }
    if (head.some(h => h)) drawRow(head, true)
    for (const r of rows) drawRow(r, false)
    this.y -= 6
  }

  space(h = 8) {
    this.y -= h
  }

  /** PDF-Datei als Bytes (Latin-1). */
  bytes(): Uint8Array {
    const objs: string[] = []
    const n = this.pages.length
    // 1 Katalog, 2 Seitenbaum, 3/4 Schriften, dann je Seite: Seite + Inhalt
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
    objs[2] = `<< /Type /Pages /Count ${n} /Kids [${this.pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')}] >>`
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
    objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
    this.pages.forEach((p, i) => {
      const ops: string[] = []
      const txt = (font: 'R' | 'B', size: number, x: number, y: number, t: string, c: [number, number, number] = [0.08, 0.1, 0.15]) =>
        ops.push(`BT ${c.join(' ')} rg /F${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${encode(t)}) Tj ET`)
      txt('B', 9, this.margin, this.height - this.margin + 8, this.header, [0.0, 0.36, 0.85])
      txt('R', 8, this.margin, this.margin - 18, `${this.footer} · ${i + 1}/${n}`, [0.45, 0.48, 0.55])
      ops.push('0.85 0.87 0.9 RG 0.5 w')
      for (const [x1, y1, x2, y2] of p.lines) ops.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`)
      for (const o of p.ops) txt(o.font, o.size, o.x, o.y, o.text, o.color)
      const stream = ops.join('\n')
      objs[5 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Resources << /Font << /FR 3 0 R /FB 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`
      objs[6 + i * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
    })
    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
    const offsets: number[] = []
    for (let k = 1; k < objs.length; k++) {
      offsets[k] = out.length
      out += `${k} 0 obj\n${objs[k]}\nendobj\n`
    }
    const xref = out.length
    out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`
    for (let k = 1; k < objs.length; k++) out += `${String(offsets[k]).padStart(10, '0')} 00000 n \n`
    out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    const bytes = new Uint8Array(out.length)
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff
    return bytes
  }
}

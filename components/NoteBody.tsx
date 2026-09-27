'use client'

import type { ReactNode } from 'react'

/**
 * Einfache Formatierung für Notizen (Markdown-Teilmenge), ohne HTML-Einschleusung:
 * # / ## / ### Überschriften, - oder * Listen, 1. nummeriert, - [ ] / - [x] Checklisten,
 * **fett**, *kursiv*, `Code`, Links (http/https).
 */
export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|https?:\/\/[^\s<>()]+)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('**')) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>)
    else if (t.startsWith('`')) out.push(<code key={k++}>{t.slice(1, -1)}</code>)
    else if (t.startsWith('*')) out.push(<em key={k++}>{t.slice(1, -1)}</em>)
    else
      out.push(
        <a key={k++} href={t} target="_blank" rel="noopener noreferrer nofollow">
          {t}
        </a>
      )
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const CHECK = /^\s*[-*] \[( |x|X)\] (.*)$/
const BULLET = /^\s*[-*] (.*)$/
const NUM = /^\s*\d+[.)] (.*)$/
const HEAD = /^(#{1,3}) (.*)$/

/** Zeilenindex → Checkbox umschalten (für die Ansicht). */
export function toggleCheckLine(body: string, line: number): string {
  const lines = body.split('\n')
  const m = CHECK.exec(lines[line] ?? '')
  if (!m) return body
  lines[line] = lines[line].replace(/\[( |x|X)\]/, m[1] === ' ' ? '[x]' : '[ ]')
  return lines.join('\n')
}

export function checklistProgress(body: string): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const l of body.split('\n')) {
    const m = CHECK.exec(l)
    if (m) {
      total++
      if (m[1] !== ' ') done++
    }
  }
  return { done, total }
}

export default function NoteBody({ body, onToggle, limit }: { body: string; onToggle?: (line: number) => void; limit?: number }) {
  const lines = body.split('\n')
  const blocks: ReactNode[] = []
  let list: { type: 'ul' | 'ol' | 'check'; items: ReactNode[] } | null = null
  const flush = () => {
    if (!list) return
    const k = blocks.length
    if (list.type === 'ol') blocks.push(<ol key={k}>{list.items}</ol>)
    else blocks.push(<ul key={k} className={list.type === 'check' ? 'checklist' : undefined}>{list.items}</ul>)
    list = null
  }
  const push = (type: 'ul' | 'ol' | 'check', item: ReactNode) => {
    if (list && list.type !== type) flush()
    if (!list) list = { type, items: [] }
    list.items.push(item)
  }
  const shown = limit ? lines.slice(0, limit) : lines
  shown.forEach((l, i) => {
    let m: RegExpExecArray | null
    if ((m = CHECK.exec(l))) {
      const on = m[1] !== ' '
      push(
        'check',
        <li key={i} className={on ? 'done' : undefined}>
          <input
            type="checkbox"
            checked={on}
            disabled={!onToggle}
            onChange={() => onToggle?.(i)}
            onClick={e => e.stopPropagation()}
            aria-label={m[2]}
          />
          <span>{renderInline(m[2])}</span>
        </li>
      )
    } else if ((m = BULLET.exec(l))) push('ul', <li key={i}>{renderInline(m[1])}</li>)
    else if ((m = NUM.exec(l))) push('ol', <li key={i}>{renderInline(m[1])}</li>)
    else {
      flush()
      if ((m = HEAD.exec(l))) {
        const level = m[1].length
        const H = (level === 1 ? 'h4' : level === 2 ? 'h5' : 'h6') as 'h4'
        blocks.push(<H key={i}>{renderInline(m[2])}</H>)
      } else if (l.trim() === '') blocks.push(<div key={i} className="nb-gap" />)
      else blocks.push(<p key={i}>{renderInline(l)}</p>)
    }
  })
  flush()
  if (limit && lines.length > limit) blocks.push(<p key="more" className="dim">…</p>)
  return <div className="notemd">{blocks}</div>
}

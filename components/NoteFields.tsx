'use client'

import { useState } from 'react'
import { useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { secretsMessages } from '@/lib/i18n/messages/secrets'
import { fieldType } from '@/lib/note-templates'
import type { NoteField, NoteTemplateId } from '@/lib/vault'

/** Strukturierte Felder einer Notiz: geheime Werte verdeckt, alles kopierbar. */
export default function NoteFields({ template, fields }: { template?: NoteTemplateId | string; fields: NoteField[] }) {
  const m = useMessages(secretsMessages).notes
  const { fmtDate } = useI18n()
  const [shown, setShown] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState<string | null>(null)
  const visible = fields.filter(f => f.value.trim())
  if (!visible.length) return null
  const label = (k: string) => (m.fields as Record<string, string>)[k] ?? k

  return (
    <dl className="notefields">
      {visible.map(f => {
        const type = fieldType(template as NoteTemplateId, f.key)
        const secret = type === 'secret'
        const open = shown.has(f.key)
        const display =
          secret && !open ? '•'.repeat(Math.min(12, Math.max(6, f.value.length))) : type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(f.value) ? fmtDate(f.value) : f.value
        return (
          <div className="notefield" key={f.key}>
            <dt>{label(f.key)}</dt>
            <dd>
              <span className={secret ? 'mono' : undefined}>{display}</span>
              <span className="notefield-actions">
                {secret && (
                  <button
                    type="button"
                    className="linkish"
                    onClick={() =>
                      setShown(s => {
                        const n = new Set(s)
                        if (n.has(f.key)) n.delete(f.key)
                        else n.add(f.key)
                        return n
                      })
                    }
                  >
                    {open ? m.hide : m.reveal}
                  </button>
                )}
                <button
                  type="button"
                  className="linkish"
                  onClick={() =>
                    void navigator.clipboard?.writeText(f.value).then(() => {
                      setCopied(f.key)
                      setTimeout(() => setCopied(c => (c === f.key ? null : c)), 1500)
                    })
                  }
                >
                  {copied === f.key ? `✓ ${m.copied}` : m.copy}
                </button>
              </span>
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

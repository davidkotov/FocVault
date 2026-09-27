'use client'

import { useMemo, useRef, useState } from 'react'
import { api } from '@/features/api/client'
import { fmt, useI18n, useMessages } from '@/features/i18n/I18nProvider'
import { useErrorText } from '@/features/i18n/errors'
import { downloadFile, uploadFile } from '@/features/objects/transfer'
import { secretsMessages } from '@/lib/i18n/messages/secrets'
import { EXPIRY_WARN_DAYS, NOTE_TEMPLATES, TEMPLATE_IDS, daysUntilExpiry, emptyFields, fieldType, noteSearchText, parseTags } from '@/lib/note-templates'
import { formatBytes, type NoteField, type NoteTemplateId, type SecretEntry, type VaultEntry } from '@/lib/vault'
import ConfirmDialog from './ConfirmDialog'
import NoteBody, { checklistProgress, toggleCheckLine } from './NoteBody'
import NoteFields from './NoteFields'

interface Props {
  entries: SecretEntry[]
  onSave: (s: SecretEntry) => void
  onDelete: (id: string) => void
  /** für Anhänge (Verschlüsseln/Entschlüsseln im Browser) */
  masterKey?: CryptoKey
  onShare?: (s: SecretEntry) => void
  /** Speicherverbrauch hat sich geändert (Anhang hoch-/gelöscht) */
  onStorageChanged?: () => void
  readOnly?: boolean
  heading?: string
}

interface Form {
  id?: string
  title: string
  body: string
  template?: NoteTemplateId
  fields: NoteField[]
  tags: string
  pinned: boolean
  attachments: VaultEntry[]
}

const Icon = ({ d }: { d: string }) => (
  <svg className="icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} />
  </svg>
)
const PIN = 'M12 17v5M9 3h6l-1 7 4 3H6l4-3z'
const TRASH = 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6'
const SHARE = 'M22 2 11 13M22 2l-7 20-4-9-9-4z'
const CLIP = 'M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48'

export default function NotesPanel({ entries, onSave, onDelete, masterKey, onShare, onStorageChanged, readOnly = false, heading }: Props) {
  const { common: c, notes: m } = useMessages(secretsMessages)
  const { fmtDate } = useI18n()
  const errText = useErrorText()
  const [form, setForm] = useState<Form | null>(null)
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [confirm, setConfirm] = useState<SecretEntry | null>(null)
  const uploadedInForm = useRef<Set<string>>(new Set())
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const allTags = useMemo(() => [...new Set(entries.flatMap(e => e.tags ?? []))].sort((a, b) => a.localeCompare(b)), [entries])
  const q = query.trim().toLowerCase()
  const shown = entries
    .filter(e => (!tag || e.tags?.includes(tag)) && (!q || noteSearchText(e).includes(q)))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt)
  const expiring = entries.filter(e => {
    const d = daysUntilExpiry(e)
    return d !== null && d <= EXPIRY_WARN_DAYS
  })

  const startNew = (template?: NoteTemplateId) => {
    uploadedInForm.current = new Set()
    setForm({ title: template ? m.templates[template] : '', body: '', template, fields: template ? emptyFields(template) : [], tags: '', pinned: false, attachments: [] })
  }
  const startEdit = (s: SecretEntry) => {
    uploadedInForm.current = new Set()
    const fields = s.template ? emptyFields(s.template).map(f => s.fields?.find(x => x.key === f.key) ?? f) : s.fields ?? []
    setForm({ id: s.id, title: s.title, body: s.body ?? '', template: s.template, fields, tags: (s.tags ?? []).join(', '), pinned: !!s.pinned, attachments: s.attachments ?? [] })
  }

  const deleteObjects = (list: VaultEntry[]) => {
    for (const a of list) if (a.objectId) void api.deleteObject(a.objectId).catch(() => undefined)
    if (list.length) setTimeout(() => onStorageChanged?.(), 500)
  }

  const cancel = () => {
    if (form) deleteObjects(form.attachments.filter(a => uploadedInForm.current.has(a.id)))
    setForm(null)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form || form.title.trim() === '') return
    const now = Date.now()
    const prev = form.id ? entries.find(x => x.id === form.id) : undefined
    const keep = new Set(form.attachments.map(a => a.id))
    deleteObjects((prev?.attachments ?? []).filter(a => !keep.has(a.id)))
    const tags = parseTags(form.tags)
    const fields = form.fields.filter(f => f.value.trim())
    onSave({
      ...(prev ?? {}),
      id: form.id ?? crypto.randomUUID(),
      kind: 'note',
      title: form.title.trim(),
      body: form.body,
      template: form.template,
      fields: fields.length ? fields : undefined,
      tags: tags.length ? tags : undefined,
      pinned: form.pinned || undefined,
      attachments: form.attachments.length ? form.attachments : undefined,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now
    })
    setForm(null)
  }

  const attach = async (files: FileList | null) => {
    if (!files?.length || !masterKey || !form) return
    setError(null)
    for (const file of Array.from(files)) {
      setUploadPct(0)
      try {
        const entry = await uploadFile(file, masterKey, { onProgress: p => setUploadPct(p.total ? Math.round((p.done / p.total) * 100) : 100) })
        uploadedInForm.current.add(entry.id)
        setForm(f => (f ? { ...f, attachments: [...f.attachments, entry] } : f))
      } catch (err) {
        setError(`${file.name}: ${errText(err)}`)
      }
    }
    setUploadPct(null)
    onStorageChanged?.()
  }

  const download = async (a: VaultEntry) => {
    if (!masterKey) return
    setError(null)
    try {
      await downloadFile(a, masterKey)
    } catch (err) {
      setError(errText(err))
    }
  }

  /** Format-Knopf: Präfix vor die aktuelle Zeile setzen bzw. Auswahl fett machen. */
  const format = (kind: 'h' | 'list' | 'check' | 'bold') => {
    const el = bodyRef.current
    if (!el || !form) return
    const { selectionStart: a, selectionEnd: b, value } = el
    let next: string
    let caret: number
    if (kind === 'bold') {
      const sel = value.slice(a, b) || '…'
      next = `${value.slice(0, a)}**${sel}**${value.slice(b)}`
      caret = a + sel.length + 4
    } else {
      const prefix = kind === 'h' ? '## ' : kind === 'list' ? '- ' : '- [ ] '
      const start = value.lastIndexOf('\n', a - 1) + 1
      next = value.slice(0, start) + prefix + value.slice(start)
      caret = b + prefix.length
    }
    setForm({ ...form, body: next })
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }

  const expiryBadge = (s: SecretEntry) => {
    const d = daysUntilExpiry(s)
    if (d === null || d > EXPIRY_WARN_DAYS) return null
    return <span className={`badge ${d < 0 ? 'bad' : 'warn'}`}>{d < 0 ? m.expired : d === 0 ? m.expiresToday : fmt(m.expiresIn, { n: d })}</span>
  }

  return (
    <div className="card">
      <h3>
        {heading ?? m.heading}
        <span>{fmt(m.subtitle, { n: entries.length })}</span>
      </h3>
      {error && <div className="errorbox">{error}</div>}
      {expiring.length > 0 && !form && <div className="notice warn">{fmt(m.expiringSoon, { n: expiring.length })}</div>}

      {entries.length > 0 && !form && (
        <div className="notetools">
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={m.search} aria-label={m.search} />
          {allTags.length > 0 && (
            <div className="chips">
              <button type="button" className={`chip${tag === null ? ' active' : ''}`} onClick={() => setTag(null)}>
                {m.allTags}
              </button>
              {allTags.map(t => (
                <button key={t} type="button" className={`chip${tag === t ? ' active' : ''}`} onClick={() => setTag(tag === t ? null : t)}>
                  #{t}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!form && shown.length > 0 && (
        <div className="notesgrid">
          {shown.map(s => {
            const progress = checklistProgress(s.body ?? '')
            return (
              <div className={`notecard${s.pinned ? ' pinned' : ''}`} key={s.id}>
                <div className="notehead">
                  <div className="sectitle">
                    {s.template && <span aria-hidden="true">{NOTE_TEMPLATES[s.template]?.icon} </span>}
                    {s.title}
                  </div>
                  <div className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>
                    {!readOnly && <button className={`iconbtn${s.pinned ? ' on' : ''}`} title={s.pinned ? m.unpin : m.pin} aria-pressed={!!s.pinned} onClick={() => onSave({ ...s, pinned: !s.pinned || undefined, updatedAt: s.updatedAt })}>
                      <Icon d={PIN} />
                    </button>}
                    {onShare && (
                      <button className="iconbtn" title={m.share} onClick={() => onShare(s)}>
                        <Icon d={SHARE} />
                      </button>
                    )}
                    {!readOnly && <button className="iconbtn danger" title={c.delete} onClick={() => setConfirm(s)}>
                      <Icon d={TRASH} />
                    </button>}
                  </div>
                </div>
                {(expiryBadge(s) || (s.tags?.length ?? 0) > 0 || progress.total > 0) && (
                  <div className="notemeta">
                    {expiryBadge(s)}
                    {progress.total > 0 && <span className="badge">{fmt(m.checklist, progress)}</span>}
                    {s.tags?.map(t => (
                      <button key={t} type="button" className="notetag" onClick={() => setTag(t)}>
                        #{t}
                      </button>
                    ))}
                  </div>
                )}
                {s.fields?.length ? <NoteFields template={s.template} fields={s.fields} /> : null}
                {(s.body || !s.fields?.length) && (
                  <div className="notebody">
                    {s.body ? (
                      <NoteBody body={s.body} limit={14} onToggle={readOnly ? undefined : line => onSave({ ...s, body: toggleCheckLine(s.body!, line), updatedAt: Date.now() })} />
                    ) : (
                      <span className="dim">{m.emptyNote}</span>
                    )}
                  </div>
                )}
                {s.attachments?.length ? (
                  <ul className="noteatt">
                    {s.attachments.map(a => (
                      <li key={a.id}>
                        <Icon d={CLIP} />
                        <button type="button" className="linkish" title={m.download} onClick={() => void download(a)} disabled={!masterKey}>
                          {a.name}
                        </button>
                        <span className="dim">{formatBytes(a.size)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="notefoot">
                  <span className="dim">{fmtDate(s.updatedAt)}</span>
                  {!readOnly && <button className="small" onClick={() => startEdit(s)}>
                    {c.edit}
                  </button>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!form && entries.length > 0 && shown.length === 0 && <p className="dim">{m.noMatch}</p>}
      {entries.length === 0 && !form && <p className="dim">{m.empty}</p>}

      {form ? (
        <form className="secform" onSubmit={submit}>
          <h4>
            {form.template && <span aria-hidden="true">{NOTE_TEMPLATES[form.template].icon} </span>}
            {form.id ? m.editTitle : m.newTitle}
          </h4>
          <div className="secfields">
            <label>
              {c.title} <span className="req">*</span>
              <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder={m.titlePlaceholder} autoFocus />
            </label>
            {form.template && (
              <div className="notefieldgrid">
                {form.fields.map((f, i) => {
                  const type = fieldType(form.template, f.key)
                  return (
                    <label key={f.key}>
                      {(m.fields as Record<string, string>)[f.key] ?? f.key}
                      <input
                        type={type === 'date' ? 'date' : type === 'month' ? 'month' : 'text'}
                        className={type === 'secret' ? 'mono' : undefined}
                        autoComplete="off"
                        spellCheck={false}
                        value={f.value}
                        onChange={e => setForm({ ...form, fields: form.fields.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
                      />
                    </label>
                  )
                })}
              </div>
            )}
            <label htmlFor="note-body">{m.body}</label>
            <div className="mdtoolbar" role="toolbar" aria-label={m.fmtHint}>
              <button type="button" className="small" onClick={() => format('h')} title={m.fmtHeading}>
                H
              </button>
              <button type="button" className="small" onClick={() => format('bold')} title={m.fmtBold}>
                <strong>B</strong>
              </button>
              <button type="button" className="small" onClick={() => format('list')} title={m.fmtList}>
                • {m.fmtList}
              </button>
              <button type="button" className="small" onClick={() => format('check')} title={m.fmtCheck}>
                ☐ {m.fmtCheck}
              </button>
            </div>
            <textarea id="note-body" ref={bodyRef} rows={7} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} placeholder={m.bodyPlaceholder} />
            <span className="hint">{m.fmtHint}</span>
            <label>
              {m.tags}
              <input value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder={m.tagsPlaceholder} />
            </label>
            <label className="checkrow">
              <input type="checkbox" checked={form.pinned} onChange={e => setForm({ ...form, pinned: e.target.checked })} /> {m.pinned}
            </label>
            {masterKey && (
              <div>
                <div className="navsection" style={{ padding: '6px 0' }}>
                  {m.attachments}
                </div>
                {form.attachments.length > 0 && (
                  <ul className="noteatt">
                    {form.attachments.map(a => (
                      <li key={a.id}>
                        <Icon d={CLIP} />
                        <span>{a.name}</span>
                        <span className="dim">{formatBytes(a.size)}</span>
                        <button type="button" className="iconbtn danger" title={m.removeAttachment} onClick={() => setForm({ ...form, attachments: form.attachments.filter(x => x.id !== a.id) })}>
                          <Icon d={TRASH} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {uploadPct !== null ? (
                  <span className="hint">{fmt(m.attaching, { pct: uploadPct })}</span>
                ) : (
                  <label className="small filebtn">
                    <Icon d={CLIP} /> {m.attach}
                    <input type="file" multiple hidden data-testid="note-attach" onChange={e => {
                      void attach(e.target.files)
                      e.target.value = ''
                    }} />
                  </label>
                )}
                <div className="hint">{m.attachHint}</div>
              </div>
            )}
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="primary" type="submit" disabled={form.title.trim() === '' || uploadPct !== null}>
              {c.save}
            </button>
            <button type="button" onClick={cancel}>
              {c.cancel}
            </button>
          </div>
        </form>
      ) : readOnly ? null : (
        <div className="notenew">
          <button className="primary" onClick={() => startNew()}>
            {m.newButton}
          </button>
          <span className="dim">{m.fromTemplate}:</span>
          {TEMPLATE_IDS.map(id => (
            <button key={id} className="small" onClick={() => startNew(id)}>
              {NOTE_TEMPLATES[id].icon} {m.templates[id]}
            </button>
          ))}
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title={fmt(m.deleteConfirm, { title: confirm.title })}
          body=""
          confirmLabel={c.delete}
          cancelLabel={c.cancel}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            deleteObjects(confirm.attachments ?? [])
            onDelete(confirm.id)
            setConfirm(null)
          }}
        />
      )}
    </div>
  )
}

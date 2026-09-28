import type { NoteField, NoteTemplateId, SecretEntry } from './vault'

export type FieldType = 'text' | 'secret' | 'date' | 'month'

export interface TemplateField {
  key: string
  type: FieldType
}

/** Vorlagen für strukturierte Notizen. Labels kommen aus den Übersetzungen (secrets.templates). */
export const NOTE_TEMPLATES: Record<NoteTemplateId, { icon: 'idcard' | 'card' | 'shield' | 'wifi' | 'key'; fields: TemplateField[] }> = {
  id: {
    icon: 'idcard',
    fields: [
      { key: 'docType', type: 'text' },
      { key: 'name', type: 'text' },
      { key: 'number', type: 'secret' },
      { key: 'authority', type: 'text' },
      { key: 'issued', type: 'date' },
      { key: 'expires', type: 'date' }
    ]
  },
  card: {
    icon: 'card',
    fields: [
      { key: 'holder', type: 'text' },
      { key: 'number', type: 'secret' },
      { key: 'expires', type: 'month' },
      { key: 'cvc', type: 'secret' },
      { key: 'pin', type: 'secret' },
      { key: 'bank', type: 'text' }
    ]
  },
  insurance: {
    icon: 'shield',
    fields: [
      { key: 'insurer', type: 'text' },
      { key: 'policy', type: 'text' },
      { key: 'phone', type: 'text' },
      { key: 'expires', type: 'date' }
    ]
  },
  wifi: {
    icon: 'wifi',
    fields: [
      { key: 'ssid', type: 'text' },
      { key: 'password', type: 'secret' },
      { key: 'security', type: 'text' }
    ]
  },
  license: {
    icon: 'key',
    fields: [
      { key: 'product', type: 'text' },
      { key: 'licenseKey', type: 'secret' },
      { key: 'email', type: 'text' },
      { key: 'purchased', type: 'date' },
      { key: 'expires', type: 'date' }
    ]
  }
}

export const TEMPLATE_IDS = Object.keys(NOTE_TEMPLATES) as NoteTemplateId[]

export function fieldType(template: NoteTemplateId | undefined, key: string): FieldType {
  return (template && NOTE_TEMPLATES[template]?.fields.find(f => f.key === key)?.type) || 'text'
}

/** Ablaufdatum aus dem Feld „expires“ (YYYY-MM-DD oder YYYY-MM = Monatsende). */
export function expiryDate(note: Pick<SecretEntry, 'fields'>): Date | null {
  const v = note.fields?.find(f => f.key === 'expires')?.value?.trim()
  if (!v) return null
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59)
  m = /^(\d{4})-(\d{2})$/.exec(v)
  if (m) return new Date(Number(m[1]), Number(m[2]), 0, 23, 59, 59)
  return null
}

/** Ablauf nur als Monat/Jahr angegeben (z. B. Kreditkarte „10/2026“)? */
export function expiresAtMonthEnd(note: Pick<SecretEntry, 'fields'>): boolean {
  return /^\d{4}-\d{2}$/.test(note.fields?.find(f => f.key === 'expires')?.value?.trim() ?? '')
}

/** Tage bis zum Ablauf (negativ = abgelaufen), null ohne Datum. */
export function daysUntilExpiry(note: Pick<SecretEntry, 'fields'>, now = Date.now()): number | null {
  const d = expiryDate(note)
  return d ? Math.ceil((d.getTime() - now) / 86_400_000) : null
}

/** Erinnerung ab 60 Tagen vor Ablauf. */
export const EXPIRY_WARN_DAYS = 60

export function emptyFields(template: NoteTemplateId): NoteField[] {
  return NOTE_TEMPLATES[template].fields.map(f => ({ key: f.key, value: '' }))
}

/** Suchtext einer Notiz (ohne geheime Felder). */
export function noteSearchText(n: SecretEntry): string {
  const visible = (n.fields ?? []).filter(f => fieldType(n.template, f.key) !== 'secret').map(f => f.value)
  return [n.title, n.body ?? '', ...(n.tags ?? []), ...visible, ...(n.attachments ?? []).map(a => a.name)].join('\n').toLowerCase()
}

export function parseTags(input: string): string[] {
  return [...new Set(input.split(',').map(t => t.trim()).filter(Boolean))].slice(0, 20)
}

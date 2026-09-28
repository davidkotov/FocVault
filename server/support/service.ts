import { z } from 'zod'
import { audit, type Deps } from '../deps'
import { ipLimit, rateLimit } from '../auth/ratelimit'
import { ApiError } from '../shared/errors'
import { isUuid, uuidv7 } from '../shared/ids'

/** Support-Formular (öffentlich). Anfragen landen im Admin unter „Support“. */
export const CATEGORIES = ['product', 'billing', 'general', 'feature', 'storage', 'business'] as const

export const ticketSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().pipe(z.email('Ungültige E-Mail-Adresse').max(254)),
  company: z.string().trim().max(120).optional(),
  categories: z.array(z.enum(CATEGORIES)).min(1, 'Bitte mindestens eine Kategorie wählen.').max(CATEGORIES.length),
  topic: z.string().trim().max(80).optional(),
  message: z.string().trim().min(10, 'Bitte beschreibe dein Anliegen (mind. 10 Zeichen).').max(5000),
  /** Honeypot – bleibt bei Menschen leer */
  website: z.string().max(0).optional()
})

export async function createTicket(deps: Deps, input: z.output<typeof ticketSchema>, meta: { ip: string; accountId?: string }): Promise<{ id: string }> {
  rateLimit(`support:ip:${meta.ip}`, ipLimit(6), 60 * 60_000)
  rateLimit(`support:email:${input.email}`, 10, 24 * 60 * 60_000)
  const id = uuidv7()
  await deps.db.query(
    `INSERT INTO support_tickets (id, account_id, first_name, last_name, email, company, categories, topic, message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, meta.accountId ?? null, input.firstName, input.lastName, input.email, input.company || null, input.categories, input.topic || null, input.message]
  )
  await audit(deps.db, meta.accountId ?? null, 'user', 'support.ticket_created', { ticket: id, categories: input.categories })
  return { id }
}

export interface SupportTicket {
  id: string
  accountId: string | null
  name: string
  email: string
  company: string | null
  categories: string[]
  topic: string | null
  message: string
  status: 'open' | 'answered' | 'closed'
  note: string | null
  createdAt: string
}

export async function listTickets(deps: Deps, status?: string): Promise<SupportTicket[]> {
  const rows = await deps.db.query<{
    id: string
    account_id: string | null
    first_name: string
    last_name: string
    email: string
    company: string | null
    categories: string[]
    topic: string | null
    message: string
    status: SupportTicket['status']
    note: string | null
    created_at: string
  }>(`SELECT * FROM support_tickets WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT 300`, [status ?? null])
  return rows.map(r => ({
    id: r.id,
    accountId: r.account_id,
    name: `${r.first_name} ${r.last_name}`,
    email: r.email,
    company: r.company,
    categories: r.categories,
    topic: r.topic,
    message: r.message,
    status: r.status,
    note: r.note,
    createdAt: new Date(r.created_at).toISOString()
  }))
}

export const ticketUpdateSchema = z.object({ status: z.enum(['open', 'answered', 'closed']), note: z.string().max(2000).optional() })

export async function updateTicket(deps: Deps, adminId: string, id: string, input: z.output<typeof ticketUpdateSchema>): Promise<void> {
  if (!isUuid(id)) throw new ApiError('NOT_FOUND', 'Anfrage nicht gefunden.')
  const r = await deps.db.query('UPDATE support_tickets SET status = $2, note = COALESCE($3, note), updated_at = now() WHERE id = $1 RETURNING id', [id, input.status, input.note ?? null])
  if (!r.length) throw new ApiError('NOT_FOUND', 'Anfrage nicht gefunden.')
  await audit(deps.db, adminId, 'admin', 'support.ticket_updated', { ticket: id, status: input.status })
}

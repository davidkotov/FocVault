import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, route } from '@/server/shared/http'
import { stripeGateway } from '@/server/stripe/gateway'
import { stripeInvoices } from '@/server/stripe/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Letzte Rechnungen und hinterlegte Karte (leer ohne Stripe). */
export const GET = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const gw = stripeGateway()
  if (!gw) return json({ stripe: false, invoices: [], card: null })
  return json({ stripe: true, ...(await stripeInvoices(d, gw, session.accountId)) })
})

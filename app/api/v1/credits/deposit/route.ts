import { deps } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { json, readJson, route } from '@/server/shared/http'
import { addCredit, depositSchema } from '@/server/credits/service'
import { purchasesEnabled } from '@/server/billing/service'
import { stripeGateway } from '@/server/stripe/gateway'
import { stripeContext } from '@/server/stripe/http'
import { stripeDepositUrl } from '@/server/stripe/service'
import { ApiError } from '@/server/shared/errors'
import { uuidv7 } from '@/server/shared/ids'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Guthaben aufladen: mit Stripe → Checkout-URL; lokal (Entwicklung) → sofort gutgeschrieben. */
export const POST = route(async req => {
  const d = await deps()
  const session = await requireSession(req, d.db)
  const { amount } = await readJson(req, depositSchema)
  const gw = stripeGateway()
  if (gw) return json({ redirectUrl: await stripeDepositUrl(d, gw, session, amount, stripeContext(req)) })
  if (!purchasesEnabled()) throw new ApiError('BAD_REQUEST', 'Online-Zahlung ist noch nicht eingerichtet.')
  const acc = await d.db.query<{ currency: 'CHF' | 'EUR' | 'USD' }>('SELECT currency FROM accounts WHERE id = $1', [session.accountId])
  await addCredit(d.db, { accountId: session.accountId, amount, currency: acc[0]?.currency ?? 'CHF', kind: 'deposit', source: 'dev', ref: `dev:${uuidv7()}`, note: 'Aufladung (Entwicklung, ohne Zahlung)' })
  return json({ ok: true })
})

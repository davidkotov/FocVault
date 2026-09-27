import { deps } from '@/server/deps'
import { ApiError } from '@/server/shared/errors'
import { json, route } from '@/server/shared/http'
import { stripeGateway } from '@/server/stripe/gateway'
import { handleStripeEvent } from '@/server/stripe/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Stripe-Webhook. Authentisch nur mit gültiger Signatur (STRIPE_WEBHOOK_SECRET); ohne Signatur
 * oder mit falscher → 400. Kein CSRF-Header (Aufrufer ist Stripe).
 * Ereignisse im Stripe-Dashboard: checkout.session.completed, customer.subscription.*,
 * invoice.paid, invoice.payment_failed.
 */
export const POST = route(
  async req => {
    const gw = stripeGateway()
    if (!gw) throw new ApiError('NOT_FOUND', 'Nicht eingerichtet.')
    const signature = req.headers.get('stripe-signature')
    if (!signature) throw new ApiError('BAD_REQUEST', 'Signatur fehlt.')
    const raw = await req.text()
    if (raw.length > 1_000_000) throw new ApiError('PAYLOAD_TOO_LARGE', 'Zu groß.')
    let event
    try {
      event = gw.verifyWebhook(raw, signature)
    } catch {
      throw new ApiError('BAD_REQUEST', 'Ungültige Signatur.')
    }
    const result = await handleStripeEvent(await deps(), gw, event)
    return json({ received: true, result })
  },
  { csrf: false }
)

import type { NextRequest } from 'next/server'
import { requestOrigin } from '../auth/guard'
import { allowedOrigins } from '../shared/env'
import type { StripeContext } from './service'

/** Rücksprung-Adresse und Sprache für Stripe-Seiten (Checkout, Kundenportal). */
export function stripeContext(req: NextRequest): StripeContext {
  const origin = allowedOrigins(requestOrigin(req))[0]
  const locale = req.cookies.get('fv_locale')?.value === 'en' ? 'en' : 'de'
  return { origin, locale }
}

import Stripe from 'stripe'

/**
 * Schmale Schnittstelle zu Stripe – nur was FocVault braucht. So bleibt die Geschäftslogik
 * testbar (Attrappe in Tests) und SDK-Versionswechsel betreffen nur diese Datei.
 * Preise werden nicht in Stripe gepflegt, sondern je Vorgang aus unserem Preisbuch übergeben
 * (`price_data`); Stripe kennt nur vier Produkte (Pro, Family, Zusatzspeicher, Pay-as-you-go).
 */
export type Cur = 'chf' | 'eur' | 'usd'
export type Recurring = 'month' | 'year'

export interface PriceData {
  currency: Cur
  unitAmount: number
  product: string
  interval: Recurring
}

export interface SubscriptionItemLite {
  id: string
  product: string
  currency: Cur
  unitAmount: number
  interval: Recurring
  periodEnd: number | null
  quantity: number
}

export interface SubscriptionLite {
  id: string
  customer: string
  status: string
  cancelAtPeriodEnd: boolean
  periodEnd: number | null
  metadata: Record<string, string>
  items: SubscriptionItemLite[]
}

export interface StripeEventLite {
  id: string
  type: string
  object: Record<string, any>
}

export interface StripeGateway {
  createCustomer(input: { accountId: string; email: string | null; name: string }): Promise<string>
  createProduct(name: string, key: string): Promise<string>
  checkoutSubscription(input: {
    customer: string
    price: PriceData
    /** weitere Positionen, z. B. zusätzliche Nutzer */
    extra?: Array<{ price: PriceData; quantity: number }>
    successUrl: string
    cancelUrl: string
    metadata: Record<string, string>
    automaticTax: boolean
    locale: 'de' | 'en'
  }): Promise<string>
  checkoutSetup(input: {
    customer: string
    currency: Cur
    successUrl: string
    cancelUrl: string
    metadata: Record<string, string>
    locale: 'de' | 'en'
  }): Promise<string>
  portal(customer: string, returnUrl: string, locale: 'de' | 'en'): Promise<string>
  /** Einmalzahlung (Guthaben aufladen) */
  checkoutPayment(input: {
    customer: string
    currency: Cur
    amount: number
    description: string
    successUrl: string
    cancelUrl: string
    metadata: Record<string, string>
    locale: 'de' | 'en'
  }): Promise<string>
  retrieveSubscription(id: string): Promise<SubscriptionLite>
  changeSubscriptionPlan(id: string, itemId: string, price: PriceData): Promise<SubscriptionLite>
  setCancelAtPeriodEnd(id: string, cancel: boolean): Promise<SubscriptionLite>
  addItem(subscriptionId: string, price: PriceData, metadata: Record<string, string>, quantity?: number): Promise<string>
  setItemQuantity(itemId: string, quantity: number): Promise<void>
  removeItem(itemId: string): Promise<void>
  setupIntentPaymentMethod(setupIntentId: string): Promise<string | null>
  setDefaultPaymentMethod(customer: string, paymentMethod: string): Promise<void>
  hasDefaultPaymentMethod(customer: string): Promise<boolean>
  /** Einzelrechnung (Pay-as-you-go) sofort abbuchen */
  chargeOnce(input: {
    customer: string
    currency: Cur
    amount: number
    description: string
    metadata: Record<string, string>
    automaticTax: boolean
  }): Promise<{ invoiceId: string; paid: boolean }>
  verifyWebhook(rawBody: string, signature: string): StripeEventLite
}

function toLite(s: any): SubscriptionLite {
  const items: SubscriptionItemLite[] = (s.items?.data ?? []).map((i: any) => ({
    id: i.id,
    product: typeof i.price?.product === 'string' ? i.price.product : i.price?.product?.id,
    currency: i.price?.currency,
    unitAmount: i.price?.unit_amount ?? 0,
    interval: i.price?.recurring?.interval ?? 'month',
    quantity: i.quantity ?? 1,
    // Neuere API-Versionen führen die Laufzeit pro Position
    periodEnd: i.current_period_end ?? null
  }))
  return {
    id: s.id,
    customer: typeof s.customer === 'string' ? s.customer : s.customer?.id,
    status: s.status,
    cancelAtPeriodEnd: !!s.cancel_at_period_end,
    periodEnd: s.current_period_end ?? items.reduce<number | null>((m, i) => (i.periodEnd && (!m || i.periodEnd > m) ? i.periodEnd : m), null),
    metadata: s.metadata ?? {},
    items
  }
}

function priceData(p: PriceData) {
  return {
    currency: p.currency,
    unit_amount: p.unitAmount,
    product: p.product,
    recurring: { interval: p.interval },
    // Unsere Preise sind Endpreise inkl. MWST
    tax_behavior: 'inclusive' as const
  }
}

export class LiveStripeGateway implements StripeGateway {
  private readonly s: Stripe

  constructor(
    secretKey: string,
    private readonly webhookSecret: string
  ) {
    this.s = new Stripe(secretKey, { maxNetworkRetries: 2, appInfo: { name: 'FocVault' } })
  }

  async createCustomer(input: { accountId: string; email: string | null; name: string }) {
    const c = await this.s.customers.create({
      email: input.email ?? undefined,
      name: input.name,
      metadata: { accountId: input.accountId }
    })
    return c.id
  }

  async createProduct(name: string, key: string) {
    const p = await this.s.products.create({ name, metadata: { focvault: key }, tax_code: 'txcd_10000000' })
    return p.id
  }

  async checkoutSubscription(input: Parameters<StripeGateway['checkoutSubscription']>[0]) {
    const session = await this.s.checkout.sessions.create({
      mode: 'subscription',
      customer: input.customer,
      line_items: [
        { price_data: priceData(input.price) as any, quantity: 1 },
        ...(input.extra ?? []).filter(e => e.quantity > 0).map(e => ({ price_data: priceData(e.price) as any, quantity: e.quantity }))
      ],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      subscription_data: { metadata: input.metadata },
      metadata: input.metadata,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      automatic_tax: { enabled: input.automaticTax },
      ...(input.automaticTax ? { customer_update: { address: 'auto' as const } } : {}),
      locale: input.locale
    } as any)
    if (!session.url) throw new Error('Stripe lieferte keine Checkout-URL.')
    return session.url
  }

  async checkoutSetup(input: Parameters<StripeGateway['checkoutSetup']>[0]) {
    const session = await this.s.checkout.sessions.create({
      mode: 'setup',
      customer: input.customer,
      currency: input.currency,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: input.metadata,
      setup_intent_data: { metadata: input.metadata },
      locale: input.locale
    } as any)
    if (!session.url) throw new Error('Stripe lieferte keine Checkout-URL.')
    return session.url
  }

  async checkoutPayment(input: Parameters<StripeGateway['checkoutPayment']>[0]) {
    const session = await this.s.checkout.sessions.create({
      mode: 'payment',
      customer: input.customer,
      line_items: [{ price_data: { currency: input.currency, unit_amount: input.amount, product_data: { name: input.description } }, quantity: 1 }],
      payment_intent_data: { metadata: input.metadata, setup_future_usage: 'off_session' },
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: input.metadata,
      locale: input.locale
    } as any)
    if (!session.url) throw new Error('Stripe lieferte keine Checkout-URL.')
    return session.url
  }

  async portal(customer: string, returnUrl: string, locale: 'de' | 'en') {
    const p = await this.s.billingPortal.sessions.create({ customer, return_url: returnUrl, locale } as any)
    return p.url
  }

  async retrieveSubscription(id: string) {
    return toLite(await this.s.subscriptions.retrieve(id))
  }

  async changeSubscriptionPlan(id: string, itemId: string, price: PriceData) {
    return toLite(
      await this.s.subscriptions.update(id, {
        items: [{ id: itemId, price_data: priceData(price) as any }],
        proration_behavior: 'create_prorations',
        cancel_at_period_end: false
      } as any)
    )
  }

  async setCancelAtPeriodEnd(id: string, cancel: boolean) {
    return toLite(await this.s.subscriptions.update(id, { cancel_at_period_end: cancel }))
  }

  async setItemQuantity(itemId: string, quantity: number) {
    await this.s.subscriptionItems.update(itemId, { quantity, proration_behavior: 'create_prorations' } as any)
  }

  async addItem(subscriptionId: string, price: PriceData, metadata: Record<string, string>, quantity = 1) {
    const item = await this.s.subscriptionItems.create({
      subscription: subscriptionId,
      price_data: priceData(price) as any,
      quantity,
      metadata,
      proration_behavior: 'create_prorations'
    } as any)
    return item.id
  }

  async removeItem(itemId: string) {
    await this.s.subscriptionItems.del(itemId, { proration_behavior: 'create_prorations' } as any)
  }

  async setupIntentPaymentMethod(setupIntentId: string) {
    const si = await this.s.setupIntents.retrieve(setupIntentId)
    return typeof si.payment_method === 'string' ? si.payment_method : (si.payment_method?.id ?? null)
  }

  async setDefaultPaymentMethod(customer: string, paymentMethod: string) {
    await this.s.customers.update(customer, { invoice_settings: { default_payment_method: paymentMethod } })
  }

  async hasDefaultPaymentMethod(customer: string) {
    const c = await this.s.customers.retrieve(customer)
    return !('deleted' in c && c.deleted) && !!(c as any).invoice_settings?.default_payment_method
  }

  async chargeOnce(input: Parameters<StripeGateway['chargeOnce']>[0]) {
    const invoice = await this.s.invoices.create({
      customer: input.customer,
      currency: input.currency,
      collection_method: 'charge_automatically',
      auto_advance: false,
      description: input.description,
      metadata: input.metadata,
      automatic_tax: { enabled: input.automaticTax }
    } as any)
    await this.s.invoiceItems.create({
      customer: input.customer,
      invoice: invoice.id,
      amount: input.amount,
      currency: input.currency,
      description: input.description,
      tax_behavior: 'inclusive'
    } as any)
    await this.s.invoices.finalizeInvoice(invoice.id!)
    try {
      const paid = await this.s.invoices.pay(invoice.id!)
      return { invoiceId: invoice.id!, paid: paid.status === 'paid' }
    } catch {
      return { invoiceId: invoice.id!, paid: false }
    }
  }

  verifyWebhook(rawBody: string, signature: string): StripeEventLite {
    const e = this.s.webhooks.constructEvent(rawBody, signature, this.webhookSecret)
    return { id: e.id, type: e.type, object: (e.data as any).object }
  }
}

const g = globalThis as unknown as { __fvStripe?: StripeGateway | null; __fvStripeOverride?: StripeGateway | null }

/** Stripe ist aktiv, sobald STRIPE_SECRET_KEY und STRIPE_WEBHOOK_SECRET gesetzt sind. */
export function stripeGateway(): StripeGateway | null {
  if (g.__fvStripeOverride !== undefined) return g.__fvStripeOverride
  if (g.__fvStripe === undefined) {
    const key = process.env.STRIPE_SECRET_KEY
    const hook = process.env.STRIPE_WEBHOOK_SECRET
    g.__fvStripe = key && hook ? new LiveStripeGateway(key, hook) : null
  }
  return g.__fvStripe
}

/** Nur für Tests: Attrappe setzen (null = Stripe aus, undefined = Umgebung). */
export function setStripeGatewayForTests(gw: StripeGateway | null | undefined): void {
  g.__fvStripeOverride = gw
}

export function stripeTaxEnabled(): boolean {
  return process.env.STRIPE_AUTOMATIC_TAX === '1'
}

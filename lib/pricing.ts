/**
 * Preisbuch v2 und Wirtschaftlichkeit (reine Funktionen – Client und Server).
 * - Preise je Währung (CHF, EUR, USD) als feste Preispunkte, nicht umgerechnet
 * - Monats- und Jahresabos (Jahr = 2 Monate geschenkt)
 * - Pay-as-you-go nach durchschnittlich belegtem Speicher über der Free-Quota
 * Einheiten: 1 GB = 10^9 Byte, 1 TB = 10^12 Byte (wie Fil One und die Konkurrenz).
 * Interne Auswertung in CHF (Kurse im Preisbuch).
 */

export const GB = 1e9
export const TB = 1e12

export type Currency = 'CHF' | 'EUR' | 'USD'
export type Interval = 'month' | 'year'
export const CURRENCIES: Currency[] = ['CHF', 'EUR', 'USD']
export type Money = Record<Currency, number>

export interface PlanPrice {
  label: string
  quotaGb: number
  monthly: Money
  yearly: Money
}

export interface AddonPack {
  id: string
  gb: number
  monthly: Money
  yearly: Money
}

export interface PricingConfig {
  v: 2
  /** Fil One Listenpreis: $4.99 / TB / Monat auf den Tagesdurchschnitt */
  filOneUsdPerTbMonth: number
  filOneMinUsd: number
  /** Kurse für die interne Auswertung in CHF */
  fx: { usdToChf: number; eurToChf: number }
  /** Stripe: Prozent + Fixbetrag (CHF) pro Rechnung */
  stripePercent: number
  stripeFixedChf: number
  free: { quotaGb: number }
  payg: { perGbMonth: Money; minInvoice: Money; defaultCapGb: number; maxCapGb: number }
  plans: { pro: PlanPrice; family: PlanPrice & { seats: number } }
  addons: AddonPack[]
  freeTier: { monthlyBudgetChf: number; inactiveWarnDays: number; inactiveDeleteDays: number }
  /** Business: drei Stufen, Nutzerplätze (inklusive + zusätzlich pro Nutzer) */
  business: {
    starter: BusinessTier
    business: BusinessTier
    enterprise: { label: string; quotaGb: number; seats: number; fromMonthly: Money; contact: string }
    seat: { monthly: Money; yearly: Money }
  }
  /** Papierkorb für Abos (Pro/Family/Business): Tage bis zur endgültigen Löschung. Free löscht sofort. */
  trashDays: number
  /** Dateiversionen (Pro/Family): Aufbewahrung ältere Fassungen in Tagen, höchstens maxVersions je Datei */
  versions: { days: number; max: number }
  /**
   * Womit wir speichern (bestimmt die Kosten): Fil One (S3), Filecoin Onchain Cloud direkt
   * (USDFC, PDP-geprüft) oder beides (Fil One als schnelle Kopie + FOC als geprüfte Kopie).
   */
  storage: { backend: StorageBackend; focUsdPerTibMonthPerCopy: number; focCopies: number }
  /** Speicher-API für Entwickler (später): Preis pro GB/Monat, Download über Inklusivmenge. */
  api: { perGbMonth: Money; egressPerGb: Money; includedEgressRatio: number; minMonthly: Money }
}

export type StorageBackend = 'filone' | 'foc' | 'both'

export interface BusinessTier extends PlanPrice {
  /** inklusive Nutzer */
  seats: number
}

export type BusinessTierId = 'starter' | 'business' | 'enterprise'

/** Monatspreis bzw. Jahrespreis einer Business-Stufe inklusive zusätzlicher Nutzer. */
export function businessPrice(p: PricingConfig, tier: 'starter' | 'business', extraSeats: number, interval: Interval, currency: Currency): number {
  const t = p.business[tier]
  return round2(priceOf(t, interval, currency) + Math.max(0, extraSeats) * priceOf(p.business.seat, interval, currency))
}

export const DEFAULT_PRICING: PricingConfig = {
  v: 2,
  filOneUsdPerTbMonth: 4.99,
  filOneMinUsd: 4.99,
  fx: { usdToChf: 0.85, eurToChf: 0.94 },
  stripePercent: 2.9,
  stripeFixedChf: 0.3,
  free: { quotaGb: 5 },
  payg: {
    perGbMonth: { CHF: 0.03, EUR: 0.03, USD: 0.035 },
    minInvoice: { CHF: 2, EUR: 2, USD: 2.5 },
    defaultCapGb: 100,
    maxCapGb: 1000
  },
  plans: {
    pro: {
      label: 'Pro',
      quotaGb: 1000,
      monthly: { CHF: 13.9, EUR: 13.9, USD: 14.9 },
      yearly: { CHF: 139, EUR: 139, USD: 149 }
    },
    family: {
      label: 'Family',
      quotaGb: 2000,
      seats: 6,
      monthly: { CHF: 19.9, EUR: 19.9, USD: 21.9 },
      yearly: { CHF: 199, EUR: 199, USD: 219 }
    }
  },
  addons: [
    { id: 'plus-200', gb: 200, monthly: { CHF: 2.9, EUR: 2.9, USD: 2.99 }, yearly: { CHF: 29, EUR: 29, USD: 29.9 } },
    { id: 'plus-500', gb: 500, monthly: { CHF: 5.9, EUR: 5.9, USD: 6.49 }, yearly: { CHF: 59, EUR: 59, USD: 64.9 } },
    { id: 'plus-1000', gb: 1000, monthly: { CHF: 9.9, EUR: 9.9, USD: 10.9 }, yearly: { CHF: 99, EUR: 99, USD: 109 } },
    { id: 'plus-2000', gb: 2000, monthly: { CHF: 17.9, EUR: 17.9, USD: 19.9 }, yearly: { CHF: 179, EUR: 179, USD: 199 } }
  ],
  freeTier: { monthlyBudgetChf: 1000, inactiveWarnDays: 365, inactiveDeleteDays: 540 },
  business: {
    starter: { label: 'Business Starter', quotaGb: 3000, seats: 5, monthly: { CHF: 49, EUR: 49, USD: 55 }, yearly: { CHF: 490, EUR: 490, USD: 550 } },
    business: { label: 'Business', quotaGb: 10000, seats: 10, monthly: { CHF: 129, EUR: 129, USD: 139 }, yearly: { CHF: 1290, EUR: 1290, USD: 1390 } },
    enterprise: { label: 'Enterprise', quotaGb: 50000, seats: 50, fromMonthly: { CHF: 490, EUR: 490, USD: 529 }, contact: 'business@focvault.app' },
    seat: { monthly: { CHF: 8, EUR: 8, USD: 9 }, yearly: { CHF: 80, EUR: 80, USD: 90 } }
  },
  trashDays: 30,
  versions: { days: 30, max: 10 },
  storage: { backend: 'filone', focUsdPerTibMonthPerCopy: 2.5, focCopies: 2 },
  api: {
    perGbMonth: { CHF: 0.015, EUR: 0.015, USD: 0.016 },
    egressPerGb: { CHF: 0.01, EUR: 0.01, USD: 0.01 },
    includedEgressRatio: 1,
    minMonthly: { CHF: 5, EUR: 5, USD: 5 }
  }
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function toChf(p: PricingConfig, amount: number, currency: Currency): number {
  return currency === 'CHF' ? amount : currency === 'EUR' ? amount * p.fx.eurToChf : amount * p.fx.usdToChf
}

/** Preis pro Abrechnungsintervall. */
export function priceOf(item: { monthly: Money; yearly: Money }, interval: Interval, currency: Currency): number {
  return (interval === 'year' ? item.yearly : item.monthly)[currency]
}

/** Auf einen Monat umgelegter Preis (Jahrespreis / 12). */
export function monthlyEquivalent(item: { monthly: Money; yearly: Money }, interval: Interval, currency: Currency): number {
  return interval === 'year' ? item.yearly[currency] / 12 : item.monthly[currency]
}

/** Ersparnis des Jahresabos gegenüber 12 Monatszahlungen in Prozent. */
export function yearlySavingsPct(item: { monthly: Money; yearly: Money }, currency: Currency): number {
  const twelve = item.monthly[currency] * 12
  return twelve > 0 ? Math.round((1 - item.yearly[currency] / twelve) * 100) : 0
}

/** GB (10^9) pro TiB (2^40) – FOC rechnet in TiB, wir in GB. */
const GB_PER_TIB = 2 ** 40 / GB

/** Speicherkosten pro GB und Monat in USD je Anbieter. */
export function costUsdPerGb(p: PricingConfig, backend: StorageBackend = p.storage.backend): number {
  const filone = p.filOneUsdPerTbMonth / 1000
  const foc = (p.storage.focUsdPerTibMonthPerCopy * p.storage.focCopies) / GB_PER_TIB
  return backend === 'filone' ? filone : backend === 'foc' ? foc : filone + foc
}

/** Kosten pro gespeichertem GB und Monat in CHF (ohne Fil-One-Minimum). */
export function costChfPerGb(p: PricingConfig, backend: StorageBackend = p.storage.backend): number {
  return costUsdPerGb(p, backend) * p.fx.usdToChf
}

/** Aufschlag (Preis ÷ Kosten − 1) und Marge (Gewinn ÷ Preis) für einen GB-Preis. */
export function markupOf(p: PricingConfig, pricePerGb: number, currency: Currency, backend: StorageBackend = p.storage.backend) {
  const price = toChf(p, pricePerGb, currency)
  const cost = costChfPerGb(p, backend)
  return { markupPct: cost > 0 ? (price / cost - 1) * 100 : 0, marginPct: price > 0 ? (1 - cost / price) * 100 : 0 }
}

export function stripeFee(p: PricingConfig, amountChf: number): number {
  return amountChf > 0 ? (amountChf * p.stripePercent) / 100 + p.stripeFixedChf : 0
}

export interface PaygEstimate {
  /** GB über der Free-Quota (Durchschnitt des Monats) */
  billableGb: number
  /** Betrag vor Mindestbetrag */
  amount: number
  /** wird diesen Monat verrechnet (sonst in den nächsten Monat übertragen) */
  charged: boolean
  /** ab dieser Zusatzmenge wäre Pro (Monatsabo) günstiger */
  proBreakEvenGb: number
}

/**
 * Pay-as-you-go: nur der Teil über der Free-Quota, nach durchschnittlich belegtem Speicher.
 * Beträge unter dem Mindestbetrag verfallen nicht – sie werden in den Folgemonat übertragen.
 */
export function paygEstimate(p: PricingConfig, storedBytes: number, currency: Currency): PaygEstimate {
  const billableGb = Math.max(0, storedBytes - p.free.quotaGb * GB) / GB
  const perGb = p.payg.perGbMonth[currency]
  const amount = round2(billableGb * perGb)
  return {
    billableGb,
    amount,
    charged: amount >= p.payg.minInvoice[currency],
    proBreakEvenGb: perGb > 0 ? Math.ceil(p.plans.pro.monthly[currency] / perGb) : 0
  }
}

export interface UsageInput {
  free: { accounts: number; storedBytes: number }
  pro: { accounts: number; storedBytes: number }
  family: { accounts: number; storedBytes: number }
  business: { accounts: number; storedBytes: number }
  /** Umsatz pro Monat in CHF (Jahresabos auf den Monat umgelegt) */
  revenue: { proChf: number; familyChf: number; addonsChf: number; paygChf: number }
  /** Rechnungen pro Monat (Jahresabos zählen 1/12) – Basis der Stripe-Fixgebühr */
  invoicesPerMonth: number
  addonsActive: number
  paygBillableBytes: number
}

export interface Economics {
  storedBytes: number
  cost: { storageUsd: number; storageChf: number; stripeChf: number; totalChf: number }
  revenue: { proChf: number; familyChf: number; addonsChf: number; paygChf: number; totalChf: number }
  grossProfitChf: number
  grossMarginPct: number
  freeTier: {
    accounts: number
    subsidyChf: number
    perAccountChf: number
    worstCaseChf: number
    budgetChf: number
    budgetUsedPct: number
    proCustomersToCover: number
  }
  perPlan: Array<{
    plan: 'free' | 'pro' | 'family' | 'business'
    accounts: number
    storedBytes: number
    costChf: number
    revenueChf: number
    avgUtilPct: number
  }>
}

export function computeEconomics(p: PricingConfig, u: UsageInput): Economics {
  const perGb = costChfPerGb(p)
  const storedBytes = u.free.storedBytes + u.pro.storedBytes + u.family.storedBytes + u.business.storedBytes
  const storageUsd = Math.max(p.filOneMinUsd, (storedBytes / TB) * p.filOneUsdPerTbMonth)
  const storageChf = storageUsd * p.fx.usdToChf
  const r = u.revenue
  const revenueTotal = r.proChf + r.familyChf + r.addonsChf + r.paygChf
  const stripeChf = revenueTotal > 0 ? (revenueTotal * p.stripePercent) / 100 + u.invoicesPerMonth * p.stripeFixedChf : 0
  const totalCost = storageChf + stripeChf
  const gross = revenueTotal - totalCost

  // Geschenkt ist nur der Speicher innerhalb der Free-Quota – der PAYG-Anteil wird bezahlt.
  const subsidy = (Math.max(0, u.free.storedBytes - u.paygBillableBytes) / GB) * perGb
  const worstCase = u.free.accounts * p.free.quotaGb * perGb
  const proPrice = p.plans.pro.monthly.CHF
  const proAvgGb = u.pro.accounts > 0 ? u.pro.storedBytes / u.pro.accounts / GB : p.plans.pro.quotaGb * 0.3
  const proMargin = proPrice - stripeFee(p, proPrice) - proAvgGb * perGb

  const quotaGbOf = { free: p.free.quotaGb, pro: p.plans.pro.quotaGb, family: p.plans.family.quotaGb, business: 0 }
  const revenueOf = { free: r.paygChf, pro: r.proChf, family: r.familyChf, business: 0 }
  const perPlan = (['free', 'pro', 'family', 'business'] as const).map(plan => {
    const row = u[plan]
    const quota = quotaGbOf[plan] * GB * row.accounts
    return {
      plan,
      accounts: row.accounts,
      storedBytes: row.storedBytes,
      costChf: round2((row.storedBytes / GB) * perGb),
      revenueChf: round2(revenueOf[plan]),
      avgUtilPct: quota > 0 ? round2((row.storedBytes / quota) * 100) : 0
    }
  })

  return {
    storedBytes,
    cost: { storageUsd: round2(storageUsd), storageChf: round2(storageChf), stripeChf: round2(stripeChf), totalChf: round2(totalCost) },
    revenue: {
      proChf: round2(r.proChf),
      familyChf: round2(r.familyChf),
      addonsChf: round2(r.addonsChf),
      paygChf: round2(r.paygChf),
      totalChf: round2(revenueTotal)
    },
    grossProfitChf: round2(gross),
    grossMarginPct: revenueTotal > 0 ? round2((gross / revenueTotal) * 100) : 0,
    freeTier: {
      accounts: u.free.accounts,
      subsidyChf: round2(subsidy),
      perAccountChf: u.free.accounts > 0 ? subsidy / u.free.accounts : 0,
      worstCaseChf: round2(worstCase),
      budgetChf: p.freeTier.monthlyBudgetChf,
      budgetUsedPct: p.freeTier.monthlyBudgetChf > 0 ? round2((subsidy / p.freeTier.monthlyBudgetChf) * 100) : 0,
      proCustomersToCover: proMargin > 0 ? Math.ceil(subsidy / proMargin) : 0
    },
    perPlan
  }
}

export interface ScenarioInput {
  users: number
  paidPct: number
  familyPct: number
  /** Anteil der Abos im Jahresmodell */
  yearlyPct: number
  /** Währungsmix der zahlenden Kunden in % (Summe 100) */
  chfPct: number
  eurPct: number
  usdPct: number
  freeUtilPct: number
  paidUtilPct: number
  addonAttachPct: number
  addonAvgGb: number
  addonUtilPct: number
  paygPct: number
  paygAvgGb: number
}

export const DEFAULT_SCENARIO: ScenarioInput = {
  users: 100_000,
  paidPct: 3,
  familyPct: 25,
  yearlyPct: 40,
  chfPct: 35,
  eurPct: 50,
  usdPct: 15,
  freeUtilPct: 30,
  paidUtilPct: 30,
  addonAttachPct: 10,
  addonAvgGb: 500,
  addonUtilPct: 40,
  paygPct: 1,
  paygAvgGb: 150
}

/** Hochrechnung – gleiche Rechnung wie die Ist-Auswertung. */
export function scenario(p: PricingConfig, s: ScenarioInput): Economics {
  const paid = Math.round((s.users * s.paidPct) / 100)
  const family = Math.round((paid * s.familyPct) / 100)
  const pro = paid - family
  const free = s.users - paid
  const payg = Math.round((free * s.paygPct) / 100)
  const addons = Math.round((paid * s.addonAttachPct) / 100)
  const mixTotal = s.chfPct + s.eurPct + s.usdPct || 1
  const mix: Record<Currency, number> = { CHF: s.chfPct / mixTotal, EUR: s.eurPct / mixTotal, USD: s.usdPct / mixTotal }
  const yearly = s.yearlyPct / 100

  /** Ø Monatsumsatz in CHF für ein Produkt über Währungs- und Intervallmix. */
  const avgChf = (item: { monthly: Money; yearly: Money }) =>
    CURRENCIES.reduce(
      (sum, c) =>
        sum + mix[c] * toChf(p, (1 - yearly) * monthlyEquivalent(item, 'month', c) + yearly * monthlyEquivalent(item, 'year', c), c),
      0
    )
  const pack = p.addons.reduce((best, a) => (Math.abs(a.gb - s.addonAvgGb) < Math.abs(best.gb - s.addonAvgGb) ? a : best), p.addons[0])
  const paygChfPerAccount = CURRENCIES.reduce((sum, c) => {
    const est = paygEstimate(p, (p.free.quotaGb + s.paygAvgGb) * GB, c)
    return sum + mix[c] * toChf(p, est.amount, c)
  }, 0)
  const addonBytes = (accounts: number) =>
    paid > 0 && pack ? addons * (accounts / paid) * pack.gb * GB * (s.addonUtilPct / 100) : 0

  return computeEconomics(p, {
    free: {
      accounts: free,
      storedBytes: (free - payg) * p.free.quotaGb * GB * (s.freeUtilPct / 100) + payg * (p.free.quotaGb + s.paygAvgGb) * GB
    },
    pro: { accounts: pro, storedBytes: pro * p.plans.pro.quotaGb * GB * (s.paidUtilPct / 100) + addonBytes(pro) },
    family: { accounts: family, storedBytes: family * p.plans.family.quotaGb * GB * (s.paidUtilPct / 100) + addonBytes(family) },
    business: { accounts: 0, storedBytes: 0 },
    revenue: {
      proChf: pro * avgChf(p.plans.pro),
      familyChf: family * avgChf(p.plans.family),
      addonsChf: pack ? addons * avgChf(pack) : 0,
      paygChf: payg * paygChfPerAccount
    },
    invoicesPerMonth: paid * (1 - yearly) + (paid * yearly) / 12 + payg,
    addonsActive: addons,
    paygBillableBytes: payg * s.paygAvgGb * GB
  })
}

const SYMBOL: Record<Currency, string> = { CHF: 'CHF', EUR: '€', USD: '$' }

/** Betrag formatiert: „13.90 CHF", „13,90 €", „$14.90". */
export function money(amount: number, currency: Currency, locale: 'de' | 'en' = 'de', digits = 2): string {
  const loc = locale === 'en' ? 'en-US' : currency === 'EUR' ? 'de-DE' : 'de-CH'
  const n = amount.toLocaleString(loc, { minimumFractionDigits: digits, maximumFractionDigits: digits })
  if (currency === 'USD') return `$${n}`
  if (currency === 'EUR') return locale === 'en' ? `€${n}` : `${n} €`
  return `${n} ${SYMBOL.CHF}`
}

/** Interne CHF-Beträge (Admin). */
export function chf(n: number, digits = 2): string {
  return money(n, 'CHF', 'de', digits)
}

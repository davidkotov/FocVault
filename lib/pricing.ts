/**
 * Preisbuch und Wirtschaftlichkeit (reine Funktionen – Client und Server).
 * Einheiten: 1 GB = 10^9 Byte, 1 TB = 10^12 Byte (wie Fil One und die Konkurrenz abrechnen).
 */

export const GB = 1e9
export const TB = 1e12

export interface PlanPrice {
  label: string
  quotaGb: number
  chfPerMonth: number
}

export interface AddonPack {
  id: string
  gb: number
  chfPerMonth: number
}

export interface PricingConfig {
  /** Fil One Listenpreis: $4.99 / TB / Monat auf den Tagesdurchschnitt */
  filOneUsdPerTbMonth: number
  /** Fil One Monatsminimum */
  filOneMinUsd: number
  /** Umrechnung USD → CHF (quartalsweise pflegen) */
  usdToChf: number
  /** Stripe: Prozent + Fixbetrag pro Rechnung */
  stripePercent: number
  stripeFixedChf: number
  free: { quotaGb: number }
  payg: { chfPerGbMonth: number; minInvoiceChf: number; defaultCapGb: number; maxCapGb: number }
  plans: { pro: PlanPrice; family: PlanPrice & { seats: number } }
  addons: AddonPack[]
  freeTier: {
    /** Budgetgrenze für den geschenkten Free-Speicher pro Monat */
    monthlyBudgetChf: number
    /** Inaktive Free-Konten: Warnung / Löschung nach so vielen Tagen ohne Login */
    inactiveWarnDays: number
    inactiveDeleteDays: number
  }
}

export const DEFAULT_PRICING: PricingConfig = {
  filOneUsdPerTbMonth: 4.99,
  filOneMinUsd: 4.99,
  usdToChf: 0.85,
  stripePercent: 2.9,
  stripeFixedChf: 0.3,
  free: { quotaGb: 5 },
  payg: { chfPerGbMonth: 0.02, minInvoiceChf: 2, defaultCapGb: 100, maxCapGb: 1000 },
  plans: {
    pro: { label: 'Pro', quotaGb: 1000, chfPerMonth: 13.9 },
    family: { label: 'Family', quotaGb: 2000, chfPerMonth: 19.9, seats: 6 }
  },
  addons: [
    { id: 'plus-200', gb: 200, chfPerMonth: 2.9 },
    { id: 'plus-500', gb: 500, chfPerMonth: 5.9 },
    { id: 'plus-1000', gb: 1000, chfPerMonth: 9.9 },
    { id: 'plus-2000', gb: 2000, chfPerMonth: 17.9 }
  ],
  freeTier: { monthlyBudgetChf: 1000, inactiveWarnDays: 365, inactiveDeleteDays: 540 }
}

/** Kosten pro gespeichertem GB und Monat in CHF (ohne Fil-One-Minimum). */
export function costChfPerGb(p: PricingConfig): number {
  return (p.filOneUsdPerTbMonth / 1000) * p.usdToChf
}

export function stripeFee(p: PricingConfig, amountChf: number): number {
  return amountChf > 0 ? (amountChf * p.stripePercent) / 100 + p.stripeFixedChf : 0
}

/** Pay-as-you-go-Rechnung eines Free-Kontos: nur der Teil über der Free-Quota, ab Mindestbetrag. */
export function paygInvoiceChf(p: PricingConfig, storedBytes: number): number {
  const billableGb = Math.max(0, storedBytes - p.free.quotaGb * GB) / GB
  const amount = billableGb * p.payg.chfPerGbMonth
  return amount >= p.payg.minInvoiceChf ? round2(amount) : 0
}

export interface UsageInput {
  free: { accounts: number; storedBytes: number }
  pro: { accounts: number; storedBytes: number }
  family: { accounts: number; storedBytes: number }
  business: { accounts: number; storedBytes: number }
  addons: { active: number; chfPerMonth: number }
  /** Summe der PAYG-Rechnungen (bereits mit Mindestbetrag gerechnet) und Anzahl Rechnungen */
  payg: { invoices: number; chfPerMonth: number; billableBytes: number }
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
    /** so viele Pro-Kunden finanzieren den heutigen Free-Speicher */
    proCustomersToCover: number
  }
  perPlan: Array<{ plan: 'free' | 'pro' | 'family' | 'business'; accounts: number; storedBytes: number; costChf: number; revenueChf: number; avgUtilPct: number }>
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function computeEconomics(p: PricingConfig, u: UsageInput): Economics {
  const perGb = costChfPerGb(p)
  const storedBytes = u.free.storedBytes + u.pro.storedBytes + u.family.storedBytes + u.business.storedBytes
  const storageUsd = Math.max(p.filOneMinUsd, (storedBytes / TB) * p.filOneUsdPerTbMonth)
  const storageChf = storageUsd * p.usdToChf

  const proChf = u.pro.accounts * p.plans.pro.chfPerMonth
  const familyChf = u.family.accounts * p.plans.family.chfPerMonth
  const revenueTotal = proChf + familyChf + u.addons.chfPerMonth + u.payg.chfPerMonth
  const invoices = u.pro.accounts + u.family.accounts + u.payg.invoices
  const stripeChf = invoices > 0 ? (revenueTotal * p.stripePercent) / 100 + invoices * p.stripeFixedChf : 0
  const totalCost = storageChf + stripeChf
  const gross = revenueTotal - totalCost

  // Geschenkt ist nur der Speicher innerhalb der Free-Quota – der PAYG-Anteil wird bezahlt.
  const subsidy = (Math.max(0, u.free.storedBytes - u.payg.billableBytes) / GB) * perGb
  const worstCase = u.free.accounts * p.free.quotaGb * perGb
  const proMargin =
    p.plans.pro.chfPerMonth -
    stripeFee(p, p.plans.pro.chfPerMonth) -
    (u.pro.accounts > 0 ? (u.pro.storedBytes / u.pro.accounts / GB) * perGb : p.plans.pro.quotaGb * 0.3 * perGb)

  const quotaGbOf = { free: p.free.quotaGb, pro: p.plans.pro.quotaGb, family: p.plans.family.quotaGb, business: 0 }
  const perPlan = (['free', 'pro', 'family', 'business'] as const).map(plan => {
    const row = u[plan]
    const revenueChf =
      plan === 'pro' ? proChf : plan === 'family' ? familyChf : plan === 'free' ? u.payg.chfPerMonth : 0
    const quota = quotaGbOf[plan] * GB * row.accounts
    return {
      plan,
      accounts: row.accounts,
      storedBytes: row.storedBytes,
      costChf: round2((row.storedBytes / GB) * perGb),
      revenueChf: round2(revenueChf),
      avgUtilPct: quota > 0 ? round2((row.storedBytes / quota) * 100) : 0
    }
  })

  return {
    storedBytes,
    cost: { storageUsd: round2(storageUsd), storageChf: round2(storageChf), stripeChf: round2(stripeChf), totalChf: round2(totalCost) },
    revenue: {
      proChf: round2(proChf),
      familyChf: round2(familyChf),
      addonsChf: round2(u.addons.chfPerMonth),
      paygChf: round2(u.payg.chfPerMonth),
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
  /** Anteil zahlender Kunden in % (Branche: 2–4 %) */
  paidPct: number
  /** davon Family in % */
  familyPct: number
  /** Auslastung der Quota in % */
  freeUtilPct: number
  paidUtilPct: number
  /** Anteil Abos mit Zusatzspeicher in %, Ø-Paketpreis */
  addonAttachPct: number
  addonAvgChf: number
  addonUtilPct: number
  addonAvgGb: number
  /** Free-Nutzer mit Pay-as-you-go in %, Ø zusätzliche GB */
  paygPct: number
  paygAvgGb: number
}

export const DEFAULT_SCENARIO: ScenarioInput = {
  users: 100_000,
  paidPct: 3,
  familyPct: 25,
  freeUtilPct: 30,
  paidUtilPct: 30,
  addonAttachPct: 10,
  addonAvgChf: 5.9,
  addonUtilPct: 40,
  addonAvgGb: 500,
  paygPct: 1,
  paygAvgGb: 150
}

/** Hochrechnung für ein Szenario – gleiche Rechnung wie die Ist-Auswertung. */
export function scenario(p: PricingConfig, s: ScenarioInput): Economics {
  const paid = Math.round((s.users * s.paidPct) / 100)
  const family = Math.round((paid * s.familyPct) / 100)
  const pro = paid - family
  const free = s.users - paid
  const payg = Math.round((free * s.paygPct) / 100)
  const addons = Math.round((paid * s.addonAttachPct) / 100)
  const paygInvoice = paygInvoiceChf(p, (p.free.quotaGb + s.paygAvgGb) * GB)
  return computeEconomics(p, {
    free: {
      accounts: free,
      storedBytes: (free - payg) * p.free.quotaGb * GB * (s.freeUtilPct / 100) + payg * (p.free.quotaGb + s.paygAvgGb) * GB
    },
    pro: { accounts: pro, storedBytes: pro * p.plans.pro.quotaGb * GB * (s.paidUtilPct / 100) + addonBytes(pro) },
    family: { accounts: family, storedBytes: family * p.plans.family.quotaGb * GB * (s.paidUtilPct / 100) + addonBytes(family) },
    business: { accounts: 0, storedBytes: 0 },
    addons: { active: addons, chfPerMonth: addons * s.addonAvgChf },
    payg: { invoices: paygInvoice > 0 ? payg : 0, chfPerMonth: payg * paygInvoice, billableBytes: payg * s.paygAvgGb * GB }
  })

  function addonBytes(accounts: number): number {
    return paid > 0 ? (addons * (accounts / paid)) * s.addonAvgGb * GB * (s.addonUtilPct / 100) : 0
  }
}

/** Beträge CHF im Schweizer Format, z. B. „1'234.50 CHF". */
export function chf(n: number, digits = 2): string {
  return `${n.toLocaleString('de-CH', { minimumFractionDigits: digits, maximumFractionDigits: digits })} CHF`
}

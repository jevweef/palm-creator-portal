// ── Infloww platform-fee forecast ────────────────────────────────────────────
//
// Infloww charges a monthly platform fee PER OnlyFans account, scaled by the
// creator's GROSS monthly earnings (gross = before OnlyFans' 20% cut), measured
// over the full calendar month (1st → last day).
//
// Billing cadence (confirmed with ManageHer/Infloww, 2026-06):
//   - Infloww looks at each creator's revenue for the entire month (1st–EOM).
//   - It charges ONCE a month, on the 1st.
//   - Therefore Palm only pays the Infloww fee on the SECOND invoice of the
//     month (the 15th–EOM period). First-half (1st–14th) invoices carry $0.
//
// Tier table below is Infloww's "New price" schedule, effective Feb 1, 2026.
// Source: https://help.infloww.com/en/articles/529787-pricing-update-overview-effective-feb-1-2026
//
// NOTE: only the OnlyFans tier table is published. Fansly/MYM start at a $50
// floor vs OF's $40. Every Palm revenue account is OnlyFans today, so we only
// implement the OF schedule; pass platform for future-proofing.

// Ascending by upper bound. A creator's gross falls in the FIRST tier whose
// `upTo` it does not exceed. Boundaries follow Infloww's table exactly:
//   $0–$500 → $40, $500.01–$1,000 → $50, $1,000.01–$2,000 → $65, …
export const INFLOWW_OF_TIERS = [
  { upTo: 500,      fee: 40 },
  { upTo: 1000,     fee: 50 },
  { upTo: 2000,     fee: 65 },
  { upTo: 5000,     fee: 70 },
  { upTo: 7500,     fee: 90 },
  { upTo: 10000,    fee: 125 },
  { upTo: 15000,    fee: 175 },
  { upTo: 30000,    fee: 225 },
  { upTo: 45000,    fee: 275 },
  { upTo: 60000,    fee: 300 },
  { upTo: 75000,    fee: 400 },
  { upTo: Infinity, fee: 500 },
]

/**
 * Forecasted monthly Infloww fee for one account.
 * @param {number} grossMonthlyEarnings - full calendar-month GROSS (before OF's 20% cut)
 * @param {string} [platform='OnlyFans'] - reserved; only OnlyFans tiers are published
 * @returns {number} monthly fee in dollars (0 if no/negative earnings)
 */
export function inflowwMonthlyFee(grossMonthlyEarnings, platform = 'OnlyFans') {
  const gross = Number(grossMonthlyEarnings)
  if (!Number.isFinite(gross) || gross <= 0) return 0
  const tier = INFLOWW_OF_TIERS.find(t => gross <= t.upTo)
  return tier ? tier.fee : 0
}

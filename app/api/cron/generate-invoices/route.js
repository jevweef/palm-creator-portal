/**
 * Scheduled invoice creation.
 *
 * Replaces the (incomplete) Airtable automation: "Scheduled Invoice Creation
 * for Creators". Runs twice a month via Vercel cron — on the 1st and 15th —
 * and creates one placeholder Creator Invoices (Weekly) record per active
 * OnlyFans Revenue Account for the pay period that just ended.
 *
 * Pay periods are semi-monthly:
 *   - 1st → 14th
 *   - 15th → end of month
 * (OF day boundary is 8pm ET = midnight UTC. Period dates are calendar dates
 * — the field values themselves are TZ-agnostic. The cron schedule below
 * fires after both period endings in ET.)
 *
 * Snapshot logic: at creation we copy the creator's current Commission %
 * into Commission % (Snapshot). This locks the rate for that pay period so
 * future commission changes don't retroactively alter old invoices —
 * replacing the "Snapshot Commission %" Airtable automation in one shot.
 *
 * Invocation:
 *   GET  /api/cron/generate-invoices  → Vercel cron (auth: Bearer CRON_SECRET)
 *   POST /api/cron/generate-invoices  → manual admin trigger
 *        body: { dryRun?: bool, periodStart?: 'YYYY-MM-DD', periodEnd?: 'YYYY-MM-DD' }
 */

import { fetchHqRecords, createHqRecord } from '@/lib/hqAirtable'
import { requireAdmin } from '@/lib/adminAuth'

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'
const HQ_REVENUE_ACCOUNTS = 'tblQqPWlsjiyJA0ba'
const HQ_INVOICES = 'tblKbU8VkdlOHXoJj'

/**
 * Compute the pay period that JUST ENDED relative to a given UTC date.
 *   - On day 1: returns last month's 15 → end-of-month
 *   - On day 15: returns this month's 1 → 14
 *   - Other days (manual run): returns the most recently ended period
 */
export function computePeriodFor(date = new Date()) {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth() // 0-indexed
  const d = date.getUTCDate()

  if (d >= 15) {
    // Second half of month — period 1–14 of THIS month just ended
    return { start: ymd(y, m, 1), end: ymd(y, m, 14) }
  }
  // First half — period 15–EOM of LAST month just ended
  const prevMonth = m === 0 ? 11 : m - 1
  const prevYear = m === 0 ? y - 1 : y
  const lastDay = new Date(Date.UTC(prevYear, prevMonth + 1, 0)).getUTCDate()
  return { start: ymd(prevYear, prevMonth, 15), end: ymd(prevYear, prevMonth, lastDay) }
}

function ymd(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

async function generateInvoicesForPeriod({ start, end, dryRun = false }) {
  // 1. Active OnlyFans Revenue Accounts (skip Fansly + Paused/Inactive)
  const revenueAccounts = await fetchHqRecords(HQ_REVENUE_ACCOUNTS, {
    filterByFormula: `AND({Status}='Active', {Platform}='OnlyFans')`,
    fields: ['Account Name', 'Creator', 'Status', 'Platform'],
  })

  // 2. Existing invoices for this period (idempotency check)
  const existing = await fetchHqRecords(HQ_INVOICES, {
    filterByFormula: `AND(DATETIME_FORMAT({Period Start},'YYYY-MM-DD')='${start}',DATETIME_FORMAT({Period End},'YYYY-MM-DD')='${end}')`,
    fields: ['Revenue Account'],
  })
  const coveredAccountIds = new Set()
  for (const inv of existing) {
    const linked = inv.fields['Revenue Account'] || []
    linked.forEach(id => coveredAccountIds.add(id))
  }

  // 3. Batch-fetch creator commissions for all linked creators
  const creatorIds = new Set()
  for (const ra of revenueAccounts) {
    ;(ra.fields['Creator'] || []).forEach(id => creatorIds.add(id))
  }
  const creatorCommission = new Map()
  if (creatorIds.size > 0) {
    const filter = `OR(${[...creatorIds].map(id => `RECORD_ID()='${id}'`).join(',')})`
    const creators = await fetchHqRecords(HQ_CREATORS, {
      filterByFormula: filter,
      fields: ['Commission %'],
    })
    for (const c of creators) {
      creatorCommission.set(c.id, c.fields['Commission %'])
    }
  }

  // 4. Create one invoice per uncovered active account
  const created = []
  const skipped = []

  for (const ra of revenueAccounts) {
    const accountName = ra.fields['Account Name']
    if (coveredAccountIds.has(ra.id)) {
      skipped.push({ accountName, reason: 'already exists for this period' })
      continue
    }
    const creatorId = (ra.fields['Creator'] || [])[0]
    if (!creatorId) {
      skipped.push({ accountName, reason: 'no Creator linked' })
      continue
    }
    const commission = creatorCommission.get(creatorId)
    if (commission == null) {
      skipped.push({ accountName, reason: 'creator has no Commission %' })
      continue
    }

    if (dryRun) {
      created.push({ accountName, creatorId, commission, dryRun: true })
      continue
    }

    const fields = {
      'Creator': [creatorId],
      'Revenue Account': [ra.id],
      'Account Name': [ra.id],
      'Period Start': start,
      'Period End': end,
      'Commission % (Snapshot)': commission,
      'Invoice Status': 'Draft',
    }
    try {
      const rec = await createHqRecord(HQ_INVOICES, fields)
      created.push({ accountName, invoiceId: rec.id, commission })
    } catch (err) {
      console.error('[generate-invoices] failed for', accountName, err.message)
      skipped.push({ accountName, reason: err.message })
    }
  }

  return {
    period: { start, end },
    totalActiveAccounts: revenueAccounts.length,
    createdCount: created.length,
    skippedCount: skipped.length,
    details: { created, skipped },
  }
}

export const maxDuration = 60

export async function GET(request) {
  // Vercel cron auto-includes Bearer CRON_SECRET when the env var is set
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const period = computePeriodFor(new Date())
    const result = await generateInvoicesForPeriod(period)
    return Response.json(result)
  } catch (err) {
    console.error('[cron generate-invoices] failed:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const body = await request.json().catch(() => ({}))
    const period = (body.periodStart && body.periodEnd)
      ? { start: body.periodStart, end: body.periodEnd }
      : computePeriodFor(new Date())
    const result = await generateInvoicesForPeriod({ ...period, dryRun: !!body.dryRun })
    return Response.json(result)
  } catch (err) {
    console.error('[generate-invoices POST] failed:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
